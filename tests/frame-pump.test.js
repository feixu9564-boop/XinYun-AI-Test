import test from 'node:test';
import assert from 'node:assert/strict';
import {FramePump} from '../web/frame-pump.js';
function harness(process=async()=>{}){
  let time=0,cb,calls=0;
  const video={readyState:4,paused:false,videoWidth:640,videoHeight:480,currentTime:0,
    requestVideoFrameCallback(fn){cb=fn;return 1;},cancelVideoFrameCallback(){}};
  const pump=new FramePump(video,async t=>{calls++;return process(t);},()=>{}, {now:()=>time,raf:()=>1,cancel:()=>{}});pump.start();
  return {video,pump,get calls(){return calls;},emit(meta){cb(0,meta);},async tick(t,media=t){time=t;video.currentTime=media;pump.tick();await new Promise(r=>setImmediate(r));}};
}
test('stalled callback falls back only when media time advances',async()=>{
  const h=harness();h.emit({mediaTime:0,presentedFrames:1});await h.tick(.01,0);assert.equal(h.calls,1);
  await h.tick(.3,.3);assert.equal(h.calls,1);
  await h.tick(.6,.6);await h.tick(.7,.7);assert.equal(h.calls,3);assert.equal(h.pump.stats.scheduler_source,'media_time_fallback');
  await h.tick(.9,.7);assert.equal(h.calls,3);h.pump.stop();
});
test('frozen decoded counter overrides an advancing media clock',async()=>{
  const h=harness();let decoded=1;h.video.getVideoPlaybackQuality=()=>({totalVideoFrames:decoded});
  await h.tick(.01);await h.tick(1);assert.equal(h.calls,1);decoded=2;await h.tick(1.1);assert.equal(h.calls,2);
});
test('missing metadata uses actual currentTime; never undefined-equality deadlock',async()=>{
  const h=harness();h.emit({});await h.tick(.01,.01);h.emit({});await h.tick(.1,.1);assert.equal(h.calls,2);
  h.emit({});await h.tick(.2,.1);assert.equal(h.calls,2);
});
test('constant media timestamp with advancing presented frames keeps sampling',async()=>{
  const h=harness();h.emit({mediaTime:0,presentedFrames:1});await h.tick(.01,0);
  h.emit({mediaTime:0,presentedFrames:2});await h.tick(.1,0);assert.equal(h.calls,2);
});
test('hung model remains serialized, timeout diagnostic differs from video stall',async()=>{
  let finish;const h=harness(()=>new Promise(r=>finish=r));h.emit({mediaTime:0});await h.tick(.01,0);
  await h.tick(1,1);assert.equal(h.calls,1);assert.equal(h.pump.timeoutReason(1),'model_timeout');assert.ok(h.pump.snapshot().pending_inference_ms>900);
  h.pump.stop();finish();await h.tick(2);assert.equal(h.calls,1);assert.equal(h.pump.stats.model_completions,0);
});
test('frozen video never acquires invented samples, and stopped callbacks cannot resume',async()=>{
  const h=harness();h.emit({mediaTime:0});await h.tick(.01,0);await h.tick(1,0);await h.tick(9,0);
  assert.equal(h.calls,1);assert.equal(h.pump.timeoutReason(1),'video_frame_stalled');
  h.pump.stop();h.emit({mediaTime:10});await h.tick(10,10);assert.equal(h.calls,1);
});
