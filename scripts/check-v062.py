"""SciPy numerical reference plus existing fixtures. All inputs ENGINEERING_ONLY."""
import json,subprocess,sys
from pathlib import Path
import numpy as np
from scipy.signal import butter,filtfilt
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from benchmark.adversarial import fixture
from benchmark.mobile_signal import pulse
from benchmark.quality import reliable_heart_rate,InsufficientSignal
cases=[]
for name in ('clean','no_pulse','second_harmonic','mixed_motion','noise','indistinguishable_color_artifact'):
    data,_=fixture(1,name);rgb=data['frames'][:480].mean(axis=(1,2))
    for method in ('POS','CHROM'):
        wave=pulse(rgb,30,method)
        try:bpm,_=reliable_heart_rate(wave,30);reason=''
        except InsufficientSignal as e:bpm=None;reason=e.reason
        cases.append(dict(case=name,method=method,rgb=rgb.tolist(),wave=wave.tolist(),bpm=bpm,reason=reason))
filters=[]
for fs in (12,20,29.97,30,60):
    x=np.sin(np.arange(480)*.31)+np.cos(np.arange(480)*.07)
    b,a=butter(3,[.7,3],btype='bandpass',fs=fs)
    filters.append(dict(fs=fs,x=x.tolist(),a=a.tolist(),b=b.tolist(),y=filtfilt(b,a,x).tolist()))
js="""import fs from 'node:fs';import {extract,spectrum} from './web/signal.js';import {extract as oldExtract,spectrum as oldSpectrum} from './tests/fixtures/signal-v061.mjs';import {butterBandpass,filtfilt} from './web/dsp.js';
const {cases,filters}=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify({cases:cases.map(r=>{const wave=extract(r.rgb,30,r.method);return {maxError:Math.max(...wave.map((v,i)=>Math.abs(v-r.wave[i]))),result:spectrum(wave,30),before:oldSpectrum(oldExtract(r.rgb,30,r.method),30)};}),filters:filters.map(r=>{const c=butterBandpass(r.fs),y=filtfilt(r.x,c);return {fs:r.fs,coeffError:Math.max(...c.a.map((v,i)=>Math.abs(v-r.a[i])),...c.b.map((v,i)=>Math.abs(v-r.b[i]))),waveError:Math.max(...y.map((v,i)=>Math.abs(v-r.y[i])))};})}));"""
p=subprocess.run(['node','--input-type=module','-e',js],input=json.dumps(dict(cases=cases,filters=filters)),text=True,capture_output=True,check=True)
actual=json.loads(p.stdout)
for r in actual['filters']:
    assert r['coeffError']<1e-10 and r['waveError']<1e-6,r
    print(json.dumps(dict(type='SCIPY_FILTER_REFERENCE',**r)))
for c,r in zip(cases,actual['cases']):
    assert r['maxError']<1e-7,(c['case'],r['maxError'])
    assert r['result']['reason']==c['reason'],(c['case'],c['reason'],r['result'])
    if c['bpm'] is not None:assert abs(c['bpm']-r['result']['bpm'])<1e-8
    print(json.dumps(dict(case=c['case'],method=c['method'],wave_error=r['maxError'],reason=r['result']['reason'],bpm=r['result']['bpm'],before_reason=r['before']['reason'],before_bpm=r['before']['bpm'])))
print('PASS: 5 SciPy filter references and 12 v2 extraction/spectrum comparisons. NOT HUMAN VALIDATION.')
