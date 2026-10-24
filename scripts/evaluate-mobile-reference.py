"""Local consented human diagnostic/reference evaluation. Never uploads inputs.

Manifest rows require diagnostic_file, provenance='human', reference_device,
reference_bpm, reference_observed_at (ISO), conditions and label_provenance.
No reference value is passed into the camera estimator. Rejected attempts stay
in denominators. Missing inputs produce BLOCKED, not zero error or success.
"""
import argparse
from datetime import datetime
import hashlib
import math
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from benchmark.metrics import summarize


def evaluate(manifest):
    rows=[];audit=[]
    for item in manifest.get('sessions',[]):
        if item.get('provenance')!='human' or not item.get('reference_device') or not item.get('label_provenance'):
            raise ValueError('Require human provenance, independent device and label provenance')
        path=Path(item['diagnostic_file']);raw=path.read_bytes();d=json.loads(raw)
        if d.get('schema')!='xinyun-diagnostics-v1' or d.get('truncated'):
            raise ValueError('Require complete diagnostic export')
        if not d.get('commit_sha') or d['commit_sha']=='LOCAL_UNCOMMITTED':
            raise ValueError('Require a versioned measurement')
        candidates=[r for r in d.get('records',[]) if r.get('record_type')=='window']
        if len(candidates)!=1:raise ValueError('Require one final or stopped window per session')
        window=candidates[0]
        ref=float(item['reference_bpm'])
        if not 30<=ref<=240:raise ValueError('invalid reference')
        matched=False
        if window.get('sample_start') and window.get('sample_end'):
            stamp=lambda s:datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
            mid=(stamp(window['sample_start'])+stamp(window['sample_end']))/2
            matched=abs(stamp(item['reference_observed_at'])-mid)<=2
        accepted=window.get('status')=='accepted' and isinstance(window.get('bpm'),(int,float)) and math.isfinite(window['bpm'])
        rows.append(dict(subject_id=d['subject_id'],algorithm=d['algorithm_version'],conditions=item.get('conditions',{}),status='ok' if accepted and matched else 'blocked' if not matched else 'rejected',predicted_bpm=window.get('bpm') if accepted and matched else None,reference_bpm=ref,inference_s=0))
        audit.append(dict(session_id=d['session_id'],file_sha256=hashlib.sha256(raw).hexdigest(),matched_reference=matched,accepted_output=accepted,reason=window.get('reason')))
    return dict(status='OBSERVATIONAL_RESULTS_NOT_ACCEPTANCE' if rows else 'BLOCKED_NO_PAIRED_HUMAN_DATA',human_sessions=len(rows),metrics=summarize(rows),mae_bpm=None if not rows else 'see grouped metrics',coverage=None if not rows else sum(a['accepted_output'] for a in audit)/len(rows),wrong_acceptance_definition='absolute error >10 BPM among time-matched accepted outputs; research cutoff, not clinical',reference_rule='actual final-window midpoint +/-2 seconds; unmatched references excluded from errors',strata=['lighting','motion'],audit=audit)


if __name__=='__main__':
    p=argparse.ArgumentParser(__doc__);p.add_argument('--manifest',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    report=evaluate(json.loads(a.manifest.read_text()) if a.manifest else {'sessions':[]})
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
