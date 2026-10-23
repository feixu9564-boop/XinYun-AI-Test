# Issue #12 — v0.6.0 mobile 45-second measurement

Base: PR #10, `b21e3da3ba0b980b268fb41d30a3c3ea64869d04` (v0.5.1). Issue body and latest acceptance comment 6354471010 were read on 2026-10-23. Also read Issue #11. No merges are authorized.

## Three separate gates

- Code / automation: PENDING_FINAL_RUN.
- Physical iPhone Safari continuous acquisition: **DEVICE_TEST_REQUIRED**. Desktop WebKit does not satisfy this gate. Old one-frame failures are not successful retests.
- HR vs finger-clip accuracy: **NOT_VALIDATED**, separate future validation. No human data or raw facial video is included in this PR.

## Implementation and acquisition policy

`web/measurement.js` is a state machine over monotonically increasing capture timestamps. Permission/model loading and alignment do not contribute to the 45 seconds. One complete face must pass existing geometry/ROI/motion/exposure checks, with all face landmarks inside 1%-99% of the source image. Stable acquisition for 1.5 seconds at >=12 FPS enters ready, then the next valid frame starts measurement. Countdown = ceil(45 - continuous valid sample duration). Rendering ticks cannot advance effective duration; only delivered, non-stale valid samples do. The displayed zero remains on the completed result screen.

Policy: `duration=45`, `stable=1.5`, `minFPS=12`, `maxGap=0.25`, `invalidTimeout=8`, `sessionLimit=120` seconds. FPS uses a rolling two-second valid-sample interval (requires at least a one-second interval before rejecting low FPS). This acquisition policy is experimental and has not been tuned on humans.

Every invalid ROI/multiple-face/pose/exposure/motion sample, >250ms gap, or low-FPS interval clears the current window. Recovery requires a fresh stable alignment and restarts at 45; interrupted fragments are never joined. If a started measurement cannot recover for 8 seconds it fails. Startup timeout stays 30 seconds; video/model timeout stays 8 seconds. Initial alignment may wait within the overall 120-second limit. Background/page exit stops immediately; restarting is explicit.

At >=45 seconds continuous valid acquisition, the app applies the **unchanged v0.5.1 algorithm and quality gates to the final 16-second contiguous window**, stops tracks, and shows its accepted experimental BPM/POS/CHROM/quality or a specific rejection. It does not average disjoint windows or fabricate a value. Manual stop always records a rejected partial attempt.

The existing FramePump foreground RAF loop, actual media progression fallback and serialized full `FaceMesh.send()` promise remain. Fresh advancing video callback frame IDs now take priority over a stagnant playback-quality counter; a frozen counter alone is still not overridden by a wall clock. Without decoder counters, an advancing media time is a compatibility fallback, not proof of physiological liveness. A hung inference is never overlapped by another send. New logs expose original decoder/callback/media counters and inference timing/errors. The old phone-specific root cause is still unconfirmed; regression simulations demonstrate paths, not a physical-device fix.

## UI and local records

During acquisition the actual preview occupies 48dvh (48vh fallback), with `object-fit: contain`, matching mirrored video/overlay, and an unobtrusive face outline. Letterboxing preserves the original camera ratio. The 180px corner window is removed. A fixed measurement panel keeps the preview, large countdown, status, FPS and stop/restart controls in view; safe-area padding is applied. The result panel includes zero and the final output. All saved records remain in the existing local storage key; no migration/clear is required.

CSV/JSON now include `app_version`, `commit_sha`, session ID, aligned/start/stopped timestamps, effective seconds, countdown, valid sample count, reset count, ROI count, model result/completion/submission counts, decoder/presented frames/media time, inference duration/error count, FPS, quality/BPM/rejection and stop reason. One telemetry record is saved each observed second; an event-loop stall is not backfilled with invented telemetry. Alignment/start/reset/final events preserve transitions. Build injects the source commit into `dist/build-info.js`; unbuilt source explicitly reports LOCAL_UNCOMMITTED.

