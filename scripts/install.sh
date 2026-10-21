#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm ci --cache /tmp/xinyun-npm-cache --ignore-scripts
mkdir -p web/vendor
cp -R node_modules/@mediapipe/face_mesh web/vendor/
