import {DiagnosticCapture} from './diagnostics.js?v=0.6.2';
import {analyze,VERSION} from './signal.js?v=0.6.2';
import {LocalRecords,validateSubject,makeReference,toCSV,matchedRows} from './records.js?v=0.6.2';
import {sampleROI} from './roi.js?v=0.6.2';
import {FramePump,CAPTURE_VERSION} from './frame-pump.js?v=0.6.2';
import {Measurement} from './measurement.js?v=0.6.2';
import {BUILD} from './build-info.js?v=0.6.2';
const $=id=>document.getElementById(id),video=$('video'),overlay=$('overlay');
const capture=document.createElement('canvas');
let storage;try{storage=window.localStorage;}catch{storage={getItem(){throw Error('浏览器禁止本地存储');},setItem(){throw Error('浏览器禁止本地存储');},removeItem(){}};}
const records=new LocalRecords(storage);
const labels={realigned:'已重新对准：上一段已作废，从 45 秒重新采样',analysis_error:'信号分析发生异常，本次未能生成可信结果；请导出日志',invalid_result:'算法返回了无效结果，已禁止显示心率',aligning:'请保持单人正脸稳定至少 1.5 秒',aligned:'已对准，准备测量',measuring:'正在测量，请保持静止',measurement_complete:'45 秒有效采样完成',alignment_timeout:'8 秒内未恢复有效采样，请重新对准后重测',session_timeout:'对准等待超过 120 秒，请检查帧率和光线后重测',video_frame_stalled:'视频帧停止更新，请使用 Safari 并保持预览可见后重试',model_timeout:'人脸模型处理超时，请停止后重试；仍失败请导出诊断日志',model_result_timeout:'模型未返回检测结果，请导出诊断日志',no_face:'未检测到人脸',multiple_faces:'请保持单人画面',face_out_of_frame:'请将完整面部移入画面',face_distance:'请调整距离，让面部居中',face_pose:'请正对镜头，不要侧头',invalid_landmarks:'人脸定位异常',insufficient_roi_pixels:'有效皮肤区域不足，请调整光照或移除遮挡',unstable_roi:'面部区域不稳定',invalid_face_roi:'人脸区域不可用',exposure:'光线过暗或过曝',excessive_motion:'运动过大，请固定手机并保持静止',illumination_variation:'光照变化过大',no_chromatic_pulse_evidence:'未发现足够的颜色脉搏信号',diffuse_spectrum:'信号频谱分散',harmonic_ambiguity:'存在谐波歧义，无法可靠测量',competing_periodicity:'存在多个竞争周期，无法可靠测量',algorithm_disagreement:'POS 与 CHROM 结果不一致',low_fps:'有效帧率不足，需至少 12 FPS',sampling_gap:'摄像头采样中断',window_too_short:'连续采样不足 15 秒',insufficient_samples:'等待有效采样',constant_waveform:'未检测到变化信号',no_in_band_signal:'没有有效心率频带信号',accepted_experimental:'通过实验性质量门；准确性尚未真人验证',user_stop:'已停止，摄像头已关闭',restart:'正在重新测量',page_hidden:'页面进入后台，摄像头已关闭；返回后请重新开始',page_exit:'页面离开，摄像头已关闭',camera_ended:'摄像头断开，请重新开始',camera_muted:'摄像头被系统暂停，请重新开始',frame_timeout:'视频或人脸模型长时间无响应',time_limit:'已达到 120 秒，摄像头已关闭',model_error:'人脸模型运行失败，请重试或更换浏览器',camera_permission_denied:'摄像头权限被拒绝，请在 Safari 网站设置中允许摄像头后重试',camera_not_found:'没有可用摄像头',camera_busy:'摄像头不可用或被其他程序占用',insecure_context:'需要 HTTPS 或本机 localhost',model_missing:'本地人脸模型文件缺失',startup_timeout:'启动超时，请检查权限与模型加载后重试',unsupported_camera:'浏览器不支持摄像头，请使用 Safari 或 Chrome',wrong_camera:'浏览器选中了后置摄像头，已停止；请检查前置摄像头是否可用',storage_limit:'本地记录已达到上限，请先导出并清空',clock_changed:'系统时钟发生变化，本次测量已停止'};
let running=false,starting=false,token=0,stream=null,mesh=null,pump=null,timer=0,startTimer=0;
let measurement=null,lastTelemetry=-1,roiSamples=0,lastOutcome=null,diagnosticCapture=null,diagnosticReport=null;
let session=null,lastSession=null,samples=[],previous=null,pendingTime=0,lastFrame=0,resultCount=0,faceFrames=0,lastSampleReason='';
const iso=t=>new Date(t).toISOString();
function nowSession(){return session.wall+(performance.now()/1000-session.mono)*1000;}
function reasonText(reason){return labels[reason]||reason;}
function render(result){$('bpm').textContent=result.reliable?result.bpm:'—';$('quality').textContent=`${result.score||0} / 100`;$('qualitybar').value=result.score||0;$('comparison').textContent=result.reliable?`POS ${result.pos.toFixed(1)} / CHROM ${result.chrom.toFixed(1)}`:'POS — / CHROM —';$('status').textContent=reasonText(result.reason);$('reason').textContent=result.reliable?'accepted_experimental':`insufficient_signal · ${result.reason}`;$('state').textContent=result.reliable?'窗口估算':'信号不足';}
function fail(reason){render({reliable:false,reason});}
function diagnostic(){const rect=video.getBoundingClientRect();return {app_version:BUILD.version,commit_sha:BUILD.commit,roi_samples:roiSamples,invalid_frames:Math.max(0,resultCount-roiSamples),roi_status:lastSampleReason,...(measurement?.snapshot()||{}),aligned_at:session?.alignedAt||'',measurement_started_at:session?.measurementAt||'',capture_version:CAPTURE_VERSION,...(pump?.snapshot()||{}),model_results:resultCount,face_frames:faceFrames,last_sample_reason:lastSampleReason,document_visibility:document.visibilityState,preview_visible:rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth};}
function base(type,s=session){return {schema_version:1,record_type:type,session_id:s.id,subject_id:s.subject,recorded_at:iso(Date.now()),algorithm_version:VERSION,user_agent:navigator.userAgent,...s.camera,...diagnostic()};}
function showRecords(){
  $('record-count').textContent=`${records.rows.length} 条`;$('storage-status').textContent=records.error||'记录仅保存在当前浏览器；清理网站数据会删除记录。';$('storage-status').className=records.error?'error':'';
  $('records').replaceChildren();for(const r of records.rows.slice(-8).reverse()){
    const tr=document.createElement('tr');for(const value of [new Date(r.recorded_at).toLocaleTimeString(),r.record_type,r.bpm??r.status,r.reference_bpm!=null?`${r.reference_bpm} BPM`:reasonText(r.reason||'')]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('records').append(tr);
  }
}
function append(row){if(diagnosticCapture)diagnosticCapture.event(row.record_type,{t:performance.now()/1000,record:row});records.add(row);if(!running)showRecords();}
function recordWindow(end,partial=false,stopReason=''){
  // Final estimate uses the same 16-second algorithm window as v0.5.1.
  const selected=samples.filter(s=>s.t>=end-16&&s.t<=end);
  let result;try{result=analyze(selected);}catch(e){result={reliable:false,bpm:null,pos:null,chrom:null,score:0,reason:'analysis_error',analysis_error:{name:e.name,message:String(e.message).slice(0,160)}};}
  if(result.reliable&&![result.bpm,result.pos,result.chrom,result.score].every(Number.isFinite))result={reliable:false,bpm:null,pos:null,chrom:null,score:0,reason:'invalid_result'};
  if(partial)result={...result,reliable:false,bpm:null,pos:null,chrom:null,score:0,reason:stopReason||'window_too_short'};
  append({...base('window'),window_start:iso(session.wall+(Math.max(measurement?.startedAt??end,end-16)-session.mono)*1000),window_end:iso(session.wall+(end-session.mono)*1000),sample_start:selected.length?iso(session.wall+(selected[0].t-session.mono)*1000):'',sample_end:selected.length?iso(session.wall+(selected.at(-1).t-session.mono)*1000):'',status:result.reliable?'accepted':'insufficient_signal',reason:result.reason,bpm:result.bpm,pos_bpm:result.pos,chrom_bpm:result.chrom,quality:result.score,pos_reason:result.pos_reason||'not_evaluated',chrom_reason:result.chrom_reason||'not_evaluated',fps:selected.length>1?(selected.length-1)/(selected.at(-1).t-selected[0].t):0,sample_count:selected.length,stop_reason:stopReason});
  return result;
}
function updateMeasurement(){
  if(!measurement)return;const m=measurement.snapshot(),paused=measurement.phase==='paused';
  $('countdown').textContent=m.countdown_seconds;$('progress').value=Math.min(45,paused?m.previous_effective_seconds:m.effective_seconds);
  $('elapsed').textContent=paused?'当前连续窗口已失效，不累计暂停时间':`连续有效 ${m.effective_seconds.toFixed(1)} / 45 秒`;
  $('state').textContent=paused?'已暂停':measurement.phase==='measuring'?'正在测量':measurement.phase==='ready'?'已对准，准备测量':'请对准';
  $('status').textContent=paused?`已暂停：${reasonText(measurement.reason)}。请重新对准，稳定后从 45 秒重测。`:reasonText(measurement.reason);
  $('reason').textContent=measurement.reason;
  const interruption=measurement.interruption;
  $('interruption').hidden=!interruption;
  if(interruption)$('interruption').textContent=`${paused?'中断':'已重新开始'}：剩余 ${interruption.countdown} 秒时${reasonText(interruption.reason)}；上一段 ${interruption.effective.toFixed(1)} 秒已作废，不会拼接。`;
}
function measurementEvent(event,t){
  if(event.clear){samples=[];previous=null;session.measurementAt='';}
  if(event.paused||event.reset){
    const i=event.interruption;
    append({...base(event.paused?'measurement_pause':'measurement_reset'),status:event.paused?'paused':'reacquired',reason:i.reason,fps:i.fps,paused_at:iso(session.wall+(i.at-session.mono)*1000),reset_at:event.reset?iso(session.wall+(t-session.mono)*1000):'',countdown_before_reset:i.countdown,previous_effective_seconds:i.effective,previous_valid_samples:i.valid_samples});
  }
  if(event.aligned){session.alignedAt=iso(session.wall+(t-session.mono)*1000);append({...base('aligned'),status:'aligned',reason:measurement.reason});}
  if(event.started){samples=[];session.measurementAt=iso(session.wall+(t-session.mono)*1000);append({...base('measurement_start'),status:'measuring',reason:''});}
}
function renderFinal(row){
  const reliable=row.status==='accepted'&&[row.bpm,row.pos_bpm,row.chrom_bpm].every(Number.isFinite);
  render({reliable,bpm:row.bpm,pos:row.pos_bpm,chrom:row.chrom_bpm,score:row.quality,reason:row.reason});
  document.body.classList.remove('measuring');document.body.classList.add('results');
  const completed=row.stop_reason==='measurement_complete';document.body.classList.toggle('completed',completed);
  $('result-title').textContent=reliable?'测量完成 · 实验性心率':completed?'45 秒采样完成 · 未得到可靠心率':'测量已结束 · 未得到可靠心率';
  $('state').textContent=reliable?'实验性结果，非医疗用途':'本次测量失败';
  if(!reliable)$('status').textContent=`失败原因：${reasonText(row.reason)}。未输出心率数字；请导出日志。`;
  if(completed){$('countdown').textContent='0';$('progress').value=45;}
  $('result-details').hidden=false;
  $('result-details').textContent=`连续有效采样 ${Number(row.effective_seconds||0).toFixed(2)} 秒 · ${Number(row.fps||0).toFixed(1)} FPS · 有效 ROI 帧 ${row.roi_samples||0} / 无效帧 ${row.invalid_frames||0} · 重置 ${row.alignment_resets||0} 次`;
  $('result-version').textContent=`版本 ${row.app_version||'旧版'} · SHA ${row.commit_sha||'未记录'} · POS ${row.pos_reason||'未记录'} / CHROM ${row.chrom_reason||'未记录'}`;
  $('fps').textContent=`${Number(row.fps||0).toFixed(1)} FPS`;$('elapsed').textContent=`连续有效 ${Number(row.effective_seconds||0).toFixed(2)} / 45 秒`;
  $('interruption').hidden=true;
  window.scrollTo(0,0);$('result-title').focus({preventScroll:true});
}
function stop(reason='user_stop',finalResult=null){
  // Finalization is idempotent: late callbacks/cleanup must not erase a result.
  if(!running&&!starting)return;
  running=false;starting=false;token++;clearInterval(timer);clearTimeout(startTimer);
  const finalDiagnostic=diagnostic(),finished=session;const cleanup=[];
  const safely=(name,fn)=>{try{fn();}catch(e){cleanup.push(name+':'+e.name);}};
  safely('pump_stop',()=>pump?.stop());
  if(stream)for(const track of stream.getTracks())safely('track_stop',()=>{track.onended=null;track.onmute=null;track.stop();});
  stream=null;safely('video_pause',()=>video.pause());safely('video_clear',()=>{video.srcObject=null;});
  if(mesh){const old=mesh;mesh=null;Promise.resolve().then(()=>old.close()).catch(()=>{});}
  if(finished){
    const end=Math.max(0,(nowSession()-session.wall)/1000);
    const result=finalResult||recordWindow(performance.now()/1000,true,reason);
    lastOutcome={...base('session_end'),...finalDiagnostic,status:result.reliable?'accepted':'failed',reason:result.reason,final_reason:result.reason,stop_reason:reason,bpm:result.reliable?result.bpm:null,pos_bpm:result.reliable?result.pos:null,chrom_bpm:result.reliable?result.chrom:null,quality:result.score||0,pos_reason:result.pos_reason||'not_evaluated',chrom_reason:result.chrom_reason||'not_evaluated',fps:result.fs??finalDiagnostic.measurement_fps??0,cleanup_errors:cleanup.join(';'),stopped_at:iso(nowSession()),window_start:iso(session.wall),window_end:iso(session.wall+end*1000)};
    append(lastOutcome);lastSession=finished;
    if(diagnosticCapture){const captureReport=diagnosticCapture;captureReport.finish({...lastOutcome,analysis_error:result.analysis_error||null});$('diagnostic-status').textContent='正在整理本次诊断；不上传数据…';setTimeout(()=>{if(diagnosticCapture!==captureReport)return;try{diagnosticReport=captureReport.report();$('diagnostic-status').textContent='诊断已就绪，含RGB及中间波形。请在重测或刷新前导出；仅保留本次内存数据。';}catch(e){diagnosticReport={schema:'xinyun-diagnostics-error',final:lastOutcome,error:{name:e.name,message:String(e.message).slice(0,160)},samples:captureReport.samples,events:captureReport.events};$('diagnostic-status').textContent='诊断分析失败，仍可导出原始数值和错误。';}},0);}
  }
  session=null;samples=[];previous=null;pump=null;
  safely('canvas_clear',()=>{capture.width=1;capture.height=1;overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);});
  $('start').disabled=false;$('reset').disabled=false;$('stop').disabled=true;$('subject').disabled=false;$('consent').disabled=false;$('placeholder').hidden=false;$('face').textContent='摄像头已关闭';
  if(lastOutcome)renderFinal(lastOutcome);showRecords();
}
function onResults(result,id){
  if(!running||id!==token)return;lastFrame=performance.now()/1000;resultCount++;const faces=result.multiFaceLandmarks||[];if(faces.length===1)faceFrames++;
  overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  let sample=faces.length===1?sampleROI(faces[0],capture,overlay,previous):{reason:faces.length?'multiple_faces':'no_face'};
  previous=sample.previous||null;delete sample.previous;sample.t=pendingTime;
  if(!sample.reason&&faces[0].some(p=>p.x<.01||p.x>.99||p.y<.01||p.y>.99))sample.reason='face_out_of_frame';
  const immediate=sample.reason||(measurement.last!==null&&pendingTime-measurement.last>.25?'sampling_gap':lastFrame-pendingTime>.25?'sampling_gap':sample.displacement>.012||sample.motion>3?'excessive_motion':sample.rgb.reduce((a,b)=>a+b,0)/3<30||sample.rgb.reduce((a,b)=>a+b,0)/3>235?'exposure':'');
  lastSampleReason=immediate||'roi_sampled';
  const event=measurement.observe(pendingTime,immediate);if(event.ignored)return;
  if(!immediate)roiSamples++;
  measurementEvent(event,pendingTime);
  diagnosticCapture?.add(sample,immediate);
  if(measurement.phase==='measuring'||measurement.phase==='complete')samples.push(sample);
  while(samples.length&&pendingTime-samples[0].t>16.1)samples.shift();
  $('face').textContent=immediate?reasonText(immediate):'已定位单人面部';
  if(event.paused||event.reset||event.started||event.aligned||event.complete)updateMeasurement();
  if(event.complete){const result=recordWindow(pendingTime,false,'measurement_complete');stop('measurement_complete',result);}
}

