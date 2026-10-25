import fs from 'node:fs';
import crypto from 'node:crypto';
const baseline=process.argv.includes('--baseline');
const {analyze,extract,spectrum,POLICY}=await import(baseline?'../docs/issue-12-artifacts/baseline-signal.mjs':'../web/signal.js');
import {DiagnosticCapture} from '../web/diagnostics.js';
import {BUILD} from '../web/build-info.js';
import {fixture,conditions} from './synthetic-fixtures.mjs';
const arg=process.argv.indexOf('--label'),label=arg<0?'after':process.argv[arg+1];
const source=baseline?'docs/issue-12-artifacts/baseline-signal.mjs':'web/signal.js';
const out='docs/issue-12-artifacts';fs.mkdirSync(out,{recursive:true});
const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);};
// Observations below are separate from the production decision. They expose
// metrics even when baseline rejects before extraction; never override result.
function observe(samples){
  const fs=(samples.length-1)/(samples.at(-1).t-samples[0].t),rgb=[];let j=0;
  for(let i=0;i<samples.length;i++){const t=samples[0].t+i/fs;while(j<samples.length-2&&samples[j+1].t<t)j++;const a=samples[j],b=samples[j+1],q=(t-a.t)/(b.t-a.t);rgb.push(a.rgb.map((v,c)=>v+(b.rgb[c]-v)*q));}
  const waves=Object.fromEntries(['POS','CHROM'].map(m=>[m,extract(rgb,fs,m)]));
  const spectra=Object.fromEntries(Object.entries(waves).map(([m,w])=>{const s=spectrum(w,fs,{diagnostics:true});return [m,{...s,snrDb:s.snrDb??(s.concentration>0&&s.concentration<1?10*Math.log10(s.concentration/(1-s.concentration)):null)}];}));
  const sums=samples.map(s=>s.rgb.reduce((a,b)=>a+b,0)),light=sums.map(v=>v/3);
  const chromaStd=Math.max(...[0,1,2].map(c=>sd(samples.map((s,i)=>s.rgb[c]/sums[i]))));
  const p95=a=>{a.sort((a,b)=>a-b);const q=(a.length-1)*.95,i=Math.floor(q);return a[i]+(a[Math.ceil(q)]-a[i])*(q-i);};
  const motion=p95(samples.map(s=>s.motion)),displacement=p95(samples.map(s=>s.displacement)),lightCV=sd(light)/(light.reduce((a,b)=>a+b,0)/light.length);
  const gates=[
    {name:'chromaticity',value:chromaStd,threshold:POLICY.minChromaticStd??POLICY.constantChromaticEpsilon,operator:'>='},
    {name:'light_cv',value:lightCV,threshold:POLICY.maxBrightnessCV,operator:'<='},
    {name:'motion_p95',value:motion,threshold:POLICY.maxMotionP95,operator:'<='},
    {name:'displacement_p95',value:displacement,threshold:.012,operator:'<='}
  ];
  for(const [m,sp] of Object.entries(spectra))for(const [metric,key,threshold,operator] of [['concentration','concentration',POLICY.minPeakFraction,'>='],['secondary','secondary',POLICY.maxSecondaryRatio,'<='],['subharmonic','subharmonic',POLICY.maxSubharmonicRatio,'<=']])gates.push({name:m+'.'+metric,value:sp[key]??null,threshold,operator,diagnosticOnly:true});
  for(const g of gates)g.pass=g.value===null?null:g.operator==='>='?g.value>=g.threshold:g.value<=g.threshold;
  return {chromaStd,lightCV,motion,displacement,waves,spectra,observedGates:gates};
}
const rows=[];
for(const duration of [16,45])for(const bpm of [60,75,90,120])for(const condition of conditions){
  const samples=fixture(bpm,condition,duration),result=analyze(samples,{diagnostics:true});
  rows.push({duration,bpm,condition,seed:12026,result,...observe(samples),samples,adequate:['normal','weak','drift','jitter'].includes(condition)});
}
for(const duration of [16,45])for(const condition of ['flat','white_noise','colored_noise','motion_only','periodic_light','out_of_band'])for(const seed of condition==='flat'?[12026]:[12026,12027,12028,12029]){
  const samples=fixture(75,condition,duration,seed);rows.push({duration,bpm:null,condition,seed,result:analyze(samples,{diagnostics:true}),...observe(samples),samples});
}
// Explicit counterexample, excluded from positive/negative coverage statistics.
// Unobserved chromatic motion identical to pulse is not identifiable from RGB.
const limitations=[16,45].map(duration=>{const samples=fixture(75,'motion_only',duration).map(s=>({...s,motion:.15,displacement:.0002}));return {duration,condition:'indistinguishable_chromatic_artifact',samples,result:analyze(samples,{diagnostics:true})};});
const tones=[];
for(const duration of [16,45])for(const baseHz of [1,1.5,2])for(const offset of [0,.1,.25,.4,.5]){
  const n=duration*20,k=Math.round(baseHz*duration),f=(k+offset)*20/n;if(f<.7||f>3)continue;
  const wave=Array.from({length:n},(_,i)=>Math.sin(2*Math.PI*f*i/20));tones.push({duration,f,bpm:f*60,offset,result:spectrum(wave,20)});
}
const report={label,sourceSHA256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),policy:POLICY,assumptions:{dc:[170,120,100],relativeAC:{normal:[.000801,.003,.0012],weak:[.000267,.001,.0004]},pixels:256,pixelNoiseSD:.5,fps:20,jitterSeconds:.008,seed:12026},rows,tones,limitations};
fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report));
const fmt=v=>typeof v==='number'?v.toPrecision(5):v??'—';
let md=`# ${label}（固定种子；合成数据，不是真机）\n\nsource signal.js SHA256: ${report.sourceSHA256}\n\n|秒|目标|场景|seed|输出/原因|chromaStd|lightCV|motion P95|POS concentration / secondary / half / SNR dB|CHROM concentration / secondary / half / SNR dB|\n|---|---|---|---|---|---|---|---|---|---|\n`;
for(const r of rows){const s=m=>{const p=r.spectra?.[m]??r.result.diagnostics?.spectra?.[m];return p?[p.concentration,p.secondary,p.subharmonic,p.snrDb??(p.concentration>0&&p.concentration<1?10*Math.log10(p.concentration/(1-p.concentration)):null)].map(fmt).join(' / '):'未计算（见 gates）';};md+=`|${r.duration}|${r.bpm??'无'}|${r.condition}|${r.seed}|${r.result.bpm??r.result.reason}|${fmt(r.chromaStd??r.result.chromaStd)}|${fmt(r.lightCV)}|${fmt(r.motion)}|${s('POS')}|${s('CHROM')}|\n`;}
md+='\n## 纯正弦（直接 spectrum，不受颜色门影响）\n\n|秒|输入 BPM|bin偏移|输出/原因|集中度|secondary|half|\n|---|---|---|---|---|---|---|\n';
for(const t of tones)md+=`|${t.duration}|${fmt(t.bpm)}|${t.offset}|${t.result.bpm??t.result.reason}|${fmt(t.result.concentration)}|${fmt(t.result.secondary)}|${fmt(t.result.subharmonic)}|\n`;
md+='\nSNR dB = 10 log10(±1 bin power / remaining in-band power)，不是参考PPG SNR，无额外SNR门。spectra/observedGates 为旁路观测（先线性重采样），只有 result 是生产决定。基线未运行的POS/CHROM不能误记为生产通过。完整生产逐门状态见修复版 result.diagnostics.gates。\n\n已知不可辨识反例（不计作正例或干净负例）：\n';
for(const r of limitations)md+=`- ${r.duration}s indistinguishable_chromatic_artifact: ${r.result.reason}, BPM=${r.result.bpm??'null'}\n`;
fs.writeFileSync(`${out}/${label}.md`,md);
console.log(JSON.stringify({label,cases:rows.length,accepted:rows.filter(r=>r.result.reliable).length,adequateAccepted:rows.filter(r=>r.adequate&&r.result.reliable&&Math.abs(r.result.bpm-r.bpm)<=5).length,adequateTotal:rows.filter(r=>r.adequate).length,tones:tones.length,tonesRejected:tones.filter(t=>t.result.reason).length,falseAccepts:rows.filter(r=>r.bpm===null&&r.result.reliable).length,maxAdequateError:Math.max(0,...rows.filter(r=>r.adequate&&r.result.reliable).map(r=>Math.abs(r.result.bpm-r.bpm))),knownArtifactAccepts:limitations.filter(r=>r.result.reliable).length,reasons:Object.fromEntries([...new Set(rows.map(r=>r.result.reason))].map(reason=>[reason,rows.filter(r=>r.result.reason===reason).length]))},null,2));

if(!baseline){
  const row=rows.find(r=>r.duration===16&&r.bpm===75&&r.condition==='weak');
  const capture=new DiagnosticCapture({appVersion:BUILD.version,commit:BUILD.commit,evidence:'SYNTHETIC_ONLY_NOT_DEVICE_DATA'});
  capture.event('started',0);for(const s of row.samples)capture.add(s,'','measuring');capture.analysis(row.samples,row.result,false,'measurement_complete');
  fs.writeFileSync(`${out}/synthetic-diagnostic.json`,JSON.stringify(capture.report()));
}
