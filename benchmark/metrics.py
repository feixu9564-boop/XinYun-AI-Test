import numpy as np


def metrics(rows):
    valid = [r for r in rows if r['status'] == 'ok']
    errors = np.array([r['predicted_bpm']-r['reference_bpm'] for r in valid])
    n, k = len(rows), len(valid)
    return {'total_windows': n, 'valid_windows': k,
            'mae_bpm': float(np.abs(errors).mean()) if k else None,
            'rmse_bpm': float(np.sqrt((errors**2).mean())) if k else None,
            'bias_bpm': float(errors.mean()) if k else None,
            'coverage': k/n if n else None, 'failure_rate': (n-k)/n if n else None,
            'mean_inference_s': float(np.mean([r['inference_s'] for r in valid])) if k else None}


def summarize(rows):
    # Include rejected/blocked windows in every group denominator.
    groups = {}
    for row in rows:
        keys = [(row['algorithm'], 'all'), (row['algorithm'], 'subject:'+row['subject_id'])]
        keys += [(row['algorithm'], k+':'+v) for k, v in row['conditions'].items()]
        for key in keys:
            groups.setdefault(key, []).append(row)
    return [{'algorithm': key[0], 'group': key[1], **metrics(value)} for key, value in sorted(groups.items())]
