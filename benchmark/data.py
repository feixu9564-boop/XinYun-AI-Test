"""Versioned local manifest and timestamp alignment; never upload recordings."""
import hashlib
import json
from pathlib import Path
import numpy as np


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(path):
    path = Path(path).resolve()
    manifest = json.loads(path.read_text())
    if manifest.get('schema_version') != 1 or not manifest.get('records'):
        raise ValueError('schema_version=1 and nonempty records required')
    subjects, ids = {}, set()
    for r in manifest['records']:
        for key in ('id', 'dataset', 'subject_id', 'split', 'path', 'sha256',
                    'duration_s', 'reference_offset_s', 'conditions'):
            if key not in r:
                raise ValueError(f'missing {key}')
        if r['id'] in ids:
            raise ValueError('duplicate recording id')
        ids.add(r['id'])
        if r['split'] not in ('train', 'validation', 'test'):
            raise ValueError('invalid split')
        # subject_id must be canonical across sessions/datasets, not a recording ID.
        if not isinstance(r['subject_id'], str) or not r['subject_id'].strip():
            raise ValueError('empty subject ID')
        if subjects.setdefault(r['subject_id'], r['split']) != r['split']:
            raise ValueError('subject leakage across splits')
        if not np.isfinite(r['duration_s']) or r['duration_s'] <= 0:
            raise ValueError('invalid duration')
        if not np.isfinite(r['reference_offset_s']):
            raise ValueError('invalid reference offset')
        if not isinstance(r['conditions'], dict):
            raise ValueError('conditions must be a mapping')
        for key, value in r['conditions'].items():
            if key not in ('lighting', 'motion', 'skin_tone') or not isinstance(value, str):
                raise ValueError('invalid condition label')
        if r['conditions'] and not r.get('label_provenance'):
            raise ValueError('condition labels require reliable dataset provenance')
        if not r.get('research_authorization') or not r.get('source_url'):
            raise ValueError('source and research authorization required')
        if not isinstance(r['sha256'], str) or len(r['sha256']) != 64 or any(c not in '0123456789abcdef' for c in r['sha256']):
            raise ValueError('SHA256 required')
        r['_path'] = str((path.parent / r['path']).resolve())
    return manifest


def load_record(record):
    path = record['_path']
    if sha256(path) != record['sha256']:
        raise ValueError('record checksum mismatch')
    with np.load(path, allow_pickle=False) as z:
        data = {k: z[k] for k in ('frames', 'timestamps', 'reference_timestamps', 'reference_bpm')}
        data['provenance'] = json.loads(str(z['provenance'])) if 'provenance' in z.files else {}
    frames, t = data['frames'], data['timestamps']
    if frames.ndim != 4 or frames.shape[1:] != (128, 128, 3) or frames.dtype != np.uint8:
        raise ValueError('frames must be uint8 T,128,128,3 RGB skin ROI')
    if len(frames) != len(t):
        raise ValueError('frame/timestamp count mismatch')
    check_times(t, 'video')
    rt, hr = data['reference_timestamps'], data['reference_bpm']
    if hr.ndim != 1 or len(hr) != len(rt):
        raise ValueError('reference count mismatch')
    check_times(rt, 'reference')
    data['reference_timestamps'] = rt + record['reference_offset_s']
    return data


def check_times(t, name):
    if t.ndim != 1 or len(t) < 2 or not np.isfinite(t).all() or np.any(np.diff(t) <= 0):
        raise ValueError(f'{name} timestamps must be finite and strictly increasing')


def aligned_window(data, start, duration=16, fs=30):
    t = data['timestamps']
    end = start + duration
    grid = start + np.arange(round(duration*fs)) / fs
    # Include bracketing frames to measure gaps at both window edges.
    lo, hi = max(0, np.searchsorted(t, start)-1), min(len(t), np.searchsorted(t, end)+1)
    local_t = t[lo:hi]
    if len(local_t) < 2 or local_t[0] > start + 1e-6 or local_t[-1] < grid[-1] - 1e-6:
        raise ValueError('insufficient frame coverage')
    dt = np.diff(local_t)
    actual_fps = 1 / float(np.median(dt))
    if actual_fps < 12 or dt.max() > .25:
        raise ValueError('low FPS or dropped-frame gap')
    # Nearest-frame resampling shared by every algorithm; ties choose previous.
    right = np.clip(np.searchsorted(t, grid), 1, len(t)-1)
    left = right-1
    idx = np.where(grid-t[left] <= t[right]-grid, left, right)
    frames = data['frames'][idx]
    means = frames.mean(axis=(1, 2))
    if np.any(means.mean(axis=1) < 30) or np.any(means.mean(axis=1) > 235):
        raise ValueError('invalid dark/overexposed frame')
    rt, hr = data['reference_timestamps'], data['reference_bpm']
    a, b = max(0, np.searchsorted(rt, start)-1), min(len(rt), np.searchsorted(rt, end)+1)
    if rt[0] > start or rt[-1] < end or not np.isfinite(hr[a:b]).all():
        raise ValueError('missing aligned reference')
    if np.diff(rt[a:b]).max() > 1.5 or np.any((hr[a:b] < 30) | (hr[a:b] > 240)):
        raise ValueError('invalid reference or reference gap')
    # Integrate supplied reference device HR, no camera-derived reference.
    q = np.r_[start, rt[(rt > start) & (rt < end)], end]
    reference = float(np.trapezoid(np.interp(q, rt, hr), q) / duration)
    audit = {'actual_fps': actual_fps, 'max_gap_s': float(dt.max()),
             'estimated_dropped_frames': int(np.maximum(np.round(dt*actual_fps)-1, 0).sum()),
             'unique_resampled_frames': int(len(np.unique(idx)))}
    return frames, reference, audit
