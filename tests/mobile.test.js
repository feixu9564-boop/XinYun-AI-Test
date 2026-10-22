import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalRecords,makeReference,matchedRows,toCSV,validateSubject,STORAGE_KEY} from '../web/records.js';
import {analyze,spectrum} from '../web/signal.js';
const epoch=Date.parse('2026-10-22T10:00:00Z');
const windowRow={schema_version:1,record_type:'window',session_id:'s',subject_id:'P001',sample_start:new Date(epoch).toISOString(),sample_end:new Date(epoch+16000).toISOString(),status:'insufficient_signal',bpm:null};
const ref=(offset=8000,sessionId='s')=>makeReference({bpm:72,observed:epoch+offset,now:epoch+30000,sessionId,subjectId:'P001',id:'r'});
test('reference pairing uses actual midpoint, session and subject; no retrospective guessing',()=>{
  assert.equal(matchedRows([windowRow,ref()])[0].reference_match,'matched_instant_within_2s');
  for(const r of [ref(12000),ref(8000,'other'),{...ref(),subject_id:'other'}])assert.equal(matchedRows([windowRow,r])[0].reference_match,'unmatched');
  assert.equal(matchedRows([{...windowRow,sample_start:'',sample_end:''},ref()])[0].reference_match,'unmatched');
});
test('manual reference range and future timestamp validation',()=>{
  for(const bpm of [0,NaN,241])assert.throws(()=>makeReference({bpm,observed:epoch,now:epoch}));
  assert.throws(()=>makeReference({bpm:72,observed:epoch+3000,now:epoch}));
});
test('CSV preserves failed windows, timestamps, BOM and escapes formula/text',()=>{
  const csv=toCSV([{...windowRow,reason:'=DANGEROUS(),"quoted"\nline'},ref()]);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=DANGEROUS(),""quoted""\nline"'));
  assert.ok(csv.includes('insufficient_signal'));assert.ok(csv.includes('matched_instant_within_2s'));assert.ok(csv.includes('reference'));
});
test('storage persists reload/clear and preserves memory on quota error',()=>{
  const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const db=new LocalRecords(storage);db.add(windowRow);assert.equal(new LocalRecords(storage).rows.length,1);
  storage.setItem=()=>{throw Error('quota');};db.add(ref());assert.equal(db.rows.length,2);assert.match(db.error,/quota/);db.clear();assert.equal(map.has(STORAGE_KEY),false);
});
test('corrupt storage is protected rather than overwritten',()=>{
  const db=new LocalRecords({getItem:()=>'{invalid',setItem:()=>assert.fail('must not overwrite')});assert.equal(db.readFailed,true);db.add(windowRow);assert.ok(db.error);
});
test('anonymous IDs reject spreadsheet formulas and names with whitespace',()=>{
  assert.equal(validateSubject('P001_A-1'),true);for(const s of ['','=SUM(1)','person name','x'.repeat(33)])assert.equal(validateSubject(s),false);
});
test('missing/no-face/short/constant inputs fail closed',()=>{
  for(const samples of [[],[{t:0},{t:1,reason:'no_face'}],[{t:0,rgb:[100,100,100]},{t:1,rgb:[100,100,100]}]])assert.equal(analyze(samples).bpm,null);
  assert.equal(spectrum(Array(480).fill(0),30).bpm,null);
});
