"""python -m benchmark.run MANIFEST --out outputs/run [--smoke]."""
import argparse
import json
from pathlib import Path
import platform
import sys
import time
import numpy as np
from .adapters import NAMES, build_adapters
from .data import load_manifest, load_record, aligned_window, sha256
from .metrics import summarize
from .signal import heart_rate


def hardware():
    info = {'python': platform.python_version(), 'platform': platform.platform(),
            'processor': platform.processor(), 'numpy': np.__version__}
    cpuinfo = Path('/proc/cpuinfo')
    if cpuinfo.exists():
        info['cpu'] = next((l.split(':', 1)[1].strip() for l in cpuinfo.read_text().splitlines()
                            if l.startswith('model name')), 'unknown')
    try:
        import torch
        info.update(torch=torch.__version__, cuda=torch.cuda.is_available(),
                    gpu=torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)
    except ImportError:
        info.update(torch=None, cuda=False, gpu=None)
    return info


def run(manifest_path, out, smoke=False, toolbox=None, device='cpu', acknowledge_license=False):
    output = Path(out)
    if output.exists():
        raise FileExistsError('output already exists')
    started = time.perf_counter()
    np.random.seed(2026)
    manifest = load_manifest(manifest_path)
    records = [r for r in manifest['records'] if r['split'] == 'test']
    if not records:
        raise ValueError('manifest contains no test records')
    if any(r['duration_s'] < 16 for r in records):
        raise ValueError('test records need at least one full 16-second window')
    adapters, states = build_adapters(toolbox, device, acknowledge_license)
    rows = []
    for record in records:
        data, load_error = None, None
        try:
            data = load_record(record)
            record['input_provenance'] = data['provenance']
        except Exception as e:
            load_error = f'{type(e).__name__}: {e}'
        starts = list(range(0, int(record['duration_s']) - 15, 16))
        if smoke:
            starts = starts[:1]  # one window per recording; same sample IDs for all algorithms
        for start in starts:
            frames, reference, audit, error = None, None, {}, load_error
            if error is None:
                try:
                    frames, reference, audit = aligned_window(data, start)
                except Exception as e:
                    error = f'{type(e).__name__}: {e}'
            for name in NAMES:
                row = dict(algorithm=name, recording_id=record['id'], subject_id=record['subject_id'],
                           conditions=record['conditions'], start_s=start, duration_s=16,
                           status='rejected', reason=error, reference_bpm=reference,
                           predicted_bpm=None, inference_s=0., **audit)
                if not error:
                    if name not in adapters:
                        row.update(status='blocked', reason=states[name]['reason'])
                    elif name not in NAMES[:2] and record['dataset'].upper() == 'PURE':
                        row.update(status='blocked', reason='training-dataset overlap: PURE checkpoint/test PURE')
                    else:
                        tick = time.perf_counter()
                        try:
                            value = heart_rate(adapters[name].predict(frames))
                            row.update(status='ok', reason=None, predicted_bpm=value)
                        except Exception as e:
                            row.update(status='failed', reason=f'{type(e).__name__}: {e}')
                        row['inference_s'] = time.perf_counter()-tick
                rows.append(row)
    output = Path(out)
    output.mkdir(parents=True, exist_ok=False)  # preserve previous evidence, never overwrite
    (output/'windows.jsonl').write_text(''.join(json.dumps(r, allow_nan=False)+'\n' for r in rows))
    summary = {'schema_version': 1, 'synthetic': manifest.get('synthetic', False),
               'mode': 'smoke' if smoke else 'full', 'seed': 2026, 'hardware': hardware(),
               'adapters': states, 'metrics': summarize(rows),
               'elapsed_s': time.perf_counter()-started,
               'manifest_sha256': sha256(manifest_path),
               'recordings': [{k:v for k,v in r.items() if k not in ('_path', 'path')} for r in records],
               'window_s':16, 'target_fps':30,
               'trailing_partial_windows': 'excluded; duration floor to multiples of 16 s',
               'preprocessing': 'shared 128px ROI, nearest timestamp resampling; model-specific resize/normalize/chunk/edge pad; see docs/protocol.md'}
    (output/'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False)+'\n')
    print(json.dumps({'out': str(output), 'rows': len(rows), 'mode':summary['mode'],
                      'status_counts': {s:sum(r['status']==s for r in rows) for s in ('ok','rejected','blocked','failed')},
                      'synthetic': summary['synthetic']}, indent=2))
    return summary


def main():
    p = argparse.ArgumentParser(__doc__)
    p.add_argument('manifest')
    p.add_argument('--out', required=True)
    p.add_argument('--smoke', action='store_true')
    p.add_argument('--toolbox')
    p.add_argument('--device', choices=('cpu', 'cuda'), default='cpu')
    p.add_argument('--acknowledge-toolbox-license', action='store_true')
    args = p.parse_args()
    try:
        result = run(args.manifest, args.out, args.smoke, args.toolbox, args.device, args.acknowledge_toolbox_license)
    except (ValueError, OSError, KeyError) as e:
        p.exit(2, f'benchmark error: {e}\n')
    # Nonzero for missing/failed inference; artifacts still exported. Rejections count in coverage.
    totals = [m for m in result['metrics'] if m['group']=='all']
    return 0 if all(m['coverage'] == 1 for m in totals) else 1


if __name__ == '__main__':
    sys.exit(main())
