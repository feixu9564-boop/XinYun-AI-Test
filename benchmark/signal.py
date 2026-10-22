"""Independent research implementations of POS/CHROM; not upstream code."""
import numpy as np


def pulse(rgb, fs, method):
    rgb = np.asarray(rgb, dtype=float)
    if method not in ('POS', 'CHROM'):
        raise ValueError('unknown baseline')
    if rgb.ndim != 2 or rgb.shape[1] != 3 or not np.isfinite(rgb).all():
        raise ValueError('invalid RGB')
    out, weights = np.zeros(len(rgb)), np.zeros(len(rgb))
    width = round(1.6 * fs)
    for start in range(0, len(rgb) - width + 1, max(1, round(fs / 5))):
        block = rgb[start:start + width]
        mu = block.mean(axis=0)
        if np.any(mu <= 0):
            raise ValueError('nonpositive RGB mean')
        r, g, b = (block / mu - 1).T
        x, y = (g-b, g+b-2*r) if method == 'POS' else (3*r-2*g, 1.5*r+g-1.5*b)
        h = x + (1 if method == 'POS' else -1) * np.std(x) / max(np.std(y), 1e-10) * y
        win = np.hanning(width)
        out[start:start+width] += (h-h.mean()) * win
        weights[start:start+width] += win
    return np.divide(out, weights, out=np.zeros_like(out), where=weights > 1e-8)


def heart_rate(wave, fs=30, *, interpolate=False):
    """Hann FFT peak; optional log-power parabola, not a quality/identity test.

    Default retains the fixed FFT bin estimator. Interpolation refines a peak
    location only; it cannot distinguish pulse, harmonics, or periodic motion.
    """
    wave = np.asarray(wave, dtype=float).reshape(-1)
    if len(wave) < fs * 4 or not np.isfinite(wave).all():
        raise ValueError('invalid or short waveform')
    x = np.arange(len(wave), dtype=float)
    wave = wave - np.polyval(np.polyfit(x, wave, 1), x)
    if np.std(wave) < 1e-8:
        raise ValueError('constant waveform')
    power = abs(np.fft.rfft(wave * np.hanning(len(wave)))) ** 2
    frequencies = np.fft.rfftfreq(len(wave), 1/fs)
    valid = (frequencies >= .7) & (frequencies <= 3)
    if power[valid].sum() < 1e-12:
        raise ValueError('no in-band signal')
    index = np.flatnonzero(valid)[np.argmax(power[valid])]
    offset = 0.
    if interpolate and 0 < index < len(power)-1 and valid[index-1] and valid[index+1]:
        a, b, c = np.log(np.maximum(power[index-1:index+2], np.finfo(float).tiny))
        denominator = a - 2*b + c
        if denominator < -1e-12:
            offset = float(np.clip(.5*(a-c)/denominator, -.5, .5))
    return float((index+offset) * fs/len(wave) * 60)
