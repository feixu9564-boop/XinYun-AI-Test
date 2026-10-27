import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyze,spectrum} from '../web/signal.js';
import {FIELDS,toCSV} from '../web/records.js';
import {fixture,conditions} from '../scripts/synthetic-fixtures.mjs';
const previousFields=["schema_version","record_type","session_id","subject_id","recorded_at","window_start","window_end","sample_start","sample_end","status","reason","bpm","pos_bpm","chrom_bpm","quality","fps","sample_count","reference_id","reference_bpm","reference_observed_at","reference_recorded_at","reference_match","algorithm_version","user_agent","camera_width","camera_height","camera_facing","capture_version","stop_reason","scheduler_source","video_callbacks","frames_submitted","model_completions","model_results","face_frames","pending_inference_ms","last_video_time","video_ready_state","video_paused","document_visibility","preview_visible","last_sample_reason","app_version","commit_sha","aligned_at","measurement_started_at","stopped_at","measurement_phase","effective_seconds","countdown_seconds","valid_sample_count","alignment_resets","measurement_fps","roi_samples","decoded_frames","presented_frames","media_time","inference_ms","inference_errors","invalid_frames","roi_status","interruption_reason","paused_at","reset_at","countdown_before_reset","previous_effective_seconds","previous_valid_samples","final_reason","pos_reason","chrom_reason","cleanup_errors"];
const summaryFields=["pos_peak_bpm", "pos_concentration", "pos_secondary_ratio", "pos_secondary_bpm", "pos_subharmonic_ratio", "pos_subharmonic_bpm", "chrom_peak_bpm", "chrom_concentration", "chrom_secondary_ratio", "chrom_secondary_bpm", "chrom_subharmonic_ratio", "chrom_subharmonic_bpm", "spectral_bin_bpm", "analysis_sample_count", "analysis_fs", "analysis_duration"];
const snapshot=JSON.parse(fs.readFileSync(new URL('./fixtures/decisions-f73adc3.json',import.meta.url)));
const decisionKeys=['reliable','bpm','pos','chrom','score','reason','pos_reason','chrom_reason'];
const decisions=r=>Object.fromEntries(decisionKeys.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));

test('spectral summaries are available without diagnostics and absent evaluations are null',()=>{
  for(const diagnostics of [false,true]){
    const accepted=analyze(fixture(120,'normal'),{diagnostics});
    const competing=analyze(fixture(75,'noise'),{diagnostics});
    assert.equal(accepted.reliable,true);
    assert.ok(['competing_periodicity','diffuse_spectrum'].includes(competing.reason));
    for(const result of [accepted,competing]){
      for(const key of summaryFields){
        assert.ok(Object.hasOwn(result,key),key);
        if(key.endsWith('_subharmonic_bpm')&&result[key]===null)continue;
        assert.ok(Number.isFinite(result[key]),key);
      }
      for(const m of ['pos','chrom']){
        assert.ok(result[m+'_peak_bpm']>=42&&result[m+'_peak_bpm']<=180);
        for(const k of ['concentration','secondary_ratio','subharmonic_ratio'])assert.ok(result[m+'_'+k]>=0);
      }
      assert.equal(result.analysis_sample_count,321);
      assert.equal(result.analysis_fs,20);
      assert.equal(result.analysis_duration,16);
      assert.equal(result.spectral_bin_bpm,20/321*60);
    }
    assert.equal(analyze(fixture(75,'normal'),{diagnostics}).pos_subharmonic_bpm,null);
    assert.ok(Number.isFinite(accepted.pos_subharmonic_bpm));
    const flat=analyze(fixture(75,'flat'),{diagnostics});
    for(const key of summaryFields)assert.equal(flat[key],null,key);
  }
  for(const wave of [[],Array(100).fill(0),Array(100).fill(NaN)]){
    const s=spectrum(wave,20);
    assert.equal(s.bpm,null);
    assert.equal(s.peakBpm,undefined);
  }
  const wave=Array.from({length:320},(_,i)=>Math.sin(2*Math.PI*1.25*i/20));
  const plain=spectrum(wave,20),diagnostic=spectrum(wave,20,{diagnostics:true});
  assert.equal(plain.peakBpm,plain.candidateBpm);
  assert.equal(plain.secondaryBpm,diagnostic.secondaryPeak?.f*60||null);
  assert.equal(plain.subharmonicBpm,diagnostic.subharmonicPeak?.f*60||null);
  assert.equal(plain.sampleCount,320);
  assert.equal(plain.binBpm,20/320*60);
});

test('every synthetic matrix decision matches the unmodified f73adc3 snapshot',()=>{
  let index=0,adequate=0,acceptedWithinFive=0,negatives=0,falseAccepts=0;
  function check(duration,bpm,condition,seed=12026,negative=false){
    const samples=fixture(bpm,condition,duration,seed);
    const expected=snapshot[index++];
    assert.equal(expected.duration,duration);
    assert.equal(expected.condition,condition);
    for(const diagnostics of [false,true])assert.deepEqual(decisions(analyze(samples,{diagnostics})),decisions(expected),`${duration}s ${bpm} ${condition} ${seed} diagnostics=${diagnostics}`);
    if(!negative&&['normal','weak','drift','jitter'].includes(condition)){
      adequate++;
      if(expected.reliable&&Math.abs(expected.bpm-bpm)<=5)acceptedWithinFive++;
    }
    if(negative){negatives++;if(expected.reliable)falseAccepts++;}
  }
  for(const duration of [16,45])for(const bpm of [60,75,90,120])for(const condition of conditions)check(duration,bpm,condition);
  for(const duration of [16,45])for(const condition of ['flat','white_noise','colored_noise','motion_only','periodic_light','out_of_band'])for(const seed of condition==='flat'?[12026]:[12026,12027,12028,12029])check(duration,75,condition,seed,true);
  assert.equal(index,snapshot.length);
  assert.equal(adequate,32);
  assert.equal(acceptedWithinFive,32);
  assert.equal(negatives,42);
  assert.equal(falseAccepts,0);
});

test('CSV preserves the previous columns and appends nullable spectral fields',()=>{
  assert.deepEqual(FIELDS.slice(0,previousFields.length),previousFields);
  assert.deepEqual(FIELDS.slice(previousFields.length),summaryFields);
  const row=Object.fromEntries(summaryFields.map(k=>[k,null]));
  const csv=toCSV([row]);
  const [header,line]=csv.replace(/^\uFEFF/,'').trimEnd().split('\r\n');
  assert.equal(header,FIELDS.join(','));
  assert.deepEqual(line.split(',').slice(previousFields.length),summaryFields.map(()=>'""'));
  const numeric=toCSV([{...row,pos_peak_bpm:75}]).split('\r\n')[1].split(',');
  assert.equal(numeric[FIELDS.indexOf('pos_peak_bpm')],'"75"');
});
