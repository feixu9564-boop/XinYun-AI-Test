// Acquisition policy, independent of the unchanged POS/CHROM quality policy.
export const MEASUREMENT_POLICY=Object.freeze({duration:45,stable:1.5,minFPS:12,maxGap:.25,invalidTimeout:8,sessionLimit:120});
export class Measurement {
  constructor(policy=MEASUREMENT_POLICY){this.policy=policy;this.phase='aligning';this.reason='insufficient_samples';this.times=[];this.last=null;this.stableAt=null;this.startedAt=null;this.alignedAt=null;this.effective=0;this.resets=0;this.invalidSince=null;this.count=0;this.fps=0;}
  invalidate(reason,t){
    const reset=this.phase==='measuring'||this.phase==='ready';
    if(reset)this.resets++;
    this.phase='aligning';this.reason=reason;this.times=[];this.stableAt=null;this.startedAt=null;this.effective=0;this.count=0;
    if(reset&&this.invalidSince===null)this.invalidSince=t;
    return reset;
  }
  observe(t,reason=''){
    if(this.phase==='complete')return {complete:true};
    let reset=false;
    if(!Number.isFinite(t)||this.last!==null&&t<=this.last)return {ignored:true};
    if(this.last!==null&&t-this.last>this.policy.maxGap)reset=this.invalidate('sampling_gap',t);
    this.last=t;
    if(reason)return {reset:this.invalidate(reason,t)||reset};
    this.times.push(t);while(this.times.length>1&&t-this.times[0]>2)this.times.shift();
    const span=t-this.times[0];this.fps=span>0?(this.times.length-1)/span:0;
    if(span>=1&&this.fps<this.policy.minFPS)return {reset:this.invalidate('low_fps',t)||reset};
    if(this.stableAt===null)this.stableAt=t;
    if(this.phase==='aligning'){
      this.reason='aligning';
      if(t-this.stableAt>=this.policy.stable&&this.fps>=this.policy.minFPS){this.phase='ready';this.reason='aligned';this.alignedAt=t;this.invalidSince=null;return {aligned:true,reset};}
      return {reset};
    }
    if(this.phase==='ready'){this.phase='measuring';this.startedAt=t;this.count=1;this.reason='measuring';return {started:true,reset};}
    this.count++;this.effective=t-this.startedAt;
    if(this.effective>=this.policy.duration){this.phase='complete';this.reason='measurement_complete';return {complete:true,reset};}
    return {reset};
  }
  poll(t){
    if(this.phase!=='complete'&&this.last!==null&&t-this.last>this.policy.maxGap)return {reset:this.invalidate('sampling_gap',t)};
    return {};
  }
  snapshot(){return {measurement_phase:this.phase,effective_seconds:this.effective,countdown_seconds:Math.max(0,Math.ceil(this.policy.duration-this.effective)),valid_sample_count:this.count,alignment_resets:this.resets,measurement_fps:this.fps};}
}
