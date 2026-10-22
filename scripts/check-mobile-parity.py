"""Reuse PR6 fixtures only to verify JS port. No new physiological data or accuracy claim."""
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from benchmark.adversarial import fixture
from benchmark.signal import pulse
from benchmark.quality import reliable_heart_rate, InsufficientSignal

cases=[]
for name in ('clean','no_pulse','second_harmonic','mixed_motion','noise','indistinguishable_color_artifact'):
    data,_=fixture(1,name)
    rgb=data['frames'][:480].mean(axis=(1,2))
    for method in ('POS','CHROM'):
        wave=pulse(rgb,30,method)
        try: bpm,_=reliable_heart_rate(wave,30); reason=''
        except InsufficientSignal as e: bpm=None; reason=e.reason
        cases.append(dict(case=name,method=method,rgb=rgb.tolist(),wave=wave.tolist(),bpm=bpm,reason=reason))
js="""import fs from 'node:fs';import {extract,spectrum} from './web/signal.js';
const rows=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(rows.map(r=>{const wave=extract(r.rgb,30,r.method);return {maxError:Math.max(...wave.map((v,i)=>Math.abs(v-r.wave[i]))),result:spectrum(wave,30)};})));"""
p=subprocess.run(['node','--input-type=module','-e',js],input=json.dumps(cases),text=True,capture_output=True,check=True)
results=json.loads(p.stdout)
for case,actual in zip(cases,results):
    assert actual['maxError']<1e-10,(case['case'],actual)
    assert case['reason']==actual['result']['reason'],(case['case'],case['reason'],actual)
    if case['bpm'] is not None: assert abs(case['bpm']-actual['result']['bpm'])<1e-9
    print(json.dumps(dict(case=case['case'],algorithm=case['method'],max_wave_error=actual['maxError'],bpm=actual['result']['bpm'],reason=actual['result']['reason'])))
print('PASS: 12 existing-fixture JS/Python extraction and spectral comparisons; NOT human validation')
