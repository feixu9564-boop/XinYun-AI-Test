// Research implementation: temporally normalized, sliding-window POS/CHROM.
export const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
const std = a => {const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)));};
export function extract(rgb, fs, method='POS', audit=null) {
  const n=rgb.length, out=Array(n).fill(0), weight=Array(n).fill(0);
  const w=Math.min(n,Math.round(1.6*fs));
  for(let start=0;start+w<=n;start+=Math.max(1,Math.round(fs/5))){
    const block=rgb.slice(start,start+w), mu=[0,1,2].map(c=>mean(block.map(v=>v[c])));
    if(mu.some(v=>v<1)) continue;
    const norm=block.map(v=>v.map((x,c)=>x/mu[c]-1));
    const x=norm.map(([r,g,b])=>method==='POS'?g-b:3*r-2*g);
    const y=norm.map(([r,g,b])=>method==='POS'?g+b-2*r:1.5*r+g-1.5*b);
    const alpha=std(x)/Math.max(std(y),1e-10);
    if(audit)audit.push({start,window:w,mean:mu,alpha});
    const h=x.map((v,i)=>v+(method==='POS'?1:-1)*alpha*y[i]), m=mean(h);
    for(let j=0;j<w;j++){const win=0.5-0.5*Math.cos(2*Math.PI*j/(w-1));out[start+j]+=(h[j]-m)*win;weight[start+j]+=win;}
  }
  return out.map((v,i)=>weight[i]>1e-8?v/weight[i]:0);
}
// Port of benchmark/quality.py experimental-v2; NOT calibrated on humans.
export const VERSION='mobile-pos-chrom-v1/experimental-v2';
export const POLICY={minPeakFraction:.60,maxSecondaryRatio:.04,maxSubharmonicRatio:.04,maxMotionP95:3,maxBrightnessCV:.08,constantChromaticEpsilon:1e-10,mainLobeBins:2};
export const percentile=(a,q)=>{const b=[...a].sort((x,y)=>x-y),i=(b.length-1)*q,j=Math.floor(i);return b[j]+(b[Math.ceil(i)]-b[j])*(i-j);};
export function spectrum(signal,fs,{diagnostics=false}={}){
  const n=signal.length,m=mean(signal),center=(n-1)/2;
  const slope=signal.reduce((s,v,i)=>s+(i-center)*(v-m),0)/Math.max(1,signal.reduce((s,_,i)=>s+(i-center)**2,0));
  const detrended=signal.map((v,i)=>v-m-slope*(i-center));
  const waveformStd=std(detrended);
  const spectralAudit=diagnostics?{sampleCount:n,minSamples:fs*4,waveformStd:Number.isFinite(waveformStd)?waveformStd:null,bandPower:null}:{};
  const reject=reason=>({bpm:null,reason,concentration:0,...spectralAudit});
  if(n<fs*4||signal.some(v=>!Number.isFinite(v)))return reject('invalid_or_short_waveform');
  if(waveformStd<1e-8)return reject('constant_waveform');
  const x=detrended.map((v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))),bins=[];
  for(let k=Math.ceil(.7*n/fs);k<=Math.floor(3*n/fs);k++){
    let re=0,im=0;for(let j=0;j<n;j++){const a=2*Math.PI*k*j/n;re+=x[j]*Math.cos(a);im-=x[j]*Math.sin(a);}
    bins.push({k,f:k*fs/n,p:re*re+im*im});
  }
  if(!bins.length)return reject('no_in_band_signal');
  const peak=bins.reduce((a,b)=>a.p>b.p?a:b),total=bins.reduce((s,b)=>s+b.p,0);
  if(diagnostics)spectralAudit.bandPower=total;
  if(total<1e-12)return reject('no_in_band_signal');
  const fraction=bins.filter(b=>Math.abs(b.k-peak.k)<=1).reduce((s,b)=>s+b.p,0)/total;
  const competitors=bins.filter(b=>Math.abs(b.k-peak.k)>POLICY.mainLobeBins),halves=bins.filter(b=>Math.abs(2*b.k-peak.k)<=2);
  const secondary=Math.max(0,...competitors.map(b=>b.p))/peak.p;
  const half=Math.max(0,...halves.map(b=>b.p))/peak.p;
  const reason=fraction<POLICY.minPeakFraction?'diffuse_spectrum':half>POLICY.maxSubharmonicRatio?'harmonic_ambiguity':secondary>POLICY.maxSecondaryRatio?'competing_periodicity':'';
  return {bpm:reason?null:peak.f*60,candidateBpm:peak.f*60,reason,concentration:fraction,secondary,subharmonic:half,snrDb:10*Math.log10(fraction/Math.max(1e-15,1-fraction)),...(diagnostics?{...spectralAudit,bins,peak,secondaryPeak:competitors.reduce((a,b)=>!a||b.p>a.p?b:a,null),subharmonicPeak:halves.reduce((a,b)=>!a||b.p>a.p?b:a,null),binHz:fs/n,mainLobeBins:POLICY.mainLobeBins}: {})};
}
// The color variance is an observability metric, not evidence of a pulse.
// Only numerical constancy is rejected here; frequency evidence is tested below.
export function analyze(samples,{diagnostics=false}={}){
  const gates=[],trace={gates,raw:diagnostics?samples.map(s=>({t:s.t,rgb:s.rgb??null})):null,resampled:null,normalized:null,waves:null,spectra:null};
  const gate=(name,value,operator,threshold,pass)=>{if(diagnostics)gates.push({name,value,operator,threshold,pass,evaluated:true});return pass;};
  const finish=result=>{
    if(diagnostics){
      const specs={sample_count:['>=',2],sample_reason:['==',null],sample_format:['==',true],duration:['>=',15],max_gap:['<=',.25],monotonic_time:['>',0],fps:['range',[12,65]],face_roi:['==',true],motion_telemetry:['==',true],exposure_min:['>=',30],exposure_max:['<=',235],motion_p95:['<=',POLICY.maxMotionP95],displacement_p95:['<=',.012],light_cv:['<=',POLICY.maxBrightnessCV],chromatic_nonconstant:['>=',POLICY.constantChromaticEpsilon],algorithm_agreement:['<=',6]};
      for(const m of ['POS','CHROM'])Object.assign(specs,{[m+'.sample_count']:['>=','4*fs'],[m+'.waveform_std']:['>=',1e-8],[m+'.band_power']:['>=',1e-12],[m+'.concentration']:['>=',POLICY.minPeakFraction],[m+'.subharmonic']:['<=',POLICY.maxSubharmonicRatio],[m+'.secondary']:['<=',POLICY.maxSecondaryRatio]});
      for(const [name,[operator,threshold]] of Object.entries(specs))if(!gates.some(g=>g.name===name))gates.push({name,value:null,operator,threshold,pass:null,evaluated:false});
      result.diagnostics={...trace,finalReason:result.reason};
    }
    return result;
  };
  const fail=(reason,extra={})=>finish({reliable:false,bpm:null,pos:null,chrom:null,score:0,reason,fs:0,duration:0,...extra});
  if(!gate('sample_count',samples.length,'>=',2,samples.length>=2))return fail('insufficient_samples');
  const invalid=samples.find(s=>s.reason);
  if(!gate('sample_reason',invalid?.reason??null,'==',null,!invalid))return fail(invalid.reason);
  const format=samples.every(s=>Number.isFinite(s.t)&&s.rgb?.length===3&&s.rgb.every(Number.isFinite));
  if(!gate('sample_format',format,'==',true,format))return fail('invalid_samples');
  const duration=samples.at(-1).t-samples[0].t,fs=(samples.length-1)/duration,audit={duration,fs};
  if(!gate('duration',duration,'>=',15,duration>=15))return fail('window_too_short',audit);
  const dt=samples.slice(1).map((s,i)=>s.t-samples[i].t),gap=Math.max(...dt);
  const monotonic=gate('monotonic_time',Math.min(...dt),'>',0,dt.every(v=>v>0));
  if(!gate('max_gap',gap,'<=',.25,gap<=.25)||!monotonic)return fail('sampling_gap',audit);
  if(!gate('fps',fs,'range',[12,65],fs>=12&&fs<=65))return fail('low_fps',audit);
  const validROI=samples.every(s=>s.faceCount===1&&s.roiValid);
  if(!gate('face_roi',validROI,'==',true,validROI))return fail('invalid_face_roi',audit);
  const telemetry=samples.every(s=>Number.isFinite(s.motion)&&Number.isFinite(s.displacement));
  if(!gate('motion_telemetry',telemetry,'==',true,telemetry))return fail('missing_motion_telemetry',audit);
  const light=samples.map(s=>mean(s.rgb)),motion=percentile(samples.map(s=>s.motion),.95),lightCV=std(light)/mean(light);
  const displacement=percentile(samples.map(s=>s.displacement),.95);
  const chroma=samples.map(s=>s.rgb.map(v=>v/s.rgb.reduce((a,b)=>a+b,0))),chromaStd=Math.max(...[0,1,2].map(c=>std(chroma.map(v=>v[c]))));
  Object.assign(audit,{motion,displacement,lightCV,chromaStd});
  const checks=[
    ['exposure_min',Math.min(...light),'>=',30,Math.min(...light)>=30,'exposure'],
    ['exposure_max',Math.max(...light),'<=',235,Math.max(...light)<=235,'exposure'],
    ['motion_p95',motion,'<=',POLICY.maxMotionP95,motion<=POLICY.maxMotionP95,'excessive_motion'],
    ['displacement_p95',displacement,'<=',.012,displacement<=.012,'excessive_motion'],
    ['light_cv',lightCV,'<=',POLICY.maxBrightnessCV,lightCV<=POLICY.maxBrightnessCV,'illumination_variation'],
    ['chromatic_nonconstant',chromaStd,'>=',POLICY.constantChromaticEpsilon,chromaStd>=POLICY.constantChromaticEpsilon,'no_chromatic_pulse_evidence']
  ];
  // Record all available input metrics even if an earlier input gate rejects.
  for(const [name,value,op,threshold,pass] of checks)gate(name,value,op,threshold,pass);
  const rejected=checks.find(c=>!c[4]);if(rejected)return fail(rejected[5],audit);
  const n=samples.length,rgb=[];let j=0;
  for(let i=0;i<n;i++){const t=samples[0].t+i/fs;while(j<samples.length-2&&samples[j+1].t<t)j++;const a=samples[j],b=samples[j+1],q=(t-a.t)/(b.t-a.t);rgb.push(a.rgb.map((v,c)=>v+(b.rgb[c]-v)*q));}
  const windows={POS:[],CHROM:[]};
  const waves=Object.fromEntries(['POS','CHROM'].map(m=>[m,extract(rgb,fs,m,diagnostics?windows[m]:null)]));
  const spectra=Object.fromEntries(['POS','CHROM'].map(m=>[m,spectrum(waves[m],fs,{diagnostics})]));
  const {POS:pos,CHROM:chrom}=spectra;
  if(diagnostics){
    trace.resampled={t:rgb.map((_,i)=>samples[0].t+i/fs),rgb,fs,method:'linear'};
    const mu=[0,1,2].map(c=>mean(rgb.map(v=>v[c])));
    trace.normalized={rgb:rgb.map(v=>v.map((x,c)=>x/mu[c]-1)),note:'global normalization for display; exact extraction local window means/alphas below',windows};
    trace.waves=waves;trace.spectra=spectra;
  }
  for(const [name,s] of Object.entries(spectra)){
    if(diagnostics){
      gate(name+'.sample_count',s.sampleCount,'>=',s.minSamples,s.sampleCount>=s.minSamples);
      gate(name+'.waveform_std',s.waveformStd,'>=',1e-8,s.waveformStd>=1e-8);
      if(s.bandPower!==null)gate(name+'.band_power',s.bandPower,'>=',1e-12,s.bandPower>=1e-12);
    }
    if(s.secondary!==undefined){
      gate(name+'.concentration',s.concentration,'>=',POLICY.minPeakFraction,s.concentration>=POLICY.minPeakFraction);
      gate(name+'.subharmonic',s.subharmonic,'<=',POLICY.maxSubharmonicRatio,s.subharmonic<=POLICY.maxSubharmonicRatio);
      gate(name+'.secondary',s.secondary,'<=',POLICY.maxSecondaryRatio,s.secondary<=POLICY.maxSecondaryRatio);
    }
  }
  Object.assign(audit,{pos_reason:pos.reason||'accepted_spectrum',chrom_reason:chrom.reason||'accepted_spectrum'});
  if(pos.reason||chrom.reason)return fail(pos.reason||chrom.reason,audit);
  const difference=Math.abs(pos.bpm-chrom.bpm);
  if(!gate('algorithm_agreement',difference,'<=',6,difference<=6))return fail('algorithm_disagreement',audit);
  return finish({reliable:true,bpm:Math.round(pos.bpm*10)/10,pos:pos.bpm,chrom:chrom.bpm,score:Math.round(100*Math.min(pos.concentration,chrom.concentration)),reason:'accepted_experimental',...audit});
}