Reference entry remains available after measurement. If the reading was observed during acquisition, uncheck 'just observed' and enter its actual time. Matching rules remain unchanged (same session/subject, sampled window, midpoint +/-2 seconds). A reading taken after the window is deliberately unmatched. No raw video is recorded, saved, or uploaded. Records are local to that browser/device.

## Acceptance checklist and evidence

| Issue #12 criterion | Engineering evidence | Physical acceptance |
|---|---|---|
| Aligned start; exclude permission/model waits | measurement.test.js waiting/stability tests; browser no-face prealignment | DEVICE_TEST_REQUIRED |
| Visible 45..0, monotonic effective duration | all 46 integer states in Node; browser completion and interruption cases | DEVICE_TEST_REQUIRED |
| Half-screen mobile preview and reachable controls | browser layout assertions + 390x844 and small-screen screenshots | DEVICE_TEST_REQUIRED |
| 45-second auto-stop/result, manual stop and restart | injected constant-ROI flow rejects BPM, closes all tracks; real algorithm rejection tests and existing parity fixtures | DEVICE_TEST_REQUIRED |
| Face loss, low FPS, stalled frames, hung model, background | Node state/pump regressions + Chromium/WebKit lifecycle tests; no fragment stitching | DEVICE_TEST_REQUIRED |
| Original one-frame regression | >45s frame-ID regression plus browser one-callback-only media-clock fallback; freeze/hang remain failures | **DEVICE_TEST_REQUIRED: user must supply new iPhone logs** |
| Detailed local JSON/CSV | exported browser sessions, CSV/JSON assertions and 5 Python CSV tests | DEVICE_TEST_REQUIRED for iPhone download/share UI |
| Automated evidence and portrait screenshots | commands.json, logs and browser results/screenshots under reports/logs/issue12 | ENGINEERING ONLY |
| Real iPhone Safari HTTPS run | no physical device available to agent | **DEVICE_TEST_REQUIRED** |
| PR/version/SHA/report/HTTPS/known issues, no merge | release metadata and PR body | delivery, not phone validation |

## Testing and development failures

Reproduce with Node and the pinned dependencies: `npm ci --ignore-scripts`; install Python dependencies from requirements-benchmark.lock and Playwright Chromium/WebKit; run `python scripts/validate-mobile.py --out <new-directory>`. Local Windows uses `.venv/Scripts/python.exe`. The browser harness uses explicit camera/detector/ROI fault injection and constant RGB for workflow checks; it never represents a human recording or returns a mock successful HR. The separate real bundled FaceMesh/WASM case uses a no-face fake camera and checks loading, rejection, lifecycle, no external requests and no uploads.

Initial setup run1: selected Python lacked pytest; reran with the existing project venv. Run2: an old test double-clicked the disabled stop button after stopping; fixed the test, retained its failed output. First state test had an extra 50ms frame in its setup; corrected its frame boundary. All failed logs remain distinct from final evidence.

## Safari review and limits

`autoplay muted playsinline` and JS `muted/playsInline` remain set before playback; front camera uses `facingMode: {ideal: 'user'}` and rejects a reported environment camera. HTTPS is mandatory. Visible preview remains composited; video callbacks are not the sole scheduling source. Safari permissions, thermal load, camera hardware/OS behavior, background interruptions and downloads require device testing.

Official references reviewed: [Apple video delivery](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari), [WebKit iOS video policy](https://webkit.org/blog/6784/new-video-policies-for-ios/), [WebKit playsinline bug](https://bugs.webkit.org/show_bug.cgi?id=260345). These explain compatibility precautions, not proof of the reported bug's root cause.

## iPhone acceptance procedure

Open the deployed v0.6.0 URL in Safari; verify the badge. Enter an anonymous ID, consent, start, grant front-camera permission. Keep one entire face centered, evenly lit and still. Alignment should switch to a large 45-second countdown and half-screen preview. Complete without hiding Safari. At zero the camera must close and show a result or explicit signal rejection. Export JSON and CSV even on failure. Verify commit SHA, continuously increasing video/model/ROI/valid sample counts, effective_seconds >=45, measurement_complete stop, and no resets within the final interval. Also exercise face loss, manual stop/restart and background behavior. Supply those local logs to complete DEVICE_TEST_REQUIRED. Do not send raw facial video.
