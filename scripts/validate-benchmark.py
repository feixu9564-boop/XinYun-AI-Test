"""Reproducible engineering checks, followed by synthetic smoke and full fixture run."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

p=argparse.ArgumentParser(__doc__)
p.add_argument('--out', default='outputs/validation')
p.add_argument('--toolbox')
p.add_argument('--acknowledge-toolbox-license', action='store_true')
a=p.parse_args()
root=Path(__file__).resolve().parent.parent
out=Path(a.out).resolve()
out.mkdir(parents=True,exist_ok=False)
commands=[]


def call(arguments, filename, expected):
    result=subprocess.run([sys.executable,*arguments], cwd=root, capture_output=True,text=True)
    (out/filename).write_text('$ python '+ ' '.join(arguments)+'\n'+result.stdout+result.stderr+f'\nEXIT_CODE={result.returncode}\n')
    commands.append(dict(command=arguments,exit_code=result.returncode,log=filename))
    (out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
    if result.returncode not in expected:
        raise SystemExit(f'Unexpected failure; see {out/filename}')


call(['-m','pytest','-q'],'pytest.log',{0})
call(['-m','benchmark.spectral_check','--out',str(out/'spectral.json')],'spectral.log',{0})
call(['-m','benchmark.adversarial','--out',str(out/'adversarial')],'adversarial.log',{1})
adversarial=json.loads((out/'adversarial/summary.json').read_text())
adversarial_rows=[json.loads(s) for s in (out/'adversarial/windows.jsonl').read_text().splitlines()]
if any(r['status']=='failed' or (r['status']!='ok' and r['predicted_bpm'] is not None) for r in adversarial_rows):
    raise SystemExit('Unexpected adversarial inference failure or leaked rejected BPM')
for m in adversarial['metrics']:
    if m['algorithm'] in ('POS','CHROM'):
        if m['positive_metrics']['coverage'] != 1 or m['false_accept_rate'] > .09:
            raise SystemExit('Adversarial coverage/regression failed; see retained evidence')
    elif m['status'] != 'NOT_RUN':
        raise SystemExit('Unexpected synthetic deep model status')
if a.toolbox and a.acknowledge_toolbox_license:
    call(['-m','benchmark.parity','--toolbox',a.toolbox,'--acknowledge-toolbox-license',
          '--out',str(out/'parity.json')],'parity.log',{0})
with tempfile.TemporaryDirectory(prefix='xinyun-engineering-') as tmp:
    fixture=Path(tmp)/'fixture'
    call(['-m','benchmark.fixture','--out',str(fixture)],'fixture.log',{0})
    extra=['--toolbox',a.toolbox] if a.toolbox else []
    if a.acknowledge_toolbox_license:
        extra+=['--acknowledge-toolbox-license']
    for mode in ('smoke','full'):
        target=out/mode
        call(['-m','benchmark.run',str(fixture/'manifest.json'),'--out',str(target),
              *(['--smoke'] if mode=='smoke' else []),*extra],mode+'.log',{1})
        summary=json.loads((target/'summary.json').read_text())
        windows=[json.loads(s) for s in (target/'windows.jsonl').read_text().splitlines()]
        if any(r['status']=='failed' for r in windows):
            raise SystemExit(f'Unexpected model inference failure: {target}')
        totals={m['algorithm']:m for m in summary['metrics'] if m['group']=='all'}
        expected=2 if mode=='smoke' else 3
        if any(totals[n]['valid_windows']!=expected for n in ('POS','CHROM')):
            raise SystemExit(f'Unexpected baseline coverage: {target}')
        print(mode,':',len(windows),'rows; expected blocked/rejected rows retained')
(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
print('PASS engineering validation. Synthetic only; blocked models are not passed models.')
