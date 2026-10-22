"""Convert an authorized local video + timestamp/HR CSVs to the common format."""
import argparse
import csv
import json
from pathlib import Path
import cv2
import numpy as np
from .data import check_times, sha256


def read_csv(path, fields):
    with open(path, newline='') as f:
        rows = list(csv.DictReader(f))
    return [np.array([float(r[k]) for r in rows]) for k in fields]


def prepare(video, timestamps, reference, roi, out, quality_csv=None, quality_source=None):
    out = Path(out)
    if out.exists():
        raise ValueError('output already exists')
    t, = read_csv(timestamps, ('timestamp_s',))
    rt, hr = read_csv(reference, ('timestamp_s', 'bpm'))
    check_times(t, 'video')
    check_times(rt, 'reference')
    telemetry = {}
    if quality_csv:
        if not quality_source or not quality_source.strip():
            raise ValueError('quality CSV requires documented verification source')
        qt, faces, valid = read_csv(quality_csv, ('timestamp_s', 'face_count', 'roi_valid'))
        if qt.shape != t.shape or not np.allclose(qt, t, atol=1e-6, rtol=0):
            raise ValueError('quality telemetry timestamps do not match decoded-frame timestamps')
        if (not np.isfinite(faces).all() or np.any(faces < 0) or np.any(faces != np.floor(faces))
                or not np.isin(valid, [0,1]).all()):
            raise ValueError('invalid quality telemetry values')
        telemetry = dict(face_count=faces, roi_valid=valid)
    if len(roi) != 4 or any(int(v) != v for v in roi) or min(roi[:2]) < 0 or min(roi[2:]) < 1:
        raise ValueError('ROI must be x,y,width,height in integer pixels')
    x, y, w, h = map(int, roi)
    cap = cv2.VideoCapture(str(video))
    frames = []
    try:
        if not cap.isOpened():
            raise ValueError('video cannot be opened')
        nominal_fps = cap.get(cv2.CAP_PROP_FPS)
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if x+w > frame.shape[1] or y+h > frame.shape[0]:
                raise ValueError('ROI outside video')
            crop = cv2.cvtColor(frame[y:y+h, x:x+w], cv2.COLOR_BGR2RGB)
            frames.append(cv2.resize(crop, (128, 128), interpolation=cv2.INTER_AREA))
    finally:
        cap.release()
    if len(frames) != len(t):
        raise ValueError('decoded frame/timestamp count mismatch (including decode failure)')
    provenance = {'video_sha256': sha256(video), 'timestamp_csv_sha256': sha256(timestamps),
                  'reference_csv_sha256': sha256(reference), 'roi_xywh': list(roi),
                  'nominal_fps': nominal_fps, 'opencv': cv2.__version__}
    if quality_csv:
        provenance.update(quality_csv_sha256=sha256(quality_csv), quality_source=quality_source)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Refuse silent extension changes by using a file handle.
    with out.open('xb') as f:
        np.savez_compressed(f, frames=np.array(frames), timestamps=t, reference_timestamps=rt,
                            reference_bpm=hr, provenance=json.dumps(provenance), **telemetry)
    print(json.dumps({'sha256': sha256(out), 'frames':len(t), 'provenance':provenance}, indent=2))
    return provenance


def main():
    p = argparse.ArgumentParser(__doc__)
    p.add_argument('--video', required=True)
    p.add_argument('--timestamps', required=True)
    p.add_argument('--reference', required=True)
    p.add_argument('--roi', type=int, nargs=4, required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--quality-csv', help='Per decoded frame: timestamp_s,face_count,roi_valid')
    p.add_argument('--quality-source', help='Evidence/method for face count and skin ROI verification')
    args = p.parse_args()
    try:
        prepare(args.video, args.timestamps, args.reference, args.roi, args.out, args.quality_csv, args.quality_source)
    except (ValueError, OSError, KeyError) as e:
        p.exit(2, f'prepare error: {e}\n')


if __name__ == '__main__':
    main()
