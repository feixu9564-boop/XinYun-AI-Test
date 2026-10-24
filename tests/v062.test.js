// ENGINEERING ONLY. No fixture in this file is a person or accuracy evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {extract,spectrum,analyze,POLICY} from '../web/signal.js';
import {DiagnosticCapture} from '../web/diagnostics.js';
import {sampleROI,POLYGONS} from '../web/roi.js';

test('quality thresholds retained; Hann isolated tone sweep has no forced rejection',()=>{
  assert.deepEqual([POLICY.minPeakFraction,POLICY.maxSecondaryRatio,POLICY.maxSubharmonicRatio],[.6,.04,.04]);
  for(let f=.8;f<2.9;f+=.025){const r=spectrum(Array.from({length:480},(_,i)=>Math.sin(2*Math.PI*f*i/30)),30);assert.equal(r.reason,'');assert.ok(Math.abs(r.bpm-60*f)<2);assert.equal(r.bins.length,37);}
});
test('diffuse/competing spectrum retains candidates and all rejection metrics without output BPM',()=>{
  const x=Array.from({length:480},(_,i)=>Math.sin(2*Math.PI*1.2*i/30)+.8*Math.sin(2*Math.PI*1.8*i/30));
  const r=spectrum(x,30);assert.equal(r.bpm,null);assert.ok(r.candidate_bpm>0);assert.ok(r.rejections.length);assert.ok(r.secondary>.04);assert.ok(r.bins.every(b=>Number.isFinite(b.p)));
});
test('CHROM tail is covered even when length does not divide hop',()=>{
  const rgb=Array.from({length:487},(_,i)=>[100+Math.sin(i*.23),110+2*Math.sin(i*.23),90+.2*Math.sin(i*.23)]),trace={};
  const wave=extract(rgb,30,'CHROM',trace);assert.equal(wave.length,rgb.length);assert.equal(trace.alphas.at(-1).start+trace.window_samples,rgb.length);assert.ok(wave.slice(-8,-1).some(v=>Math.abs(v)>1e-6));
});
test('diagnostics preserve interruptions rather than stitching invalid samples',()=>{
  const d=new DiagnosticCapture({session_id:'ENGINEERING'});d.event('measurement_start');
  for(let i=0;i<=600;i++)d.add({t:i/20,rgb:[100,100,100],motion:0,displacement:0,faceCount:1,roiValid:true},i===590?'no_face':'');
  const r=d.report();assert.equal(r.comparisons.find(x=>x.window==='final16').result.reason,'no_face');assert.ok(r.samples.some(s=>s.reason==='no_face'));assert.equal(r.human_accuracy,'NOT_VALIDATED');
});
test('ROI and full/multiple windows are shadow diagnostics and cannot choose a successful candidate',()=>{
  const d=new DiagnosticCapture({session_id:'ENGINEERING'});d.event('measurement_start');
  const regions=Object.fromEntries(['forehead','left_cheek','right_cheek'].map(k=>[k,{rgb:[100,100,100],motion:0,valid_fraction:1}]));
  for(let i=0;i<=900;i++)d.add({t:i/20,rgb:[100,100,100],regions,motion:0,displacement:0,faceCount:1,roiValid:true});
  const r=d.report();assert.equal(r.comparisons.length,24);assert.ok(r.comparisons.every(c=>c.result.bpm===null));assert.match(r.selection_policy,/final16_pooled_only/);assert.equal(r.samples.length,901);
});
test('detailed capture is bounded and excludes image/landmark/grid fields',()=>{
  const d=new DiagnosticCapture({});for(let i=0;i<9002;i++)d.add({t:i,grid:['secret'],image:'secret',landmarks:['secret']});
  assert.equal(d.samples.length,9000);assert.equal(d.truncated,true);assert.doesNotMatch(JSON.stringify(d.samples),/secret/);
});
test('separate ROI means preserve the original pooled pixel weighting',()=>{
  const old=globalThis.Path2D;globalThis.Path2D=class{constructor(){this.points=[];}moveTo(x,y){this.points.push([x,y]);}lineTo(x,y){this.points.push([x,y]);}closePath(){}};
  try{
    const lm=Array.from({length:455},()=>({x:.5,y:.5}));lm[234]={x:.2,y:.5};lm[454]={x:.8,y:.5};lm[33]={x:.3,y:.4};lm[263]={x:.7,y:.4};
    POLYGONS.forEach((ids,k)=>ids.forEach((id,j)=>{const a=2*Math.PI*j/ids.length;lm[id]={x:[.5,.3,.7][k]+.07*Math.cos(a),y:[.25,.6,.6][k]+.06*Math.sin(a)};}));
    const W=320,H=240,data=new Uint8ClampedArray(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;data[i]=x<130?60:x>190?180:110;data[i+1]=100;data[i+2]=90;data[i+3]=255;}
    const ctx={getImageData:()=>({data}),isPointInPath:(p,x,y)=>{const xs=p.points.map(a=>a[0]),ys=p.points.map(a=>a[1]);return x>=Math.min(...xs)&&x<=Math.max(...xs)&&y>=Math.min(...ys)&&y<=Math.max(...ys);}};
    const s=sampleROI(lm,{width:W,height:H,getContext:()=>ctx},{getContext:()=>({stroke(){}})},null);
    assert.equal(s.reason,undefined);assert.equal(Object.keys(s.regions).length,3);assert.notEqual(s.regions.left_cheek.rgb[0],s.regions.right_cheek.rgb[0]);
    const rs=Object.values(s.regions),n=rs.reduce((a,r)=>a+r.valid_pixels,0);assert.equal(s.rgb[0],rs.reduce((a,r)=>a+r.rgb[0]*r.valid_pixels,0)/n);
  }finally{globalThis.Path2D=old;}
});
test('real irregular sampling is audited and over-250ms gap still rejects',()=>{
  const samples=Array.from({length:481},(_,i)=>({t:i/30+(i%2)*.002,rgb:[100+Math.sin(i*.25),110+2*Math.sin(i*.25),90+.2*Math.sin(i*.25)],motion:0,displacement:0,faceCount:1,roiValid:true}));
  const r=analyze(samples,{diagnostics:true});assert.equal(r.resampling.method,'linear');assert.ok(r.trace.POS.waveform.length);samples[240].t+=.4;assert.equal(analyze(samples).reason,'sampling_gap');
});
