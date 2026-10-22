"""One offline engineering command; genuine-data acceptance remains BLOCKED.

Reruns existing PR6 adversarial cases once (no expanded synthetic benchmark).
All subcommands retain stdout/stderr, elapsed time and actual return codes.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

p=argparse.ArgumentParser(__doc__);p.add_argument('--out',default='outputs/phase4-validation')
a=p.parse_args();root=Path(__file__).resolve().parent.parent;out=Path(a.out).resolve()
out.mkdir(parents=True,exist_ok=False);commands=[]


def call(args,log,expected):
    tick=time.perf_counter()
    result=subprocess.run([sys.executable,*args],cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace')
    (out/log).write_text('$ python '+' '.join(args)+'\n'+result.stdout+result.stderr+f'\nEXIT_CODE={result.returncode}\n',encoding='utf-8')
    commands.append(dict(command=args,exit_code=result.returncode,elapsed_s=time.perf_counter()-tick,log=log))
    (out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n',encoding='utf-8')
    if result.returncode not in expected:raise SystemExit('Unexpected failure: '+str(out/log))


call(['-m','pip','freeze'],'environment.freeze.txt',{0})
call(['-m','pytest','-q'],'pytest.log',{0})
call(['-m','benchmark.ingest_ubfc','docs/phase4-empty-plan.json','--out',str(out/'real-preflight')],
     'real-preflight.log',{1})
inventory=json.loads((out/'real-preflight/inventory.json').read_text())
assert inventory['status']=='BLOCKED' and inventory['real_evaluated_recordings']==0
assert not (out/'real-preflight/manifest.json').exists()
assert len(inventory['algorithms'])==6 and all(s['status']=='NOT_RUN' for s in inventory['algorithms'].values())

call(['-m','benchmark.adversarial','--out',str(out/'pr6-regression')],'pr6-regression.log',{1})
result=json.loads((out/'pr6-regression/summary.json').read_text())
assert result['rows']==624, 'Do not expand simulation volume in place of real evidence'
for m in result['metrics']:
    if m['algorithm'] in ('POS','CHROM') and m['split']=='test':
        assert m['positive_metrics']['valid_windows']==6
        assert (m['false_accepts'],m['negative_windows'])==(6,72)
rows=[json.loads(s) for s in (out/'pr6-regression/windows.jsonl').read_text().splitlines()]
assert not any(r['status']=='failed' for r in rows)
for row in rows:
    if row['algorithm'] in ('POS','CHROM') and row['case'] in ('second_harmonic','mixed_motion','no_pulse'):
        assert row['status']=='insufficient_signal' and row['predicted_bpm'] is None

# Unrun real evaluation has no fake window rows and no zero-valued error metrics.
keys=('mae_bpm','rmse_bpm','bias_bpm','absolute_error_p50_bpm','absolute_error_p90_bpm',
      'absolute_error_p95_bpm','coverage','rejection_rate','negative_false_accept_rate',
      'inference_latency_s','throughput_windows_s','subject_cluster_ci95')
summary=dict(status='BLOCKED',real_recordings=0,real_subjects=0,real_windows=0,
             reason='No approved real recordings in the supplied empty plan; no real evaluation run',
             algorithms={n:dict(status='NOT_RUN',reason=state['reason'],metrics={k:None for k in keys})
                         for n,state in inventory['algorithms'].items()})
(out/'real-results.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
(out/'real-windows.jsonl').write_text('',encoding='utf-8')
with (out/'real-windows.csv').open('w',newline='',encoding='utf-8') as f:
    csv.writer(f).writerow(['algorithm','anonymous_subject_id','recording_id','window_start_s','status','reference_bpm','predicted_bpm','reason'])
files=[*root.glob('benchmark/*.py'),*root.glob('scripts/*.py'),*root.glob('tests/*.py'),root/'requirements-benchmark.lock']
hashes={p.relative_to(root).as_posix():hashlib.sha256(p.read_text(encoding='utf-8-sig').encode('utf-8')).hexdigest() for p in files}
(out/'source-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n',encoding='utf-8')
(out/'gate-status.json').write_text(json.dumps(dict(engineering='PASS',physiological_acceptance='BLOCKED',
    quality_threshold_calibration='NOT_RUN: no real validation subjects',synthetic_regression='unchanged PR6 6/72 false accepts per baseline',
    quality_source_sha256=hashes['benchmark/quality.py']),indent=2)+'\n',encoding='utf-8')
print('PASS engineering checks only. Real-data acceptance BLOCKED. No threshold tuning; no merge.')
