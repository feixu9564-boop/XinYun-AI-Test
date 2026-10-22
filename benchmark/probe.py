"""Probe actual checkpoint load and 480-frame forward pass, without accuracy claims."""
import argparse
import json
from pathlib import Path
import time
import numpy as np
from .adapters import build_adapters
from .run import hardware


def main():
    p=argparse.ArgumentParser(__doc__)
    p.add_argument('--toolbox', required=True)
    p.add_argument('--device', choices=('cpu','cuda'), default='cpu')
    p.add_argument('--acknowledge-toolbox-license', action='store_true')
    p.add_argument('--out', required=True)
    args=p.parse_args()
    if Path(args.out).exists():
        p.error('output already exists')
    adapters, states=build_adapters(args.toolbox, args.device, args.acknowledge_toolbox_license)
    rng=np.random.default_rng(2026)
    # Spatially varying synthetic input checks tensors, not physiology.
    frames=rng.integers(60,180,(480,128,128,3), dtype=np.uint8)
    for name, adapter in adapters.items():
        tick=time.perf_counter()
        try:
            wave=adapter.predict(frames)
            if len(wave)!=480 or not np.isfinite(wave).all():
                raise ValueError('bad waveform')
            states[name].update(forward='passed', output_samples=len(wave))
        except Exception as e:
            states[name].update(forward='failed', reason=f'{type(e).__name__}: {e}')
        states[name]['forward_s']=time.perf_counter()-tick
    result=dict(synthetic=True, seed=2026, hardware=hardware(), models=states)
    Path(args.out).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
    return 0 if all(v.get('forward')=='passed' for v in states.values()) else 1


if __name__=='__main__':
    raise SystemExit(main())
