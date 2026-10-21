// Research implementation: temporally normalized, sliding-window POS/CHROM.
export const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
const std = a => {const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)));};
export function extract(rgb, fs, method='POS') {
  const n=rgb.length, out=Array(n).fill(0), weight=Array(n).fill(0);
  const w=Math.min(n,Math.round(1.6*fs));
  for(let start=0;start+w<=n;start+=Math.max(1,Math.round(fs/5))){
    const block=rgb.slice(start,start+w), mu=[0,1,2].map(c=>mean(block.map(v=>v[c])));
    if(mu.some(v=>v<1)) continue;
    const norm=block.map(v=>v.map((x,c)=>x/mu[c]-1));
    const x=norm.map(([r,g,b])=>method==='POS'?g-b:3*r-2*g);
    const y=norm.map(([r,g,b])=>method==='POS'?g+b-2*r:1.5*r+g-1.5*b);
    const alpha=std(x)/Math.max(std(y),1e-10);
    const h=x.map((v,i)=>v+(method==='POS'?1:-1)*alpha*y[i]), m=mean(h);
    for(let j=0;j<w;j++){const win=0.5-0.5*Math.cos(2*Math.PI*j/(w-1));out[start+j]+=(h[j]-m)*win;weight[start+j]+=win;}
  }
  return out.map((v,i)=>weight[i]>1e-8?v/weight[i]:0);
}
export function spectrum(signal,fs){
  const n=signal.length,m=mean(signal), center=(n-1)/2;
  const slope=signal.reduce((s,v,i)=>s+(i-center)*(v-m),0)/Math.max(1,signal.reduce((s,_,i)=>s+(i-center)**2,0));
  const x=signal.map((v,i)=>(v-m-slope*(i-center))*(0.5-0.5*Math.cos(2*Math.PI*i/(n-1))));
  const bins=[];
  for(let k=Math.ceil(0.7*n/fs);k<=Math.floor(3*n/fs);k++){
    let re=0,im=0;for(let j=0;j<n;j++){const a=2*Math.PI*k*j/n;re+=x[j]*Math.cos(a);im-=x[j]*Math.sin(a);}
    bins.push({f:k*fs/n,p:re*re+im*im});
  }
  if(!bins.length)return {bpm:null, concentration:0};
  const peak=bins.reduce((a,b)=>a.p>b.p?a:b),total=bins.reduce((s,b)=>s+b.p,0);
  return {bpm:total>1e-12?peak.f*60:null,concentration:total>1e-12?bins.filter(b=>Math.abs(b.f-peak.f)<=0.12).reduce((s,b)=>s+b.p,0)/total:0};
}
// Samples: {t seconds, rgb [0..255], motion normalized face displacement}.
export function analyze(samples){
  const fail=(reason,extra={})=>({reliable:false,bpm:null,score:0,reason,wave:[],...extra});
  if(samples.length<2)return fail('等待有效人脸信号');
  if(samples.some(s=>!Number.isFinite(s.t)||s.rgb?.length!==3||s.rgb.some(v=>!Number.isFinite(v))))return fail('采样数据无效');
  const duration=samples.at(-1).t-samples[0].t;
  if(duration<15)return fail(`积累信号中：${Math.max(0,duration).toFixed(0)} / 15 秒`);
  const dt=samples.slice(1).map((s,i)=>s.t-samples[i].t);
  if(dt.some(v=>v<=0)||Math.max(...dt)>0.25)return fail('采样中断，请保持人脸可见');
  const fs=(samples.length-1)/duration;
  if(fs<12)return fail('有效帧率不足（需要至少 12 帧/秒）');
  const light=mean(samples.map(s=>mean(s.rgb)));
  if(light<30||light>235)return fail('光线过暗或过曝');
  const motion=mean(samples.map(s=>s.motion||0));
  if(motion>0.012)return fail('运动过大，请保持静止');
  // Linear resampling using actual frame timestamps.
  const n=Math.floor(duration*fs)+1,rgb=[];let j=0;
  for(let i=0;i<n;i++){const t=samples[0].t+i/fs;while(j<samples.length-2&&samples[j+1].t<t)j++;const a=samples[j],b=samples[j+1],q=(t-a.t)/(b.t-a.t);rgb.push(a.rgb.map((v,c)=>v+(b.rgb[c]-v)*q));}
  const wave=extract(rgb,fs),pos=spectrum(wave,fs),chrom=spectrum(extract(rgb,fs,'CHROM'),fs);
  const agree=pos.bpm!==null&&chrom.bpm!==null&&Math.abs(pos.bpm-chrom.bpm)<=6;
  const concentration=Math.min(pos.concentration,chrom.concentration);
  const score=Math.round(100*concentration*(agree?1:0.4)*Math.max(0,1-motion/0.024));
  const reliable=agree&&concentration>=0.5&&score>=50&&std(wave)>1e-6;
  return {reliable,bpm:reliable?Math.round(pos.bpm):null,score,reason:reliable?'信号符合研究阈值；尚未经参考设备验证':'无法可靠测量：频谱不集中或算法不一致',wave,fs,duration,pos:pos.bpm,chrom:chrom.bpm};
}
