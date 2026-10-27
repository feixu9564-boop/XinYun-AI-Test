// Explicit opt-in, memory only. Never retains pixels, landmarks, images or video.
export const DIAGNOSTIC_LIMIT=4096;
export class DiagnosticCapture {
  constructor(meta,limit=DIAGNOSTIC_LIMIT){this.meta=meta;this.limit=limit;this.samples=[];this.events=[];this.analyses=[];this.segment=0;this.truncated=false;}
  event(type,t,detail={}){
    if(type==='clear'||type==='started')this.segment++;
    this.events.push({type,t,segment:this.segment,...detail});
    if(this.events.length>256){this.events.shift();this.truncated=true;}
  }
  add(sample,reason,phase){
    const previous=this.samples.at(-1),rgb=sample.rgb?.slice()??null;
    const brightness=rgb?rgb.reduce((a,b)=>a+b,0)/3:null;
    const prior=previous?.segment===this.segment?previous:null;
    // Whitelist fields: never accidentally serialize sample.previous.grid.
    this.samples.push({t:sample.t,segment:this.segment,phase,reason:reason||'',rgb,
      regions:sample.regions??null,skinRatio:sample.skinRatio??null,validPixels:sample.validPixels??null,
      roiPosition:sample.roiPosition??null,motion:sample.motion??null,displacement:sample.displacement??null,
      brightness,brightnessChange:brightness!==null&&prior?.brightness!=null?brightness-prior.brightness:null,
      faceCount:sample.faceCount??null,roiValid:sample.roiValid??false});
    if(this.samples.length>this.limit){this.samples.shift();this.truncated=true;}
  }
  analysis(selected,result,partial,stopReason){
    this.analyses.push({segment:this.segment,start:selected[0]?.t??null,end:selected.at(-1)?.t??null,sampleCount:selected.length,partial,stopReason,result});
    if(this.analyses.length>8){this.analyses.shift();this.truncated=true;}
  }
  report(){return {schema:'xinyun-diagnostics-v1',privacy:'LOCAL_OPT_IN_NO_IMAGES_NO_UPLOAD',timeUnit:'seconds',...this.meta,truncated:this.truncated,limit:this.limit,samples:this.samples,events:this.events,analyses:this.analyses};}
}
