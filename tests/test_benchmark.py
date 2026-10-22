import copy
import json
from pathlib import Path
import numpy as np
import pytest
from benchmark.data import load_manifest, load_record, aligned_window, sha256
from benchmark.signal import heart_rate, pulse
from benchmark.metrics import metrics, summarize
from benchmark.adapters import build_adapters, ToolboxAdapter
from benchmark.fixture import generate
from benchmark.prepare import prepare
from benchmark.run import run


@pytest.fixture
def data():
    t=np.arange(481)/30
    p=np.sin(2*np.pi*1.2*t)
    rgb=np.array([130,100,80])+p[:,None]*np.array([1,4,.5])
    return dict(frames=np.broadcast_to(rgb.astype(np.uint8)[:,None,None,:], (481,128,128,3)),
                timestamps=t, reference_timestamps=np.arange(17.), reference_bpm=np.full(17,72.))


@pytest.fixture(scope='module')
def fixture_manifest(tmp_path_factory):
    return generate(tmp_path_factory.mktemp('video')/'fixture')


def test_reference_offset_and_window(data):
    data['reference_timestamps']=np.arange(17.)-.4
    data['reference_timestamps']+=.4
    frames, ref, audit=aligned_window(data,0)
    assert frames.shape==(480,128,128,3)
    assert ref==72
    assert audit['estimated_dropped_frames']==0
    assert audit['actual_fps']==pytest.approx(30)


def test_reference_uses_time_weighting(data):
    data['reference_bpm']=60+data['reference_timestamps']
    assert aligned_window(data,0)[1]==68


@pytest.mark.parametrize('kind', ['gap','dark','overexposed','missing_ref','ref_gap','late_ref','short_video','low_fps'])
def test_rejected_windows(data, kind):
    if kind=='gap':
        data['timestamps'][100:]+=1
    elif kind in ('dark','overexposed'):
        data['frames']=data['frames'].copy(); data['frames'][100]=0 if kind=='dark' else 255
    elif kind=='missing_ref':
        data['reference_bpm'][8]=np.nan
    elif kind=='ref_gap':
        data['reference_timestamps']=np.array([0.,16.]); data['reference_bpm']=np.array([72.,72.])
    elif kind=='late_ref':
        data['reference_timestamps']+=.2
    elif kind=='short_video':
        data['timestamps']=data['timestamps'][:300]; data['frames']=data['frames'][:300]
    elif kind=='low_fps':
        data['timestamps']=data['timestamps'][::3]; data['frames']=data['frames'][::3]
    with pytest.raises(ValueError):
        aligned_window(data,0)


@pytest.mark.parametrize('bpm',[54,72,108,150])
@pytest.mark.parametrize('method',['POS','CHROM'])
def test_baseline_frequency(bpm, method):
    t=np.arange(480)/30; p=np.sin(2*np.pi*bpm/60*t)
    rgb=np.array([130,100,80])+p[:,None]*np.array([.35,1.2,.15])
    assert abs(heart_rate(pulse(rgb,30,method))-bpm)<4


def test_no_constant_or_invalid_hr():
    for wave in (np.ones(480), np.full(480,np.nan), np.ones(10)):
        with pytest.raises(ValueError): heart_rate(wave)


def test_metric_denominators():
    rows=[dict(status='ok',predicted_bpm=75,reference_bpm=72,inference_s=.1),
          dict(status='ok',predicted_bpm=68,reference_bpm=72,inference_s=.2),
          dict(status='rejected'),dict(status='blocked')]
    m=metrics(rows)
    assert m['mae_bpm']==3.5
    assert m['rmse_bpm']==pytest.approx(np.sqrt(12.5))
    assert m['bias_bpm']==-.5
    assert m['coverage']==m['failure_rate']==.5
    assert metrics(rows[2:])['mae_bpm'] is None
    assert metrics([])['coverage'] is None


def test_subject_and_stratum_include_rejection():
    rows=[dict(algorithm='POS',subject_id='s1',conditions={'motion':'static'},status='rejected')]
    groups=summarize(rows)
    assert len(groups)==3
    assert all(g['total_windows']==1 and g['coverage']==0 for g in groups)


