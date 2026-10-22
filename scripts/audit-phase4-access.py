"""Read official acquisition endpoints once; no mirrors, signups or quota bypass.

Raw pages and optional UBFC video stay in ignored data/. Published JSON contains
only URLs, access outcomes and checksums. HTTP 200 never means licensed access.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import urllib.error

PURE = 'https://www.tu-ilmenau.de/en/university/departments/department-of-computer-science-and-automation/profile/institutes-and-groups/institute-of-computer-and-systems-engineering/group-for-neuroinformatics-and-cognitive-robotics/data-sets-code/pulse-rate-detection-dataset-pure'
SOURCES = [
    ('PURE', PURE, 'Academic institutional application required; no approval held', ['academic institutions', 'licensing restrictions']),
    ('UBFC-rPPG', 'https://sites.google.com/view/ybenezeth/ubfcrppg', 'Official Drive route; research sharing and participant consent reviewed in phase3; quota is not bypassed', ['research purpose']),
    ('COHFACE', 'https://zenodo.org/records/4081054', 'Restricted files; noncommercial research EULA and permanent institutional signatory required', ['Restricted', 'non-commercial research']),
    ('MMPD', 'https://raw.githubusercontent.com/McJackTang/MMPD_rPPG_dataset/main/README.md', 'Academic-only; faculty institutional application and signed release required', ['commercial usage is banned', 'faculty']),
    ('LGI-PPGI', 'https://raw.githubusercontent.com/partofthestars/LGI-PPGI-DB/master/README.md', 'Author reports downloads unavailable; no third-party mirror used', ['no sessions for dowload available']),
    ('UBFC-Phys-author', 'https://sites.google.com/view/ybenezeth/ubfc-phys', 'Official alternative dataset; separately verify download-host terms', ['IEEE dataport', 'dat@UBFC']),
    ('UBFC-Phys-dataport', 'https://ieee-dataport.org/open-access/ubfc-phys-2', 'Host access/license unverified; no account creation or terms submission', []),
    ('UBFC-Phys-dataubfc', 'https://search-data.ubfc.fr/FR-18008901306731-2022-05-05_UBFC-Phys-A-Multimodal-Dataset-For.html', 'Official author-linked alternative endpoint; access unverified', []),
]


def main():
    p = argparse.ArgumentParser(__doc__)
    p.add_argument('--out', required=True)
    p.add_argument('--cache', default='data/phase4-access')
    p.add_argument('--probe-ubfc-video', action='store_true', help='Requires gdown==5.2.0; one official subject1 attempt')
    a = p.parse_args()
    out, cache = Path(a.out), Path(a.cache)
    out.mkdir(parents=True, exist_ok=False); cache.mkdir(parents=True, exist_ok=True)

    def fetch(source):
        name, url, constraint, markers = source
        row = dict(dataset=name, source_url=url, reviewed_constraint=constraint, checked_at_utc=datetime.now(timezone.utc).isoformat())
        tick = time.perf_counter()
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(4*1024*1024)
                row.update(http_status=response.status, final_url=response.url, bytes=len(data),
                           sha256=hashlib.sha256(data).hexdigest(), page_status='READ')
                text = data.decode('utf-8', errors='replace')
                row['constraint_markers_found'] = {marker: marker.lower() in text.lower() for marker in markers}
                (cache/(name+'.html')).write_bytes(data)
        except (OSError, urllib.error.URLError) as e:
            row.update(page_status='BLOCKED', reason=f'{type(e).__name__}: {e}')
        row['elapsed_s'] = time.perf_counter()-tick
        return row

    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(fetch, SOURCES))
    if a.probe_ubfc_video:
        import gdown
        path = cache/'ubfc-subject1.avi'
        row = dict(dataset='UBFC-rPPG-video-probe', source_url='https://drive.google.com/file/d/1qBlkbaB8y3-KlWC_A61KsY42Wjo66ss4/view')
        try:
            if path.exists(): raise FileExistsError('probe output exists; refusing to overwrite')
            result = gdown.download(id='1qBlkbaB8y3-KlWC_A61KsY42Wjo66ss4', output=str(path), use_cookies=False, quiet=True)
            if result is None: raise RuntimeError('download returned no file')
            row.update(status='DOWNLOADED_NOT_VALIDATED', bytes=path.stat().st_size)
        except Exception as e:
            row.update(status='BLOCKED', reason=f'{type(e).__name__}: {e}')
        rows.append(row)
    result = dict(schema_version=1, entries=rows, acquisition_only=True,
                  completed_real_evaluations=0, acceptance='BLOCKED: access audit is not a synchronized evaluation')
    (out/'access.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result, indent=2))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
