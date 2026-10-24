import {butterBandpass,filtfilt} from './dsp.js?v=0.6.2';
// Research implementation: temporally normalized, sliding-window POS/CHROM.
export const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
const std = a => {const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)));};
export function extract(rgb, fs, method='POS', audit=null) {
  if(!['POS','CHROM'].includes(method))throw Error('unknown_method');
  const n=rgb.length,out=Array(n).fill(0),weights=Array(n).fill(0);
  let w=Math.min(n,Math.ceil(1.6*fs));if(method==='CHROM'&&w%2&&w<n)w++;
  const step=method==='POS'?1:Math.max(1,Math.floor(w/2)),starts=[];
  for(let start=0;start+w<=n;start+=step)starts.push(start);
  if(starts.at(-1)!==n-w)starts.push(n-w);
  const filter=butterBandpass(fs),alphas=[];
  for(const start of starts){
    const block=rgb.slice(start,start+w),mu=[0,1,2].map(c=>mean(block.map(v=>v[c])));
    if(mu.some(v=>!Number.isFinite(v)||v<=0))throw Error('invalid_rgb_mean');
    const norm=block.map(v=>v.map((x,c)=>x/mu[c]-1));
    let x=norm.map(([r,g,b])=>method==='POS'?g-b:3*r-2*g);
    let y=norm.map(([r,g,b])=>method==='POS'?g+b-2*r:1.5*r+g-1.5*b);
    // CHROM alpha is defined on band-passed chrominance, not broadband drift.
    if(method==='CHROM'){x=filtfilt(x,filter);y=filtfilt(y,filter);}
    const alpha=std(x)/Math.max(std(y),1e-10);alphas.push({start,alpha});
    const h=x.map((v,i)=>v+(method==='POS'?1:-1)*alpha*y[i]),m=mean(h);
    for(let j=0;j<w;j++){const win=method==='POS'?1:.5-.5*Math.cos(2*Math.PI*j/(w-1));out[start+j]+=(h[j]-m)*win;weights[start+j]+=win;}
  }
  // POS uses sample-by-sample overlap-add. CHROM normalizes Hann coverage;
  // the final anchored window avoids the old uncovered trailing samples.
  const wave=method==='POS'?filtfilt(out,filter):out.map((v,i)=>weights[i]>1e-8?v/weights[i]:0);
  if(audit)Object.assign(audit,{method,window_samples:w,hop_samples:step,filter:{type:'Butterworth',order:3,band_hz:[.7,3],phase:'forward_backward_odd_padding',...filter},alphas,waveform:wave});
  return wave;
}
// Port of benchmark/quality.py experimental-v1; NOT calibrated on humans.
export const VERSION='mobile-pos-chrom-v2/experimental-v1';
export const POLICY={minPeakFraction:.60,maxSecondaryRatio:.04,maxSubharmonicRatio:.04,maxMotionP95:3,maxBrightnessCV:.08,minChromaticStd:.0005};
export const percentile=(a,q)=>{const b=[...a].sort((x,y)=>x-y),i=(b.length-1)*q,j=Math.floor(i);return b[j]+(b[Math.ceil(i)]-b[j])*(i-j);};
export function spectrum(signal,fs){
  const n=signal.length,m=mean(signal),center=(n-1)/2;
  const slope=signal.reduce((s,v,i)=>s+(i-center)*(v-m),0)/Math.max(1,signal.reduce((s,_,i)=>s+(i-center)**2,0));
  const detrended=signal.map((v,i)=>v-m-slope*(i-center));
  const reject=reason=>({bpm:null,reason,concentration:0});
  if(n<fs*4||signal.some(v=>!Number.isFinite(v)))return reject('invalid_or_short_waveform');
  if(std(detrended)<1e-8)return reject('constant_waveform');
  const x=detrended.map((v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))),bins=[];
  for(let k=Math.ceil(.7*n/fs);k<=Math.floor(3*n/fs);k++){
    let re=0,im=0;for(let j=0;j<n;j++){const a=2*Math.PI*k*j/n;re+=x[j]*Math.cos(a);im-=x[j]*Math.sin(a);}
    bins.push({k,f:k*fs/n,p:re*re+im*im});
  }
  if(!bins.length)return reject('no_in_band_signal');
  const peak=bins.reduce((a,b)=>a.p>b.p?a:b),total=bins.reduce((s,b)=>s+b.p,0);
  if(total<1e-12)return reject('no_in_band_signal');
  const fraction=bins.filter(b=>Math.abs(b.k-peak.k)<=1).reduce((s,b)=>s+b.p,0)/total;
  const secondary=Math.max(0,...bins.filter(b=>Math.abs(b.k-peak.k)>1).map(b=>b.p))/peak.p;
  const half=Math.max(0,...bins.filter(b=>Math.abs(b.f-peak.f/2)<=fs/n).map(b=>b.p))/peak.p;
  const reason=fraction<POLICY.minPeakFraction?'diffuse_spectrum':half>POLICY.maxSubharmonicRatio?'harmonic_ambiguity':secondary>POLICY.maxSecondaryRatio?'competing_periodicity':'';
  return {bpm:reason?null:peak.f*60,candidate_bpm:peak.f*60,reason,concentration:fraction,secondary,subharmonic:half,bin_hz:fs/n,peak,secondary_peak:bins.filter(b=>Math.abs(b.k-peak.k)>1).sort((a,b)=>b.p-a.p)[0]||null,bins,rejections:[fraction<POLICY.minPeakFraction?'diffuse_spectrum':'',half>POLICY.maxSubharmonicRatio?'harmonic_ambiguity':'',secondary>POLICY.maxSecondaryRatio?'competing_periodicity':''].filter(Boolean)};
}
export function analyze(samples,{diagnostics=false}={}){
  const fail=(reason,extra={})=>({reliable:false,bpm:null,pos:null,chrom:null,score:0,reason,fs:0,duration:0,pos_reason:'not_evaluated',chrom_reason:'not_evaluated',...extra});
  if(samples.length<2)return fail('insufficient_samples');
  const invalid=samples.find(s=>s.reason);if(invalid)return fail(invalid.reason);
  if(samples.some(s=>!Number.isFinite(s.t)||s.rgb?.length!==3||s.rgb.some(v=>!Number.isFinite(v))))return fail('invalid_samples');
  const duration=samples.at(-1).t-samples[0].t,fs=(samples.length-1)/duration,audit={duration,fs};
  if(duration<15)return fail('window_too_short',audit);
  const dt=samples.slice(1).map((s,i)=>s.t-samples[i].t);
  if(dt.some(v=>v<=0)||Math.max(...dt)>.25)return fail('sampling_gap',audit);
  if(fs<12||fs>65)return fail('low_fps',audit);
  if(samples.some(s=>s.faceCount!==1||!s.roiValid))return fail('invalid_face_roi',audit);
  if(samples.some(s=>!Number.isFinite(s.motion)||!Number.isFinite(s.displacement)))return fail('missing_motion_telemetry',audit);
  const light=samples.map(s=>mean(s.rgb)),motion=percentile(samples.map(s=>s.motion),.95),lightCV=std(light)/mean(light);
  const chroma=samples.map(s=>s.rgb.map(v=>v/s.rgb.reduce((a,b)=>a+b,0))),chromaStd=Math.max(...[0,1,2].map(c=>std(chroma.map(v=>v[c]))));
  Object.assign(audit,{motion,lightCV,chromaStd});
  if(Math.min(...light)<30||Math.max(...light)>235)return fail('exposure',audit);
  if(motion>POLICY.maxMotionP95||percentile(samples.map(s=>s.displacement),.95)>.012)return fail('excessive_motion',audit);
  if(lightCV>POLICY.maxBrightnessCV)return fail('illumination_variation',audit);
  if(chromaStd<POLICY.minChromaticStd)return fail('no_chromatic_pulse_evidence',audit);
  const n=samples.length,rgb=[];let j=0;
  for(let i=0;i<n;i++){const t=samples[0].t+i/fs;while(j<samples.length-2&&samples[j+1].t<t)j++;const a=samples[j],b=samples[j+1],q=(t-a.t)/(b.t-a.t);rgb.push(a.rgb.map((v,c)=>v+(b.rgb[c]-v)*q));}
  const posTrace={},chromTrace={};
  const pos=spectrum(extract(rgb,fs,'POS',diagnostics?posTrace:null),fs),chrom=spectrum(extract(rgb,fs,'CHROM',diagnostics?chromTrace:null),fs);
  Object.assign(audit,{spectra:{POS:pos,CHROM:chrom},resampling:{method:'linear',input_count:samples.length,output_count:n,fs,start:samples[0].t,end:samples.at(-1).t,max_gap:Math.max(...dt),min_gap:Math.min(...dt)}});
  if(diagnostics)audit.trace={uniform_rgb:rgb,POS:posTrace,CHROM:chromTrace};
  Object.assign(audit,{pos_reason:pos.reason||'accepted_spectrum',chrom_reason:chrom.reason||'accepted_spectrum'});
  if(pos.reason||chrom.reason)return fail(pos.reason||chrom.reason,audit);
  if(Math.abs(pos.bpm-chrom.bpm)>6)return fail('algorithm_disagreement',audit);
  return {reliable:true,bpm:Math.round(pos.bpm*10)/10,pos:pos.bpm,chrom:chrom.bpm,score:Math.round(100*Math.min(pos.concentration,chrom.concentration)),reason:'accepted_experimental',...audit};
}
