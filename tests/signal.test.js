import test from 'node:test';import assert from 'node:assert/strict';import {analyze,extract,spectrum} from '../web/signal.js';
function synthetic(bpm=72,fs=30,duration=20){return Array.from({length:fs*duration+1},(_,i)=>{const t=i/fs,p=Math.sin(2*Math.PI*bpm/60*t),l=1+.02*Math.sin(2*Math.PI*.2*t);return {t,rgb:[130*l+.35*p,100*l+1.2*p,80*l+.15*p],motion:0};});}
for(const bpm of [54,72,108,150])test(`synthetic ${bpm} BPM recovered by POS and CHROM`,()=>{const s=synthetic(bpm),r=analyze(s);assert.equal(r.reliable,true,JSON.stringify({...r,wave:undefined}));assert.ok(Math.abs(r.bpm-bpm)<=4);for(const m of ['POS','CHROM'])assert.ok(Math.abs(spectrum(extract(s.map(v=>v.rgb),30,m),30).bpm-bpm)<=4);});
test('constant pixels cannot yield reliable pulse',()=>{const s=synthetic().map(v=>({...v,rgb:[130,100,80]}));assert.equal(analyze(s).bpm,null);});
test('short recording rejected',()=>assert.equal(analyze(synthetic(72,30,10)).reliable,false));
test('low frame rate rejected',()=>assert.match(analyze(synthetic(72,8)).reason,/帧率/));
test('motion rejected',()=>assert.equal(analyze(synthetic().map(v=>({...v,motion:.03}))).reliable,false));
test('dark and saturated frames rejected',()=>{for(const x of [15,250])assert.equal(analyze(synthetic().map(v=>({...v,rgb:[x,x,x]}))).reliable,false);});
test('frame gap rejected',()=>{const s=synthetic();s.splice(150,15);assert.equal(analyze(s).reliable,false);});
test('non-finite input rejected',()=>{const s=synthetic();s[20].rgb[0]=NaN;assert.equal(analyze(s).reliable,false);});
test('irregular timestamps resampled',()=>{const s=synthetic().map((v,i)=>({...v,t:v.t+(i%2?.004:0)}));assert.equal(analyze(s).reliable,true);});
