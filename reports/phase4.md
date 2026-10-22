# Issue #7 第四阶段交付报告

**真人基准验收：BLOCKED。** 用户明确确认目前无已获批真人数据、无可提供IEEE DataPort账号，
要求继续完成不依赖真人数据的接入、许可核查、自动化测试和完整日志。因此没有伪造数据、结果或验收通过声明。
独立分支从PR #6提交 `4d99c3c6903a41e0c2a72db250d5f0bec8824dbb` 继续，未合并任何PR，未改变生产部署。

## 交付变化

1. 官方数据访问审计：PURE、UBFC-rPPG、COHFACE、MMPD、LGI-PPGI及UBFC-Phys两个官方渠道。
   区分申请/登录限制、TLS异常和上轮配额错误；不绕过限制、不用未授权镜像。
2. UBFC DATASET_2专用本地接入：验证许可证据、原始文件SHA256、跨会话受试者划分、重复视频、同步材料；
   解码前先预检，之后验证参考格式、视频/参考时间覆盖、完整时长和逐帧ROI质量sidecar。
3. 记录帧数、实际FPS、参考采样率/间隔、原始/导出哈希、导入耗时；失败不静默丢弃，不生成不完整的可评估manifest。
4. 补充P90绝对误差字段和有来源依据的设备分层标签。沿用现有六算法接口；没有用另一模型代替未运行模型。
5. 新增空数据BLOCKED路径、全空真人窗口导出及CI，锁定基准与可选网络审计依赖。

## 真实数据及六算法结果

实际取得可用真人视频：**0**；实际受试者：**0**；真实评估窗口：**0**。
视频帧率、参考采样率、同步误差、标签覆盖、真实负例数量均 **N/A**。官方页面描述的采样参数不是本轮实测。
真实train/validation/test仍未产生；模板与空计划不构成已完成的数据划分。

| 算法 | 本轮真人状态 | 误差、覆盖/拒绝、负例误报、延迟/吞吐、簇CI | 原因 |
|---|---|---|---|
| POS | NOT_RUN | 全部null/N/A | 无合规、完整、已核验同步的真实视频 |
| CHROM | NOT_RUN | 全部null/N/A | 同上 |
| PhysNet | NOT_RUN | 全部null/N/A | 同上；权重独立许可未解决，本轮未安装或加载深度模型 |
| EfficientPhys | NOT_RUN | 全部null/N/A | 同上 |
| PhysFormer | NOT_RUN | 全部null/N/A | 同上 |
| PhysMamba | NOT_RUN | 全部null/N/A | 同上，另缺经验证CUDA/mamba_ssm运行环境 |

权重来源/历史摘要与必要预处理差异沿用 [锁定清单](../benchmark/toolbox.lock.json)、
[模型清单](../docs/model_inventory.md)。本轮未重新下载/执行权重；PR #4历史合成forward不能算本轮真实成绩。
所有算法后续必须使用同一真实测试视频、16秒窗和接触参考BPM。PURE预训练重叠仍受现有保护，
其他跨数据集身份重叠需实际审核，不能只看数据集名称。

## 质量策略与现有回归

`benchmark/quality.py` 与PR #6保持相同内容，未在合成测试或test上调阈值；真人validation调优和冻结**NOT_RUN**。
只复跑既有13类场景，未新增模拟样本来替代真人验证。最终624行包含416行深度模型NOT_RUN。

| 原有回归目标 | 最终结果 |
|---|---|
| 72 BPM+占优二次谐波导致约144 BPM | POS/CHROM均拒绝，BPM为空 |
| 72 BPM+运动导致约96 BPM | POS/CHROM均拒绝，BPM为空 |
| 常量无脉搏 | 拒绝，BPM为空 |
| 脉搏样周期性色彩伪影 | **仍误接受**，各6/72个测试负例 |
| 干净正例 | 各6/6接受，没有全部拒绝刷低误差 |

6/72仅为合成负例的8.33%，**不是真实误报率**。正例覆盖100%也不是真人覆盖保证。
质量门不能仅凭同形颜色波形判定生理来源，剩余失败保持公开。CI把这个已知范围当工程回归基线，不当生理验收门槛。

## 工程验证和可复现日志

最终命令：

```text
python -m venv .venv
# Windows:
.venv\Scripts\python -m pip install -r requirements-benchmark.lock
.venv\Scripts\python scripts/validate-phase4.py --out outputs/phase4-new
# Linux uses .venv/bin/python with the same arguments.
```

112项测试覆盖原有行为和新增导入契约：授权材料缺失、哈希错误、跨split泄漏、重复视频、路径ID、
参考时间重复/偏移未解决、缩短时长、缺测HR保留、空数据阻塞及防覆盖等。
测试中的小型导入视频是明确非真人的格式样本；不计入真实准确率。
初轮110项通过后补充时钟偏移/时长裁剪回归，最终重跑112项；两轮日志均保留，使用final-validation作为最终证据。

- [最终测试日志](logs/phase4/final-validation/pytest.log)
- [最终全部子命令、耗时和退出码](logs/phase4/final-validation/commands.json)
- [原有对抗回归CSV](logs/phase4/final-validation/pr6-regression/windows.csv) / [JSONL](logs/phase4/final-validation/pr6-regression/windows.jsonl)
- [真实数据阻塞清单](logs/phase4/final-validation/real-preflight/inventory.json)
- [六算法真实结果表](logs/phase4/final-validation/real-results.json)：全部NOT_RUN，指标null
- [真实窗口CSV](logs/phase4/final-validation/real-windows.csv)：只有表头；JSONL为空
- [最终环境](logs/phase4/final-validation/environment.freeze.txt) / [源码SHA256](logs/phase4/final-validation/source-hashes.json)（UTF-8/LF规范化）
- [官方访问审计](logs/phase4/access/access.json) / [本轮下载重试](logs/phase4/ubfc-retry.log)

最终工程命令退出0；空真实数据预检和保留已知失败的对抗套件退出1，原始退出码不隐藏。
真实数据阶段没有执行，不伪造解码、推理延迟或吞吐。CI链接和状态附在PR正文。
`requirements-audit.lock`仅用于复现可选网络审计；普通测试无需该依赖、网络或私人数据。

## 限制与后续配合

详细障碍、官方条款和所需材料见 [数据获取与接入指南](../docs/phase4-data-access.md)。
下一步需要用户提供获准本地数据/授权范围，或由具备资格的机构申请；IEEE路线需用户完成账号与必要条款流程。
同时需要同步/延迟证据和逐帧质量核验。不要在聊天中提供密码，不向GitHub上传原始人脸或参考信号。

当前接入采用设备HR，不等同于从接触PPG重算的论文参考；真实数据后还要验证该参考口径与延迟。
本次没有新增自动人脸跟踪、全格式数据集适配器或已校准质量模型。不能在没有数据时声称完成这些验证。
至少一个合法真实数据集完成同步对照、真实误报/覆盖结果可审阅后，才可申请真人阶段验收；目前保持BLOCKED。
PR #1/#4/#6和新PR全部保留待人工审查，不合并。