@pytest.mark.parametrize('mutation', ['leak','duplicate','empty_subject','unknown_split','labels','authorization','offset','duration'])
def test_manifest_validation(fixture_manifest, tmp_path, mutation):
    m=json.loads(fixture_manifest.read_text())
    a=m['records'][0]
    if mutation=='leak':
        b=copy.deepcopy(a); b.update(id='other', split='train'); m['records'].append(b)
    elif mutation=='duplicate': m['records'].append(copy.deepcopy(a))
    elif mutation=='empty_subject': a['subject_id']=''
    elif mutation=='unknown_split': a['split']='dev'
    elif mutation=='labels': a.pop('label_provenance')
    elif mutation=='authorization': a.pop('research_authorization')
    elif mutation=='offset': a['reference_offset_s']=float('nan')
    elif mutation=='duration': a['duration_s']=-1
    path=tmp_path/'bad.json'; path.write_text(json.dumps(m))
    with pytest.raises(ValueError): load_manifest(path)


def test_load_checksum_and_missing_file(fixture_manifest):
    r=load_manifest(fixture_manifest)['records'][0]
    assert len(load_record(r)['timestamps'])==960
    r['sha256']='0'*64
    with pytest.raises(ValueError, match='checksum'): load_record(r)
    r['_path']+='missing'
    with pytest.raises(FileNotFoundError): load_record(r)


@pytest.mark.parametrize('kind',['nan_time','duplicate_time','frame_count','reference_count','frame_shape'])
def test_input_format_rejection(data, tmp_path, kind):
    data['frames']=data['frames'].copy()
    if kind=='nan_time': data['timestamps'][10]=np.nan
    elif kind=='duplicate_time': data['timestamps'][10]=data['timestamps'][9]
    elif kind=='frame_count': data['frames']=data['frames'][:-1]
    elif kind=='reference_count': data['reference_bpm']=data['reference_bpm'][:-1]
    else: data['frames']=data['frames'][:,:,:,:2]
    p=tmp_path/'bad.npz'; np.savez_compressed(p,**data)
    with pytest.raises(ValueError): load_record(dict(_path=str(p),sha256=sha256(p),reference_offset_s=0))


def test_real_offset_applied_at_load(fixture_manifest, tmp_path):
    r=load_manifest(fixture_manifest)['records'][0]
    r['reference_offset_s']=-.5
    d=load_record(r)
    assert d['reference_timestamps'][0]==-.5
    assert aligned_window(d,0)[1]==72


def test_model_missing_is_not_substituted():
    adapters, states=build_adapters()
    assert set(adapters)=={'POS','CHROM'}
    assert all(states[n]['status']=='blocked' for n in ('PhysNet','EfficientPhys','PhysFormer','PhysMamba'))
    with pytest.raises(RuntimeError,match='supply pinned'):
        ToolboxAdapter('PhysNet',None,acknowledge_license=True)


def test_video_converter_errors(fixture_manifest, tmp_path):
    root=fixture_manifest.parent
    with pytest.raises(ValueError, match='outside'):
        prepare(root/'synthetic.avi',root/'timestamps.csv',root/'reference.csv',(31,31,10,10),tmp_path/'bad.npz')
    short=tmp_path/'short.csv'; short.write_text('timestamp_s\n0\n1\n')
    with pytest.raises(ValueError, match='count mismatch'):
        prepare(root/'synthetic.avi',short,root/'reference.csv',(0,0,32,32),tmp_path/'bad.npz')


def test_smoke_then_full_and_no_overwrite(fixture_manifest, tmp_path):
    smoke=run(fixture_manifest,tmp_path/'smoke',smoke=True)
    full=run(fixture_manifest,tmp_path/'full')
    for result, count, valid in ((smoke,2,2),(full,4,3)):
        totals={r['algorithm']:r for r in result['metrics'] if r['group']=='all'}
        assert len(totals)==6
        assert all(r['total_windows']==count for r in totals.values())
        assert totals['POS']['valid_windows']==totals['CHROM']['valid_windows']==valid
        assert totals['PhysNet']['mae_bpm'] is None
        assert result['synthetic'] is True
    rows=[json.loads(l) for l in (tmp_path/'full/windows.jsonl').read_text().splitlines()]
    assert len(rows)==24
    assert sum(r['status']=='rejected' for r in rows)==6
    assert all(r['predicted_bpm'] is None for r in rows if r['algorithm']=='PhysNet')
    with pytest.raises(FileExistsError): run(fixture_manifest,tmp_path/'full')


def test_missing_record_keeps_all_denominators(fixture_manifest, tmp_path):
    m=json.loads(fixture_manifest.read_text()); m['records']=m['records'][:1]
    m['records'][0]['path']='does-not-exist.npz'
    path=tmp_path/'m.json'; path.write_text(json.dumps(m))
    result=run(path,tmp_path/'out')
    assert all(r['coverage']==0 and r['total_windows']==2 for r in result['metrics'] if r['group']=='all')