async function frame(id,t){
  if(!running||id!==token)return;pendingTime=t;
  // Keep the frozen input alive until this send completes; callbacks use it.
  const W=320,H=Math.round(W*video.videoHeight/video.videoWidth);
  if(capture.width!==W||capture.height!==H){capture.width=W;capture.height=H;overlay.width=W;overlay.height=H;video.parentElement.style.aspectRatio=`${video.videoWidth}/${video.videoHeight}`;previous=null;}
  capture.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,W,H);
  await mesh.send({image:capture});
}
function tick(){
  if(!running||!session)return;const t=performance.now()/1000,elapsed=t-session.mono;
  if(Math.abs(Date.now()-nowSession())>2000){stop('clock_changed');return;}
  const event=measurement.poll(t);
  if(event.paused)lastSampleReason='sampling_gap';measurementEvent(event,t);
  $('fps').textContent=`${(t-lastFrame>.25?0:measurement.fps).toFixed(1)} FPS`;
  updateMeasurement();
  const sec=Math.floor(elapsed);
  if(sec!==lastTelemetry){lastTelemetry=sec;append({...base('telemetry'),status:measurement.phase,reason:measurement.reason,fps:t-lastFrame>.25?0:measurement.fps,sample_count:measurement.count});}
  if(t-lastFrame>measurement.policy.invalidTimeout){stop(pump?.timeoutReason(resultCount)||'frame_timeout');return;}
  if(measurement.invalidSince!==null&&t-measurement.invalidSince>=measurement.policy.invalidTimeout){stop(measurement.reason==='sampling_gap'&&t-lastFrame>measurement.policy.maxGap?pump?.timeoutReason(resultCount)||'sampling_gap':measurement.reason);return;}
  if(records.rows.length>=5000){stop('storage_limit');return;}
  if(elapsed>=measurement.policy.sessionLimit)stop('session_timeout');
}
async function start(){
  if(running||starting)return;
  const subject=$('subject').value.trim();if(!validateSubject(subject)){$('status').textContent='匿名编号须为 1–32 位字母、数字、下划线或短横线';return;}
  if(!$('consent').checked){$('status').textContent='请先确认自愿成年参与及知情同意';return;}
  if(records.readFailed||records.rows.length>=5000){$('status').textContent='请先导出并清空本地记录，再开始测量';return;}
  document.body.classList.remove('results','completed');$('result-details').hidden=true;$('result-version').textContent='';lastOutcome=null;diagnosticReport=null;diagnosticCapture=null;measurement=new Measurement();roiSamples=0;lastTelemetry=-1;updateMeasurement();starting=true;resultCount=0;faceFrames=0;lastSampleReason='';const id=++token;session={id:crypto.randomUUID(),subject,wall:Date.now(),mono:performance.now()/1000,camera:{}};
  if($('diagnostic-consent').checked)diagnosticCapture=new DiagnosticCapture({app_version:BUILD.version,commit_sha:BUILD.commit,session_id:session.id,subject_id:subject,wall_start:iso(session.wall),monotonic_start:session.mono,user_agent:navigator.userAgent});$('diagnostic-status').textContent=diagnosticCapture?'本次已开启本地数值诊断；重测或刷新会清除。':'未开启波形诊断；普通CSV/JSON不包含波形。';
  append({...base('session_start'),status:'starting',reason:''});$('start').disabled=true;$('reset').disabled=true;$('stop').disabled=false;$('subject').disabled=true;$('consent').disabled=true;
  samples=[];previous=null;resultCount=0;faceFrames=0;lastSampleReason='';fail('insufficient_samples');$('status').textContent='正在请求前置摄像头并加载本地模型…';$('state').textContent='启动中';
  startTimer=setTimeout(()=>{if(id===token)stop('startup_timeout');},30000);
  try{
    if(!window.isSecureContext)throw Error('insecure_context');if(!navigator.mediaDevices?.getUserMedia)throw Error('unsupported_camera');if(!window.FaceMesh)throw Error('model_missing');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}}});
    if(id!==token){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;
    const track=stream.getVideoTracks()[0],settings=track.getSettings();
    if(settings.facingMode==='environment')throw Error('wrong_camera');
    session.camera={camera_width:settings.width,camera_height:settings.height,camera_facing:settings.facingMode||'unknown'};
    track.onended=()=>{if(id===token)stop('camera_ended');};track.onmute=()=>{if(id===token)stop('camera_muted');};
    document.body.classList.add('measuring');video.muted=true;video.playsInline=true;video.srcObject=stream;await video.play();if(id!==token)return;
    const model=new window.FaceMesh({locateFile:file=>new URL(`./vendor/face_mesh/${file}`,import.meta.url).href});mesh=model;
    model.setOptions({maxNumFaces:2,refineLandmarks:false,minDetectionConfidence:.6,minTrackingConfidence:.6});model.onResults(r=>onResults(r,id));
    if(model.initialize)await model.initialize();if(id!==token)return;
    // Acquisition windows start after camera/model startup, not at the prompt.
    session.wall=Date.now();session.mono=performance.now()/1000;append({...base('camera_ready'),status:'ready',reason:''});
    clearTimeout(startTimer);running=true;starting=false;lastFrame=session.mono;$('placeholder').hidden=true;$('reset').disabled=false;
    $('camera-info').textContent=`${settings.width||video.videoWidth} × ${settings.height||video.videoHeight} · ${settings.facingMode==='user'?'前置摄像头':'前置方向未确认，请检查预览'} · 不录像、不上传`;
    pump=new FramePump(video,t=>frame(id,t),()=>{if(id===token)stop('model_error');});timer=setInterval(tick,250);pump.start();
  }catch(e){if(id!==token)return;const reasons={NotAllowedError:'camera_permission_denied',NotFoundError:'camera_not_found',NotReadableError:'camera_busy'};stop(reasons[e.name]|| (labels[e.message]?e.message:'model_error'));}
}
$('start').onclick=start;$('stop').onclick=()=>stop();$('reset').onclick=()=>{if(running||starting)stop('restart');start();};
window.addEventListener('pagehide',()=>{if(running||starting)stop('page_exit');});document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting))stop('page_hidden');});
$('reference-now').onchange=()=>{$('reference-time-label').hidden=$('reference-now').checked;};
$('save-reference').onclick=()=>{
  try{const s=session||lastSession;if(!s)throw Error('请先开始一次测量');const now=Date.now(),observed=$('reference-now').checked?now:new Date($('reference-time').value).getTime();
    const ref=makeReference({bpm:Number($('reference').value),observed,now,sessionId:s.id,subjectId:s.subject,id:crypto.randomUUID()});append({...ref,app_version:BUILD.version,commit_sha:BUILD.commit,algorithm_version:VERSION,user_agent:navigator.userAgent});$('reference-status').textContent=`已记录 ${ref.reference_bpm} BPM · 观察时间 ${new Date(observed).toLocaleTimeString()}。导出时仅匹配实际采样窗口中点 ±2 秒内的读数。`;$('reference').value='';
  }catch(e){$('reference-status').textContent=e.message;}
};
function exportFile(json=false){const text=json?JSON.stringify(matchedRows(records.rows),null,2):toCSV(records.rows);return {blob:new Blob([text],{type:json?'application/json':'text/csv;charset=utf-8'}),name:`xinyun-${new Date().toISOString().replaceAll(':','-')}.${json?'json':'csv'}`};}
function download(file){const url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}$('export-status').textContent='已请求下载（尚不能确认保存）。Safari 请查看下载列表或「文件」；也可使用对应的分享按钮保存到「文件」。';}
function exportDownload(json){try{download(exportFile(json));}catch(e){$('export-status').textContent=`导出失败（${e.name}）。记录仍在本地，请使用分享按钮重试。`;}}
$('export').onclick=()=>exportDownload(false);$('export-json').onclick=()=>exportDownload(true);
async function shareExport(json){try{const data=exportFile(json),file=new File([data.blob],data.name,{type:data.blob.type});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'心云研究记录'});$('export-status').textContent='分享面板已完成，请确认文件已保存';}else download(data);}catch(e){$('export-status').textContent=e.name==='AbortError'?'已取消分享，记录仍在本地':`分享失败（${e.name}），请使用导出 ${json?'JSON':'CSV'}`;}}
$('share').onclick=()=>shareExport(false);$('share-json').onclick=()=>shareExport(true);
function diagnosticFile(){if(!$('diagnostic-consent').checked)throw Error('请先明确同意本地数值诊断，并完成一次测量');if(!diagnosticReport)throw Error('暂无本次诊断，请先完成或停止测量后等待诊断就绪');return {blob:new Blob([JSON.stringify({...diagnosticReport,records:matchedRows(records.rows.filter(r=>r.session_id===diagnosticReport.session_id))})],{type:'application/json'}),name:`xinyun-diagnostic-${Date.now()}.json`};}
$('diagnostic-consent').onchange=()=>{if(!$('diagnostic-consent').checked){diagnosticCapture=null;diagnosticReport=null;$('diagnostic-status').textContent='已清除内存诊断；历史普通记录保留';}};
$('export-diagnostics').onclick=()=>{try{download(diagnosticFile());}catch(e){$('diagnostic-status').textContent=e.message;}};
$('share-diagnostics').onclick=async()=>{try{const data=diagnosticFile(),file=new File([data.blob],data.name,{type:data.blob.type});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'心云数值诊断'});else download(data);}catch(e){$('diagnostic-status').textContent=e.name==='AbortError'?'已取消分享，诊断仍在内存':e.message;}};
$('clear').onclick=()=>{if(!confirm('确认清空当前浏览器的全部测量记录？请先导出。'))return;if(running||starting)stop();try{records.clear();lastSession=null;lastOutcome=null;diagnosticCapture=null;diagnosticReport=null;showRecords();$('export-status').textContent='已清空本地记录';}catch(e){$('export-status').textContent='清空失败：'+e.message;}};
showRecords();
const saved=records.rows.filter(r=>r.record_type==='session_end'&&r.final_reason).at(-1);
if(saved){lastOutcome=saved;lastSession={id:saved.session_id,subject:saved.subject_id};renderFinal(saved);}

if(/MicroMessenger/i.test(navigator.userAgent)){$('browser-notice').hidden=false;}
