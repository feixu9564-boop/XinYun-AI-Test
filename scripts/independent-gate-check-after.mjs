// Coordinator independent check (not written by Codex): runs the CURRENT web/signal.js on simple synthetic pulses.
import {analyze,spectrum,extract} from '../web/signal.js';
function rng(s){return()=>{s=(s*1664525+1013904223)>>>0;return s/2**32;}}
function gauss(r){return Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r());}
function make(bpm,{ag=.003,ar=.001,ab=.0015,noise=0,dur=16,fs=20,seed=1,jit=0}={}){
  const r=rng(seed),out=[];const f=bpm/60;
  for(let i=0;i<=dur*fs;i++){const t=100+i/fs+(jit?gauss(r)*jit:0);const p=Math.sin(2*Math.PI*f*t);
    const dc=[170,120,100],a=[ar,ag,ab];out.push({t,rgb:dc.map((d,c)=>d*(1+a[c]*p)+noise*gauss(r)),faceCount:1,roiValid:true,motion:.5,displacement:.001});}
  return out;}
for(const bpm of [60,75,90,120]){
  for(const [lbl,o] of [['clean-0.3%',{}],['clean x3',{ag:.009,ar:.003,ab:.0045}],['0.3%+noise0.1',{noise:.1}],['0.3%+noise0.3',{noise:.3}]]){
    const r=analyze(make(bpm,o));console.log(bpm,lbl,r.reason,'chromaStd',r.chromaStd?.toExponential(2),'bpm',r.bpm,r.pos_reason,r.chrom_reason);
  }}
// pure tone spectrum gate
for(const bpm of [60,61,62,63,64,66,72,75,77,90,92,120]){const n=320,fs=20;const s=[...Array(n)].map((_,i)=>Math.sin(2*Math.PI*bpm/60*i/fs));const sp=spectrum(s,fs);console.log('tone',bpm,sp.reason||'ok',sp.concentration.toFixed(3),sp.secondary?.toFixed(4),sp.subharmonic?.toFixed(4));}
