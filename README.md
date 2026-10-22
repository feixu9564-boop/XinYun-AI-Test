# XinYun AI — 离线 rPPG 基准研究

Issue #3：POS、CHROM、PhysNet、EfficientPhys、PhysFormer、PhysMamba 六算法统一离线评测框架。
仅做心率生理信号研究，不做焦虑、情绪、HRV、呼吸或医疗诊断。**没有真人精度结果。**

从最新 main 独立开发。未合并/覆盖 [PR #1](https://github.com/feixu9564-boop/XinYun-AI-Test/pull/1)，
不依赖它的浏览器服务；后续可接入经校验的时间戳/ROI 导出。没有修改生产部署。

## 安装和测试

Python 3.12.x，Linux x86_64 CPU；不需要 Node。基础依赖完全固定在 `requirements-benchmark.lock`。
推荐至少2 CPU、4GB RAM、1GB空闲磁盘；包含三个深度模型时建议8GB RAM/2GB空闲磁盘。
这些是本工程配置建议，不是实时推理性能保证。基础安装需 PyPI 网络，随后基础测试可离线执行。

一条安装命令：

```bash
bash scripts/install-benchmark.sh
```

一条测试命令（40项测试→合成视频 smoke→完整合成样本，日志在新的 `outputs/validation/`）：

```bash
bash scripts/test-benchmark.sh
```

输出目录已存在时使用 `--out outputs/validation-2`，不覆盖历史证据。工程检查通过不表示被阻塞模型通过。
基础安装不会下载模型或真人数据，四个深度模型明确输出 blocked；POS/CHROM 实际运行。
测试视频由程序生成，**不能证明真人心率准确性**。

## 可选：实际检查三个 CPU 深度模型

先阅读 [模型与许可清单](docs/model_inventory.md) 和上游条款。
当前上游确实原生包含四模型及权重，但 PhysMamba 还需要兼容 CUDA/mamba_ssm/timm。
CPU 验证环境的全部已安装版本见 [environment.freeze.txt](reports/logs/environment.freeze.txt)。
以下 clone 约663MB（含多个发布模型）；源码/权重保留本地，不提交本仓库。

```bash
.venv/bin/python -m pip install -r requirements-models-cpu.lock
# 使用本地目录，不复制到仓库：
git clone https://github.com/ubicomplab/rPPG-Toolbox.git /tmp/rppg-toolbox
git -C /tmp/rppg-toolbox checkout b7500b848f84ad7f86e277b4612563b69f4f88f9
.venv/bin/python -m benchmark.probe --toolbox /tmp/rppg-toolbox \
  --acknowledge-toolbox-license --out outputs/model-probe.json
bash scripts/test-benchmark.sh --out outputs/validation-models \
  --toolbox /tmp/rppg-toolbox --acknowledge-toolbox-license
```

probe 输出父目录需已存在（例如 `mkdir -p outputs`）。CPU probe 因 PhysMamba 被阻塞返回1，并保留逐模型证据。
测试脚本验证 smoke/full 的已知阻塞与故障注入，不把 exit1 隐藏成全模型成功。
CUDA 版本仍未验证，暂不提供声称能运行 PhysMamba 的安装命令；在兼容 GPU 环境验证编译依赖后才能标记跑通。

## 已授权数据的离线评估

获取限制、输入字段和预处理差异见 [protocol.md](docs/protocol.md)。使用本地获准视频、真实逐帧时间戳、同步参考设备 HR，
通过 `python -m benchmark.prepare` 生成 NPZ，并填写 [manifest.example.json](benchmark/manifest.example.json)。
先 smoke，再完整运行；同一 manifest、同一16秒窗口用于全部六算法：

```bash
.venv/bin/python -m benchmark.run data/manifest.json --out outputs/smoke --smoke \
  --toolbox /tmp/rppg-toolbox --acknowledge-toolbox-license
.venv/bin/python -m benchmark.run data/manifest.json --out outputs/full \
  --toolbox /tmp/rppg-toolbox --acknowledge-toolbox-license
```

有拒绝/缺失/阻塞返回1、输入错误返回2；只有所有窗口全部成功才返回0。
脚本输出窗口级 JSONL、按算法/受试者/可靠条件分层的指标、所有被拒绝窗口、硬件/时间/哈希/模型状态。
数据、结果和权重默认本地处理；提交的日志仅为生成的合成测试，不包含真人录像。

实际结果与限制见 [reports/comparison.md](reports/comparison.md)。模型加载成功不等于算法准确、临床有效或许可证无限制。
