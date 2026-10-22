"""Evidence-first LOCAL UBFC DATASET_2 ingestion; never infer video clocks.

Does not download, grant permission, detect faces, tune thresholds or claim
accuracy. Empty/unavailable plans export BLOCKED with six NOT_RUN states.
Raw files, contact traces and evidence remain local, including generated NPZ.
"""
import argparse
import csv
import json
from pathlib import Path
import re
import time
import numpy as np
from .adapters import NAMES
from .data import check_times, load_manifest, sha256
from .prepare import prepare, read_csv

SAFE_ID = re.compile(r'^[a-zA-Z0-9_-]{1,80}$')
FILE_KEYS = ('video', 'timestamps', 'ground_truth', 'quality', 'sync_evidence')


def verified_file(root, spec):
    if not isinstance(spec, dict) or not spec.get('path'):
        raise ValueError('file path and SHA256 required')
    expected = spec.get('sha256', '')
    if not isinstance(expected,str) or not re.fullmatch('[0-9a-f]{64}', expected):
        raise ValueError('invalid expected SHA256')
    path = (root/spec['path']).resolve()
    if not path.is_file():
        raise ValueError('required local file unavailable')
    if sha256(path) != expected:
        raise ValueError('file checksum mismatch')
    return path


def parse_ground_truth(path):
    raw = np.loadtxt(path)
    if raw.ndim != 2 or raw.shape[0] != 3 or raw.shape[1] < 2:
        raise ValueError('UBFC DATASET_2 requires three equal rows: PPG, device HR, seconds')
    ppg, hr, rt = raw
    check_times(rt, 'contact reference')
    if rt[0] < 0 or not np.isfinite(ppg).all() or np.std(ppg) < 1e-8:
        raise ValueError('invalid contact PPG or time origin')
    # Preserve NaN/invalid device HR; aligned_window rejects affected windows.
    return rt, hr, dict(reference_samples=len(rt), reference_sampling_hz=1/float(np.median(np.diff(rt))),
                        reference_max_gap_s=float(np.diff(rt).max()), reference_duration_s=float(rt[-1]-rt[0]),
                        invalid_device_hr_samples=int((~np.isfinite(hr) | (hr < 30) | (hr > 240)).sum()),
                        reference_definition='CMS50E device HR; NOT HR derived from contact PPG and NOT original-paper protocol')


def inspect_plan(plan_path):
    plan_path = Path(plan_path).resolve()
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    if plan.get('schema_version') != 1 or plan.get('dataset') != 'UBFC-rPPG-DATASET_2':
        raise ValueError('schema_version=1 and dataset=UBFC-rPPG-DATASET_2 required')
    records = plan.get('records')
    if not isinstance(records, list):
        raise ValueError('records must be a list')
    blockers, inventory, paths = [], [], {}
    root = plan_path.parent
    if not records:
        blockers.append('NO_REAL_RECORDINGS: provide approved video, synchronized reference and per-frame sidecars')
    for key in ('dataset_version','source_url','permission_review','pretraining_overlap_review'):
        if not isinstance(plan.get(key), str) or not plan[key].strip():
            blockers.append('MISSING_'+key.upper())
    try:
        verified_file(root, plan.get('authorization_evidence'))
    except ValueError as e:
        blockers.append('AUTHORIZATION_EVIDENCE: '+str(e))
    subjects, ids, fingerprints = {}, set(), {}
    for r in records:
        if not isinstance(r, dict) or not isinstance(r.get('id'),str) or not isinstance(r.get('subject_id'),str):
            raise ValueError('record id and subject_id must be strings')
        row = dict(id=r.get('id'), subject_id=r.get('subject_id'), split=r.get('split'), status='BLOCKED', reasons=[])
        for field in ('id','subject_id'):
            if not isinstance(r.get(field), str) or not SAFE_ID.fullmatch(r[field]):
                row['reasons'].append('invalid anonymous '+field)
        rid = r.get('id')
        if rid in ids: row['reasons'].append('duplicate recording id')
        ids.add(rid)
        split = r.get('split')
        if split not in ('train','validation','test'): row['reasons'].append('invalid split')
        subject = r.get('subject_id')
        if subjects.setdefault(subject, split) != split: row['reasons'].append('subject leakage')
        for field in ('duration_s','reference_offset_s'):
            if not isinstance(r.get(field), (float,int)) or not np.isfinite(r[field]): row['reasons'].append('invalid '+field)
        if isinstance(r.get('duration_s'), (float,int)) and r['duration_s'] < 16: row['reasons'].append('duration below one full window')
        if not r.get('quality_source'): row['reasons'].append('missing per-frame quality verification source')
        if not r.get('sync_method'): row['reasons'].append('missing clock alignment method; frame-index/FPS assumption is not evidence')
        condition = r.get('conditions', {})
        if not isinstance(condition, dict) or any(k not in ('lighting','motion','device','skin_tone') or not isinstance(v,str) for k,v in condition.items()):
            row['reasons'].append('invalid conditions')
        if condition and not r.get('label_provenance'): row['reasons'].append('conditions need measured/source labels')
        files = {}
        for key in FILE_KEYS:
            try:
                files[key] = verified_file(root, r.get(key))
            except ValueError as e:
                row['reasons'].append(key+': '+str(e))
        digest = r.get('video',{}).get('sha256') if isinstance(r.get('video'),dict) else None
        if digest and fingerprints.setdefault(digest, rid) != rid:
            row['reasons'].append('duplicate raw video content')
        row['input_sha256'] = {k:r[k].get('sha256') if isinstance(r.get(k),dict) else None for k in FILE_KEYS}
        if not row['reasons']: row['status'] = 'FILES_VERIFIED_NOT_EVALUATED'
        paths[rid] = files
        inventory.append(row)
    if records and set(subjects.values()) != {'train','validation','test'}:
        blockers.append('subject-independent train/validation/test must all be explicitly assigned')
    if any(row['reasons'] for row in inventory): blockers.append('ONE_OR_MORE_RECORDINGS_FAILED_PREFLIGHT')
    return plan, paths, dict(schema_version=1, status='BLOCKED' if blockers else 'READY_FOR_LOCAL_INGEST',
        blockers=blockers, records=inventory, planned_recordings=len(records), planned_subjects=len(subjects),
        real_evaluated_recordings=0, real_evaluated_subjects=0, plan_sha256=sha256(plan_path),
        algorithms={n:dict(status='NOT_RUN',reason='preflight only; no synchronized evaluation executed') for n in NAMES},
        note='Evidence documents and operator reviews are recorded, not independently authenticated by software')


