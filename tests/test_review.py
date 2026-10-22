"""Regression tests for PR #4 review findings; no model downloads required."""
import numpy as np
import pytest
from benchmark.adapters import ToolboxAdapter, LOCK
from benchmark.signal import heart_rate
from benchmark.spectral_check import characterize


@pytest.mark.parametrize('bpm',[45,54,60,72,83.2,108,127.3,150,172.5])
@pytest.mark.parametrize('phase',[0.,.7,2.])
def test_optional_peak_interpolation_on_clean_sine(bpm,phase):
    t=np.arange(480)/30
    wave=np.sin(2*np.pi*bpm/60*t+phase)
    assert abs(heart_rate(wave,interpolate=True)-bpm)<.08
    assert heart_rate(wave)/3.75 == pytest.approx(round(heart_rate(wave)/3.75))


@pytest.mark.parametrize('interpolate',[False,True])
def test_harmonic_and_motion_are_known_failures(interpolate):
    t=np.arange(480)/30; pulse=np.sin(2*np.pi*1.2*t)
    harmonic=heart_rate(pulse+3*np.sin(2*np.pi*2.4*t),interpolate=interpolate)
    motion=heart_rate(pulse+4*np.sin(2*np.pi*1.6*t),interpolate=interpolate)
    motion_only=heart_rate(4*np.sin(2*np.pi*1.6*t),interpolate=interpolate)
    assert abs(harmonic-144)<2
    assert abs(motion-96)<2 and abs(motion_only-96)<2
    assert abs(harmonic-72)>60 and abs(motion-72)>20


@pytest.mark.parametrize('bpm',[42,180])
def test_interpolation_band_edges_do_not_escape(bpm):
    t=np.arange(480)/30
    value=heart_rate(np.sin(2*np.pi*bpm/60*t),interpolate=True)
    assert 42<=value<=180


def test_spectral_negative_cases_are_in_evidence():
    result=characterize()
    assert result['fft_grid_bpm']==3.75
    assert len(result['rows'])==30
    assert result['rows'][-1]['reference_bpm'] is None


def test_efficientphys_reconstruction_uses_output_label():
    adapter=ToolboxAdapter.__new__(ToolboxAdapter)
    adapter.name='EfficientPhys';adapter.entry=LOCK['models']['EfficientPhys']
    adapter.predict_raw=lambda frames: np.array([1.,2.,-1.,3.])
    np.testing.assert_array_equal(adapter.predict(None),[1,3,2,5])


@pytest.mark.parametrize('name',['PhysNet','EfficientPhys','PhysFormer'])
def test_constant_input_preprocessing_matches_upstream_zero_convention(name):
    adapter=ToolboxAdapter.__new__(ToolboxAdapter);adapter.entry=LOCK['models'][name]
    x=adapter.preprocess(np.full((10,12,12,3),120,dtype=np.uint8))
    assert np.isfinite(x).all() and (x==0).all()
