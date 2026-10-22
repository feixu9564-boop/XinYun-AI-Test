import {analyze,VERSION} from './signal.js';
import {LocalRecords,validateSubject,makeReference,toCSV,matchedRows} from './records.js';
import {sampleROI} from './roi.js';
const $=id=>document.getElementById(id),video=$('video'),overlay=$('overlay');
const capture=document.createElement('canvas');
let storage;try{storage=window.localStorage;}catch{storage={getItem(){throw Error('浏览器禁止本地存储');},setItem(){throw Error('浏览器禁止本地存储');},removeItem(){}};}
const records=new LocalRecords(storage);
const labels={no_face:'未检测到人脸',multiple_faces:'请保持单人画面',face_out_of_frame:'请将完整面部移入画面',face_distance:'请调整距离，让面部居中',face_pose:'请正对镜头，不要侧头',invalid_landmarks:'人脸定位异常',insufficient_roi_pixels:'有效皮肤区域不足，请调整光照或移除遮挡',unstable_roi:'面部区域不稳定',invalid_face_roi:'人脸区域不可用',exposure:'光线过暗或过曝',excessive_motion:'运动过大，请固定手机并保持静止',illumination_variation:'光照变化过大',no_chromatic_pulse_evidence:'未发现足够的颜色脉搏信号',diffuse_spectrum:'信号频谱分散',harmonic_ambiguity:'存在谐波歧义，无法可靠测量',competing_periodicity:'存在多个竞争周期，无法可靠测量',algorithm_disagreement:'POS 与 CHROM 结果不一致',low_fps:'有效帧率不足，需至少 12 FPS',sampling_gap:'摄像头采样中断',window_too_short:'连续采样不足 15 秒',insufficient_samples:'等待有效采样',constant_waveform:'未检测到变化信号',no_in_band_signal:'没有有效心率频带信号',accepted_experimental:'通过实验性质量门；准确性尚未真人验证',user_stop:'已停止，摄像头已关闭',restart:'正在重新测量',page_hidden:'页面进入后台，摄像头已关闭；返回后请重新开始',page_exit:'页面离开，摄像头已关闭',camera_ended:'摄像头断开，请重新开始',camera_muted:'摄像头被系统暂停，请重新开始',frame_timeout:'视频或人脸模型长时间无响应',time_limit:'已达到 120 秒，摄像头已关闭',model_error:'人脸模型运行失败，请重试或更换浏览器',camera_permission_denied:'摄像头权限被拒绝，请在 Safari 网站设置中允许摄像头后重试',camera_not_found:'没有可用摄像头',camera_busy:'摄像头不可用或被其他程序占用',insecure_context:'需要 HTTPS 或本机 localhost',model_missing:'本地人脸模型文件缺失',startup_timeout:'启动超时，请检查权限与模型加载后重试',unsupported_camera:'浏览器不支持摄像头，请使用 Safari 或 Chrome',wrong_camera:'浏览器选中了后置摄像头，已停止；请检查前置摄像头是否可用',storage_limit:'本地记录已达到上限，请先导出并清空',clock_changed:'系统时钟发生变化，本次测量已停止'};
let running=false,starting=false,token=0,stream=null,mesh=null,raf=0,vfc=0,timer=0,startTimer=0;
let session=null,lastSession=null,samples=[],previous=null,pendingTime=0,lastCapture=-Infinity,lastMedia=-1,lastFrame=0,nextWindow=16,lastWindowEnd=0,busy=false;
const iso=t=>new Date(t).toISOString();
function nowSession(){return session.wall+(performance.now()/1000-session.mono)*1000;}
function reasonText(reason){return labels[reason]||reason;}
function render(result){$('bpm').textContent=result.reliable?result.bpm:'—';$('quality').textContent=`${result.score||0} / 100`;$('qualitybar').value=result.score||0;$('comparison').textContent=result.reliable?`POS ${result.pos.toFixed(1)} / CHROM ${result.chrom.toFixed(1)}`:'POS — / CHROM —';$('status').textContent=reasonText(result.reason);$('reason').textContent=result.reliable?'accepted_experimental':`insufficient_signal · ${result.reason}`;$('state').textContent=result.reliable?'窗口估算':'信号不足';}
function fail(reason){render({reliable:false,reason});}
function base(type,s=session){return {schema_version:1,record_type:type,session_id:s.id,subject_id:s.subject,recorded_at:iso(Date.now()),algorithm_version:VERSION,user_agent:navigator.userAgent,...s.camera};}
function showRecords(){
  $('record-count').textContent=`${records.rows.length} 条`;$('storage-status').textContent=records.error||'记录仅保存在当前浏览器；清理网站数据会删除记录。';$('storage-status').className=records.error?'error':'';
  $('records').replaceChildren();for(const r of records.rows.slice(-8).reverse()){
    const tr=document.createElement('tr');for(const value of [new Date(r.recorded_at).toLocaleTimeString(),r.record_type,r.bpm??r.status,r.reference_bpm!=null?`${r.reference_bpm} BPM`:reasonText(r.reason||'')]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('records').append(tr);
  }
}
function append(row){records.add(row);showRecords();}
function recordWindow(end,partial=false){
  const start=partial?lastWindowEnd:Math.max(0,end-16),selected=samples.filter(s=>s.t>=session.mono+start&&s.t<=session.mono+end);
  let result=analyze(selected);
  if(partial)result={...result,reliable:false,bpm:null,pos:null,chrom:null,score:0,reason:'window_too_short'};
  if(!partial&&(!selected.length||selected[0].t-session.mono-start>.25||session.mono+end-selected.at(-1).t>.25))result={...result,reliable:false,bpm:null,pos:null,chrom:null,score:0,reason:'sampling_gap'};
  append({...base('window'),window_start:iso(session.wall+start*1000),window_end:iso(session.wall+end*1000),sample_start:selected.length?iso(session.wall+(selected[0].t-session.mono)*1000):'',sample_end:selected.length?iso(session.wall+(selected.at(-1).t-session.mono)*1000):'',status:result.reliable?'accepted':'insufficient_signal',reason:result.reason,bpm:result.bpm,pos_bpm:result.pos,chrom_bpm:result.chrom,quality:result.score,fps:result.fs,sample_count:selected.length});
  lastWindowEnd=end;render(result);return result;
}
function stop(reason='user_stop'){
  const active=running||starting;running=false;starting=false;token++;clearInterval(timer);clearTimeout(startTimer);cancelAnimationFrame(raf);if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(vfc);
  if(stream)stream.getTracks().forEach(t=>{t.onended=null;t.onmute=null;t.stop();});stream=null;video.pause();video.srcObject=null;
  if(mesh){const old=mesh;mesh=null;Promise.resolve().then(()=>old.close()).catch(()=>{});}
  if(active&&session){const end=Math.max(0,(nowSession()-session.wall)/1000);if(samples.length&&end-lastWindowEnd>.5)recordWindow(end,true);append({...base('session_end'),status:'stopped',reason,window_start:iso(session.wall),window_end:iso(session.wall+end*1000)});lastSession=session;}
  session=null;samples=[];previous=null;busy=false;capture.width=1;capture.height=1;overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  $('start').disabled=false;$('reset').disabled=false;$('stop').disabled=true;$('subject').disabled=false;$('consent').disabled=false;$('placeholder').hidden=false;$('face').textContent='摄像头已关闭';fail(reason);$('state').textContent='已停止';
}
function onResults(result,id){
  if(!running||id!==token)return;lastFrame=performance.now()/1000;const faces=result.multiFaceLandmarks||[];
  overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  let sample=faces.length===1?sampleROI(faces[0],capture,overlay,previous):{reason:faces.length?'multiple_faces':'no_face'};
  previous=sample.previous||null;delete sample.previous;sample.t=pendingTime;samples.push(sample);
  while(samples.length&&pendingTime-samples[0].t>17)samples.shift();
  $('face').textContent=sample.reason?reasonText(sample.reason):'已定位单人面部';
  const gap=samples.length>1?pendingTime-samples.at(-2).t:0;
  const immediate=sample.reason||(gap>.25?'sampling_gap':sample.displacement>.012||sample.motion>3?'excessive_motion':sample.rgb.reduce((a,b)=>a+b,0)/3<30||sample.rgb.reduce((a,b)=>a+b,0)/3>235?'exposure':'');
  if(immediate){sample.reason=immediate;fail(immediate);}
}
function schedule(id){if(!running||id!==token)return;if(video.requestVideoFrameCallback)vfc=video.requestVideoFrameCallback((_,meta)=>frame(id,meta.mediaTime));else raf=requestAnimationFrame(()=>frame(id,video.currentTime));}
async function frame(id,mediaTime){
  if(!running||id!==token)return;const t=performance.now()/1000;
  if(busy||mediaTime===lastMedia||t-lastCapture<.048||video.readyState<2){schedule(id);return;}
  busy=true;lastMedia=mediaTime;lastCapture=t;pendingTime=t;
  try{
    // Preserve native aspect ratio; avoid PR #1's fixed 4:3 stretching.
    const W=320,H=Math.round(W*video.videoHeight/video.videoWidth);
    if(capture.width!==W||capture.height!==H){capture.width=W;capture.height=H;overlay.width=W;overlay.height=H;video.parentElement.style.aspectRatio=`${video.videoWidth}/${video.videoHeight}`;previous=null;}
    capture.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,W,H);
    await mesh.send({image:capture});
  }catch{if(id===token)stop('model_error');return;}
  if(id===token){busy=false;schedule(id);}
}
function tick(){
  if(!running||!session)return;const t=performance.now()/1000,elapsed=t-session.mono;
  if(Math.abs(Date.now()-nowSession())>2000){stop('clock_changed');return;}
  $('elapsed').textContent=`已测量 ${Math.floor(elapsed)} / 120 秒`;
  const recent=samples.filter(s=>s.t>t-2),fps=recent.length>1?(recent.length-1)/(recent.at(-1).t-recent[0].t):0;$('fps').textContent=`${fps.toFixed(1)} FPS`;
  if(t-lastFrame>.5)fail('sampling_gap');
  if(t-lastFrame>8){stop('frame_timeout');return;}
  while(elapsed>=nextWindow){recordWindow(nextWindow);nextWindow+=4;}
  if(elapsed<16&&samples.length&&!samples.at(-1).reason){$('status').textContent=`积累信号中：${Math.floor(elapsed)} / 16 秒`;$('state').textContent='采样中';}
  if(records.rows.length>=5000){stop('storage_limit');return;}
  if(elapsed>=120)stop('time_limit');
}
async function start(){
  if(running||starting)return;
  const subject=$('subject').value.trim();if(!validateSubject(subject)){$('status').textContent='匿名编号须为 1–32 位字母、数字、下划线或短横线';return;}
  if(!$('consent').checked){$('status').textContent='请先确认自愿成年参与及知情同意';return;}
  if(records.readFailed||records.rows.length>=5000){$('status').textContent='请先导出并清空本地记录，再开始测量';return;}
  starting=true;const id=++token;session={id:crypto.randomUUID(),subject,wall:Date.now(),mono:performance.now()/1000,camera:{}};
  append({...base('session_start'),status:'starting',reason:''});$('start').disabled=true;$('reset').disabled=true;$('stop').disabled=false;$('subject').disabled=true;$('consent').disabled=true;
  samples=[];previous=null;lastCapture=-Infinity;lastMedia=-1;nextWindow=16;lastWindowEnd=0;fail('insufficient_samples');$('status').textContent='正在请求前置摄像头并加载本地模型…';$('state').textContent='启动中';
  startTimer=setTimeout(()=>{if(id===token)stop('startup_timeout');},30000);
  try{
    if(!window.isSecureContext)throw Error('insecure_context');if(!navigator.mediaDevices?.getUserMedia)throw Error('unsupported_camera');if(!window.FaceMesh)throw Error('model_missing');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}}});
    if(id!==token){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;
    const track=stream.getVideoTracks()[0],settings=track.getSettings();
    if(settings.facingMode==='environment')throw Error('wrong_camera');
    session.camera={camera_width:settings.width,camera_height:settings.height,camera_facing:settings.facingMode||'unknown'};
    track.onended=()=>{if(id===token)stop('camera_ended');};track.onmute=()=>{if(id===token)stop('camera_muted');};
    video.muted=true;video.playsInline=true;video.srcObject=stream;await video.play();if(id!==token)return;
    const model=new window.FaceMesh({locateFile:file=>new URL(`./vendor/face_mesh/${file}`,import.meta.url).href});mesh=model;
    model.setOptions({maxNumFaces:2,refineLandmarks:false,minDetectionConfidence:.6,minTrackingConfidence:.6});model.onResults(r=>onResults(r,id));
    if(model.initialize)await model.initialize();if(id!==token)return;
    // Acquisition windows start after camera/model startup, not at the prompt.
    session.wall=Date.now();session.mono=performance.now()/1000;append({...base('camera_ready'),status:'ready',reason:''});
    clearTimeout(startTimer);running=true;starting=false;lastFrame=session.mono;$('placeholder').hidden=true;$('reset').disabled=false;
    $('camera-info').textContent=`${settings.width||video.videoWidth} × ${settings.height||video.videoHeight} · ${settings.facingMode==='user'?'前置摄像头':'前置方向未确认，请检查预览'} · 不录像、不上传`;
    timer=setInterval(tick,250);schedule(id);
  }catch(e){if(id!==token)return;const reasons={NotAllowedError:'camera_permission_denied',NotFoundError:'camera_not_found',NotReadableError:'camera_busy'};stop(reasons[e.name]|| (labels[e.message]?e.message:'model_error'));}
}
$('start').onclick=start;$('stop').onclick=()=>stop();$('reset').onclick=()=>{if(running||starting)stop('restart');start();};
window.addEventListener('pagehide',()=>{if(running||starting)stop('page_exit');});document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting))stop('page_hidden');});
$('reference-now').onchange=()=>{$('reference-time-label').hidden=$('reference-now').checked;};
$('save-reference').onclick=()=>{
  try{const s=session||lastSession;if(!s)throw Error('请先开始一次测量');const now=Date.now(),observed=$('reference-now').checked?now:new Date($('reference-time').value).getTime();
    const ref=makeReference({bpm:Number($('reference').value),observed,now,sessionId:s.id,subjectId:s.subject,id:crypto.randomUUID()});append({...ref,algorithm_version:VERSION,user_agent:navigator.userAgent});$('reference-status').textContent=`已记录 ${ref.reference_bpm} BPM · 观察时间 ${new Date(observed).toLocaleTimeString()}。导出时仅匹配实际采样窗口中点 ±2 秒内的读数。`;$('reference').value='';
  }catch(e){$('reference-status').textContent=e.message;}
};
function exportFile(json=false){const text=json?JSON.stringify(matchedRows(records.rows),null,2):toCSV(records.rows);return new File([text],`xinyun-${new Date().toISOString().replaceAll(':','-')}.${json?'json':'csv'}`,{type:json?'application/json':'text/csv;charset=utf-8'});}
function download(file){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('export-status').textContent='已请求下载。Safari 中请查看下载列表或「文件」；如下载受限，请使用分享 CSV。';}
$('export').onclick=()=>download(exportFile());$('export-json').onclick=()=>download(exportFile(true));
$('share').onclick=async()=>{const file=exportFile();try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'心云研究记录'});$('export-status').textContent='分享面板已完成';}else download(file);}catch(e){$('export-status').textContent=e.name==='AbortError'?'已取消分享':'分享失败，请使用导出 CSV';}};
$('clear').onclick=()=>{if(!confirm('确认清空当前浏览器的全部测量记录？请先导出。'))return;if(running||starting)stop();try{records.clear();lastSession=null;showRecords();$('export-status').textContent='已清空本地记录';}catch(e){$('export-status').textContent='清空失败：'+e.message;}};
showRecords();
