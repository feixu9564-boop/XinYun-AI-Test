// Browser engineering only. Fake cameras / injected lifecycle faults are NOT
// human recordings, mobile devices, face-recognition accuracy or HR validation.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const url=process.env.TEST_URL||'http://127.0.0.1:4173',out=process.env.TEST_OUT||'test-results/mobile';
await mkdir(out,{recursive:true});const results=[];
async function scenario(name,fn){const start=Date.now();try{await fn();results.push({name,status:'PASS',elapsed_ms:Date.now()-start});console.log(`PASS ${name}`);}catch(e){results.push({name,status:'FAIL',error:e.stack});console.error(`FAIL ${name}: ${e.stack}`);process.exitCode=1;}}
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
await scenario('Chromium real bundled FaceMesh/WASM: fake no-face camera, 16s failed window, CSV, stop/restart',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera']});
  try{const page=await context.newPage(),errors=[],external=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(url+'/'))external.push(r.url());if(r.method()!=='GET')requests.push(r.method()+' '+r.url());});
    await page.goto(url);await page.locator('#consent').check();await page.locator('#start').click();
    await page.waitForFunction(()=>document.querySelector('#face').textContent==='未检测到人脸',null,{timeout:45000});
    assert.equal(await page.locator('#bpm').innerText(),'—');
    await page.locator('#reference').fill('72');await page.locator('#save-reference').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1')).some(r=>r.record_type==='window'),null,{timeout:25000});
    const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinyun-mobile-v1')));
    const windows=rows.filter(r=>r.record_type==='window');assert.ok(windows.length);assert.ok(windows.every(r=>r.bpm==null&&r.status==='insufficient_signal'));
    await page.locator('#stop').click();assert.equal(await page.evaluate(()=>document.querySelector('video').srcObject),null);
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
      await page.locator('#reference').fill('72');await page.locator('#save-reference').click();
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await page.evaluate(()=>window.cameraTest.tracks.every(t=>t.readyState==='ended')),true);
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
}
await writeFile(`${out}/results.json`,JSON.stringify({evidence:'ENGINEERING_ONLY; no human or physical phone tests',iphone:'DEVICE_TEST_REQUIRED',android:'DEVICE_TEST_REQUIRED',results},null,2));
if(process.exitCode)process.exit(process.exitCode);
