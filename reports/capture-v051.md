# Mobile acquisition follow-up — v0.5.1

## Observed failure and limits of diagnosis

A user-supplied phone export showed repeated front-camera startup followed by
one recorded sample and an approximately eight-second `frame_timeout` stop.
The reported browser was an iPhone embedded WeChat browser, not standalone
Safari. No usable heart rate or paired reference measurement was produced.
The export contains no callback counts or inference completion state, so it
cannot identify which asynchronous step stalled. We do not claim a confirmed
WeChat-only root cause or a completed phone fix from desktop tests.

The user's original export, identifiers, precise timestamps and device UA are
not included in this repository or deployed site. This report retains only
the technical symptom needed to explain the change.

## Code defects and changes

- The prior loop chose `requestVideoFrameCallback` solely by API existence and
  had no recovery when that callback ceased. It also compared only `mediaTime`;
  absent/constant metadata could suppress subsequent frames. New `FramePump`
  checks a decoder counter when available, then advancing presented-frame or
  media timestamps; a foreground RAF loop continues checking when callbacks
  stall. After 500ms without callbacks, advancing video currentTime is a
  fallback only if a usable decoder counter is unavailable. A stationary
  decoder counter or timestamp is never replaced by wall-clock samples.
- The actual preview remains visible in a small fixed viewport during capture,
  including while scrolling to reference fields. Stop restores normal layout.
  This mitigates possible composition-dependent callbacks; it is not proof
  that visibility caused the user's failure.
- Inference remains serialized until the full send promise settles. A hung
  send is reported as `model_timeout`; missing model results are
  `model_result_timeout`; stalled video evidence is `video_frame_stalled`.
  Nothing retries overlapping WASM inference or inserts replacement RGB/BPM.
- Window FPS now reflects actual received sample timestamps even when quality
  rejects the window. Previously an early quality rejection defaulted FPS to
  zero, obscuring acquisition progress.
- CSV gains additive capture diagnostics and `stop_reason`. Schema version 1
  and the local storage key remain unchanged; existing records survive and
  have blank new fields. POS/CHROM and all quality thresholds are unchanged.
- The page shows v0.5.1, versioned local asset URLs and an embedded-WeChat
  notice recommending standalone Safari. No browser is labeled validated
  merely because the new loop exists.

## Relevant platform evidence

[The frame-callback specification](https://wicg.github.io/video-rvfc/) describes
callbacks associated with frames presented for composition.
[WebKit issue 282797](https://bugs.webkit.org/show_bug.cgi?id=282797) documents
callbacks not firing when the video is not actually rendered in a hidden
window. That is supporting evidence for defensive scheduling, not a proven
match to this user's particular device and browser.

## Regression scope

Six targeted scheduler tests cover stalled callbacks, absent metadata,
constant mediaTime with advancing frame counts, frozen decoder counters,
serialized hung inference and late callbacks after stop. No physiological
RGB fixture is added. Existing algorithm parity and CSV tests are reused.

Both desktop browser engines additionally exercise one-callback-then-stall,
an advancing video clock, a genuinely frozen clock and a hung model send.
The detector in this fault-injection scenario always returns no face; it
cannot produce a mock heart rate. Tests check more than 100 acquired samples,
empty BPM, nonzero measured FPS, visible preview while scrolled, distinct
timeout reasons and exported diagnostics. These are browser engineering
tests, not successful human recordings.

Initial development runs found an inverted wait predicate in the new test
and unbound browser RAF/cancel functions in the new scheduler. The corrected
implementation uses window-call wrappers. Failed run logs are retained and
must not be mistaken for final passing evidence.

## Required phone retest

Open the existing HTTPS test site in Safari with `?v=0.5.1`, verify the page
badge says v0.5.1, and start a new session without clearing old records.
Confirm the fixed preview remains live while entering reference values.
Run at least 20 seconds if acquisition continues, then stop and export CSV.
If it stops early, the same CSV now contains the diagnostic counters needed
to distinguish video starvation and inference stalls. Do not change quality
thresholds or claim accuracy merely to get a displayed number.

Phone retest remains **DEVICE_TEST_REQUIRED**. The previous phone export is
evidence of a failed measurement, not successful physiological validation.


## Current access and privacy

Before this update, Sites reported the existing audience as public. This
update preserves that audience and does not change access settings. Raw
video and measurement records still remain in each visitor's browser.
No user CSV, raw face frame or identity is included in the build or PR.

## Verification locations

The final reproducible run is `reports/logs/phase5/capture-fix-v051-final/`:
13 Node contract/scheduler tests, 5 CSV tests, 12 reused algorithm parity
comparisons and 5 browser scenarios. Earlier development failures are under
`capture-fix-v051/` and `capture-fix-v051-r2/`. Final results are determined
by the actual summary and commands/exit codes, not these test counts alone.
