"""Adversarial abstention regressions and positive coverage controls."""
import json
import numpy as np
import pytest
from benchmark.quality import input_quality, reliable_heart_rate, InsufficientSignal
from benchmark.metrics import metrics, subject_bootstrap
from benchmark.signal import heart_rate


def sample(bpm=72):
    t = np.arange(480)/30
    p = np.sin(2*np.pi*bpm/60*t)
    rgb = np.array([130,100,80])+p[:,None]*np.array([1,4,.5])
    frames = np.broadcast_to(rgb.astype(np.uint8)[:,None,None,:], (480,32,32,3)).copy()
    telemetry = {'face_count': np.ones(480), 'roi_valid': np.ones(480)}
    return frames, telemetry, p


@pytest.mark.parametrize('bpm', [54,72,83.2,108,127.3,150,172.5])
def test_clean_positive_controls_remain_accepted(bpm):
    frames, telemetry, p = sample(bpm)
    input_quality(frames, telemetry)
    assert abs(reliable_heart_rate(p)[0]-bpm) < 2


@pytest.mark.parametrize('kind', ['constant', 'light', 'motion', 'occlusion', 'lost', 'multiple', 'missing', 'short', 'nonfinite'])
def test_bad_input_is_insufficient_signal(kind):
    frames, telemetry, _ = sample()
    if kind == 'constant': frames[:] = [130,100,80]
    if kind == 'light':
        t = np.arange(480)/30
        rgb = np.array([130,100,80])*(1+.2*np.sin(2*np.pi*1.2*t[:,None]))
        frames[:] = rgb.astype(np.uint8)[:,None,None,:]
    if kind == 'motion': frames[:,::2] = np.random.default_rng(2).integers(40,200,frames[:,::2].shape)
    if kind == 'occlusion': telemetry['roi_valid'][240] = 0
    if kind == 'lost': telemetry['face_count'][240] = 0
    if kind == 'multiple': telemetry['face_count'][240] = 2
    if kind == 'missing': telemetry = None
    if kind == 'short': telemetry['roi_valid'] = np.ones(479)
    if kind == 'nonfinite': telemetry['face_count'][0] = np.nan
    with pytest.raises(InsufficientSignal): input_quality(frames, telemetry)


def test_pr4_harmonic_144_and_motion_96_regressions():
    t = np.arange(480)/30
    p = np.sin(2*np.pi*1.2*t)
    for wave in (p+3*np.sin(2*np.pi*2.4*t), p+4*np.sin(2*np.pi*1.6*t)):
        assert abs(heart_rate(wave)-72) > 20
        with pytest.raises(InsufficientSignal): reliable_heart_rate(wave)


def test_spectrum_alone_cannot_detect_pure_periodic_motion():
    # Explicit residual limitation, not a fabricated success claim.
    t = np.arange(480)/30
    assert abs(reliable_heart_rate(np.sin(2*np.pi*1.6*t))[0]-96) < 2
    frames, _, _ = sample(96)
    with pytest.raises(InsufficientSignal, match='missing_face_roi'):
        input_quality(frames)


def test_noise_constant_nan_rejected():
    for wave in (np.ones(480), np.full(480,np.nan), np.random.default_rng(2026).normal(size=480)):
        with pytest.raises(InsufficientSignal): reliable_heart_rate(wave)


def test_no_output_is_not_zero_error_or_good_coverage():
    rows = [dict(status='insufficient_signal', subject_id=s) for s in ('a','b')]
    m = metrics(rows)
    assert m['coverage'] == 0 and m['mae_bpm'] is None
    assert m['wrong_output_rate_accepted'] is None and m['rejection_rate'] == 1
    ci = subject_bootstrap(rows, repeats=20)
    assert ci['mae_ci95'] is None and ci['draws_without_output'] == 20


def test_bootstrap_subjects_not_windows():
    rows = [dict(status='ok',subject_id=s,predicted_bpm=b,reference_bpm=72,inference_s=.1)
            for s,b in [('a',72),('b',92)]]
    ci = subject_bootstrap(rows, repeats=100)
    assert ci == subject_bootstrap(rows, repeats=100)
    assert ci['mae_ci95'] == [0.,20.]
    assert metrics(rows)['wrong_output_rate_accepted'] == .5


def test_quality_csv_requires_exact_time_alignment(tmp_path):
    from benchmark.fixture import generate
    from benchmark.prepare import prepare
    manifest = generate(tmp_path/'fixture')
    root = manifest.parent
    q = tmp_path/'q.csv'
    q.write_text('timestamp_s,face_count,roi_valid\n'+''.join(f'{t+.1},1,1\n' for t in np.arange(960)/30))
    with pytest.raises(ValueError, match='timestamps'):
        prepare(root/'synthetic.avi',root/'timestamps.csv',root/'reference.csv',(0,0,32,32),tmp_path/'out.npz',q,'test observer')


def test_missing_telemetry_retains_windows_and_no_bpm(tmp_path):
    from benchmark.fixture import generate
    from benchmark.data import sha256
    from benchmark.run import run
    manifest = generate(tmp_path/'fixture')
    m = json.loads(manifest.read_text()); m['records'] = m['records'][:1]
    recording = manifest.parent/'valid.npz'
    with np.load(recording) as z:
        data = {k:z[k] for k in z.files if k not in ('face_count','roi_valid')}
    np.savez_compressed(recording, **data)
    m['records'][0]['sha256'] = sha256(recording)
    manifest.write_text(json.dumps(m))
    run(manifest,tmp_path/'out')
    rows = [json.loads(s) for s in (tmp_path/'out/windows.jsonl').read_text().splitlines()]
    assert len(rows) == 12
    assert all(r['predicted_bpm'] is None for r in rows)
    assert all(r['status'] == 'insufficient_signal' for r in rows if r['algorithm'] in ('POS','CHROM'))
