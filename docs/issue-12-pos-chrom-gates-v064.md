# v0.6.4-rc：POS/CHROM 周期判别三道新增拒绝门（Issue #12）

状态：**DEVICE_TEST_REQUIRED**。以下全部依据合成数据与代码阅读，没有任何真机数据；不声明心率准确性。

## 重要前提（务必先读）
这三道门**都是新增的拒绝路径**，只会让输出更严格，**单靠它们不可能把“0 次有效 BPM”变成有 BPM**。
如果真机会话全部死在 `competing_periodicity`，这些改动不会改变那个结果。它们的作用是：当其他门放行了不可靠的窗口时，再多一层拦截。

## 改动（最小）
| # | 门 | 位置 | 阈值（命名常量） | 失败原因 |
|---|---|---|---|---|
| 1 | POS/CHROM 主频交叉验证 | `web/signal.js` `posChromAgree` + `analyze` | `POLICY.maxPosChromDiffBpm = 5`（原为内联的 6） | `pos_chrom_disagreement`（status 仍为 `insufficient_signal`；旧 `algorithm_disagreement` 标签保留以便读旧记录） |
| 2 | 频谱熵 | `web/signal.js` `spectrum`；Python 镜像 `benchmark/quality.py::reliable_heart_rate` | `POLICY.maxSpectralEntropy = 0.50` | `high_spectral_entropy` |
| 3 | 无效帧占比 | `web/signal.js` `analyze(…,{frames})`；`web/app.js` 传入 | `POLICY.maxInvalidFrameRatio = 0.15`，`> 15%` 拒绝 | `too_many_invalid_frames` |

- **只有一种算法给出 BPM 时**：行为不变——任一方法被现有门拒绝，整体即失败、`bpm/pos/chrom` 全为 null，不存在“只用另一个”的硬选路径（已核对 `analyze`）。
- **熵的定义**：HR 频带（0.7–3.0 Hz，与现有 DFT 同一组 bin）内功率归一化后的 Shannon 熵，再除以 ln(N)（0=单 bin，1=全平）。在所有现有门之后才判断，因此原有拒绝原因及其优先级不变；`pos_reason/chrom_reason` 保持 ≤0.6.3-rc 的含义（只反映旧门），熵门只体现在最终 `reason`。
- **无效帧字段**：`invalid_frames = max(0, model_results − roi_samples)`，总帧数 = `model_results`（= `frames_submitted`）。`analyze` 不传 `frames` 时（旧调用方式）该门不评估，行为与旧版一致。
- **新增导出字段（只追加在末尾，旧字段不变）**：`pos_spectral_entropy`、`chrom_spectral_entropy`、`pos_chrom_bpm_diff`、`invalid_frame_ratio`。诊断模式新增 gate：`POS/CHROM.spectral_entropy`、`invalid_frame_ratio`。
- 版本：`0.6.4-rc`（`web/build-info.js`、`web/index.html`、`web/app.js` import 缓存参数、浏览器测试断言）。v0.6.1 的 capture/导出字段全部保留。

## 阈值依据（合成数据，已验证）
- 干净脉搏 60/75/90/120 BPM（16 s 与 45 s；normal/weak/drift/jitter）：熵 0.20–0.42，全部通过。
- 在 2160 个合成窗口（脉搏幅度×噪声×HRV）里，现有门已放行 592 个，其中 **0 个** BPM 偏差 >5；这些放行窗口的熵 min 0.262 / p50 0.351 / p90 0.459 / max 0.542。阈值 0.50 会多拒绝其中 11 个（1.9%），都是正确但噪声较大的结果；阈值 ≤0.45 拒绝 80 个（13.5%），≥0.55 则等于不起作用。
- 能被熵门单独拦住的反例：主峰 + 10 个各 3% 功率的弱谱线（通过全部旧门，熵 0.54）。
- 理论上：旧门放行的窗口（集中度 ≥60%、次峰 ≤4%）熵上限约 0.6，所以阈值 ≥0.6 在 16 s 窗口下是空操作；0.50 是在“不误伤干净/弱脉搏（≤0.42）”与“有拦截效果”之间取的折中，**不是真人校准值**。
- 合成矩阵快照（f73adc3）中只有 3 个 `noise` 窗口由接受变为拒绝，其余 87 个决定不变（快照共 90 个）。

## 已验证的发现
- `analyze` 在任一方法有 `reason`（含 `competing_periodicity`）时直接 `fail`，**没有任何路径**在 POS/CHROM 竞争峰时输出 BPM。
- 交叉验证在 0.6.3-rc 里已存在（>6 BPM 失败）。16 s 窗口的 bin 间距约 3.74 BPM，峰值 BPM 以 bin 为单位，所以两算法的差只能是 0、3.7、7.5…，**6→5 在 16 s 窗口里几乎不改变任何结果**。4000 个随机双音合成样例中，两方法都过单项门却互相不一致的数量为 0，说明该门在现有门之后基本是冗余的保险。
- 无效帧多数发生在**对准阶段**（`measurement.observe` 暂停/aligning），并不在 16 s 分析窗内；用整段会话的占比去拒绝，会惩罚“对准花了较长时间但测量段干净”的会话。按要求实现，但建议后续改为只统计测量段内的无效帧（需真机数据决定）。

## 测试建议
1. `npm test`（含新增 `tests/gates-064.test.js`）、`pytest tests -q`、`python scripts/check-mobile-parity.py`（JS/Python 熵一致到 1e-9）。
2. 真机（iPhone Safari / 微信）：开诊断模式跑 45 s，同时指夹对照；导出后检查 `pos/chrom_spectral_entropy`、`pos_chrom_bpm_diff`、`invalid_frame_ratio`，确认熵门是否与真实竞争峰相关，再决定是否调阈值。
3. 回放：`node scripts/replay-diagnostics.mjs <诊断json> out.json`，对比熵与主峰/次峰。
