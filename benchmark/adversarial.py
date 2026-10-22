"""Seeded nonhuman adversarial suite. Never rank human accuracy with these results."""
import argparse
import csv
import json
from pathlib import Path
import time
import numpy as np
from .adapters import NAMES, build_adapters
from .data import aligned_window
from .metrics import metrics, subject_bootstrap
from .quality import input_quality, reliable_heart_rate, InsufficientSignal, POLICY
from .run import hardware
from .signal import heart_rate


CASES = ('clean', 'no_pulse', 'noise', 'second_harmonic', 'mixed_motion',
         'spatial_motion', 'illumination', 'low_fps', 'occlusion', 'multiple_faces',
         'lost_face', 'unknown_roi', 'indistinguishable_color_artifact')


def fixture(subject, case):
    rng = np.random.default_rng(2026+subject)
    t = np.arange(481)/30
    bpm = [54.,72.,83.2,108.,127.3,150.][subject % 6]
    p = np.sin(2*np.pi*bpm/60*t+.3*subject)
    if case in ('second_harmonic', 'mixed_motion'):
        bpm = 72.
        p = np.sin(2*np.pi*1.2*t)+(3*np.sin(2*np.pi*2.4*t) if case == 'second_harmonic' else 4*np.sin(2*np.pi*1.6*t))
    if case == 'no_pulse': p = np.zeros(len(t))
    if case == 'noise': p = rng.normal(size=len(t))
    if case == 'indistinguishable_color_artifact': p = np.sin(2*np.pi*1.6*t)
    rgb = np.array([130,100,80])+p[:,None]*np.array([1,4,.5])
    if case == 'illumination': rgb = np.array([130,100,80])*(1+.2*np.sin(2*np.pi*1.6*t[:,None]))
    frames = np.broadcast_to(np.clip(rgb,0,255).astype(np.uint8)[:,None,None,:], (481,32,32,3)).copy()
    if case == 'spatial_motion':
        stripe = (np.indices((32,32))[1] % 8 < 4)*60
        for i, ti in enumerate(t):
            frames[i] = np.clip(frames[i].astype(float)+np.roll(stripe, round(6*np.sin(2*np.pi*1.6*ti)), axis=1)[:,:,None],0,255)
    data = dict(frames=frames, timestamps=t, reference_timestamps=np.arange(17.),
                reference_bpm=np.full(17,bpm), face_count=np.ones(481), roi_valid=np.ones(481))
    if case == 'low_fps':
        for key in ('frames','timestamps','face_count','roi_valid'): data[key] = data[key][::3]
    if case == 'occlusion': data['roi_valid'][200:210] = 0
    if case == 'multiple_faces': data['face_count'][200:210] = 2
    if case == 'lost_face': data['face_count'][200:210] = 0
    if case == 'unknown_roi': data.pop('roi_valid')
    return data, bpm


def evaluate(out):
    out = Path(out); out.mkdir(parents=True, exist_ok=False)
    adapters, states = build_adapters()
    rows = []
    start = time.perf_counter()
    for subject in range(8):
        for case in CASES:
            data, bpm = fixture(subject, case)
            for name in NAMES:
                row = dict(algorithm=name, subject_id=f'synthetic-{subject}',
                           split='validation' if subject < 2 else 'test', case=case,
                           status='NOT_RUN', reason=None, reference_bpm=bpm if case == 'clean' else None,
                           predicted_bpm=None, raw_candidate_bpm=None, inference_s=0., quality={})
                tick = time.perf_counter()
                if name not in adapters:
                    row['reason'] = states[name]['reason']
                else:
                    try:
                        frames, _, audit, telemetry = aligned_window(data, 0, include_telemetry=True)
                        row['alignment'] = audit
                        wave = adapters[name].predict(frames)
                        try: row['raw_candidate_bpm'] = heart_rate(wave)
                        except ValueError: pass
                        row['quality'] = input_quality(frames, telemetry)
                        row['predicted_bpm'], spectral = reliable_heart_rate(wave)
                        row['quality'].update(spectral)
                        row['status'] = 'ok'
                    except InsufficientSignal as e:
                        row.update(status='insufficient_signal', reason=str(e))
                        row['quality'].update(e.audit)
                    except Exception as e:
                        row.update(status='failed', reason=f'{type(e).__name__}: {e}')
                row['inference_s'] = time.perf_counter()-tick
                rows.append(row)
    report = []
    for name in NAMES:
        for split in ('validation','test'):
            selected = [r for r in rows if r['algorithm'] == name and r['split'] == split]
            positives = [r for r in selected if r['case'] == 'clean']
            negatives = [r for r in selected if r['case'] != 'clean']
            ran = [r for r in selected if r['status'] != 'NOT_RUN']
            report.append(dict(algorithm=name, split=split,
                status='RUN_SYNTHETIC_ONLY' if ran else 'NOT_RUN',
                positive_metrics=metrics(positives), positive_ci=subject_bootstrap(positives),
                negative_windows=len(negatives),
                false_accepts=sum(r['status'] == 'ok' for r in negatives) if ran else None,
                false_accept_rate=sum(r['status'] == 'ok' for r in negatives)/len(negatives) if ran else None,
                raw_false_accepts=sum(r['raw_candidate_bpm'] is not None for r in negatives) if ran else None,
                rejection_rate=sum(r['status'] == 'insufficient_signal' for r in selected)/len(selected) if ran else None,
                all_window_coverage=sum(r['status'] == 'ok' for r in selected)/len(selected) if ran else None))
    (out/'windows.jsonl').write_text(''.join(json.dumps(r, allow_nan=False)+'\n' for r in rows), encoding='utf-8')
    fields = [k for k in rows[0] if k not in ('quality','alignment')]
    with (out/'windows.csv').open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore'); w.writeheader(); w.writerows(rows)
    summary = dict(synthetic=True, seed=2026, policy=POLICY, hardware=hardware(),
                   threshold_selection='fixed engineering defaults; validation split diagnostic only; no human calibration',
                   elapsed_s=time.perf_counter()-start, rows=len(rows), metrics=report,
                   caveat='Color artifacts identical to a pulse remain false accepts. No human or product accuracy claim.')
    (out/'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 1 if any(r['status'] in ('NOT_RUN','failed') or (r['case'] != 'clean' and r['status'] == 'ok') for r in rows) else 0


if __name__ == '__main__':
    p = argparse.ArgumentParser(__doc__); p.add_argument('--out', required=True)
    raise SystemExit(evaluate(p.parse_args().out))
