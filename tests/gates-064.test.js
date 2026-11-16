import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,spectrum,POLICY,posChromAgree} from '../web/signal.js';
import {BUILD} from '../web/build-info.js';
import {FIELDS} from '../web/records.js';
import {fixture} from '../scripts/synthetic-fixtures.mjs';

// Synthetic only; NOT device data. DEVICE_TEST_REQUIRED.
const dc=[170,120,100],fs=20,n=321,bin=fs/n;
function comb(K,power,duration=16){ // main tone at bin centre + K weak tones, each <= 4% of the main peak power
  const a=Math.sqrt(power),k0=Math.round(1.25/bin),ks=[];
  for(let j=1;ks.length<K&&j<200;j++){const c=k0+(j%2?1:-1)*Math.ceil(j/2)*3;if(c*bin>=.75&&c*bin<=2.9)ks.push(c);}
  return Array.from({length:duration*fs+1},(_,i)=>{const t=i/fs;return Math.sin(2*Math.PI*k0*bin*t)+ks.reduce((s,k,q)=>s+a*Math.sin(2*Math.PI*k*bin*t+q*1.3),0);});
}
const asSamples=w=>w.map((v,i)=>({t:i/fs,rgb:[.267,1,.4].map((m,c)=>dc[c]*(1+.003*m*v)),faceCount:1,roiValid:true,motion:.15,displacement:.0002}));

test('version is bumped to 0.6.4-rc and new export fields are appended (old fields untouched)',()=>{
  assert.equal(BUILD.version,'0.6.4-rc');
  assert.deepEqual(FIELDS.slice(-4),['pos_spectral_entropy','chrom_spectral_entropy','pos_chrom_bpm_diff','invalid_frame_ratio']);
  assert.ok(FIELDS.includes('invalid_frames')&&FIELDS.includes('pos_peak_bpm')&&FIELDS.includes('capture_version'));
});

test('gate 2 spectral entropy: clean 60/75/90/120 BPM pulses still pass with entropy well below threshold',()=>{
  assert.equal(POLICY.maxSpectralEntropy,.50);
  for(const duration of [16,45])for(const bpm of [60,75,90,120])for(const condition of ['normal','weak','drift','jitter']){
    const r=analyze(fixture(bpm,condition,duration)),tag=JSON.stringify({duration,bpm,condition});
    assert.equal(r.reliable,true,tag);
    for(const k of ['pos_spectral_entropy','chrom_spectral_entropy'])assert.ok(r[k]>0&&r[k]<.45,tag+k+r[k]);
  }
});
test('gate 2 spectral entropy: weak multi-peak spectrum that passes every older gate is rejected only by entropy',()=>{
  const ok=spectrum(comb(6,.03),fs),bad=spectrum(comb(10,.03),fs);
  assert.equal(ok.reason,'');assert.ok(ok.spectralEntropy<.50);
  assert.equal(bad.baseReason,'');                       // concentration/secondary/subharmonic all pass
  assert.equal(bad.reason,'high_spectral_entropy');assert.equal(bad.bpm,null);assert.ok(bad.spectralEntropy>.50);
  const r=analyze(asSamples(comb(10,.03)),{diagnostics:true});
  assert.equal(r.reliable,false);assert.equal(r.reason,'high_spectral_entropy');assert.equal(r.bpm,null);
  assert.equal(r.pos_reason,'accepted_spectrum');       // existing-gate reasons keep their <=0.6.3-rc meaning
  assert.ok(r.pos_spectral_entropy>.50&&r.chrom_spectral_entropy>.50);
  assert.ok(r.diagnostics.gates.some(g=>g.name==='POS.spectral_entropy'&&g.pass===false));
  assert.equal(analyze(asSamples(comb(6,.03))).reliable,true);
});
test('gate 2 spectral entropy: noise and flat spectra stay rejected; entropy never lowers an older rejection reason',()=>{
  for(const condition of ['white_noise','colored_noise','periodic_light','out_of_band'])assert.equal(analyze(fixture(75,condition)).reliable,false,condition);
  assert.equal(spectrum(comb(14,.06),fs).reason,'competing_periodicity'); // older gate keeps priority
  assert.ok(spectrum([],fs).spectralEntropy===undefined);
});

test('gate 1 POS/CHROM cross-check: >5 BPM apart fails, never picks one; boundary and diagnostics',()=>{
  assert.equal(POLICY.maxPosChromDiffBpm,5);
  assert.deepEqual(posChromAgree(75,80),{diff:5,pass:true});
  assert.equal(posChromAgree(75,80.01).pass,false);
  assert.equal(posChromAgree(60,90).pass,false);
  assert.equal(posChromAgree(75,70.5).pass,true);
  // Accepted real results always carry both methods' BPM and their difference; none is ever a single-method pick.
  const r=analyze(fixture(75,'normal'));
  assert.equal(r.reliable,true);assert.ok(Number.isFinite(r.pos)&&Number.isFinite(r.chrom));assert.ok(r.pos_chrom_bpm_diff<=5);
});
test('gate 1: one method without a BPM means no output (no single-algorithm fallback)',()=>{
  const r=analyze(fixture(75,'noise'));
  if(!r.reliable){assert.equal(r.bpm,null);assert.equal(r.pos,null);assert.equal(r.chrom,null);assert.ok(Number.isFinite(r.pos_chrom_bpm_diff)||r.pos_chrom_bpm_diff===null);}
});

test('gate 3 invalid_frames ratio: 203/1162 (17.5%) is rejected; boundary 15%; absent stats keep old behaviour',()=>{
  assert.equal(POLICY.maxInvalidFrameRatio,.15);
  const s=fixture(75,'normal');
  const bad=analyze(s,{frames:{invalid:203,total:1162}});
  assert.equal(bad.reliable,false);assert.equal(bad.reason,'too_many_invalid_frames');assert.equal(bad.bpm,null);assert.equal(bad.pos,null);assert.equal(bad.chrom,null);
  assert.ok(Math.abs(bad.invalid_frame_ratio-203/1162)<1e-12);
  assert.equal(analyze(s,{frames:{invalid:174,total:1162}}).reliable,true);   // 14.97%
  assert.equal(analyze(s,{frames:{invalid:175,total:1162}}).reliable,false);  // 15.06%
  assert.equal(analyze(s,{frames:{invalid:150,total:1000}}).reliable,true);   // exactly 15% passes ("exceeds 15%" rejects)
  const old=analyze(s);assert.equal(old.reliable,true);assert.equal(old.invalid_frame_ratio,null);
  const d=analyze(s,{diagnostics:true,frames:{invalid:203,total:1162}});
  assert.ok(d.diagnostics.gates.some(g=>g.name==='invalid_frame_ratio'&&g.pass===false));
});
test('gate 3: an older rejection keeps its reason; ratio is still logged',()=>{
  const r=analyze(fixture(75,'white_noise'),{frames:{invalid:500,total:1000}});
  assert.equal(r.reliable,false);assert.notEqual(r.reason,'too_many_invalid_frames');assert.equal(r.invalid_frame_ratio,.5);
});
