# PR #4 复审：工程对照与真人数据阻塞

日期：2026-10-22。逐项回应 [最新审查](https://github.com/feixu9564-boop/XinYun-AI-Test/pull/4#pullrequestreview-5608437811)。
PR #1 和 #4 保持未合并；不改生产部署、不增加模型或心理评分。**真人精度、临床有效性全部未验证。**

## 1. 三模型官方同输入数值对照与修复

修复两个问题：桥接 resize/标准化的 float32 舍入路径与官方不一致，现对齐官方 float64 resize/Standardized、float32 DiffNormalized 写入步骤；
EfficientPhys 输入 Standardized，但输出标签是 DiffNormalized，旧桥接遗漏输出累积和，现修正。
输出标签不再由输入归一化类型推断。

使用锁定 `b7500b848f84ad7f86e277b4612563b69f4f88f9` 的真实 checkpoint、CPU、seed2026，同一个480帧空间变化合成 RGB ROI。
输入 SHA256、权重/源码/配置 SHA256、形状、最大绝对差、RMSE、allclose 阈值与硬件见
[parity.json](logs/review-r1/validation/parity.json) / [执行日志](logs/review-r1/validation/parity.log)。
脚本直接执行官方 `BaseLoader.preprocess/crop_face_resize/chunk`、`Trainer.test`、`_reform_data_from_dict` 原方法；
通过 AST 选择原方法避免导入无关训练/检测依赖，未复制官方实现。
仅在权重加载处强制 `weights_only=True` 并移除 `module.` 前缀，在指标入口捕获真实输出；没有模拟模型 forward。

| 模型 | batch=1 预处理 max abs | 完整块共同前缀 max abs | 同补帧扩展480点 max abs | 累积和重建 max abs | 官方点数 / 桥接点数 | 补帧数 |
|---|---:|---:|---:|---:|---|---:|
| PhysNet | 0 | 0 | 0 | 0 | 384 / 480 | 32 |
| EfficientPhys | 0 | 0 | 0 | 0 | 360 / 480 | 60 |
| PhysFormer | 0 | 0 | 0 | 0 | 480 / 480 | 0 |

**范围限制：** 两路都从相同已裁剪 ROI 开始，官方人脸检测关闭；官方 chunk 丢弃尾块，桥接为完整16秒观察补边缘后裁回。
因此分别比较官方完整块前缀和显式补帧扩展，不能把补帧说成官方行为，或称完整端到端等价。
重建比较止于按输出标签做累积和；官方后续平滑去趋势、带通、periodogram 与本框架线性去趋势/Hann/FFT 不同，未纳入等价结论。
单个合成输入也不代表所有数据和设备都一致。

官方推理配置 batch=4 与桥接 batch=1 的原始输出另外实测：

| 模型 | max abs | RMSE | atol=1e-6, rtol=1e-5 |
|---|---:|---:|---|
| PhysNet | 4.35114e-6 | 1.35284e-6 | 不全通过，CPU批量数值差异 |
| EfficientPhys | 0.0624266 | 0.00364647 | 不通过，跨块内部差分/时移边界变化 |
| PhysFormer | 3.27826e-7 | 8.39918e-8 | 通过 |

这些是网络输出单位，不是 BPM。桥接固定 batch=1 隔离每块，差异保留在日志中；未放宽阈值掩盖官方配置差异。

## 2. 16秒 FFT、峰值插值和负例

默认仍用0.7–3Hz FFT bin峰值，栅格 **3.75 BPM**。新增可选 log-power 抛物线峰位插值，
仅对频带内双侧邻点使用，限制偏移在半个 bin；频带边界不插值，未改变 benchmark 默认估计器。
27组纯正弦（9个频率×3相位）上 bin 最大绝对误差1.5 BPM，插值最大绝对误差0.051732 BPM，仅限该理想输入。
这些输入及3个谐波/运动负例的原始结果见 [spectral.json](logs/review-r1/validation/spectral.json)。

- 纯正弦插值误差测试阈值为0.08 BPM，仅说明该合成波形上的峰位定位，不能声称真人准确性提升或频率分辨率提高。
- 72 BPM基波叠加强二次谐波会识别成约144 BPM。
- 72 BPM基波叠加更强周期运动会识别成约96 BPM。
- 只有周期运动、没有脉搏，也会返回约96 BPM。

负例测试**明确断言错误心率仍会出现**，不是声称已有伪影拒绝能力。插值不解决谐波消歧、运动识别、信号身份或质量判定。

## 3. 许可、数据与真人评测

获准真人录制 **0**，真实参与者 **0**，同步PPG/ECG对照窗口 **0**。
再次核查锁定源码 LICENSE 和发布目录：源码受 Responsible AI Source Code License v1.1 限制；未找到权重独立许可文件。
公开下载入口、checkpoint存在、操作者 acknowledge 均不能代替授权。
UBFC/PURE/iBVP 的本项目授权、本地同步数据、时钟和参考转换核验均缺少；详见 [许可与数据阻塞表](../docs/model_inventory.md)。
**真人评测 blocked，不下载真人视频、不编造分数。**

| 算法 | 真人 MAE/RMSE/bias | 真人覆盖/失败率 | 当前状态 |
|---|---|---|---|
| POS / CHROM | 未验证 | 未验证 | 合成工程通过，未取得真人数据 |
| PhysNet / EfficientPhys / PhysFormer | 未验证 | 未验证 | 限定范围官方对照通过；权重独立授权与真人数据仍待核验 |
| PhysMamba | 未验证 | 未验证 | CPU无 CUDA/mamba_ssm，未加载/推理，无替代输出 |

授权与同步参考具备后，先UBFC小样本 smoke（PURE训练权重→其他数据集），核查参与者跨库重复身份；
冻结受试者级 train/validation/test 清单后全量运行，记录 MAE/RMSE/bias、覆盖/失败率、所有拒绝窗口和可靠条件分层。
继续阻止 PURE训练权重在PURE上冒称跨库泛化；没有训练参与者清单时不能证明绝无身份重叠。
只有原始PPG/ECG时须先验证参考HR转换及延迟。计划不代表本次已经完成真人评测。

## 4. 当前测试、复现与历史证据

当前 [76项测试日志](logs/review-r1/validation/pytest.log)、[命令/退出码](logs/review-r1/validation/commands.json)、
[smoke记录](logs/review-r1/validation/smoke/windows.jsonl)、[完整记录](logs/review-r1/validation/full/windows.jsonl)、
[完整汇总/硬件/耗时](logs/review-r1/validation/full/summary.json)。
新增测试覆盖可选插值、频带边界、谐波/运动已知失败、EfficientPhys重建和常量预处理。
基础无模型流程的日志另存 [base-validation](logs/review-r1/base-validation/commands.json)。

fixture是同一生成MJPG视频的两个条目，subject_id只验证分组，**不是两名真人或独立生理证据**。
故障注入使第二条记录的后16秒窗口参考缺失，六算法共同拒绝，保留全部分母。

安装基础和CPU模型锁定依赖、准备本地锁定toolbox后：

```bash
bash scripts/test-benchmark.sh --out outputs/review-r1 \
  --toolbox /tmp/rppg-toolbox --acknowledge-toolbox-license
```

该命令按76项测试→FFT实验→三模型官方对照→smoke→full顺序执行。输出目录必须不存在。
smoke/full因阻塞/拒绝返回1，校验脚本核对预期状态后返回0；不表示六算法全部可用。
只需基础流程时省略toolbox与acknowledge参数，四个深度模型明确blocked。

`logs/final-validation/`、`model-probe.*` 是修复前历史，不再作为当前重建波形正确性证据，旧日志保持原样可审计。
本次只提交源码、报告和非真人文本日志，无权重、真人录像、密钥或生产部署变更。

## 5. 本次合成基准实测摘录

smoke：12行，10成功、2 PhysMamba阻塞、0推理异常；full：24行，15成功、6缺失参考拒绝、3 PhysMamba阻塞、0推理异常。
五个可运行算法的合成 MAE/RMSE=0.75 BPM、bias=−0.75 BPM、覆盖率75%、失败率25%；
PhysMamba误差=null、覆盖率0%、失败率100%。这只是生成器72 BPM与默认FFT的71.25 BPM之差，**不作算法排名或真人精度证明**。
基础无模型流程也实际完成：full为6成功、6拒绝、12阻塞，无推理异常，工程校验退出0。

本机 Python3.12.14 / NumPy2.2.6 / OpenCV4.12.0 / torch2.6.0+cpu，Intel Xeon Platinum 8573C，无GPU，torch2线程。
完整合成基准总耗时 48.29 秒。成功窗口平均推理耗时包含resize/normalize/forward/HR，不含公共解码/对齐；加载耗时另列于summary。

| 算法 | 秒/16秒窗 |
|---|---:|
| CHROM | 0.1975 |
| EfficientPhys | 5.0396 |
| POS | 0.2082 |
| PhysFormer | 7.4084 |
| PhysMamba | 未运行 |
| PhysNet | 2.4152 |

无训练、付费API或云GPU。未计量峰值内存或金额；模型和权重保留本地。
