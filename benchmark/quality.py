"""Conservative research abstention, not a physiological validity classifier.

No reference HR or condition labels enter this module. Thresholds are engineering
defaults, NOT calibrated on humans. A periodic artifact can be indistinguishable
from pulse in RGB; trustworthy acquisition/ROI telemetry remains necessary.
"""
import numpy as np
from .signal import heart_rate

POLICY = dict(version='experimental-v1', calibration='NOT_CALIBRATED_ON_REAL_VALIDATION',
              min_peak_fraction=.60, max_secondary_ratio=.04,
              min_subharmonic_ratio=.04, max_motion_p95=3.,
              max_brightness_cv=.08, min_chromatic_std=.0005)


class InsufficientSignal(ValueError):
    def __init__(self, reason, audit=None):
        super().__init__('insufficient_signal: '+reason)
        self.reason, self.audit = reason, audit or {}


def input_quality(frames, telemetry=None):
    """All telemetry must cover the actual resampled window, never a record label.

    roi_valid is an external per-frame skin-ROI verification (tracking or manual),
    not an inference from RGB. Missing telemetry fails closed for every dataset.
    Motion is pixel change after removing global RGB translation, in 8-bit units.
    """
    audit = {'policy_version': POLICY['version']}
    if telemetry is None:
        raise InsufficientSignal('missing_face_roi_telemetry', audit)
    for key in ('face_count', 'roi_valid'):
        v = np.asarray(telemetry.get(key, []))
        if v.shape != (len(frames),) or not np.isfinite(v).all():
            raise InsufficientSignal('invalid_'+key+'_telemetry', audit)
        if not np.all(v == 1):
            raise InsufficientSignal('not_single_face' if key == 'face_count' else 'unstable_or_occluded_roi', audit)
    # Subsample space only, preserve every temporal sample and avoid large copies.
    x = np.asarray(frames[:, ::4, ::4], dtype=float)
    if not np.isfinite(x).all() or len(x) < 120:
        raise InsufficientSignal('invalid_frames', audit)
    rgb = x.mean(axis=(1, 2))
    light = rgb.mean(axis=1)
    if light.min() < 30 or light.max() > 235:
        raise InsufficientSignal('exposure', audit)
    delta = np.diff(x, axis=0)
    delta -= delta.mean(axis=(1, 2), keepdims=True)
    motion = float(np.percentile(np.mean(np.abs(delta), axis=(1, 2, 3)), 95))
    chromatic = rgb / np.maximum(rgb.sum(axis=1, keepdims=True), 1)
    chroma_std = float(np.max(chromatic.std(axis=0)))
    light_cv = float(light.std()/light.mean())
    audit.update(motion_residual_p95=motion, brightness_cv=light_cv, chromatic_std=chroma_std)
    if motion > POLICY['max_motion_p95']:
        raise InsufficientSignal('excessive_motion', audit)
    if light_cv > POLICY['max_brightness_cv']:
        raise InsufficientSignal('illumination_variation', audit)
    if chroma_std < POLICY['min_chromatic_std']:
        raise InsufficientSignal('no_chromatic_pulse_evidence', audit)
    return audit


def reliable_heart_rate(wave, fs=30):
    """Return BPM only after spectral checks; never guess half the peak frequency."""
    wave = np.asarray(wave, dtype=float).reshape(-1)
    if len(wave) < fs*4 or not np.isfinite(wave).all():
        raise InsufficientSignal('invalid_or_short_waveform')
    wave = wave - np.polyval(np.polyfit(np.arange(len(wave)), wave, 1), np.arange(len(wave)))
    if wave.std() < 1e-8:
        raise InsufficientSignal('constant_waveform')
    p = np.abs(np.fft.rfft(wave*np.hanning(len(wave))))**2
    f = np.fft.rfftfreq(len(wave), 1/fs)
    band = (f >= .7) & (f <= 3)
    peak = np.flatnonzero(band)[np.argmax(p[band])]
    if p[band].sum() < 1e-12:
        raise InsufficientSignal('no_in_band_signal')
    around = np.abs(np.arange(len(p))-peak) <= 1
    fraction = float(p[around & band].sum()/p[band].sum())
    other = band & ~around
    secondary = float(p[other].max()/p[peak]) if other.any() else 0.
    half = (np.abs(f-f[peak]/2) <= fs/len(wave)) & (f >= .7)
    subharmonic = float(p[half].max()/p[peak]) if half.any() else 0.
    audit = dict(peak_fraction=fraction, secondary_ratio=secondary, subharmonic_ratio=subharmonic)
    if fraction < POLICY['min_peak_fraction']:
        raise InsufficientSignal('diffuse_spectrum', audit)
    if subharmonic > POLICY['min_subharmonic_ratio']:
        raise InsufficientSignal('harmonic_ambiguity', audit)
    if secondary > POLICY['max_secondary_ratio']:
        raise InsufficientSignal('competing_periodicity', audit)
    return heart_rate(wave, fs), audit
