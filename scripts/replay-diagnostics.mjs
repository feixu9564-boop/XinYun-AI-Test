import fs from 'node:fs';
import {analyze,VERSION,POLICY} from '../web/signal.js';
import {BUILD} from '../web/build-info.js';
const path=process.argv[2];if(!path)throw Error('Usage: node scripts/replay-diagnostics.mjs diagnostic.json [output.json]');
const input=JSON.parse(fs.readFileSync(path,'utf8'));
if(input.schema!=='xinyun-diagnostics-v1'||input.timeUnit!=='seconds')throw Error('Unsupported diagnostic schema/time unit');
// Exact recorded windows only. Segment, phase, reason and timestamps must match;
// never silently join samples from before an interruption or invent timestamps.
const windows=input.analyses.map(a=>{
  const selected=input.samples.filter(s=>s.segment===a.segment&&['measuring','complete'].includes(s.phase)&&s.t>=a.start&&s.t<=a.end);
  if(selected.length!==a.sampleCount)throw Error('Window incomplete/truncated: refusing partial replay');
  let result=analyze(selected,{diagnostics:true});
  const analysisReason=result.reason;
  if(a.partial)result={...result,reliable:false,bpm:null,pos:null,chrom:null,score:0,reason:a.stopReason||'window_too_short',diagnostics:{...result.diagnostics,finalReason:a.stopReason||'window_too_short'}};
  result.diagnostics={...result.diagnostics,analysisReason,finalReason:result.reason,gates:[...result.diagnostics.gates,{name:'measurement_complete',value:!a.partial,operator:'==',threshold:true,pass:!a.partial,evaluated:true}]};
  return {...a,result,recordedReason:a.result.reason};
});
const replay={schema:'xinyun-replay-v1',source:path,recordedBuild:{version:input.appVersion,commit:input.commit},replayBuild:BUILD,algorithmVersion:VERSION,policy:POLICY,windows};
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(replay));
for(const w of windows){console.log(`segment ${w.segment}: ${w.result.reason}; BPM=${w.result.bpm??'null'} (recorded ${w.recordedReason})`);console.table(w.result.diagnostics.gates);}
if(!windows.length)throw Error('No recorded analysis windows; no replay performed');
