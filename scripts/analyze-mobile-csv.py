"""Audit a locally exported mobile CSV; no network, video or synthetic generation."""
import argparse
from collections import Counter
import csv
from datetime import datetime
import json
import math
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from benchmark.metrics import metrics

def seconds(value):
    try:
        t=datetime.fromisoformat(value.replace('Z','+00:00'))
        return t.timestamp() if t.tzinfo else None
    except (ValueError, AttributeError): return None

def number(value):
    try:
        v=float(value)
        return v if math.isfinite(v) else None
    except (ValueError, TypeError): return None

def analyze(rows):
    if any(str(r.get('schema_version'))!='1' for r in rows):
        raise ValueError('Unsupported schema_version')
    windows=[r for r in rows if r['record_type']=='window']
    refs={}
    for r in rows:
        if r['record_type']=='reference':
            if not r.get('reference_id') or r['reference_id'] in refs: raise ValueError('Missing/duplicate reference ID')
            refs[r['reference_id']]=r
    accepted=[r for r in windows if r['status']=='accepted' and number(r['bpm']) is not None]
    pairs=[]
    for r in accepted:
        ref=refs.get(r.get('reference_id'))
        if not ref: continue
        if (ref['session_id'],ref['subject_id'])!=(r['session_id'],r['subject_id']): continue
        start,end,observed=map(seconds,(r.get('sample_start'),r.get('sample_end'),ref.get('reference_observed_at')))
        reference=number(ref.get('reference_bpm'))
        if None in (start,end,observed,reference): continue
        if not (start<=observed<=end and abs(observed-(start+end)/2)<=2 and 30<=reference<=240): continue
        # Verify denormalized exported reference fields against original event.
        if number(r.get('reference_bpm'))!=reference or r.get('reference_observed_at')!=ref.get('reference_observed_at'): continue
        pairs.append(dict(status='ok',predicted_bpm=number(r['bpm']),reference_bpm=reference,inference_s=0))
    result=metrics(pairs)
    for key in ('coverage','failure_rate','rejection_rate','blocked_rate','mean_inference_s','total_windows','valid_windows'):
        result.pop(key,None)
    n=len(windows)
    return dict(source='USER_SUPPLIED_CSV; physical provenance not independently verified',
        total_windows=n,accepted_windows=len(accepted),paired_accepted_windows=len(pairs),unpaired_accepted_windows=len(accepted)-len(pairs),
        output_coverage=len(accepted)/n if n else None,
        rejection_rate=sum(r['status']=='insufficient_signal' for r in windows)/n if n else None,
        reasons=dict(Counter(r.get('reason','') for r in windows if r['status']!='accepted')),
        session_end_reasons=dict(Counter(r.get('reason','') for r in rows if r['record_type']=='session_end')),
        error_metrics=result,
        caveats=['Only same-session/subject reference observations inside the actual sample interval and within 2 s of midpoint enter errors.',
                 'An instant manually entered device reading is not a synchronized continuous PPG mean; observer and device lag remain.',
                 '16-second windows overlap at 4-second stride; window errors are descriptive, not independent samples.',
                 'No raw video is needed or uploaded. No medical or physiological validity claim.'])

if __name__=='__main__':
    p=argparse.ArgumentParser(__doc__);p.add_argument('csv');p.add_argument('--out',required=True);args=p.parse_args()
    with open(args.csv,encoding='utf-8-sig',newline='') as f: result=analyze(list(csv.DictReader(f)))
    out=Path(args.out)
    if out.exists(): raise SystemExit('Refusing to overwrite report')
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))
