"""Lazy adapters to pinned upstream models. No substitute predictions on failure."""
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import cv2
import numpy as np
from .data import sha256
from .signal import pulse

NAMES = ('POS', 'CHROM', 'PhysNet', 'EfficientPhys', 'PhysFormer', 'PhysMamba')
LOCK = json.loads((Path(__file__).with_name('toolbox.lock.json')).read_text())


class Baseline:
    def __init__(self, name):
        self.name = name
        self.info = {'status': 'ready', 'implementation': 'independent projection baseline'}

    def predict(self, frames):
        return pulse(frames.mean(axis=(1, 2)), 30, self.name)


class ToolboxAdapter:
    def __init__(self, name, root, device='cpu', acknowledge_license=False):
        self.name, self.device = name, device
        entry = LOCK['models'][name]
        self.entry = entry
        if not acknowledge_license:
            raise RuntimeError('license restricted: acknowledge upstream research terms explicitly')
        if root is None:
            raise RuntimeError('environment blocked: supply pinned --toolbox directory')
        root = Path(root).resolve()
        commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        if commit != LOCK['commit']:
            raise RuntimeError('upstream revision mismatch')
        source = root / entry['source']
        weight = root / entry['weight']
        if sha256(source) != entry['source_sha256'] or sha256(weight) != entry['weight_sha256']:
            raise RuntimeError('upstream source/weight checksum mismatch')
        import torch
        torch.manual_seed(2026)
        torch.set_num_threads(2)
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA requested but unavailable')
        if name == 'PhysMamba' and not torch.cuda.is_available():
            raise RuntimeError('environment blocked: PhysMamba selective-scan requires CUDA/mamba_ssm')
        spec = importlib.util.spec_from_file_location('_xinyun_' + name, source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if name == 'PhysNet':
            model = module.PhysNet_padding_Encoder_Decoder_MAX(frames=128)
        elif name == 'EfficientPhys':
            model = module.EfficientPhys(frame_depth=10, img_size=72)
        elif name == 'PhysFormer':
            model = module.ViT_ST_ST_Compact3_TDC_gra_sharp(
                image_size=(160, 128, 128), patches=(4, 4, 4), dim=96,
                ff_dim=144, num_heads=4, num_layers=12, dropout_rate=.1, theta=.7)
        else:
            model = module.PhysMamba()
        # Never execute arbitrary pickle objects. Only pinned tensor state_dicts.
        state = torch.load(weight, map_location='cpu', weights_only=True)
        state = {k.removeprefix('module.'): v for k, v in state.items()}
        model.load_state_dict(state, strict=True)
        self.model, self.torch = model.to(device).eval(), torch
        self.info = {'status': 'loaded', 'commit': commit, 'weight_sha256': entry['weight_sha256'],
                     'training_datasets': ['PURE'], 'device': device,
                     'chunk_frames': entry['chunk'], 'resize': entry['size'],
                     'normalization': entry['normalization']}

    def predict(self, frames):
        torch, entry = self.torch, self.entry
        size, chunk = entry['size'], entry['chunk']
        x = np.stack([cv2.resize(f, (size, size), interpolation=cv2.INTER_AREA) for f in frames]).astype(np.float32)
        if entry['normalization'] == 'DiffNormalized':
            diff = np.diff(x, axis=0) / (x[1:] + x[:-1] + 1e-7)
            diff /= max(float(diff.std()), 1e-8)
            x = np.concatenate((diff, np.zeros_like(diff[:1])), axis=0)
        else:
            x = (x-x.mean()) / max(float(x.std()), 1e-8)
        results = []
        with torch.inference_mode():
            for start in range(0, len(x), chunk):
                block = x[start:start+chunk]
                count = len(block)
                if count < chunk:
                    block = np.pad(block, ((0, chunk-count), (0, 0), (0, 0), (0, 0)), mode='edge')
                tensor = torch.from_numpy(block.transpose(0, 3, 1, 2).copy()).to(self.device)
                if self.name == 'EfficientPhys':
                    tensor = torch.cat((tensor, tensor[-1:]), dim=0)
                    output = self.model(tensor)
                else:
                    tensor = tensor.transpose(0, 1).unsqueeze(0)
                    output = self.model(tensor, 2.0) if self.name == 'PhysFormer' else self.model(tensor)
                    if isinstance(output, tuple):
                        output = output[0]
                values = output.detach().cpu().numpy().reshape(-1)
                if len(values) != chunk or not np.isfinite(values).all():
                    raise ValueError('invalid model output shape or values')
                results.append(values[:count])
        wave = np.concatenate(results)
        return np.cumsum(wave) if entry['normalization'] == 'DiffNormalized' else wave


def build_adapters(root=None, device='cpu', acknowledge_license=False):
    adapters, states = {}, {}
    for name in NAMES:
        start = time.perf_counter()
        try:
            adapter = Baseline(name) if name in NAMES[:2] else ToolboxAdapter(name, root, device, acknowledge_license)
            adapters[name] = adapter
            states[name] = dict(adapter.info)
        except Exception as e:
            states[name] = {'status': 'blocked', 'reason': f'{type(e).__name__}: {e}'}
        states[name]['load_s'] = time.perf_counter() - start
    return adapters, states
