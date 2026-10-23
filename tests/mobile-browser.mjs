// Browser engineering only. Fake cameras / injected lifecycle faults are NOT
// human recordings, mobile devices, face-recognition accuracy or HR validation.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const url=process.env.TEST_URL||'http://127.0.0.1:4173',out=process.env.TEST_OUT||'test-results/mobile';
await mkdir(out,{recursive:true});const results=[];
async function scenario(name,fn){const start=Date.now();try{await fn();results.push({name,status:'PASS',elapsed_ms:Date.now()-start});console.log(`PASS ${name}`);}catch(e){results.push({name,status:'FAIL',error:e.stack});console.error(`FAIL ${name}: ${e.stack}`);process.exitCode=1;}}
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
await scenario('Chromium real bundled FaceMesh/WASM: fake no-face camera, 16s unaligned telemetry, CSV, stop/restart',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera']});
  try{const page=await context.newPage(),errors=[],external=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(url+'/'))external.push(r.url());if(r.method()!=='GET')requests.push(r.method()+' '+r.url());});
    await page.goto(url);await page.locator('#consent').check();await page.locator('#start').click();
    await page.waitForFunction(()=>document.querySelector('#face').textContent==='未检测到人脸',null,{timeout:45000});
    assert.equal(await page.locator('#bpm').innerText(),'—');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1')).filter(r=>r.record_type==='telemetry').length>=15,null,{timeout:25000});
    await page.locator('#stop').click();
    await page.locator('#reference').fill('72');await page.locator('#save-reference').click();
    const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1')));
    const windows=rows.filter(r=>r.record_type==='window');assert.ok(windows.length);assert.ok(windows.every(r=>r.bpm==null&&r.status==='insufficient_signal'));
    assert.equal(await page.evaluate(()=>document.querySelector('video').srcObject),null);
    const dl=page.waitForEvent('download');await page.locator('#export').click();const file=await dl;const csv=await readFile(await file.path(),'utf8');assert.ok(csv.includes('insufficient_signal'));assert.ok(csv.includes('reference_observed_at'));
    await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('#face').textContent==='未检测到人脸',null,{timeout:45000});
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.evaluate(()=>document.querySelector('video').srcObject),null);
    await page.reload();assert.ok((await page.locator('#record-count').innerText())!=='0 条');
    await page.screenshot({path:`${out}/chromium-mobile-layout.png`,fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}
});
await browser.close();
// Same deterministic lifecycle faults in both engines. Mock only the camera
// hardware and detector, never assert that these are actual phone/face tests.
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  await scenario(`${name} mobile UI lifecycle fault injection, permission, cancellation, background, export`,async()=>{
    const b=await engine.launch({headless:true});
    try{const context=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/vendor/face_mesh/face_mesh.js',route=>route.fulfill({contentType:'text/javascript',body:`window.FaceMesh=class{setOptions(){} onResults(fn){this.cb=fn} async initialize(){} async send(){this.cb({multiFaceLandmarks:[]})} async close(){}};`}));
      await page.addInitScript(()=>{
        window.cameraTest={mode:'denied',tracks:[],constraints:[],count:0};
        const state=window.cameraTest;
        Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async constraints=>{
          state.constraints.push(constraints);if(state.mode==='denied')throw new DOMException('Denied','NotAllowedError');
          if(state.mode==='delayed')await new Promise(r=>setTimeout(r,500));
          const track={readyState:'live',stop(){this.readyState='ended';},getSettings(){return {width:640,height:480,facingMode:'user'};}};
          state.tracks.push(track);return {getVideoTracks:()=>[track],getTracks:()=>[track]};
        }}});
        Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{get(){return this._stream||null;},set(v){this._stream=v;},configurable:true});
        HTMLMediaElement.prototype.play=async function(){};HTMLMediaElement.prototype.pause=function(){};
        // No video frame is emitted: the app must clear BPM on no-frame gaps.
        HTMLVideoElement.prototype.requestVideoFrameCallback=()=>0;HTMLVideoElement.prototype.cancelVideoFrameCallback=()=>{};
      });
      await page.goto(url);await page.locator('#consent').check();await page.locator('#start').click();
      await page.waitForFunction(()=>document.querySelector('#reason').textContent.includes('camera_permission_denied'));
      assert.equal(await page.locator('#bpm').innerText(),'—');assert.equal(await page.locator('#start').isEnabled(),true);
      await page.evaluate(()=>window.cameraTest.mode='delayed');await page.locator('#start').click();await page.locator('#stop').click();
      await page.waitForFunction(()=>window.cameraTest.tracks.length===1&&window.cameraTest.tracks[0].readyState==='ended');
      await page.evaluate(()=>window.cameraTest.mode='ok');await page.locator('#reset').click();
      await page.waitForFunction(()=>document.querySelector('video').srcObject!==null);
      assert.equal(await page.evaluate(()=>window.cameraTest.constraints.at(-1).video.facingMode.ideal),'user');
      assert.equal(await page.evaluate(()=>document.querySelector('video').playsInline&&document.querySelector('video').muted),true);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await page.evaluate(()=>window.cameraTest.tracks.every(t=>t.readyState==='ended')),true);
    await page.locator('#reference').fill('72');await page.locator('#save-reference').click();

      assert.equal(await page.locator('#bpm').innerText(),'—');
      await page.evaluate(()=>Object.defineProperty(document,'hidden',{value:false,configurable:true}));
      await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('video').srcObject!==null);
      await page.evaluate(()=>window.cameraTest.tracks.at(-1).onended());await page.waitForFunction(()=>document.querySelector('#reason').textContent.includes('camera_ended'));
      const dl=page.waitForEvent('download');await page.locator('#export').click();const csv=await readFile(await (await dl).path(),'utf8');assert.ok(csv.includes('camera_permission_denied'));assert.ok(csv.includes('page_hidden'));assert.ok(csv.includes('72'));
      await page.reload();assert.notEqual(await page.locator('#record-count').innerText(),'0 条');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${out}/${name.toLowerCase()}-fault-ui.png`,fullPage:true});
      page.on('dialog',d=>d.accept());await page.locator('#clear').click();assert.equal(await page.locator('#record-count').innerText(),'0 条');assert.deepEqual(errors,[]);
    }finally{await b.close();}
  });

  await scenario(`${name} stalled video-callback recovery, frozen-frame rejection and hung-model diagnostics`,async()=>{
    const b=await engine.launch({headless:true});
    try{
      const context=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/vendor/face_mesh/face_mesh.js',route=>route.fulfill({contentType:'text/javascript',body:`window.FaceMesh=class{setOptions(){} onResults(fn){this.cb=fn} async initialize(){} async send(){this.cb({multiFaceLandmarks:[]});if(window.pumpTest.mode==='hung')await new Promise(()=>{});}async close(){}};`}));
      await page.addInitScript(()=>{
        window.pumpTest={mode:'advancing',callbacks:0};
        const state=window.pumpTest;
        Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
          const track={stop(){},getSettings(){return {width:640,height:480,facingMode:'user'};}};
          return {getTracks:()=>[track],getVideoTracks:()=>[track]};
        }}});
        Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{get(){return this._stream||null;},set(v){this._stream=v;},configurable:true});
        Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{get(){return state.mode==='frozen'?0:performance.now()/1000;},configurable:true});
        Object.defineProperty(HTMLMediaElement.prototype,'readyState',{get(){return 4;},configurable:true});
        Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return !this._stream;},configurable:true});
        Object.defineProperty(HTMLVideoElement.prototype,'videoWidth',{get(){return 640;},configurable:true});
        Object.defineProperty(HTMLVideoElement.prototype,'videoHeight',{get(){return 480;},configurable:true});
        HTMLMediaElement.prototype.play=async function(){};HTMLMediaElement.prototype.pause=function(){};
        HTMLVideoElement.prototype.getVideoPlaybackQuality=undefined;
        Object.defineProperty(HTMLVideoElement.prototype,'webkitDecodedFrameCount',{get(){return undefined;},configurable:true});
        HTMLVideoElement.prototype.requestVideoFrameCallback=function(fn){state.callbacks++;if(state.callbacks===1)setTimeout(()=>fn(performance.now(),{mediaTime:0,presentedFrames:1}),0);return state.callbacks;};
        HTMLVideoElement.prototype.cancelVideoFrameCallback=()=>{};
        const draw=CanvasRenderingContext2D.prototype.drawImage;
        // No pixel fixture or fake HR: model is explicitly no-face. This only
        // exercises asynchronous lifecycle, clock progression and logging.
        CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(!(image instanceof HTMLVideoElement))return draw.call(this,image,...args);};
      });
      await page.goto(url);await page.clock.install();await page.locator('#consent').check();await page.locator('#start').click();
      await page.waitForFunction(()=>document.querySelector('#placeholder').hidden);
      // The camera and controls remain in the fixed measurement viewport.
      assert.equal(await page.evaluate(()=>{const r=document.querySelector('video').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
      await page.clock.runFor(17000);
      let rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1'))),w=rows.filter(r=>r.record_type==='telemetry').at(-1);
      assert.ok(w?.model_results>100);assert.equal(w.scheduler_source,'media_time_fallback');assert.ok(w.bpm==null);assert.equal(w.reason,'no_face');assert.equal(w.effective_seconds,0);assert.equal(w.preview_visible,true);
      await page.locator('#stop').click();
      assert.equal(await page.evaluate(()=>document.body.classList.contains('measuring')),false);
      await page.evaluate(()=>{window.pumpTest.mode='frozen';window.pumpTest.callbacks=0;});await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('#placeholder').hidden);await page.clock.runFor(9500);
      rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1')));
      let end=rows.filter(r=>r.record_type==='session_end').at(-1);assert.equal(end.reason,'video_frame_stalled');assert.equal(end.frames_submitted,1);
      await page.evaluate(()=>{window.pumpTest.mode='hung';window.pumpTest.callbacks=0;});await page.locator('#reset').click();await page.waitForFunction(()=>document.querySelector('#placeholder').hidden);await page.clock.runFor(9500);
      rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1')));end=rows.filter(r=>r.record_type==='session_end').at(-1);
      assert.equal(end.reason,'model_timeout');assert.equal(end.frames_submitted,1);assert.equal(end.model_completions,0);assert.equal(end.model_results,1);assert.ok(end.pending_inference_ms>=8000);
      assert.ok(rows.filter(r=>r.record_type==='window').every(r=>r.bpm==null));
      const dl=page.waitForEvent('download');await page.locator('#export').click();const csv=await readFile(await (await dl).path(),'utf8');assert.ok(csv.includes('capture-v0.6.0'));assert.ok(csv.includes('video_frame_stalled'));assert.ok(csv.includes('model_timeout'));assert.deepEqual(errors,[]);
    }finally{await b.close();}
  });
}
await writeFile(`${out}/results.json`,JSON.stringify({evidence:'ENGINEERING_ONLY; no human or physical phone tests',iphone:'DEVICE_TEST_REQUIRED',android:'DEVICE_TEST_REQUIRED',results},null,2));
if(process.exitCode)process.exit(process.exitCode);

await import('./measurement-browser.mjs');