def ingest(plan_path, out, preflight_only=False):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    plan, paths, report = inspect_plan(plan_path)
    report_path = out/'inventory.json'

    def save():
        report_path.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    save()
    if report['status'] == 'BLOCKED' or preflight_only:
        return report
    records = []
    for r, row in zip(plan['records'], report['records']):
        tick = time.perf_counter()
        stage = 'contact_reference'
        try:
            files = paths[r['id']]
            rt, hr, ref_audit = parse_ground_truth(files['ground_truth'])
            stage = 'video_reference_clock_and_duration'
            t, = read_csv(files['timestamps'], ('timestamp_s',))
            check_times(t, 'video sidecar')
            if abs(float(t[0])) > 1e-6:
                raise ValueError('video sidecar must use zero-origin video time; do not reset reference time implicitly')
            # Duration is frozen in the plan, not silently shortened to exclude bad data.
            if t[-1] + float(np.median(np.diff(t))) < r['duration_s']-1e-6:
                raise ValueError('declared duration exceeds video timestamp coverage')
            period = float(np.median(np.diff(t)))
            if abs(float(t[-1])+period-r['duration_s']) > period+1e-6:
                raise ValueError('declared duration must cover the complete recording; no silent tail trimming')
            aligned_reference = rt+r['reference_offset_s']
            if aligned_reference[0] > 0 or aligned_reference[-1] < (int(r['duration_s'])//16)*16:
                raise ValueError('reference clock does not cover all planned full windows')
            reference_csv = out/(r['id']+'-reference.csv')
            with reference_csv.open('x', newline='', encoding='utf-8') as f:
                w=csv.writer(f);w.writerow(('timestamp_s','bpm'));w.writerows(zip(rt,hr))
            target = out/(r['id']+'.npz')
            stage = 'video_decode_roi_and_quality_sidecar'
            provenance = prepare(files['video'],files['timestamps'],reference_csv,r['roi'],target,
                                 files['quality'],r['quality_source'])
            record = dict(id=r['id'], dataset='UBFC-rPPG', subject_id=r['subject_id'], split=r['split'],
                duration_s=r['duration_s'], reference_offset_s=r['reference_offset_s'], path=target.name,
                sha256=sha256(target), conditions=r.get('conditions',{}), label_provenance=r.get('label_provenance'),
                source_url=plan['source_url'], research_authorization=plan['permission_review'],
                dataset_version=plan['dataset_version'], raw_sha256=row['input_sha256'],
                sync_method=r['sync_method'], reference_definition=ref_audit['reference_definition'])
            records.append(record)
            row.update(status='INGESTED_NOT_EVALUATED', frames=len(t), actual_fps=1/float(np.median(np.diff(t))),
                       duration_s=r['duration_s'], npz_sha256=record['sha256'], **ref_audit)
        except (ValueError, OSError, KeyError) as e:
            # Do not publish raw file paths from exception messages in the inventory.
            row.update(status='BLOCKED', reasons=row['reasons']+[stage+': '+type(e).__name__+'; inspect local inputs'])
        row['ingest_elapsed_s'] = time.perf_counter()-tick
        save()
    if len(records) != len(plan['records']):
        report.update(status='BLOCKED', blockers=report['blockers']+['INGESTION_INCOMPLETE_NO_EVALUATION_MANIFEST'])
    else:
        manifest = out/'manifest.json'
        manifest.write_text(json.dumps(dict(schema_version=1,synthetic=False,records=records,
            source_plan_sha256=report['plan_sha256'],pretraining_overlap_review=plan['pretraining_overlap_review']),indent=2)+'\n',encoding='utf-8')
        load_manifest(manifest)
        report['status'] = 'INGESTED_NOT_EVALUATED'
    save()
    return report


def main():
    p=argparse.ArgumentParser(__doc__);p.add_argument('plan');p.add_argument('--out',required=True)
    p.add_argument('--preflight-only',action='store_true');a=p.parse_args()
    try:
        report=ingest(a.plan,a.out,a.preflight_only)
    except (ValueError,OSError,KeyError) as e:
        p.exit(2,f'ingestion configuration error: {type(e).__name__}\n')
    print(json.dumps(report,indent=2))
    return 1 if report['status']=='BLOCKED' else 0


if __name__=='__main__':
    raise SystemExit(main())
