export const STORAGE_KEY='xinyun-mobile-v1';
export const FIELDS=['schema_version','record_type','session_id','subject_id','recorded_at','window_start','window_end','sample_start','sample_end','status','reason','bpm','pos_bpm','chrom_bpm','quality','fps','sample_count','reference_id','reference_bpm','reference_observed_at','reference_recorded_at','reference_match','algorithm_version','user_agent','camera_width','camera_height','camera_facing','capture_version','stop_reason','scheduler_source','video_callbacks','frames_submitted','model_completions','model_results','face_frames','pending_inference_ms','last_video_time','video_ready_state','video_paused','document_visibility','preview_visible','last_sample_reason','app_version','commit_sha','aligned_at','measurement_started_at','stopped_at','measurement_phase','effective_seconds','countdown_seconds','valid_sample_count','alignment_resets','measurement_fps','roi_samples','decoded_frames','presented_frames','media_time','inference_ms','inference_errors','invalid_frames','roi_status','interruption_reason','paused_at','reset_at','countdown_before_reset','previous_effective_seconds','previous_valid_samples','final_reason','pos_reason','chrom_reason','cleanup_errors'];
export function validateSubject(value){return /^[A-Za-z0-9_-]{1,32}$/.test(value);}
export function makeReference({bpm,observed,now,sessionId,subjectId,id}){
  if(!Number.isFinite(bpm)||bpm<30||bpm>240)throw new Error('参考值须为 30–240 BPM');
  if(!Number.isFinite(observed)||observed>now+1000||observed<now-86400000)throw new Error('请填写过去 24 小时内的实际观察时间，不能是未来时间');
  return {schema_version:1,record_type:'reference',session_id:sessionId,subject_id:subjectId,
    recorded_at:new Date(now).toISOString(),reference_id:id,reference_bpm:bpm,
    reference_observed_at:new Date(observed).toISOString(),reference_recorded_at:new Date(now).toISOString(),status:'reference_only',reason:''};
}
// Match only same session/subject, actual sampled interval and within 2 s of
// its midpoint. A manual instant reading is not a continuous reference mean.
export function matchedRows(rows){
  const refs=rows.filter(r=>r.record_type==='reference');
  return rows.map(r=>{
    if(r.record_type!=='window')return {...r};
    const start=Date.parse(r.sample_start),end=Date.parse(r.sample_end),mid=(start+end)/2;
    const candidates=refs.filter(x=>x.session_id===r.session_id&&x.subject_id===r.subject_id&&
      Date.parse(x.reference_observed_at)>=start&&Date.parse(x.reference_observed_at)<=end&&Math.abs(Date.parse(x.reference_observed_at)-mid)<=2000)
      .sort((a,b)=>Math.abs(Date.parse(a.reference_observed_at)-mid)-Math.abs(Date.parse(b.reference_observed_at)-mid));
    const ref=candidates[0];
    return {...r,reference_match:ref?'matched_instant_within_2s':'unmatched',...(ref?{reference_id:ref.reference_id,reference_bpm:ref.reference_bpm,reference_observed_at:ref.reference_observed_at,reference_recorded_at:ref.reference_recorded_at}:{})};
  });
}
export function toCSV(rows){
  const cell=v=>{let s=v==null?'':String(v);if(/^[=+@-]/.test(s)&&!Number.isFinite(Number(s)))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+[FIELDS.join(','),...matchedRows(rows).map(r=>FIELDS.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
}
export class LocalRecords {
  constructor(storage){this.storage=storage;this.rows=[];this.error='';try{const raw=storage.getItem(STORAGE_KEY);if(raw){const parsed=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.some(r=>r.schema_version!==1))throw Error('记录格式损坏');this.rows=parsed;}}catch(e){this.error='无法读取本地记录：'+e.message;this.readFailed=true;}}
  add(row){this.rows.push(row);this.save();}
  save(){try{if(this.readFailed)throw Error('旧记录读取失败，先导出并清空后再测量');this.storage.setItem(STORAGE_KEY,JSON.stringify(this.rows));this.error='';}catch(e){this.error='本地保存失败，请立即导出，关闭页面会丢失未保存记录：'+e.message;}}
  clear(){this.storage.removeItem(STORAGE_KEY);this.rows=[];this.error='';this.readFailed=false;}
}
