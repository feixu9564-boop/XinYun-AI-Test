import test from 'node:test';
import assert from 'node:assert/strict';
import {Measurement} from '../web/measurement.js';
function aligned(){const m=new Measurement();for(let i=0;i<=31;i++)m.observe(i/20);return m;}
test('permission/loading/wall waiting never contributes effective time',()=>{const m=new Measurement();m.poll(90);assert.equal(m.effective,0);assert.equal(m.phase,'aligning');});
test('single stable face starts only after 1.5s then counts 45 to 0 from samples',()=>{
 const m=aligned();assert.equal(m.phase,'measuring');assert.equal(m.effective,0);
 const digits=new Set([45]);let completed=false;
 for(let i=32;i<=931;i++){const e=m.observe(i/20);digits.add(m.snapshot().countdown_seconds);completed ||=!!e.complete;}
 assert.equal(completed,true);assert.equal(m.effective,45);assert.equal(m.count,901);
 assert.deepEqual([...digits],Array.from({length:46},(_,i)=>45-i));
});
test('brief face loss freezes countdown with cause, then explicitly restarts a fresh window',()=>{
 const m=aligned();for(let i=32;i<=200;i++)m.observe(i/20);const before=m.snapshot();
 const event=m.observe(10.05,'no_face');assert.equal(event.paused,true);assert.equal(m.phase,'paused');assert.equal(m.effective,0);assert.equal(m.fps,0);assert.equal(event.interruption.fps,before.measurement_fps);assert.equal(m.snapshot().countdown_seconds,before.countdown_seconds);
 m.observe(10.10);assert.equal(m.reason,'no_face');assert.equal(m.phase,'paused');
 for(let i=203;i<=240;i++)m.observe(i/20);assert.equal(m.phase,'paused');
 let reset;for(let i=241;i<=244;i++){const e=m.observe(i/20);if(e.reset)reset=e;}
 assert.equal(m.phase,'measuring');assert.equal(reset.interruption.reason,'no_face');assert.equal(reset.interruption.countdown,before.countdown_seconds);assert.ok(m.effective<.2);assert.equal(m.resets,1);
});
test('event-loop gap pauses without fake completion or silent reset',()=>{const m=aligned();const before=m.snapshot();assert.equal(m.poll(60).paused,true);assert.equal(m.effective,0);assert.equal(m.phase,'paused');assert.equal(m.snapshot().countdown_seconds,before.countdown_seconds);m.observe(61);assert.equal(m.phase,'paused');assert.equal(m.reason,'sampling_gap');});
test('repeated invalid samples preserve first cause and do not repeatedly reset',()=>{const m=aligned();m.observe(1.6,'no_face');const at=m.invalidSince;for(let i=33;i<90;i++)m.observe(i/20,'no_face');assert.equal(m.invalidSince,at);assert.equal(m.resets,0);assert.equal(m.phase,'paused');});
test('low FPS during measurement pauses and keeps the low-FPS cause',()=>{const m=aligned();for(let i=1;i<=25;i++)m.observe(1.55+i/10);assert.equal(m.phase,'paused');assert.equal(m.reason,'low_fps');assert.equal(m.effective,0);});
test('low FPS and duplicate/out-of-order capture times cannot complete',()=>{const m=new Measurement();for(let i=0;i<500;i++)m.observe(i/10);assert.equal(m.effective,0);assert.equal(m.phase,'aligning');const n=m.count;m.observe(49.9);m.observe(1);assert.equal(m.count,n);});
test('bad exposure, multiple faces and pose keep clock at 45',()=>{for(const reason of ['exposure','multiple_faces','face_pose']){const m=aligned();m.observe(1.65,reason);assert.equal(m.snapshot().countdown_seconds,45);assert.equal(m.reason,reason);}});
