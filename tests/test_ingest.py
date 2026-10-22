"""Small import-contract fixtures, explicitly nonhuman; not accuracy evidence."""
import json
from pathlib import Path
import numpy as np
import pytest
from benchmark.data import sha256, load_manifest
from benchmark.fixture import generate
from benchmark.ingest_ubfc import inspect_plan, ingest, parse_ground_truth
from benchmark.metrics import metrics


@pytest.fixture
def plan(tmp_path):
    root=tmp_path/'local';root.mkdir()
    auth=root/'permission.txt';auth.write_text('NONHUMAN unit fixture only; not a human authorization')
    sync=root/'sync.txt';sync.write_text('NONHUMAN generated timestamps, offset zero')
    records=[]
    for i, split in enumerate(('train','validation','test')):
        folder=root/str(i);generate(folder)
        # Distinct file bytes, without changing encoded pixels; no duplicated raw file.
        with (folder/'synthetic.avi').open('ab') as f: f.write(bytes([i]))
        t=np.arange(961)/30
        raw=folder/'ground_truth.txt'
        np.savetxt(raw,np.vstack([np.sin(2*np.pi*1.2*t),np.full(len(t),72),t]))
        q=folder/'quality.csv'
        q.write_text('timestamp_s,face_count,roi_valid\n'+''.join(f'{v},1,1\n' for v in t[:-1]))
        def spec(p): return dict(path=str(p.relative_to(root)),sha256=sha256(p))
        records.append(dict(id=f'rec-{i}',subject_id=f'anon-{i}',split=split,duration_s=32,reference_offset_s=0,
            video=spec(folder/'synthetic.avi'),timestamps=spec(folder/'timestamps.csv'),ground_truth=spec(raw),
            quality=spec(q),sync_evidence=spec(sync),quality_source='nonhuman generator only',
            sync_method='nonhuman simultaneous generation; no inferred real-video clock',roi=[0,0,32,32],conditions={}))
    data=dict(schema_version=1,dataset='UBFC-rPPG-DATASET_2',dataset_version='NONHUMAN-unit-test',
        source_url='local:NONHUMAN-test',permission_review='NONHUMAN-test',pretraining_overlap_review='NONHUMAN-test',
        authorization_evidence=dict(path=auth.name,sha256=sha256(auth)),records=records)
    path=root/'plan.json';path.write_text(json.dumps(data));return path


def test_empty_acquisition_is_blocked_not_zero_error(tmp_path):
    result=ingest(Path(__file__).parents[1]/'docs/phase4-empty-plan.json',tmp_path/'out')
    assert result['status']=='BLOCKED' and result['real_evaluated_recordings']==0
    assert len(result['algorithms'])==6
    assert all(a['status']=='NOT_RUN' for a in result['algorithms'].values())
    assert not (tmp_path/'out/manifest.json').exists()


@pytest.mark.parametrize('mutation',['leak','hash','missing_sync','duplicate_video','unsafe_id','no_permission'])
def test_preflight_does_not_decode_invalid_inputs(plan,tmp_path,mutation):
    data=json.loads(plan.read_text());r=data['records'][1]
    if mutation=='leak':r['subject_id']=data['records'][0]['subject_id']
    if mutation=='hash':r['video']['sha256']='0'*64
    if mutation=='missing_sync':r['sync_evidence']['path']='missing.txt'
    if mutation=='duplicate_video':r['video']=data['records'][0]['video']
    if mutation=='unsafe_id':r['id']='../escape'
    if mutation=='no_permission':data['authorization_evidence']=None
    plan.write_text(json.dumps(data))
    result=ingest(plan,tmp_path/'out')
    assert result['status']=='BLOCKED'
    assert not list((tmp_path/'out').glob('*.npz'))


def test_import_preserves_split_hashes_and_missing_hr(plan,tmp_path):
    data=json.loads(plan.read_text());r=data['records'][2]
    raw=plan.parent/r['ground_truth']['path'];gt=np.loadtxt(raw);gt[1,600]=np.nan;np.savetxt(raw,gt)
    r['ground_truth']['sha256']=sha256(raw);plan.write_text(json.dumps(data))
    result=ingest(plan,tmp_path/'out')
    assert result['status']=='INGESTED_NOT_EVALUATED'
    assert result['records'][2]['invalid_device_hr_samples']==1
    manifest=load_manifest(tmp_path/'out/manifest.json')
    assert {r['split'] for r in manifest['records']}=={'train','validation','test'}
    assert manifest['source_plan_sha256']==sha256(plan)
    assert all(r['reference_offset_s']==0 for r in manifest['records'])
    assert all('CMS50E device HR' in r['reference_definition'] for r in manifest['records'])
    with pytest.raises(FileExistsError):ingest(plan,tmp_path/'out')


@pytest.mark.parametrize('kind',['duplicate_time','unresolved_offset','trimmed_duration'])
def test_bad_reference_or_clock_does_not_emit_manifest(plan,tmp_path,kind):
    data=json.loads(plan.read_text());r=data['records'][2]
    raw=plan.parent/r['ground_truth']['path'];gt=np.loadtxt(raw)
    if kind=='duplicate_time':gt[2,5]=gt[2,4]
    if kind=='unresolved_offset':gt[2]+=100
    if kind=='trimmed_duration':r['duration_s']=16
    np.savetxt(raw,gt)
    r['ground_truth']['sha256']=sha256(raw);plan.write_text(json.dumps(data))
    result=ingest(plan,tmp_path/'out')
    assert result['status']=='BLOCKED'
    assert not (tmp_path/'out/manifest.json').exists()


def test_reference_no_clock_reset_or_camera_proxy(tmp_path):
    raw=tmp_path/'ref.txt';t=np.arange(481)/30+100
    np.savetxt(raw,np.vstack([np.sin(t),np.full(len(t),75),t]))
    rt,hr,audit=parse_ground_truth(raw)
    assert rt[0]==100 and (hr==75).all()
    assert audit['reference_sampling_hz']==pytest.approx(30)
    gt=np.loadtxt(raw);gt[0]=0;np.savetxt(raw,gt)
    with pytest.raises(ValueError,match='contact PPG'):parse_ground_truth(raw)


def test_p90_is_defined_only_for_actual_predictions():
    rows=[dict(status='ok',predicted_bpm=72+e,reference_bpm=72,inference_s=.1) for e in (0,10)]
    assert metrics(rows)['absolute_error_p90_bpm']==9
    assert metrics([dict(status='blocked')])['absolute_error_p90_bpm'] is None
