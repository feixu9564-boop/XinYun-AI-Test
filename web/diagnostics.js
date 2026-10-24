import {analyze,VERSION,POLICY} from './signal.js?v=0.6.2';
export const REGION_NAMES=['forehead','left_cheek','right_cheek'];
// Only scalar/color traces, never landmarks, pixel grids, images or video.
export class DiagnosticCapture {
  constructor(meta){this.meta=meta;this.samples=[];this.events=[];this.segment=0;this.truncated=false;}
  event(type,data={}){this.events.push({type,...data});if(type==='measurement_start')this.segment++;}
  add(sample,reason=''){
    if(this.samples.length>=9000){this.truncated=true;return;}
    const {t,rgb,regions,motion,displacement,faceCount,roiValid}=sample;
    const previous=this.samples.at(-1);
    this.samples.push({t,dt:previous?t-previous.t:null,segment:this.segment,rgb:rgb||null,exposure:rgb?rgb.reduce((a,b)=>a+b,0)/3:null,regions:regions||{},motion,displacement,faceCount,roiValid,reason});
  }
  finish(final){this.final=final;}
  report(){
    const finalSegment=this.samples.filter(s=>s.segment===this.segment);
    const end=finalSegment.at(-1)?.t,start=finalSegment[0]?.t;
    const windows=[];
    if(Number.isFinite(end)){
      // Shadow comparisons never replace the user-facing final-16s decision.
      for(const [name,a,b] of [['final16',end-16,end],['first16',start,start+16],['middle16',start+14.5,start+30.5],['full_contiguous',start,end]]){
        const selected=finalSegment.filter(s=>s.t>=a&&s.t<=b);
        if(!selected.length)continue;
        const strategies={pooled:selected};
        if(selected.every(s=>REGION_NAMES.every(k=>s.regions[k]?.rgb))){
          for(const region of REGION_NAMES)strategies[region]=selected.map(s=>({...s,rgb:s.regions[region].rgb,motion:s.regions[region].motion}));
          strategies.equal_regions=selected.map(s=>({...s,rgb:[0,1,2].map(c=>REGION_NAMES.reduce((a,k)=>a+s.regions[k].rgb[c],0)/3)}));
          // Fixed geometry/coverage/motion weights, not selected by a desired HR.
          strategies.quality_weighted=selected.map(s=>{const weights=REGION_NAMES.map(k=>{const r=s.regions[k];return r.valid_fraction/(1+r.motion);}),sum=weights.reduce((a,b)=>a+b,0);return {...s,rgb:[0,1,2].map(c=>REGION_NAMES.reduce((a,k,i)=>a+weights[i]*s.regions[k].rgb[c],0)/sum)};});
        }
        for(const [strategy,samples] of Object.entries(strategies)){
          try{windows.push({window:name,strategy,start:samples[0].t,end:samples.at(-1).t,result:analyze(samples,{diagnostics:true})});}
          catch(e){windows.push({window:name,strategy,error:{name:e.name,message:String(e.message).slice(0,160)}});}
        }
      }
    }
    return {schema:'xinyun-diagnostics-v1',privacy:'LOCAL_OPT_IN_NO_IMAGES',region_definitions:{forehead:[109,10,338,337,151,108],left_cheek:[50,101,205,187],right_cheek:[280,330,425,411],coordinate_note:'Labels refer to landmark groups on the unmirrored source image, not anatomical side inferred from preview'},human_accuracy:'NOT_VALIDATED',...this.meta,algorithm_version:VERSION,policy:{...POLICY,calibration:'NOT_CALIBRATED_ON_REAL_VALIDATION'},selection_policy:'final16_pooled_only; all alternative windows/ROI strategies are shadow diagnostics, never cherry-picked',truncated:this.truncated,samples:this.samples,events:this.events,final:this.final,comparisons:windows};
  }
}
