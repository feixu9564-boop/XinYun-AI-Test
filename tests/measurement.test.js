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
test('missing face resets window; recovery cannot stitch old data',()=>{
 const m=aligned();m.observe(1.65);assert.equal(m.observe(1.7,'no_face').reset,true);assert.equal(m.effective,0);
 for(let i=35;i<=67;i++)m.observe(i/20);assert.equal(m.phase,'measuring');assert.ok(m.effective<.1);assert.equal(m.resets,1);
});
test('event-loop gap cannot fake 45 seconds or complete on poll',()=>{const m=aligned();m.poll(60);assert.equal(m.effective,0);assert.equal(m.phase,'aligning');m.observe(61);assert.equal(m.phase,'aligning');});
test('low FPS and duplicate/out-of-order capture times cannot complete',()=>{const m=new Measurement();for(let i=0;i<500;i++)m.observe(i/10);assert.equal(m.effective,0);assert.equal(m.phase,'aligning');const n=m.count;m.observe(49.9);m.observe(1);assert.equal(m.count,n);});
test('bad exposure, multiple faces and pose keep clock at 45',()=>{for(const reason of ['exposure','multiple_faces','face_pose']){const m=aligned();m.observe(1.65,reason);assert.equal(m.snapshot().countdown_seconds,45);assert.equal(m.reason,reason);}});
