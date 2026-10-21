import {analyze} from './signal.js';
const $=id=>document.getElementById(id),video=$('video'),overlay=$('overlay'),ctx=overlay.getContext('2d');
const capture=document.createElement('canvas');capture.width=320;capture.height=240;
const pixels=capture.getContext('2d',{willReadFrequently:true});
let stream=null,mesh=null,running=false,starting=false,token=0,raf=0,timer=0,samples=[],history=[],last=null,previous=null,startTime=0,lastAnalysis=0;
const polygons=[[109,10,338,337,151,108],[50,101,205,187],[280,330,425,411]];
function render(r){last=r;$('bpm').textContent=r.bpm??'—';$('quality').textContent=`${r.score} / 100`;$('qualitybar').value=r.score;$('status').textContent=r.reason;$('comparison').textContent=`POS ${r.pos?.toFixed(1)??'—'} / CHROM ${r.chrom?.toFixed(1)??'—'} 次/分钟`;
 const c=$('wave'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);g.strokeStyle='#203744';g.beginPath();g.moveTo(0,75);g.lineTo(600,75);g.stroke();
 const w=r.wave.slice(-Math.round((r.fs||30)*6)),scale=Math.max(1e-6,...w.map(Math.abs));g.strokeStyle='#65d9c4';g.lineWidth=2;g.beginPath();w.forEach((v,i)=>{const x=i*600/Math.max(1,w.length-1),y=75-v/scale*60;i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();}
function results(result){
 if(!running)return;
 ctx.clearRect(0,0,640,480);
 const faces=result.multiFaceLandmarks||[];
 if(faces.length!==1){samples=[];previous=null;$('face').textContent=faces.length?'请保持单人画面':'未检测到人脸';render({reliable:false,bpm:null,score:0,wave:[],reason:'人脸不可用，连续采样已重置'});return;}
 const lm=faces[0];$('face').textContent='已定位人脸';pixels.drawImage(video,0,0,320,240);
 const image=pixels.getImageData(0,0,320,240).data,sum=[0,0,0];let count=0;
 for(const indices of polygons){const path=new Path2D();indices.forEach((i,j)=>{const p=lm[i];j?path.lineTo(p.x*320,p.y*240):path.moveTo(p.x*320,p.y*240);});path.closePath();
 ctx.save();ctx.scale(2,2);ctx.strokeStyle='#65d9c4';ctx.lineWidth=1;ctx.stroke(path);ctx.restore();
 const xs=indices.map(i=>lm[i].x*320),ys=indices.map(i=>lm[i].y*240);
 for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<Math.min(240,Math.max(...ys));y+=2)for(let x=Math.max(0,Math.floor(Math.min(...xs)));x<Math.min(320,Math.max(...xs));x+=2){if(!pixels.isPointInPath(path,x,y))continue;const k=(y*320+x)*4,r=image[k],g=image[k+1],b=image[k+2];
 // Exclude saturated, near-black and specular pixels; no fixed skin-color threshold.
 if(Math.min(r,g,b)<10||Math.max(r,g,b)>245)continue;sum[0]+=r;sum[1]+=g;sum[2]+=b;count++;}}
 if(count<80){samples=[];previous=null;render({bpm:null,score:0,wave:[],reason:'有效皮肤像素不足，请调整距离或光照'});return;}
 const center=lm[1],width=Math.hypot(lm[234].x-lm[454].x,lm[234].y-lm[454].y);
 const motion=previous?Math.hypot(center.x-previous.x,center.y-previous.y)/Math.max(width,.01)+Math.abs(width-previous.width):0;previous={...center,width};
 const t=performance.now()/1000;if(samples.length&&t-samples.at(-1).t>.25)samples=[];
 samples.push({t,rgb:sum.map(v=>v/count),motion});while(samples.length&&t-samples[0].t>20)samples.shift();
 if(t-lastAnalysis>=1){lastAnalysis=t;const r=analyze(samples);render(r);if(r.reliable)history.push({seconds:t-startTime,bpm:r.bpm,score:r.score});}
}
async function frame(session){if(!running||session!==token)return;try{await mesh.send({image:video});}catch(e){console.error('Face Mesh failure',e);if(session===token){stop();$('status').textContent='人脸模型运行失败，请检查本地模型文件与浏览器 WebAssembly 支持';}return;}if(running&&session===token)raf=requestAnimationFrame(()=>frame(session));}
function stop(){running=false;starting=false;token++;cancelAnimationFrame(raf);clearInterval(timer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;if(mesh){const old=mesh;mesh=null;Promise.resolve(old.close()).catch(()=>{});}$('start').disabled=false;$('stop').disabled=true;$('reset').disabled=false;$('placeholder').hidden=false;$('face').textContent='摄像头已关闭';ctx.clearRect(0,0,640,480);
 const duration=startTime?Math.max(0,performance.now()/1000-startTime):0;
 $('result').textContent=last?.reliable?`测量已结束（${duration.toFixed(0)} 秒）。末次有效窗口心率估计 ${last.bpm} 次/分钟，质量 ${last.score}/100；共 ${history.length} 个通过阈值的重叠窗口。窗口并非独立样本，结果未经参考设备验证。`:'测量已结束：末次信号不足，无法可靠测量。请改善光照、保持静止后重试。';
 $('status').textContent='测量结束，摄像头已关闭';}
async function start(){if(running||starting)return;starting=true;const session=++token;$('start').disabled=true;$('reset').disabled=true;$('stop').disabled=false;samples=[];history=[];last=null;previous=null;lastAnalysis=0;startTime=0;render({bpm:null,score:0,wave:[],reason:'正在请求摄像头授权并加载本地模型…'});$('result').textContent='正在测量，结果将在停止后显示。';
 try{if(!window.isSecureContext||!navigator.mediaDevices)throw new Error('需要 HTTPS 或本机 localhost 才能使用摄像头');if(!window.FaceMesh)throw new Error('模型文件缺失，请先运行安装脚本');
 const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}},audio:false});if(session!==token){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;video.srcObject=stream;await video.play();if(session!==token)return;
 mesh=new window.FaceMesh({locateFile:file=>`/static/vendor/face_mesh/${file}`});mesh.setOptions({maxNumFaces:2,refineLandmarks:false,minDetectionConfidence:.6,minTrackingConfidence:.6});mesh.onResults(r=>{if(session===token)results(r);});running=true;starting=false;startTime=performance.now()/1000;$('placeholder').hidden=true;
 timer=setInterval(()=>{const elapsed=performance.now()/1000-startTime;$('elapsed').textContent=`已测量 ${elapsed.toFixed(0)} / 45 秒`;if(elapsed>=45)stop();},250);stream.getVideoTracks()[0].onended=()=>{if(running)stop();};frame(session);
 }catch(e){if(session!==token)return;stop();$('status').textContent=`无法开始：${e.name==='NotAllowedError'?'摄像头权限被拒绝，请在浏览器设置中授权':e.message}`;}}
$('start').onclick=start;$('stop').onclick=stop;$('reset').onclick=()=>{if(running||starting)stop();start();};
window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting))stop();});
// Future research modules consume scalar-only window summaries, never video.
export function researchSnapshot(){return {schemaVersion:1,algorithm:'POS+CHROM',windows:history.map(v=>({...v})),modules:{respiration:'not_validated',hrv:'not_validated',questionnaire:'not_enabled'}};}
