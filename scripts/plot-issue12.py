"""Rebuild all evidence charts offline from baseline/after production results."""
import json
from pathlib import Path
import os
os.environ.setdefault('MPLCONFIGDIR', '/tmp/xinyun-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import importlib.util
spec = importlib.util.spec_from_file_location('plot_diagnostics', Path(__file__).with_name('plot-diagnostics.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

out = Path('docs/issue-12-artifacts')
before, after = [json.loads((out/f'{label}.json').read_text()) for label in ('baseline', 'after')]
fig, axes = plt.subplots(1, 2, figsize=(13, 5), constrained_layout=True)
for ax, obj in zip(axes, [before, after]):
    rows = [r for r in obj['rows'] if r['bpm'] is not None]
    matrix = np.array([r['result']['reliable'] for r in rows]).reshape(8, 6)
    ax.imshow(matrix, vmin=0, vmax=1, cmap='RdYlGn', aspect='auto')
    ax.set_xticks(range(6), ['normal', 'weak', 'noise', 'drift', 'jitter', 'motion'], rotation=35)
    ax.set_yticks(range(8), [f"{d}s / {b} BPM" for d in [16,45] for b in [60,75,90,120]])
    ax.set_title(obj['label']+' (green=accepted; red=rejected)')
fig.savefig(out/'before-after-matrix.png', dpi=150); plt.close(fig)
fig, ax = plt.subplots(figsize=(12, 5), constrained_layout=True)
rows = [r for r in before['rows'] if r.get('adequate')]
ax.scatter(range(len(rows)), [r['chromaStd'] for r in rows], label='normal / weak / drift / jitter')
ax.axhline(.0005, color='r', label='baseline minChromaticStd=.0005')
ax.set_ylabel('max chromaticity std (dimensionless)'); ax.set_xlabel('Fixed cases: 16/45s x 60/75/90/120 x four conditions')
ax.legend(); ax.set_title('All 32 adequate synthetic pulses blocked before POS/CHROM')
fig.savefig(out/'baseline-color-gate.png', dpi=150); plt.close(fig)
fig, axes = plt.subplots(1, 2, figsize=(12, 4), constrained_layout=True)
for ax, obj in zip(axes, [before, after]):
    for duration in [16,45]:
        tones = [r for r in obj['tones'] if r['duration']==duration and 85<r['bpm']<100]
        ax.plot([r['offset'] for r in tones], [r['result']['secondary'] for r in tones], marker='o', label=f'{duration}s')
    ax.axhline(.04, color='r', linestyle=':', label='maxSecondaryRatio=.04')
    ax.set_title(obj['label']); ax.set_xlabel('DFT bin offset'); ax.set_ylabel('secondary / peak'); ax.legend()
fig.savefig(out/'hann-main-lobe.png', dpi=150); plt.close(fig)
# Baseline spectra computed from the unmodified production extraction output.
fig, axes = plt.subplots(2, 2, figsize=(12, 7), constrained_layout=True)
from scipy.signal import detrend
for ax, condition in zip(axes.flat, ['normal','weak','noise','drift']):
    r = next(r for r in before['rows'] if r['duration']==16 and r['bpm']==60 and r['condition']==condition)
    for name, wave in r['waves'].items():
        wave=np.array(wave); p=abs(np.fft.rfft(detrend(wave)*np.hanning(len(wave))))**2
        f=np.fft.rfftfreq(len(wave), 1/20); mask=(f>=.7)&(f<=3)
        ax.plot(f[mask]*60, p[mask]/p[mask].max(), marker='.', label=name)
    ax.set_title(f"baseline {condition}: {r['result']['reason']}", fontsize=9); ax.set_xlabel('BPM'); ax.legend()
fig.savefig(out/'baseline-spectra.png', dpi=150); plt.close(fig)
r = next(r for r in after['rows'] if r['duration']==16 and r['bpm']==60 and r['condition']=='weak')
module.plot(r['result'], out/'after-weak-waveforms.png', 'Synthetic weak 60 BPM; not a device test')
print('Generated 5 PNG charts offline in', out)
