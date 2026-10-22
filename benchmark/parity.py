"""Compare bridge with executable methods from the pinned official source.

No upstream files are copied. AST selects unmodified method bodies to avoid
importing training/face-detector dependencies. Real weights and real forwards
are used. Scope: shared ROI, CPU, official preprocessing/chunk/test/reassembly;
not face detection, dataset decoding, HR filtering, or end-to-end equivalence.
"""
import argparse
import hashlib
import ast
import contextlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace as NS
import cv2
import numpy as np
from .adapters import ToolboxAdapter, LOCK
from .data import sha256
from .run import hardware


def official_class(path, class_name, methods, namespace):
    tree = ast.parse(path.read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
    selected = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in methods]
    if {n.name for n in selected} != set(methods):
        raise ValueError('missing upstream method')
    cls.bases, cls.decorator_list, cls.body = [], [], selected
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(path), 'exec'), namespace)
    return namespace[class_name]


def difference(a, b, atol=1e-6, rtol=1e-5):
    a, b = np.asarray(a), np.asarray(b)
    same_shape = a.shape == b.shape
    finite = bool(np.isfinite(a).all() and np.isfinite(b).all())
    return {'shape_a': list(a.shape), 'shape_b': list(b.shape),
            'max_abs': float(np.max(np.abs(a-b))) if same_shape else None,
            'rmse': float(np.sqrt(np.mean((a.astype(float)-b)**2))) if same_shape else None,
            'atol': atol, 'rtol': rtol,
            'allclose': bool(same_shape and finite and np.allclose(a,b,atol=atol,rtol=rtol))}


def official_predictions(root, adapter, clips, batch_size):
    """Execute actual Trainer.test, intercept only metric export and safe loading."""
    import torch
    name = adapter.name
    trainer_name = {'PhysNet':'PhysnetTrainer', 'EfficientPhys':'EfficientPhysTrainer',
                    'PhysFormer':'PhysFormerTrainer'}[name]
    captured = {}
    def collect(predictions, labels, config):
        captured.update(predictions)
    class SafeTorch:
        def __getattr__(self, key):
            return getattr(torch, key)
        def load(self, path):
            state = torch.load(path, map_location='cpu', weights_only=True)
            return {k.removeprefix('module.'):v for k,v in state.items()}
    namespace = {'torch':SafeTorch(), 'os':os, 'tqdm':lambda x, **kw:x,
                 'calculate_metrics':collect}
    cls = official_class(root/f'neural_methods/trainer/{trainer_name}.py', trainer_name,
                         ['test'], namespace)
    trainer = cls()
    trainer.model = adapter.model
    trainer.config = NS(TOOLBOX_MODE='only_test', DEVICE='cpu',
        INFERENCE=NS(MODEL_PATH=str(root/adapter.entry['weight'])),
        TEST=NS(OUTPUT_SAVE_DIR='', DATA=NS(PREPROCESS=NS(CHUNK_LENGTH=adapter.entry['chunk']))))
    trainer.base_len, trainer.num_of_gpu = 10, 1
    batches = []
    for start in range(0, len(clips), batch_size):
        block = clips[start:start+batch_size]
        axes = (0,1,4,2,3) if name == 'EfficientPhys' else (0,4,1,2,3)
        tensor = torch.from_numpy(block.transpose(axes).astype(np.float32).copy())
        batches.append((tensor, torch.zeros((len(block),adapter.entry['chunk'])),
                        ['synthetic']*len(block), [str(i) for i in range(start,start+len(block))]))
    with contextlib.redirect_stdout(io.StringIO()):
        trainer.test({'test':batches})
    # Execute official metrics helper for sorting and concatenating outputs.
    tree = ast.parse((root/'evaluation/metrics.py').read_text())
    method = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_reform_data_from_dict')
    scope = {'np':np,'torch':torch}
    exec(compile(ast.Module(body=[method],type_ignores=[]),'evaluation/metrics.py','exec'),scope)
    return np.asarray(scope['_reform_data_from_dict'](captured['synthetic']))


