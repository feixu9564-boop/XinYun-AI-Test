import numpy as np


def metrics(rows):
    valid = [r for r in rows if r['status'] == 'ok']
    errors = np.array([r['predicted_bpm']-r['reference_bpm'] for r in valid])
    n, k = len(rows), len(valid)
    wrong = int((np.abs(errors) > 10).sum())
    return {'total_windows': n, 'valid_windows': k,
            'mae_bpm': float(np.abs(errors).mean()) if k else None,
            'rmse_bpm': float(np.sqrt((errors**2).mean())) if k else None,
            'bias_bpm': float(errors.mean()) if k else None,
            'coverage': k/n if n else None, 'failure_rate': (n-k)/n if n else None,
            'rejection_rate': sum(r['status'] in ('rejected', 'insufficient_signal') for r in rows)/n if n else None,
            'blocked_rate': sum(r['status'] in ('blocked', 'NOT_RUN') for r in rows)/n if n else None,
            'absolute_error_p50_bpm': float(np.quantile(np.abs(errors), .5)) if k else None,
            'absolute_error_p90_bpm': float(np.quantile(np.abs(errors), .9)) if k else None,
            'absolute_error_p95_bpm': float(np.quantile(np.abs(errors), .95)) if k else None,
            'wrong_output_threshold_bpm': 10,
            'wrong_output_rate_all_windows': wrong/n if n and k else None,
            'wrong_output_rate_accepted': wrong/k if k else None,
            'mean_inference_s': float(np.mean([r['inference_s'] for r in valid])) if k else None}


def subject_bootstrap(rows, repeats=1000, seed=2026):
    """Resample subjects, preserving all their windows and abstentions.

    Null MAE CI with fewer than two subjects contributing accepted windows;
    bootstrap draws with no outputs are counted and not treated as zero error.
    """
    subjects = sorted({r['subject_id'] for r in rows})
    accepted = {r['subject_id'] for r in rows if r['status'] == 'ok'}
    result = {'method': 'subject-cluster percentile bootstrap', 'seed': seed,
              'repeats': repeats, 'subjects': len(subjects), 'mae_ci95': None,
              'coverage_ci95': None, 'draws_without_output': None}
    if len(subjects) < 2:
        return result
    groups = {s: [r for r in rows if r['subject_id'] == s] for s in subjects}
    rng = np.random.default_rng(seed)
    maes, coverages = [], []
    for _ in range(repeats):
        sample = [r for s in rng.choice(subjects, len(subjects), replace=True) for r in groups[s]]
        m = metrics(sample)
        coverages.append(m['coverage'])
        if m['mae_bpm'] is not None:
            maes.append(m['mae_bpm'])
    result['coverage_ci95'] = np.quantile(coverages, [.025, .975]).tolist()
    result['draws_without_output'] = repeats-len(maes)
    if len(accepted) >= 2 and maes:
        result['mae_ci95'] = np.quantile(maes, [.025, .975]).tolist()
    return result


def summarize(rows):
    # Include rejected/blocked windows in every group denominator.
    groups = {}
    for row in rows:
        keys = [(row['algorithm'], 'all'), (row['algorithm'], 'subject:'+row['subject_id'])]
        keys += [(row['algorithm'], k+':'+v) for k, v in row['conditions'].items()]
        for key in keys:
            groups.setdefault(key, []).append(row)
    return [{'algorithm': key[0], 'group': key[1], **metrics(value),
             'subject_ci': subject_bootstrap(value) if key[1] == 'all' else None}
            for key, value in sorted(groups.items())]
