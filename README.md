# XinYun AI — 手机摄像头心率研究与离线基准

## 当前：Issue #9 手机测试版本

[打开独立 HTTPS 手机测试站](https://xinyun-mobile-research-20261022.tasty-iris-5068.chatgpt.site)
（所有者私有，可能需要登录同一 ChatGPT 账号）。请用 iPhone Safari 或 Android Chrome。
填写匿名编号、确认成年自愿参与，点击开始并允许摄像头，固定手机正对面部至少16秒。
支持停止/重测、指夹参考值、成功与失败记录、本地保存、CSV/JSON下载与CSV分享。
不上传或保存视频，不做医疗/心理诊断。**尚未真机验证；真人准确性未验证。**

本分支基于 PR #8，选择性复用 PR #1 网页和锁定模型依赖，移植 PR #6 POS/CHROM质量门。
没有合并任何旧PR。新的独立站点与原生产系统无关。

```sh
npm ci --ignore-scripts
npm run build
npm start
```

本机开发页面为 `http://127.0.0.1:4173`，手机必须使用上方HTTPS网址或独立HTTPS部署。
自动化：`npm test`；安装Playwright浏览器后运行 `npm run test:browser`（先启动页面）。
完整日志：安装 `requirements-benchmark.lock` 后，运行
`python scripts/validate-mobile.py --out outputs/mobile-new`。

[第五阶段报告](reports/phase5.md) · [手机使用/部署/CSV规范](docs/mobile-testing.md) · [执行日志](reports/logs/phase5/release)

## 历史：Issue #7 第四阶段（真实数据 BLOCKED）

用户已确认没有已获批的真人数据或可用IEEE DataPort账号。本分支继续PR #6的代码，交付
UBFC DATASET_2本地接入、官方渠道审计、材料/哈希/同步/受试者划分验证和完整工程日志。
没有真实准确率结果，没有阈值调优；PR #1/#4/#6及本分支均不合并，不修改生产部署。
当前结果以 [第四阶段报告](reports/phase4.md) 和 [数据许可与接入指南](docs/phase4-data-access.md) 为准。

安装 `requirements-benchmark.lock` 后，一键复现本轮工程验证：

```text
python scripts/validate-phase4.py --out outputs/phase4-new
```

该命令执行单元/导入测试、明确阻塞的真实数据预检和原有PR #6对抗回归，不下载真人视频。
真实结果表全部NOT_RUN/null；真实窗口CSV只有表头，JSONL为空，不虚构匿名受试者或窗口。
CI工程通过不代表真人验收通过。待取得授权文件后，按接入指南运行 `python -m benchmark.ingest_ubfc`。

## 历史：Issue #5 第三阶段（BLOCKED，待审查，不合并）

新增信号质量拒绝、13类对抗场景、逐窗CSV与受试者簇置信区间。
**真实视频评测仍为0，阈值未在真人验证集标定；仍有已记录的周期性色彩干扰误报。**
本分支基于未合并的 PR #4，完整增量说明、99项测试、六算法状态及下载失败证据见
[第三阶段报告](reports/phase3.md)与[数据许可核查](docs/phase3-data-license.md)。下面的 PR #4 章节保留为历史背景，最新状态以第三阶段报告为准。

安装依赖后跨平台执行：`python scripts/validate-benchmark.py --out outputs/phase3-new`。
真实输入还需逐帧质量CSV（`timestamp_s,face_count,roi_valid`，时间与帧CSV逐行一致），
导入时加 `--quality-csv data/quality.csv --quality-source "核验方法与证据位置"`。
缺少核验信息时拒绝输出；不能把全1人工占位作为真实检测结果。

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

一条测试命令（76项测试→FFT插值/伪影实验→合成视频 smoke→完整合成样本，日志在新的 `outputs/validation/`）：

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
提供 toolbox 并确认条款时，测试命令还会运行三模型同输入官方管线数值对照。以下 clone 约663MB（含多个发布模型）；源码/权重保留本地，不提交本仓库。

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

## PR #4 复审复现

最新修复、数值差异与阻塞逐项见 [比较报告](reports/comparison.md)。旧 `final-validation/` 是修复前历史记录，
当前日志在 `reports/logs/review-r1/validation/`。已修正 EfficientPhys 输出累积和和三模型预处理 dtype。

安装基础和可选 CPU 依赖并准备锁定 toolbox 后，一条命令执行76项测试、FFT实验、官方数值对照、smoke/full：

```bash
bash scripts/test-benchmark.sh --out outputs/review-r1 \
  --toolbox /tmp/rppg-toolbox --acknowledge-toolbox-license
```

单独复现（输出路径必须不存在）：

```bash
.venv/bin/python -m benchmark.parity --toolbox /tmp/rppg-toolbox \
  --acknowledge-toolbox-license --out outputs/parity.json
.venv/bin/python -m benchmark.spectral_check --out outputs/spectral.json
```

对照直接执行锁定源码中的 BaseLoader 和 Trainer.test 方法，以 AST 选择原方法，避免引入训练/人脸检测依赖；
安全加载使用 `weights_only=True`，只在指标入口捕获输出。共享 ROI、CPU、batch=1 的结果与官方配置 batch=4 差异分开记录。
官方丢尾块，本框架补帧；共同有效前缀与补帧扩展分别比较。比较的重建波形止于累积和、在 HR 去趋势/滤波之前；
没有验证官方面部检测、原始数据集解码或全部 HR 后处理等价。峰值插值是可选实验，默认基准仍是3.75 BPM栅格，
谐波/运动可产生错误心率。真人授权、同步对照与 PhysMamba CUDA 仍阻塞，PR #1/#4 保持未合并。
