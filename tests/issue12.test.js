import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analyze,spectrum,extract} from '../web/signal.js';
import {analyze as baseline,spectrum as baselineSpectrum} from '../docs/issue-12-artifacts/baseline-signal.mjs';
import {fixture,conditions} from '../scripts/synthetic-fixtures.mjs';
import {DiagnosticCapture} from '../web/diagnostics.js';

test('production analyze: 20 FPS camera-like weak/normal pulses and adverse conditions at 16/45 seconds',()=>{
  for(const duration of [16,45])for(const bpm of [60,75,90,120])for(const condition of conditions){
    const r=analyze(fixture(bpm,condition,duration),{diagnostics:true}),tag=JSON.stringify({duration,bpm,condition});
    if(['normal','weak','drift','jitter'].includes(condition)){assert.equal(r.reliable,true,tag);assert.ok(Math.abs(r.bpm-bpm)<=5,tag);}
    if(condition==='motion'){assert.equal(r.bpm,null);assert.equal(r.reason,'excessive_motion');}
    const {diagnostics:trace,...decision}=r;assert.deepEqual(decision,analyze(fixture(bpm,condition,duration)));
    assert.ok(trace.gates.length>=24);assert.equal(r.diagnostics.finalReason,r.reason);
    if(!r.reliable){assert.equal(r.bpm,null);assert.equal(r.pos,null);assert.equal(r.chrom,null);}
  }
});
test('unmodified baseline reproduces early color rejection; Hann half-bin regression is isolated',()=>{
  const samples=fixture(60,'weak',16),old=baseline(samples),fixed=analyze(samples);
  assert.equal(old.reason,'no_chromatic_pulse_evidence');assert.equal(old.pos_reason,undefined);assert.equal(fixed.reliable,true);
  for(const duration of [16,45])for(const hz of [1,1.5,2])for(const offset of [0,.1,.25,.4,.5]){
    const n=20*duration,f=(Math.round(hz*duration)+offset)/duration,w=Array.from({length:n},(_,i)=>Math.sin(2*Math.PI*f*i/20));
    const r=spectrum(w,20);assert.equal(r.reason,'');assert.ok(Math.abs(r.bpm-f*60)<=30/duration+1e-9);
    if(offset===.5)assert.equal(baselineSpectrum(w,20).reason,'competing_periodicity');
  }
});
test('false accepts: flat, white/colored noise, motion-only, periodic light and out-of-band rejected',()=>{
  for(const duration of [16,45])for(const condition of ['flat','white_noise','colored_noise','motion_only','periodic_light','out_of_band'])for(const seed of [12026,12027,12028,12029]){
    const r=analyze(fixture(75,condition,duration,seed));assert.equal(r.reliable,false,JSON.stringify({duration,condition,seed,r}));assert.equal(r.bpm,null);
  }
});
test('known identifiability limit: same RGB and telemetry cannot reveal chromatic artifact origin',()=>{
  const artifact=fixture(75,'motion_only',16).map(s=>({...s,motion:.15,displacement:.0002}));
  assert.equal(analyze(artifact).reliable,true); // Residual limitation, never counted as a positive accuracy result.
});
test('seconds, nonmonotonic time, discontinuities and missing telemetry fail closed',()=>{
  const a=fixture();
  assert.equal(analyze(a.map(s=>({...s,t:s.t*1000}))).bpm,null);
  const gap=a.map(s=>({...s,t:s.t+(s.t>8?1:0)}));assert.equal(analyze(gap).reason,'sampling_gap');
  const reverse=a.map(s=>({...s}));reverse[100].t=reverse[99].t;assert.equal(analyze(reverse).reason,'sampling_gap');
  assert.equal(analyze(a.map(({motion,...s})=>s)).reason,'missing_motion_telemetry');
  const r=analyze(a);assert.equal('diagnostics' in r,false);
});
test('frequency units and normalization scale invariance across camera frame rates',()=>{
  for(const fs of [12,20,30,60])for(const f of [1,1.25,1.5,2]){
    const w=Array.from({length:16*fs},(_,i)=>Math.sin(2*Math.PI*f*i/fs));assert.ok(Math.abs(spectrum(w,fs).bpm-f*60)<2);
  }
  const rgb=fixture().map(s=>s.rgb),a=extract(rgb,20),b=extract(rgb.map(v=>v.map(x=>x*1.1)),20);
  assert.ok(Math.max(...a.map((x,i)=>Math.abs(x-b[i])))<1e-12);
});
test('diagnostic whitelist, null detection failure, memory bound, and replay exact segment',()=>{
  const capture=new DiagnosticCapture({appVersion:'TEST',commit:'LOCAL_UNCOMMITTED'},400);
  capture.add({t:0,previous:{grid:'must never export'}},'no_face','aligning');
  assert.equal(capture.samples[0].rgb,null);assert.equal(capture.samples[0].motion,null);assert.equal(capture.samples[0].brightness,null);
  capture.event('started',1);const samples=fixture(75,'weak',16).map(s=>({...s,t:s.t+1}));
  samples.forEach(s=>capture.add(s,'','measuring'));capture.analysis(samples,analyze(samples,{diagnostics:true}),false,'measurement_complete');
  const data=capture.report();assert.equal(JSON.stringify(data).includes('must never export'),false);
  const dir=mkdtempSync(join(tmpdir(),'issue12-'));try{
    const path=join(dir,'diagnostic.json'),out=join(dir,'replay.json');writeFileSync(path,JSON.stringify(data));
    const run=spawnSync(process.execPath,['scripts/replay-diagnostics.mjs',path,out],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
    const replay=JSON.parse(readFileSync(out));assert.equal(replay.windows[0].result.bpm,analyze(samples).bpm);
    data.samples=data.samples.slice(2);writeFileSync(path,JSON.stringify(data));assert.notEqual(spawnSync(process.execPath,['scripts/replay-diagnostics.mjs',path],{encoding:'utf8'}).status,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
  const small=new DiagnosticCapture({},2);for(let i=0;i<5;i++)small.add({t:i},'no_face','aligning');assert.equal(small.samples.length,2);assert.equal(small.truncated,true);
});

test('half-frequency boundary uses integer bins, avoiding floating-point mask disagreements',()=>{
  const n=321,k=24,q=13,w=Array.from({length:n},(_,i)=>Math.sin(2*Math.PI*k*i/n)+.3*Math.sin(2*Math.PI*q*i/n));
  const fixed=spectrum(w,20),old=baselineSpectrum(w,20);
  assert.ok(old.subharmonic<.04);assert.ok(fixed.subharmonic>.08);
  assert.equal(fixed.reason,'harmonic_ambiguity');assert.equal(fixed.bpm,null);
});
