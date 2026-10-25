"""Independent projection/DFT oracle, not a validation of full paper pipelines or human HR."""
import json
import subprocess
import numpy as np
import pytest
from scipy.signal import detrend
from benchmark.signal import pulse
from benchmark.quality import reliable_heart_rate, InsufficientSignal, input_quality


def projection_reference(rgb, fs, method):
    # Matrix formulation of the paper projections, independently vectorized.
    projection = np.array([[0, 1, -1], [-2, 1, 1]]) if method == 'POS' else np.array([[3, -2, 0], [1.5, 1, -1.5]])
    n, width, hop = len(rgb), min(len(rgb), round(1.6*fs)), max(1, round(fs/5))
    starts = np.arange(0, n-width+1, hop)
    blocks = np.stack([rgb[s:s+width] for s in starts])
    normalized = blocks/blocks.mean(axis=1, keepdims=True)-1
    projected = normalized @ projection.T
    alpha = projected[:, :, 0].std(axis=1)/np.maximum(projected[:, :, 1].std(axis=1), 1e-10)
    h = projected[:, :, 0] + (1 if method == 'POS' else -1)*alpha[:, None]*projected[:, :, 1]
    h -= h.mean(axis=1, keepdims=True)
    win = np.hanning(width)
    out, weights = np.zeros(n), np.zeros(n)
    for s, block in zip(starts, h):
        out[s:s+width] += block*win
        weights[s:s+width] += win
    return np.divide(out, weights, out=np.zeros(n), where=weights > 1e-8)


def test_real_js_against_independent_numpy_projection_and_scipy_fft():
    js = """import {fixture} from './scripts/synthetic-fixtures.mjs';import {extract,spectrum} from './web/signal.js';
    const rgb=fixture(90,'drift',16).map(s=>s.rgb);console.log(JSON.stringify({rgb,methods:['POS','CHROM'].map(method=>{const wave=extract(rgb,20,method);return {method,wave,spectrum:spectrum(wave,20,{diagnostics:true})};})}));"""
    data = json.loads(subprocess.run(['node', '--input-type=module', '-e', js], check=True, capture_output=True, text=True).stdout)
    rgb = np.array(data['rgb'])
    errors = {}
    for row in data['methods']:
        wave = projection_reference(rgb, 20, row['method'])
        errors[row['method']] = float(np.max(np.abs(wave-row['wave'])))
        np.testing.assert_allclose(row['wave'], wave, atol=1e-12, rtol=1e-10)
        np.testing.assert_allclose(pulse(rgb, 20, row['method']), wave, atol=1e-12)
        power = abs(np.fft.rfft(detrend(wave)*np.hanning(len(wave))))**2
        for b in row['spectrum']['bins']:
            np.testing.assert_allclose(b['p'], power[b['k']], atol=1e-15, rtol=1e-9)
        bpm, audit = reliable_heart_rate(wave, 20)
        np.testing.assert_allclose(bpm, row['spectrum']['bpm'], atol=1e-10)
        np.testing.assert_allclose(audit['secondary_ratio'], row['spectrum']['secondary'], atol=1e-10)
    print('independent projection max abs errors:', errors)


@pytest.mark.parametrize('duration', [16, 45])
@pytest.mark.parametrize('offset', [0, .1, .25, .4, .5])
def test_python_hann_frequency_units(duration, offset):
    n, fs = duration*20, 20
    f = (round(duration*1.5)+offset)/duration
    bpm, _ = reliable_heart_rate(np.sin(2*np.pi*f*np.arange(n)/fs), fs)
    assert abs(bpm-f*60) <= 30/duration+1e-8


def test_python_color_gate_allows_weak_signal_but_rejects_constant():
    t = np.arange(321)/20
    rgb = np.array([170, 120, 100])*(1+np.sin(2*np.pi*t[:, None])*np.array([.000267, .001, .0004]))
    frames = np.broadcast_to(rgb[:, None, None, :], (321, 8, 8, 3))
    telemetry = {'face_count': np.ones(321), 'roi_valid': np.ones(321)}
    audit = input_quality(frames, telemetry)
    assert 1e-10 < audit['chromatic_std'] < .0005
    for method in ('POS', 'CHROM'):
        assert abs(reliable_heart_rate(pulse(rgb, 20, method), 20)[0]-60) < 2
    with pytest.raises(InsufficientSignal, match='no_chromatic'):
        input_quality(np.broadcast_to([170., 120., 100.], (321, 8, 8, 3)), telemetry)