def compare(root, acknowledge_license, out):
    if not acknowledge_license:
        raise RuntimeError('acknowledge upstream research terms explicitly')
    root, out = Path(root).resolve(), Path(out)
    if out.exists():
        raise FileExistsError(out)
    # Verify all oracle files before executing any selected upstream method.
    for path, digest in LOCK['parity_sources'].items():
        if sha256(root/path) != digest:
            raise ValueError(f'parity source checksum mismatch: {path}')
    loader_path = root/'dataset/data_loader/BaseLoader.py'
    namespace = {'np':np, 'cv2':cv2}
    loader_cls = official_class(loader_path, 'BaseLoader',
        ['preprocess','crop_face_resize','diff_normalize_data','diff_normalize_label',
         'standardized_data','chunk'], namespace)
    loader = loader_cls()
    # Spatially varying uint8 ROI exposes dtype/resize errors; repeat seed for all models.
    rng = np.random.default_rng(2026)
    frames = rng.integers(40,211,(480,36,36,3), dtype=np.uint8)
    result = {'seed':2026,'frames':480,'input_sha256':hashlib.sha256(frames.tobytes()).hexdigest(),
              'commit':LOCK['commit'],'hardware':hardware(),'scope':__doc__,
              'sources':{p:sha256(root/p) for p in LOCK['parity_sources']},'models':{}}
    for name in ('PhysNet','EfficientPhys','PhysFormer'):
        adapter = ToolboxAdapter(name,root,acknowledge_license=acknowledge_license)
        e = adapter.entry
        cfg = NS(CROP_FACE=NS(DO_CROP_FACE=False,BACKEND='HC',USE_LARGE_FACE_BOX=False,
            LARGE_BOX_COEF=1.,DETECTION=NS(DO_DYNAMIC_DETECTION=False,
            DYNAMIC_DETECTION_FREQUENCY=30,USE_MEDIAN_FACE_BOX=False)),
            RESIZE=NS(W=e['size'],H=e['size']),DATA_TYPE=[e['normalization']],
            LABEL_TYPE='DiffNormalized',DO_CHUNK=True,CHUNK_LENGTH=e['chunk'])
        # Run the actual full preprocess method, with face cropping disabled on both paths.
        clips, _ = loader.preprocess(frames,np.sin(np.arange(480)/5),cfg)
        cfg.DO_CHUNK=False
        normalized, _ = loader.preprocess(frames,np.sin(np.arange(480)/5),cfg)
        normalized = normalized[0].astype(np.float32)
        pre = difference(adapter.preprocess(frames),normalized)
        padded = np.pad(normalized,((0,(-len(frames))%e['chunk']),(0,0),(0,0),(0,0)),mode='edge')
        padded = padded.reshape((-1,e['chunk'],e['size'],e['size'],3))
        raw = adapter.predict_raw(frames)
        official_raw = official_predictions(root,adapter,clips,1)
        extended_raw = official_predictions(root,adapter,padded,1)[:len(frames)]
        configured_batch_raw = official_predictions(root,adapter,clips,4)
        prefix = difference(raw[:len(official_raw)],official_raw)
        extended = difference(raw,extended_raw)
        reconstruction = difference(adapter.predict(frames),np.cumsum(extended_raw))
        result['models'][name] = dict(preprocessing=pre, official_complete_chunk_prefix=prefix,
            padded_extension=extended,reconstructed_waveform=reconstruction,
            official_batch1_vs_config_batch4=difference(official_raw,configured_batch_raw),
            official_output_frames=len(official_raw),bridge_output_frames=len(raw),
            tail_padding_frames=(-len(frames))%e['chunk'],
            output_label='DiffNormalized',weight_sha256=e['weight_sha256'],
            official_tail_policy='drop incomplete chunk',bridge_tail_policy='edge pad then trim',
            passed=all(x['allclose'] for x in (pre,prefix,extended,reconstruction)))
        print(name, json.dumps(result['models'][name]))
    result['passed'] = all(m['passed'] for m in result['models'].values())
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    return result


if __name__ == '__main__':
    p=argparse.ArgumentParser(__doc__)
    p.add_argument('--toolbox',required=True)
    p.add_argument('--out',required=True)
    p.add_argument('--acknowledge-toolbox-license',action='store_true')
    a=p.parse_args()
    raise SystemExit(0 if compare(a.toolbox,a.acknowledge_toolbox_license,a.out)['passed'] else 1)
