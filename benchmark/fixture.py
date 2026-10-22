"""Generate SYNTHETIC engineering fixtures only, never human accuracy evidence."""
import argparse
import csv
import json
from pathlib import Path
import cv2
import numpy as np
from .prepare import prepare
from .data import sha256


def generate(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    t = np.arange(32*30)/30
    p = np.sin(2*np.pi*1.2*t)
    rgb = np.array([130, 100, 80]) + p[:, None]*np.array([1., 4., .5])
    video = out/'synthetic.avi'
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*'MJPG'), 30, (32, 32))
    if not writer.isOpened():
        raise RuntimeError('MJPG encoder unavailable')
    for value in rgb:
        writer.write(np.broadcast_to(value[::-1].astype(np.uint8), (32,32,3)).copy())
    writer.release()
    for name, columns, rows in [('timestamps.csv', ('timestamp_s',), ((x,) for x in t)),
                                 ('reference.csv', ('timestamp_s','bpm'), ((x,72) for x in np.arange(33)))]:
        with (out/name).open('w', newline='') as f:
            w = csv.writer(f); w.writerow(columns); w.writerows(rows)
    prepare(video, out/'timestamps.csv', out/'reference.csv', (0,0,32,32), out/'valid.npz')
    with np.load(out/'valid.npz', allow_pickle=False) as z:
        data = {k:z[k] for k in z.files}
    data['reference_bpm'] = data['reference_bpm'].astype(float)
    data['reference_bpm'][20] = np.nan
    np.savez_compressed(out/'missing_reference.npz', **data)
    records=[]
    for i, filename in enumerate(('valid.npz', 'missing_reference.npz')):
        records.append(dict(id=f'synthetic-{i}', dataset='SYNTHETIC-NOT-HUMAN', subject_id=f'synthetic-subject-{i}',
                            split='test', path=filename, sha256=sha256(out/filename), duration_s=32,
                            reference_offset_s=0, conditions={'motion':'synthetic-static'},
                            label_provenance='generated fixture; not a human label',
                            source_url='local:benchmark.fixture', research_authorization='generated nonhuman pixels'))
    manifest=dict(schema_version=1, synthetic=True, records=records)
    (out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print('SYNTHETIC fixture manifest:', out/'manifest.json')
    return out/'manifest.json'


if __name__ == '__main__':
    p=argparse.ArgumentParser(__doc__); p.add_argument('--out', required=True)
    generate(p.parse_args().out)
