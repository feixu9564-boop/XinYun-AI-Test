# 六算法比较：工程验证与真人数据阻塞报告

日期：2026-10-22。关联 Issue #3；不合并 PR #1 或本 PR。**没有真人精度结论，也没有临床或情绪解释。**

## 数据来源与真实结果

获准真人录制 **0**，真实参与者 **0**，同步 PPG/ECG 对照窗口 **0**。
尚未获准下载/使用带同步参考及可审阅许可的数据；数据获取限制见 [model_inventory.md](../docs/model_inventory.md)。
以下表格如实表示缺失，空白不是零误差：

| 算法 | 真人 MAE | 真人 RMSE | 真人 bias | 真人有效覆盖/失败率 | 状态 |
|---|---|---|---|---|---|
| POS | 未验证 | 未验证 | 未验证 | 未验证 | 合成工程路径通过 |
| CHROM | 未验证 | 未验证 | 未验证 | 未验证 | 合成工程路径通过 |
| PhysNet | 未验证 | 未验证 | 未验证 | 未验证 | 权重加载/合成推理已跑通；许可限制 |
| EfficientPhys | 未验证 | 未验证 | 未验证 | 未验证 | 权重加载/合成推理已跑通；权重单独许可未确认 |
| PhysFormer | 未验证 | 未验证 | 未验证 | 未验证 | 权重加载/合成推理已跑通；上游流水线等价性未验证 |
| PhysMamba | 未验证 | 未验证 | 未验证 | 未验证 | 环境阻塞，无 CUDA/mamba_ssm；权重存在且哈希已校验 |

## 实际工程测试与原始日志

- [pytest.log](logs/final-validation/pytest.log)：40项自动化测试，输入时间戳/参考对齐、不同 FPS/掉帧、无效亮度、缺失参考、错误文件/哈希、受试者泄漏、分层分母、指标计算及真实视频编解码路径。
- [model-probe.json](logs/model-probe.json) / [完整 probe 日志](logs/model-probe.log)：三个深度 checkpoint 在 CPU 上严格加载、随机非生理像素输入推理，输出各480点；PhysMamba 原因逐项记录。probe 因阻塞返回1，不当作六模型通过。
- [commands.json](logs/final-validation/commands.json)：实际命令和退出码；[smoke.log](logs/final-validation/smoke.log) → [full.log](logs/final-validation/full.log)，按此顺序执行。
- [smoke 窗口原始记录](logs/final-validation/smoke/windows.jsonl)、[smoke 指标/硬件](logs/final-validation/smoke/summary.json)；[完整窗口记录](logs/final-validation/full/windows.jsonl)、[完整指标/硬件](logs/final-validation/full/summary.json)。逐受试者/条件结果和所有拒绝窗口都在原始导出中。
- 环境 [freeze](logs/environment.freeze.txt)：CPython3.12.14，NumPy2.2.6，OpenCV4.12.0，PyTorch2.6.0+cpu；AMD EPYC9V74，torch2线程，CUDA不可用。

工程 fixture：程序生成两个32秒、30 FPS的 MJPG **非真人**录制条目，均来自同一个生成的视频，两个 subject_id 只用于验证分组，不代表独立的人。
真值为生成器声明的72 BPM；第二条记录20秒位置注入参考 NaN。
smoke 每条取第一个16秒窗，共2窗×6算法=12行；10成功、2 PhysMamba阻塞。
full 共4窗×6算法=24行；15成功、6缺失参考拒绝、3 PhysMamba阻塞、0推理异常。
后者 NaN 被所有六算法共同拒绝，不能仅删除失败模型的窗口。

下面数值只用于核对编解码→推理→指标导出，**不是生理精度或算法排名**。
五个可运行算法的合成 MAE/RMSE=0.75 BPM、bias=−0.75 BPM、有效覆盖75%、失败率25%；
来自16秒FFT栅格的71.25 BPM与生成器72 BPM之差，周期性生成像素也可能被模型解释为周期，不能视作独立生理证据。
PhysMamba合成 MAE/RMSE/bias=null、覆盖0%、失败率100%。

计时与开销逐项见下方自动摘录及 summary。推理耗时包含模型专属预处理和HR计算，不含公共解码/对齐；加载、整体运行时间单列。
没有训练、没有付费API或云GPU使用；本地上游 clone 约663MB，CPU torch wheel约179MB，测试/推理占用CPU与磁盘。未计量峰值内存或实际金额。

## 未解决问题与下一步

1. 取得适用研究授权、同步参考说明及本地真人数据（优先 UBFC 与 PURE 权重跨数据集）；没有授权时不上传、不申请签署或下载真人素材。
2. 核对代码及单独权重条款、训练参与者清单与跨库重复身份。程序阻止同一subject跨split及 PURE权重测PURE，但无法自动证明所有预训练身份不重叠。
3. PhysMamba需兼容GPU/CUDA及扩展依赖验证；未运行，没有用POS或其他模型冒名。
4. 当前是通用本地视频+时间戳+参考HR适配器，不是所有数据集原始文件的专用导入器；仅有PPG/ECG波形的库须另行验证参考HR转换。
5. 固定皮肤ROI需人工核验，对大头动不够稳健；模型归一化/边缘补帧/分块需与上游同样本对照，检查谐波、运动/光照伪影和阈值敏感性。
6. 获授权后先少量参与者 smoke，逐项检查时钟延迟和失败原因，通过后冻结清单做全量评测；按真实受试者/可靠光照运动标签分层，肤色无合法可靠标签则不分析。
7. 下一阶段真人摄像头验证：经参与者同意，独立测试参与者与同步接触式PPG/ECG，记录照明、静息/说话/头动和相机FPS；预先固定协议并保留全部拒绝窗口。未经对照不声称准确、稳定、临床有效，不开展HRV/呼吸/心理评分。

本PR只交付可审查离线框架与诚实阻塞清单，不修改生产部署，等待人工审查。

## 本次完整合成工程运行计时

| 算法 | 成功推理均值（秒/16秒窗） |
|---|---:|
| CHROM | 0.2226 |
| EfficientPhys | 4.8458 |
| POS | 0.2038 |
| PhysFormer | 7.7963 |
| PhysMamba | 未运行 |
| PhysNet | 2.2965 |

完整合成基准命令实际总耗时 49.28 秒。非真人性能数据，不能外推到浏览器实时应用。
