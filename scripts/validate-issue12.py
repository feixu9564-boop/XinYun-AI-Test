"""Run all requested local validations; retain real exit codes, including environment failures."""
import json
from pathlib import Path
import subprocess
import sys
import time

out = Path('docs/issue-12-artifacts/validation'); out.mkdir(parents=True, exist_ok=True)
results = []

def run(name, command, timeout=180):
    try:
        r = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        text = r.stdout+r.stderr
        status = 'PASS' if r.returncode==0 else 'ENVIRONMENT_BLOCKED' if 'EPERM' in text or 'Operation not permitted' in text else 'FAIL'
        code = r.returncode
    except subprocess.TimeoutExpired as e:
        status, code, text = 'TIMEOUT', None, str(e)
    (out/f'{name}.log').write_text(text)
    results.append(dict(name=name,command=command,status=status,exitCode=code,log=str(out/f'{name}.log')))
    print(name, status, code, flush=True)

run('npm-test', ['npm','test'])
# Node's sandboxed --test IPC reports file-level counts here. Direct invocation
# also records all named assertions and their true TAP counts.
for path in sorted(Path('tests').glob('*.test.js')): run('direct-'+path.stem, ['node',str(path)])
run('pytest', [sys.executable,'-m','pytest','-q'])
run('parity', [sys.executable,'scripts/check-mobile-parity.py'])
run('reference', [sys.executable,'scripts/check-issue12-reference.py'])
run('build', ['npm','run','build'])
with (out/'server.log').open('w') as log:
    server = subprocess.Popen(['npm','start'], stdout=log, stderr=log, start_new_session=True)
    try:
        time.sleep(.5)
        if server.poll() is not None:
            results.append(dict(name='server',command=['npm','start'],status='ENVIRONMENT_BLOCKED' if 'EPERM' in (out/'server.log').read_text() else 'FAIL',exitCode=server.returncode,log=str(out/'server.log')))
        else: results.append(dict(name='server',command=['npm','start'],status='STARTED',log=str(out/'server.log')))
        run('mobile-browser', ['node','tests/mobile-browser.mjs'], timeout=900)
        run('measurement-browser', ['node','tests/measurement-browser.mjs'], timeout=900)
    finally:
        if server.poll() is None:
            import os
            import signal
            os.killpg(server.pid, signal.SIGTERM)
            server.wait(timeout=5)
(out/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({status:sum(r['status']==status for r in results) for status in sorted({r['status'] for r in results})}), flush=True)
raise SystemExit(1 if any(r['status'] in ('FAIL','ENVIRONMENT_BLOCKED','TIMEOUT') for r in results) else 0)
