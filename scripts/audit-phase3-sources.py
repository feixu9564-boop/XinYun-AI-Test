"""Read official provenance; keep raw reference/video/consent files in ignored data/.

Optional network audit dependency: gdown==5.2.0. This does not accept EULAs,
contact authors, copy public mirrors, or upload participant data.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

p = argparse.ArgumentParser(__doc__)
p.add_argument('--out', required=True)
p.add_argument('--cache', default='data/source-audit')
p.add_argument('--try-video', action='store_true')
a = p.parse_args()
out, cache = Path(a.out), Path(a.cache)
out.mkdir(parents=True, exist_ok=False); cache.mkdir(parents=True, exist_ok=True)
entries = []


def save():
    (out/'sources.json').write_text(json.dumps(dict(checked_at_utc=datetime.now(timezone.utc).isoformat(),
        python=sys.version, gdown=importlib.metadata.version('gdown'), entries=entries), indent=2)+'\n', encoding='utf-8')


def fetch(label, url, filename, drive_id=None):
    entry = dict(label=label, url=url)
    try:
        path = cache/filename
        if drive_id:
            import gdown
            result = gdown.download(id=drive_id, output=str(path), quiet=True, use_cookies=False)
            if result is None: raise RuntimeError('download returned no file')
        else:
            with urllib.request.urlopen(url, timeout=30) as response:
                path.write_bytes(response.read())
        entry.update(status='DOWNLOADED_LOCAL_ONLY', bytes=path.stat().st_size,
                     sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    except Exception as e:
        entry.update(status='BLOCKED', reason=f'{type(e).__name__}: {e}')
    entries.append(entry); save(); print(json.dumps(entry))
    return entry


for label, ident, filename in (
    ('UBFC participant agreement', '1oT_t9EHB_SzqwoQt-7VWvyLpFgCoLZT1', 'Agreement.xlsx'),
    ('UBFC official readme', '1oL9oy_FU7jbB3qliHQIW629GtEMPJ64q', 'readme.txt'),
    ('UBFC official processor', '12jym67QYPnXHp3qSRjf1XsQGWRrC284M', 'processor.py')):
    fetch(label, 'https://drive.google.com/file/d/'+ident+'/view', filename, ident)

if (cache/'Agreement.xlsx').exists():
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(cache/'Agreement.xlsx') as z:
        strings = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rows = ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:row', ns)
        consent = {}
        for row in rows:
            cells = {}
            for c in row.findall('s:c', ns):
                v = c.find('s:v', ns)
                if v is not None:
                    cells[c.attrib['r'][0]] = strings[int(v.text)] if c.attrib.get('t') == 's' else v.text
            if cells.get('A') in ('Subject 1','Subject 3','Subject 21','Subject 27'):
                consent[cells['A']] = dict(image_sharing=cells.get('B'), data_sharing=cells.get('C'))
        # Only aggregate audit conclusion is published; do not republish the sheet.
        entries.append(dict(label='UBFC consent review', status='REVIEWED',
            selected_subjects_1_and_3_data_sharing=all(consent.get(s,{}).get('data_sharing') == 'X' for s in ('Subject 1','Subject 3')),
            discrepancy='readme describes image restriction for 21/27; workbook also marks subject21 data sharing NO; exclude both',
            publication_policy='no participant images or raw reference traces in repository'))
        save()

lock = json.loads((Path(__file__).resolve().parent.parent/'benchmark/toolbox.lock.json').read_text())
prefix = 'https://raw.githubusercontent.com/ubicomplab/rPPG-Toolbox/'+lock['commit']+'/'
fetch('Toolbox source license', prefix+'LICENSE', 'toolbox-LICENSE')
for name, model in lock['models'].items():
    item = fetch(name+' source', prefix+model['source'], name+'.py')
    item['expected_sha256'] = model['source_sha256']
    item['matches_lock'] = item.get('sha256') == model['source_sha256']
    item['weight_expected_sha256'] = model['weight_sha256']
    item['weight_current_run'] = 'NOT_DOWNLOADED_OR_EXECUTED: independent weight permission unresolved; no real video acquired'
    save()

if a.try_video:
    for subject, ident in [('1','1qBlkbaB8y3-KlWC_A61KsY42Wjo66ss4'),('3','1tL5EX50qFD8n6VO0wX9x_iOrPKyVR2-W')]:
        fetch('UBFC subject'+subject+' video', 'https://drive.google.com/file/d/'+ident+'/view', 'subject'+subject+'.avi', ident)
print('Audit only. Downloads are not proof of synchronized evaluation or model accuracy.')
raise SystemExit(1 if any(e['status'] == 'BLOCKED' for e in entries) else 0)
