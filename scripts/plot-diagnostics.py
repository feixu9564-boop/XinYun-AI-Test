"""Local only: plot xinyun diagnostic/replay JSON, never reads images or uses network."""
import argparse
import json
from pathlib import Path
import os
os.environ.setdefault('MPLCONFIGDIR', '/tmp/xinyun-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def plot(result, target, title='Local diagnostic'):
    d = result.get('diagnostics', {})
    fig, axes = plt.subplots(4, 1, figsize=(12, 13), constrained_layout=True)
    raw = [s for s in d.get('raw', []) if s.get('rgb') is not None]
    if raw:
        t = np.array([s['t'] for s in raw]); t -= t[0]
        rgb = np.array([s['rgb'] for s in raw])
        for c, label in enumerate(['R', 'G', 'B']): axes[0].plot(t, rgb[:, c]-rgb[:, c].mean(), label=label)
        axes[0].legend(); axes[0].set_ylabel('ROI RGB - mean (8-bit)')
    resampled = d.get('resampled')
    if resampled:
        t = np.array(resampled['t']); t -= t[0]
        normalized = d.get('normalized', {}).get('rgb', [])
        if len(normalized):
            for c in range(3): axes[1].plot(t, np.array(normalized)[:, c], label=['R/DC-1', 'G/DC-1', 'B/DC-1'][c])
        for name, wave in (d.get('waves') or {}).items(): axes[2].plot(t, wave, label=name, alpha=.8)
        axes[1].legend(); axes[2].legend()
    axes[1].set_ylabel('Global normalized RGB'); axes[2].set_ylabel('Production POS / CHROM')
    for name, s in (d.get('spectra') or {}).items():
        bins = s.get('bins', [])
        if bins:
            f = np.array([b['f']*60 for b in bins]); p = np.array([b['p'] for b in bins]); p /= max(p.max(), 1e-30)
            axes[3].plot(f, p, marker='.', label=f"{name}: candidate={s.get('candidateBpm', 0):.2f}, SNR={s.get('snrDb', 0):.2f} dB")
            axes[3].axvline(s['candidateBpm'], linestyle=':', alpha=.6)
            gate_text = f"{name}: concentration={s.get('concentration',0):.3f} >= .60; secondary={s.get('secondary',0):.4f} <= .04; half={s.get('subharmonic',0):.4f} <= .04"
            axes[3].text(.01, .98 if name=='POS' else .91, gate_text, transform=axes[3].transAxes, va='top', fontsize=8)
    if axes[3].lines: axes[3].legend(fontsize=8)
    axes[3].set_xlabel('BPM'); axes[3].set_ylabel('Peak-normalized power')
    for ax in axes[:3]: ax.set_xlabel('seconds')
    failed = [f"{g['name']}: {g['value']} {g['operator']} {g['threshold']}" for g in d.get('gates', []) if g.get('pass') is False]
    fig.suptitle(title+'\n'+result.get('reason', '')+'; '+('; '.join(failed) or 'No failed evaluated gates'), fontsize=10)
    target = Path(target); target.parent.mkdir(parents=True, exist_ok=True); fig.savefig(target, dpi=140); plt.close(fig)


if __name__ == '__main__':
    p = argparse.ArgumentParser(__doc__); p.add_argument('input'); p.add_argument('output', nargs='?', default='diagnostics.png'); a = p.parse_args()
    obj = json.loads(Path(a.input).read_text())
    windows = obj.get('windows', obj.get('analyses', []))
    if not windows: raise SystemExit('No analysis window in this file')
    plot(windows[-1]['result'], a.output, f"{obj['schema']}: {Path(a.input).name}")
