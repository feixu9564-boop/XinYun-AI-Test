// Acquisition policy only. Signal quality thresholds are unchanged.
export const MEASUREMENT_POLICY=Object.freeze({duration:45,stable:1.5,minFPS:12,maxGap:.25,invalidTimeout:8,sessionLimit:120,pauseNotice:2});
export class Measurement {
  constructor(policy=MEASUREMENT_POLICY){this.policy=policy;this.phase='aligning';this.reason='insufficient_samples';this.times=[];this.last=null;this.stableAt=null;this.startedAt=null;this.alignedAt=null;this.effective=0;this.resets=0;this.invalidSince=null;this.count=0;this.fps=0;this.interruption=null;}
  invalidate(reason,t){
    if(this.phase==='complete')return {};
    const interrupted=this.phase==='measuring'||this.phase==='ready';
    const before=this.snapshot();
    this.times=[];this.stableAt=null;this.startedAt=null;this.effective=0;this.count=0;this.fps=0;
    if(interrupted){
      this.interruption={reason,at:t,countdown:before.countdown_seconds,effective:before.effective_seconds,fps:before.measurement_fps,valid_samples:before.valid_sample_count};
      this.invalidSince=t;this.phase='paused';this.reason=reason;
      return {paused:true,clear:true,interruption:{...this.interruption}};
    }
    // Preserve the first cause throughout the pause; ordinary frames must not
    // replace it with a generic alignment message before the user can read it.
    if(this.phase!=='paused'){this.phase='aligning';this.reason=reason;}
    return {};
  }
  observe(t,reason=''){
    if(this.phase==='complete')return {ignored:true};
    if(!Number.isFinite(t)||this.last!==null&&t<=this.last)return {ignored:true};
    const gap=this.last!==null&&t-this.last>this.policy.maxGap;this.last=t;
    if(reason||gap)return this.invalidate(reason||'sampling_gap',t);
    this.times.push(t);while(this.times.length>1&&t-this.times[0]>2)this.times.shift();
    const span=t-this.times[0];this.fps=span>0?(this.times.length-1)/span:0;
    if(span>=1&&this.fps<this.policy.minFPS)return this.invalidate('low_fps',t);
    if(this.stableAt===null)this.stableAt=t;
    if(this.phase==='aligning'||this.phase==='paused'){
      const paused=this.phase==='paused';
      if(!paused)this.reason='aligning';
      if(t-this.stableAt>=this.policy.stable&&this.fps>=this.policy.minFPS&&(!paused||t-this.interruption.at>=this.policy.pauseNotice)){
        this.phase='ready';this.reason=paused?'realigned':'aligned';this.alignedAt=t;this.invalidSince=null;
        if(paused)this.resets++;
        return {aligned:true,reset:paused,interruption:paused?{...this.interruption}:null};
      }
      return {};
    }
    if(this.phase==='ready'){this.phase='measuring';this.startedAt=t;this.count=1;this.reason='measuring';return {started:true};}
    this.count++;this.effective=t-this.startedAt;
    if(this.effective>=this.policy.duration){this.phase='complete';this.reason='measurement_complete';return {complete:true};}
    return {};
  }
  poll(t){
    if(this.phase!=='complete'&&this.last!==null&&t-this.last>this.policy.maxGap)return this.invalidate('sampling_gap',t);
    return {};
  }
  snapshot(){return {measurement_phase:this.phase,effective_seconds:this.effective,countdown_seconds:this.phase==='paused'?this.interruption.countdown:Math.max(0,Math.ceil(this.policy.duration-this.effective)),valid_sample_count:this.count,alignment_resets:this.resets,measurement_fps:this.fps,interruption_reason:this.interruption?.reason||'',previous_effective_seconds:this.interruption?.effective??0,countdown_before_reset:this.interruption?.countdown??null};}
}
