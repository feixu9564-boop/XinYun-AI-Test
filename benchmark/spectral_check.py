"""Synthetic estimator characterization, including known artifact failures."""
import argparse
import json
from pathlib import Path
import numpy as np
from .signal import heart_rate


def characterize():
    t = np.arange(480)/30
    rows = []
    for bpm in (45.,54.,60.,72.,83.2,108.,127.3,150.,172.5):
        for phase in (0.,.7,2.):
            wave = np.sin(2*np.pi*bpm/60*t+phase)
            rows.append(dict(kind='clean_sinusoid',reference_bpm=bpm,phase=phase,
                bin_bpm=heart_rate(wave),interpolated_bpm=heart_rate(wave,interpolate=True)))
    pulse = np.sin(2*np.pi*1.2*t)
    for kind,wave in (
        ('dominant_second_harmonic',pulse+3*np.sin(2*np.pi*2.4*t)),
        ('periodic_motion_dominates',pulse+4*np.sin(2*np.pi*1.6*t)),
        ('motion_only_no_pulse',4*np.sin(2*np.pi*1.6*t))):
        rows.append(dict(kind=kind,reference_bpm=None if 'only' in kind else 72.,
            bin_bpm=heart_rate(wave),interpolated_bpm=heart_rate(wave,interpolate=True),
            expected_limitation='FFT accepts periodic artifact; no physiological validity or quality gate'))
    return dict(synthetic=True,window_s=16,fft_grid_bpm=3.75,
        interpolation='optional log-power parabola; default estimator unchanged',
        conclusion='clean-sine peak localization only; interpolation does not resolve harmonics or motion',rows=rows)


if __name__ == '__main__':
    p=argparse.ArgumentParser(__doc__);p.add_argument('--out',required=True);a=p.parse_args()
    out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('x') as f:
        json.dump(characterize(),f,indent=2,allow_nan=False);f.write('\n')
