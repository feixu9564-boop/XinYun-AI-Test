# Issue #5 第三阶段报告

**验收结论：BLOCKED / 不合并。** 真实视频评测数为0；阈值尚未在真人验证集上标定。
本 PR 是基于 PR #4 head `f8e56a4e326df2e1fe520713a65f10ad91647da0` 的独立后续分支，
PR #4 未合并。只交付可审阅工程修改与真实运行证据，不关闭 Issue #5、不开展心理评分。

## 已执行与尚未完成

- 核查官方数据许可/参与者限制、模型锁定源码与历史权重摘要，详情见[许可表](../docs/phase3-data-license.md)。
- 增加 `insufficient_signal` 与原因；不输出拒绝窗口 BPM。输入门控检查逐帧人脸数/ROI核验、运动残差、亮度和色度变化；频谱门控拒绝扩散谱、多峰与二次谐波歧义。
- 增加逐帧质量 sidecar 导入和哈希/核验来源，缺失不假定人脸有效。固定 ROI 不是检测器，尚无已验证自动人脸/遮挡跟踪。
- 新增13类合成场景、逐窗 CSV/JSONL、误报与覆盖率、误差分位数、受试者簇 bootstrap CI。真实数据与合成结果严格分开。
- 真人阈值标定、真实6算法对照、原始视频到预测的端到端计时及产品适用性验证**未完成**。两个官方样本视频下载额度受限，保留原始错误。

## 本轮六算法状态（真实数据）

| 算法 | 真视频窗口 | 真人 MAE/RMSE/覆盖率/CI | 状态与原因 |
|---|---:|---|---|
| POS | 0 | N/A | NOT_RUN：未获得可解码的同步视频 |
| CHROM | 0 | N/A | NOT_RUN：同上 |
| PhysNet | 0 | N/A | NOT_RUN：同上；未取得权重独立许可，本轮未安装/加载 torch 与模型 |
| EfficientPhys | 0 | N/A | NOT_RUN：同上 |
| PhysFormer | 0 | N/A | NOT_RUN：同上 |
| PhysMamba | 0 | N/A | NOT_RUN：同上，且未提供兼容 CUDA/mamba_ssm 环境 |

不按合成结果排名，不把 N/A 填成0，不把加载/合成推理解释为真人准确。

## 合成测试：正例覆盖与负例误报一起报告

固定种子2026，8个**虚构场景 ID**（不是真人）：0/1用于诊断 validation，2–7用于 test。
每个ID有13类场景，每窗16秒、480点、30Hz；共624行（8×13×6），其中416行深度模型 NOT_RUN。
阈值为公开的固定工程默认值，validation 仅做诊断，**未声称数据驱动调参或独立临床验证**。

| test 指标 | POS | CHROM |
|---|---:|---:|
| 正例接受/总数 | 6/6 | 6/6 |
| 正例 MAE / RMSE（BPM） | 0.650 / 0.807 | 0.650 / 0.807 |
| 正例 bias（BPM） | -0.333 | -0.333 |
| 正例绝对误差 P50 / P95（BPM） | 0.725 / 1.313 | 0.725 / 1.313 |
| 正例 MAE 95%簇bootstrap区间 | [0.308, 1.025] | [0.308, 1.025] |
| 负例误接受/总数 | 6/72（8.33%） | 6/72（8.33%） |
| 门控前负例产生候选数 | 60/72 | 60/72 |
| 全部窗口拒绝率 | 66/78（84.62%） | 66/78（84.62%） |
| 全部窗口输出覆盖率（包括错误输出） | 12/78（15.38%） | 12/78（15.38%） |

负例占比是人为设计的压力测试分布，不能作为产品误报率估计。正例覆盖100%说明并未把所有输入都拒绝，
但正例是容易的合成信号，不能证明真实运动/肤色/照明鲁棒性。CI重采样的是虚构场景ID，仅用于验证统计实现。
误差仅对有参考且接受的正例计算；错误输出阈值10 BPM仅用于描述计数，不是精度达标门槛。
原始窗口中的 `raw_candidate_bpm` 仅为离线失效对照；对外结果是 `predicted_bpm`，拒绝时始终为空。

## 失败案例与逐项回归

| 场景 | 门控后结果 | 局限 |
|---|---|---|
| 72 BPM+占优二次谐波，旧 FFT约144 BPM | harmonic_ambiguity，拒绝 | 不擅自把峰值除2；弱基频可能漏检 |
| 72 BPM+1.6Hz运动，旧 FFT约96 BPM | competing_periodicity，拒绝 | 只有单峰的运动需要独立输入证据 |
| 常量/无脉搏、随机噪声 | 无色度证据/扩散频谱，拒绝 | 与真实低灌注不同，不能据此标定真人阈值 |
| 空间周期运动、光照波动、10 FPS | 运动/照明/帧率原因拒绝 | 阈值未在真视频标定；空间采样有盲点 |
| 遮挡、失脸、多人、缺少ROI核验 | 逐帧质量原因拒绝 | 测试注入遥测，未验证自动检测正确性 |
| 与脉搏同形的周期性色彩伪影 | **仍误报：各6/72负例** | 波形与颜色单独不足以辨别生理来源，不能宣称“假心率已解决” |

保留裸 FFT 为低层候选估计器与复现旧失效证据。正式 `benchmark.run` 使用门控。
已知失败使对抗套件返回1；验证脚本仅在符合已披露范围并通过工程检查时返回0，不能解读为第三阶段验收通过。

## 复现与证据

本轮 Windows 10 / Python3.12.14 / NumPy2.2.6 / OpenCV4.12.0；CPU标识与无torch环境在 summary，
完整依赖/硬件见 logs。延迟为合成ROI的对齐、质量/基线计算；不含真视频解码，不是线上实时性能承诺。
一般基准另记录NPZ加载和总耗时；总时长含统计/写出，不能直接当模型吞吐。

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-benchmark.lock
.venv\Scripts\python scripts/validate-benchmark.py --out outputs/phase3-new
```

Linux 可使用 README 的两条 bash 命令。每次输出路径必须全新，禁止覆盖日志。
网络审计独立运行，安装 `gdown==5.2.0` 后：

```text
python scripts/audit-phase3-sources.py --out outputs/source-audit-new --try-video
```

原始下载只保留在被忽略的 `data/source-audit/`。审计日志只含官方URL、摘要、状态与异常。
网页/Google Drive 可变，审计重跑可能获得不同结果；应比较已存SHA256。

- [99项测试完整日志](logs/phase3/validation/pytest.log)
- [全部验证命令和退出码](logs/phase3/validation/commands.json)
- [对抗结果CSV](logs/phase3/validation/adversarial/windows.csv)、[逐窗质量与原因](logs/phase3/validation/adversarial/windows.jsonl)、[统计与硬件](logs/phase3/validation/adversarial/summary.json)
- [完整视频fixture结果](logs/phase3/validation/full/summary.json)、[CSV](logs/phase3/validation/full/windows.csv)
- [来源/许可/下载失败原始证据](logs/phase3/source-audit/sources.json)

## 解除阻塞后才能验收

取得官方视频与同步参考 → 固定数据清单和受试者隔离划分 → 验证逐帧时钟/ROI遥测 →
在真人validation标定并冻结阈值 → 同一test上跑六算法（不能运行者明确原因）→
报告真实误差、误报/覆盖、分组、簇CI、含解码的延迟/吞吐 → 独立审查。
目前 Issue #5 的真实数据门槛未通过，PR #4 和本 PR 都不合并。
