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


## 2026-10-24 用户真机反馈与新增验收要求（待修复，未通过）

**来源：用户口述 iPhone 手机网页测试。以下是故障报告，不代表已定位根因或已修复。**

### 已报告故障

1. **倒计时无提示重置**：已进入 45 秒倒计时，但中途经常直接跳回 45 秒；没有先显示人脸丢失、采样中断或其他明确提示。用户未提供本次对应的 JSON/CSV，故具体触发原因 **UNCONFIRMED**。
2. **完成后无可理解的检测信息**：用户曾勉强完成一次 45 秒，但感觉没有检测到任何信息。需要区分“算法正确拒绝输出 BPM”和“结果页/状态渲染故障”；原因 **UNCONFIRMED**。不能把完成倒计时等同于获得可靠心率。

### Codex 本轮修复任务（仅一轮针对性修复）

- 检查 `web/measurement.js` 的 `invalidate/observe/poll`，以及 `web/app.js` 的 `onResults/tick/recordWindow/render/stop`，追踪从原始异常到状态变化、清零及 UI 展示的完整链路。
- 区分暂时追踪/采样中断与持续失败：短暂异常必须在 UI 显示暂停与具体原因，不能无提示跳回 45 秒。不得把不连续的片段拼接为“45 秒连续有效采样”；若不能恢复连续性，明确提示必须重新获取有效窗口。
- 45 秒完成后必须显示结果页：合格则显示**实验性** BPM、质量指标和版本；不合格则显示明确拒绝原因、有效采样时间、帧率、有效/无效帧和重置次数，不能空白、不能伪造 BPM。
- 本地 JSON/CSV 应包含每次暂停/重置的时间、原因、前一刻倒计时、帧率、ROI 状态、模型回调/采样计数，以及最终 POS/CHROM 拒绝原因；失败也能导出。不得上传原始面部视频。
- 加入模拟短暂丢帧、>250ms 采样间隔、低 FPS、人脸丢失、恢复、45 秒完成但算法拒绝、结果页渲染和导出的一组回归测试；记录修改前后证据，标明模拟测试不等于真人验收。
- **禁止**仅靠放宽心率质量门槛、填充缺失帧或虚构数据提高成功率；保留现有算法质量标准。使用新修复分支提交 Draft PR，不合并 main 或现有 PR，不覆盖已有测试记录。

### 三项强制验收门槛（当前均为 NOT_VERIFIED）

| 验收项 | 通过条件 | 当前状态 |
|---|---|---|
| 倒计时行为 | 真机测量中不再无提示重置；中断显示原因和处理状态；不把断裂采样伪装为连续信号 | **NOT_VERIFIED** |
| 45 秒结束 | 必须有明确结果或可解释的失败原因，且失败不生成虚假 BPM | **NOT_VERIFIED** |
| 真机数据导出 | iPhone Safari 可导出并核对 JSON/CSV，含版本 SHA、帧率、ROI、重置和算法拒绝信息 | **NOT_VERIFIED** |

**验收流程**：Codex 先提供新 Draft PR、自动化测试日志、构建 SHA 与独立 HTTPS 测试地址；用户在 iPhone Safari 做真实测试并导出 JSON/CSV；审核人核对数据后再决定是否通过。若此轮仍无法达到三项门槛，可让 Grok **只做独立代码审查**，不得与 Codex 同时修改同一分支；是否转交实施另行决定。心率准确性与参考设备对照仍是独立的 **NOT_VALIDATED** 门槛。
