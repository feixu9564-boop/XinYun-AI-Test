"""Verify saved JS waveforms and spectral metrics with independent NumPy/SciPy math."""
import importlib.util
import json
from pathlib import Path
import sys
import numpy as np
from scipy.signal import detrend
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('oracle', 'tests/test_issue12_reference.py')
oracle = importlib.util.module_from_spec(spec); spec.loader.exec_module(oracle)
output = []
for label in ['baseline', 'after']:
    obj = json.loads(Path(f'docs/issue-12-artifacts/{label}.json').read_text())
    max_wave_error, max_metric_error, count = 0., 0., 0
    discrepancies = []
    for row in obj['rows']:
        samples = row['samples']; t = np.array([s['t'] for s in samples]); rgb = np.array([s['rgb'] for s in samples])
        fs = (len(t)-1)/(t[-1]-t[0]); uniform = t[0]+np.arange(len(t))/fs
        rgb = np.column_stack([np.interp(uniform, t, rgb[:, c]) for c in range(3)])
        for method, actual in row['waves'].items():
            wave = oracle.projection_reference(rgb, fs, method)
            err = float(np.max(np.abs(wave-actual))); max_wave_error = max(err, max_wave_error)
            assert err < 1e-11, (label, row['condition'], method, err)
            count += 1
            s = row['spectra'][method]
            if 'secondary' not in s: continue
            power = abs(np.fft.rfft(detrend(wave)*np.hanning(len(wave))))**2
            f = np.fft.rfftfreq(len(wave), 1/fs); idx = np.arange(len(f)); band = (f>=.7)&(f<=3)
            peak = np.flatnonzero(band)[np.argmax(power[band])]
            concentration = power[band & (abs(idx-peak)<=1)].sum()/power[band].sum()
            other = band & (abs(idx-peak)>(1 if label=='baseline' else 2))
            half = band & (abs(2*idx-peak)<=2)
            metrics = {'concentration':concentration, 'secondary':power[other].max()/power[peak] if other.any() else 0., 'subharmonic':power[half].max()/power[peak] if half.any() else 0.}
            for name, value in metrics.items():
                err = abs(float(value)-s[name]); max_metric_error = max(max_metric_error, err)
                if label=='baseline' and name=='subharmonic' and err>=1e-9:
                    discrepancies.append(dict(duration=row['duration'],bpm=row['bpm'],condition=row['condition'],method=method,js=s[name],integer_bin_reference=float(value),gate_changed=bool((value>.04)!=(s[name]>.04))))
                else: assert err < 1e-9, (label, row['condition'], method, name, err)
    output.append(dict(label=label, comparisons=count, max_wave_abs_error=max_wave_error, max_spectral_metric_abs_error=max_metric_error, baseline_half_bin_boundary_discrepancies=discrepancies, scope='projection + existing local overlap policy + linear resampling + Hann DFT; not full paper filtering or human validation'))
Path('docs/issue-12-artifacts/reference-check.json').write_text(json.dumps(output, indent=2)+'\n')
print(json.dumps(output, indent=2))
