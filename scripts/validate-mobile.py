"""Capture reproducible engineering logs; does not use a real camera or person."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]

def main(out):
    out=Path(out).resolve();out.mkdir(parents=True,exist_ok=False)
    commands=[]
    def run(name,args,env=None):
        t=time.time();p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',env=env)
        (out/(name+'.log')).write_text(p.stdout+'\n--- STDERR ---\n'+p.stderr,encoding='utf-8')
        commands.append(dict(name=name,command=args,exit_code=p.returncode,elapsed_s=time.time()-t))
        (out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n',encoding='utf-8')
        print(f'{name}: exit {p.returncode}',flush=True)
        if p.returncode: raise RuntimeError(f'{name} failed; see log')
    run('node-version',['node','--version'])
    run('build',['node','scripts/build-mobile.mjs'])
    run('node-tests',['node','--test','tests/mobile.test.js'])
    run('python-csv-tests',[sys.executable,'-m','pytest','tests/test_mobile_csv.py','-q'])
    run('algorithm-port-parity',[sys.executable,'scripts/check-mobile-parity.py'])
    run('diff-check',['git','diff','--check'])
    env=dict(os.environ,PORT='4174',TEST_URL='http://127.0.0.1:4174',TEST_OUT=str(out/'browser'))
    with (out/'server.log').open('w',encoding='utf-8') as f:
        server=subprocess.Popen(['node','scripts/serve-mobile.mjs'],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,env=env)
        try:
            for _ in range(30):
                try:
                    with urllib.request.urlopen(env['TEST_URL'],timeout=1) as r:
                        if r.status==200: break
                except OSError: time.sleep(.2)
            else: raise RuntimeError('Preview did not start')
            run('browser-tests',['node','tests/mobile-browser.mjs'],env)
        finally: server.terminate();server.wait(timeout=10)
    sources={str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'web').glob('*') if p.is_file()}
    (out/'summary.json').write_text(json.dumps(dict(status='ENGINEERING_PASS',human_sessions=0,
        iphone_safari='DEVICE_TEST_REQUIRED',android_chrome='DEVICE_TEST_REQUIRED',
        human_accuracy='NOT_VALIDATED',node_tests=7,python_csv_tests=5,existing_fixture_comparisons=12,browser_scenarios=3,
        caveat='Desktop engines; actual FaceMesh no-face fake-camera check and explicit lifecycle mocks. No simulated result counted as a human test.',source_sha256=sources),indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    p=argparse.ArgumentParser(__doc__);p.add_argument('--out',required=True);main(p.parse_args().out)
