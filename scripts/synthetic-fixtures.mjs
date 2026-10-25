// Test assumptions, not measured device data. t is seconds; 256 averaged uint8 pixels.
export function rng(seed=12026){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=Math.imul(a^a>>>15,1|a);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
export function fixture(bpm=75,condition='normal',duration=16,seed=12026){
  const random=rng(seed),gauss=()=>Math.sqrt(-2*Math.log(Math.max(1e-12,random())))*Math.cos(2*Math.PI*random());
  const dc=[170,120,100],samples=[];let colored=[0,0,0];
  for(let i=0;i<=duration*20;i++){
    const t=i/20+(condition==='jitter'&&i>0&&i<duration*20?(random()-.5)*.016:0),p=Math.sin(2*Math.PI*bpm/60*t);
    const amp=condition==='weak'?.001:.003,hasPulse=!['flat','white_noise','colored_noise','motion_only','periodic_light','out_of_band'].includes(condition);
    const common=condition==='drift'?.025*Math.sin(2*Math.PI*.12*t):condition==='periodic_light'?.005*p:0;
    const rgb=dc.map((d,c)=>{
      colored[c]=.96*colored[c]+.04*gauss();
      if(condition==='flat')return d;
      const pulse=hasPulse?amp*[.267,1,.4][c]*p:condition==='motion_only'? .003*[.267,1,.4][c]*p:condition==='out_of_band'?.003*[.267,1,.4][c]*Math.sin(2*Math.PI*.35*t):0;
      const value=d*(1+pulse+common)+(condition==='colored_noise'?1.8*colored[c]:0);
      // Independent pixel/read noise followed by 8-bit quantization, then ROI average.
      let sum=0;for(let k=0;k<256;k++)sum+=Math.round(value+gauss()*(condition==='noise'||condition==='white_noise'?3:.5));
      return sum/256;
    });
    samples.push({t,rgb,faceCount:1,roiValid:true,motion:condition==='motion'||condition==='motion_only'?4:.15,displacement:condition==='motion'||condition==='motion_only'?.016:.0002});
  }
  return samples;
}
export const conditions=['normal','weak','noise','drift','jitter','motion'];
