// UI/acquisition fault injection ONLY: constant pixels/ROI, no physiological signal.
// Desktop WebKit is not iPhone Safari. No result here is a human measurement.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const url=process.env.TEST_URL||'http://127.0.0.1:4173',out=process.env.TEST_OUT||'test-results/mobile';
await mkdir(out,{recursive:true});const results=[];
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 const browser=await engine.launch({headless:true});const started=Date.now();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/vendor/face_mesh/face_mesh.js',r=>r.fulfill({contentType:'text/javascript',body:`window.FaceMesh=class{setOptions(){}onResults(cb){this.cb=cb}async initialize(){}async close(){}async send(){if(window.acq.mode==='error')throw Error('injected');if(window.acq.mode==='hung')return new Promise(()=>{});this.cb({multiFaceLandmarks:window.acq.mode==='no_face'?[]:[Array.from({length:455},()=>({x:.5,y:.5}))]});}};`}));
  await page.route('**/roi.js*',r=>r.fulfill({contentType:'text/javascript',body:`export function sampleROI(){return {rgb:[100,100,100],motion:0,displacement:0,faceCount:1,roiValid:true};}`}));
  await page.addInitScript(()=>{
   window.acq={mode:'no_face',tracks:[],callbacks:0};const state=window.acq;
   Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
    const t={readyState:'live',stop(){this.readyState='ended';},getSettings(){return {width:640,height:480,facingMode:'user'};}};state.tracks.push(t);return {getTracks:()=>[t],getVideoTracks:()=>[t]};
   }}});
   Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{get(){return this._stream||null;},set(v){this._stream=v;},configurable:true});
   for(const [key,get] of Object.entries({currentTime(){return state.mode==='frozen'?state.frozen:performance.now()/1000;},readyState(){return 4;},paused(){return !this._stream;}}))Object.defineProperty(HTMLMediaElement.prototype,key,{get,configurable:true});
   Object.defineProperty(HTMLVideoElement.prototype,'videoWidth',{get(){return 640;},configurable:true});
   Object.defineProperty(HTMLVideoElement.prototype,'videoHeight',{get(){return 480;},configurable:true});
   HTMLMediaElement.prototype.play=async function(){};HTMLMediaElement.prototype.pause=function(){};
   HTMLVideoElement.prototype.getVideoPlaybackQuality=undefined;
   Object.defineProperty(HTMLVideoElement.prototype,'webkitDecodedFrameCount',{get(){return undefined;},configurable:true});
   HTMLVideoElement.prototype.requestVideoFrameCallback=function(fn){state.callbacks++;if(state.callbacks===1)setTimeout(()=>fn(performance.now(),{mediaTime:0,presentedFrames:1}),0);return state.callbacks;};
   HTMLVideoElement.prototype.cancelVideoFrameCallback=()=>{};
   const draw=CanvasRenderingContext2D.prototype.drawImage;
   CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(!(image instanceof HTMLVideoElement))return draw.call(this,image,...args);this.fillStyle='#646464';this.fillRect(0,0,this.canvas.width,this.canvas.height);};
  });
  await page.goto(url);await page.clock.install();await page.locator('#consent').check();await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#placeholder').hidden);
  await page.clock.runFor(4000);assert.equal(await page.locator('#countdown').innerText(),'45');
  assert.equal(await page.locator('#bpm').innerText(),'—');
  await page.evaluate(()=>window.acq.mode='aligned');await page.clock.runFor(4000);
  const layout=await page.evaluate(()=>{const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};return {height:innerHeight,preview:rect('.viewport'),count:rect('#countdown'),stop:rect('#stop'),reset:rect('#reset'),overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(layout.preview.height/layout.height>=.45&&layout.preview.height/layout.height<=.55);
  for(const r of [layout.preview,layout.count,layout.stop,layout.reset])assert.ok(r.top>=0&&r.bottom<=layout.height);
  assert.equal(layout.overflow,false);
  await page.screenshot({path:`${out}/${name.toLowerCase()}-45s-measuring.png`});
  await page.setViewportSize({width:320,height:568});
  const small=await page.evaluate(()=>{const p=document.querySelector('.viewport').getBoundingClientRect(),c=document.querySelector('#countdown').getBoundingClientRect(),b=document.querySelector('#reset').getBoundingClientRect();return {ratio:p.height/innerHeight,countTop:c.top,buttonBottom:b.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(small.ratio>=.45&&small.ratio<=.55&&small.countTop>=0&&small.buttonBottom<=small.height&&!small.overflow);
  await page.screenshot({path:`${out}/${name.toLowerCase()}-320x568-measuring.png`});
  await page.setViewportSize({width:390,height:844});

  await page.clock.runFor(8000);assert.ok(Number(await page.locator('#countdown').innerText())<40);
  await page.evaluate(()=>window.acq.mode='no_face');await page.clock.runFor(500);
  assert.equal(await page.locator('#countdown').innerText(),'45');
  await page.evaluate(()=>window.acq.mode='aligned');await page.clock.runFor(3000);
  await page.evaluate(()=>{window.acq.frozen=performance.now()/1000;window.acq.mode='frozen';});await page.clock.runFor(600);
  assert.equal(await page.locator('#countdown').innerText(),'45');
  await page.evaluate(()=>window.acq.mode='aligned');await page.clock.runFor(48000);
  assert.equal(await page.locator('#countdown').innerText(),'0');assert.equal(await page.locator('#countdown').isVisible(),true);assert.equal(await page.locator('#bpm').innerText(),'—');
  assert.equal(await page.evaluate(()=>document.querySelector('video').srcObject),null);
  let rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1')));
  const end=rows.filter(r=>r.record_type==='session_end').at(-1),windowRow=rows.filter(r=>r.record_type==='window').at(-1);
  assert.equal(end.stop_reason,'measurement_complete');assert.ok(end.effective_seconds>=45);assert.ok(end.valid_sample_count>=540);assert.ok(end.roi_samples>540);assert.ok(end.frames_submitted>540);assert.ok(end.alignment_resets>=2);assert.ok(end.aligned_at&&end.measurement_started_at&&end.stopped_at&&end.commit_sha);
  assert.equal(windowRow.bpm,null);assert.ok(rows.filter(r=>r.record_type==='measurement_reset').some(r=>r.reason==='sampling_gap'));assert.equal(windowRow.status,'insufficient_signal');assert.ok(rows.filter(r=>r.record_type==='telemetry').length>=45);
  await writeFile(`${out}/${name.toLowerCase()}-ENGINEERING-ONLY-session.json`,JSON.stringify(rows,null,2));
  await page.screenshot({path:`${out}/${name.toLowerCase()}-45s-rejected-result.png`,fullPage:true});
  const dl=page.waitForEvent('download');await page.locator('#export').click();const csv=await readFile(await (await dl).path(),'utf8');for(const field of ['commit_sha','effective_seconds','roi_samples','measurement_complete'])assert.ok(csv.includes(field));
  const jd=page.waitForEvent('download');await page.locator('#export-json').click();assert.equal(JSON.parse(await readFile(await (await jd).path(),'utf8')).length,rows.length);
  await page.locator('#subject').fill('P002');await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('#placeholder').hidden);await page.clock.runFor(3000);assert.ok(Number(await page.locator('#countdown').innerText())>=43);await page.locator('#stop').click();
  await page.evaluate(()=>window.acq.mode='error');await page.locator('#reset').click();await page.clock.runFor(1000);assert.ok((await page.locator('#reason').innerText()).includes('model_error'));
  await page.evaluate(()=>window.acq.mode='aligned');await page.locator('#reset').click();await page.clock.runFor(3000);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(()=>window.acq.tracks.every(t=>t.readyState==='ended')),true);assert.deepEqual(errors,[]);
  results.push({name,status:'PASS',elapsed_ms:Date.now()-started,layout,small,final:{effective_seconds:end.effective_seconds,valid_samples:end.valid_sample_count,frames:end.frames_submitted,resets:end.alignment_resets,rejection:windowRow.reason},evidence:'ENGINEERING_FAULT_INJECTION_ONLY'});
  console.log(`PASS ${name} 45s alignment/countdown/reset/stop/export/layout; NOT HUMAN TEST`);
 }catch(e){results.push({name,status:'FAIL',error:e.stack});console.error(e);process.exitCode=1;}finally{await browser.close();}
}
await writeFile(`${out}/measurement-results.json`,JSON.stringify({iphone:'DEVICE_TEST_REQUIRED',human_accuracy:'NOT_VALIDATED',results},null,2));
