# XinYun AI — Camera Physiological Signal Research

心云 AI：普通摄像头非接触式生理信号研究原型。**仅供研究参考，不用于医疗诊断。** 不将心率解释为焦虑，不提供心理评分。

## 运行

需要 Python 3.10+、Node.js 20+、npm，及支持 WebAssembly、摄像头 API 的现代桌面浏览器（优先 Chrome/Edge）。

```bash
cd /workspace/XinYun-AI-Test  # 或你本地的仓库目录
bash scripts/install.sh
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

本机浏览器访问 `http://localhost:8000`。在远程机器访问必须自行配置 HTTPS 和摄像头权限；云机器上的 localhost 不等于用户电脑的 localhost。不要直接把开发服务器暴露到公网。

首次安装需要访问 PyPI 和 npm registry。MediaPipe JS、WASM、模型随固定版本 npm 包下载，通过本站静态目录提供，安装后测量无需访问第三方。`package-lock.json` 固定 npm 依赖及完整性。Python 顶层依赖固定版本，间接依赖尚未完全锁定。模型资源不提交 Git，重建请运行安装脚本，保留上游包内说明。安装流程不下载或运行远程 shell 脚本。

点击「开始测量」主动授权摄像头，正对镜头保持均匀光照和静止，画面仅一人。至少积累 15 秒连续有效采样，使用最近 20 秒滚动窗口每秒更新，45 秒自动结束；可随时停止或重新测量。切换到后台自动停止。拒绝授权后可修改浏览器权限再重试。

## 架构与目录

- `backend/main.py`：FastAPI 提供静态页面及 `/api/health`，没有视频上传、数据库或推理接口。
- `web/app.js`：摄像头生命周期、MediaPipe Face Mesh、额头/双颊多边形采样、实时结果与会话汇总。
- `web/signal.js`：可独立测试的 POS/CHROM、时间戳重采样、频谱与质量门控。
- `web/index.html`、`style.css`：中文响应式界面，视频左侧、指标和波形右侧。
- `scripts/install.sh`：可重复执行的依赖安装和本地模型资源准备。
- `tests/`：信号单元测试、FastAPI/静态模型资源测试。

视频和 RGB 序列仅在浏览器内存处理，无录像、持久化、第三方分析或上传。摄像头停止后关闭媒体轨道。会话内只保留通过门控窗口的时间、心率、质量摘要；刷新即消失。后台服务只接收页面和资源请求。FastAPI 返回限制第三方连接的 CSP。旧版 MediaPipe 的 Emscripten 包装需要 CSP `unsafe-eval`，扩大了脚本执行权限；第三方连接仍被禁止。生产环境应迁移并评测较新运行时，完成安全审查和依赖维护。

## 算法与限制

1. MediaPipe Face Mesh 定位人脸；额头、双颊内侧多边形作为候选皮肤区域，避开眼和嘴。
2. 稀疏像素采样，排除近黑与饱和像素，计算三个区域合并的 RGB 均值。避免固定肤色阈值，但这并不保证肤色公平性；遮挡、化妆、胡须及 ROI 偏移仍会污染信号。当前没有语义皮肤分割。
3. 使用真实采样时间戳线性重采样。1.6 秒窗口归一化 RGB，投影后按标准差比组合，Hann 加权重叠相加：POS 使用 `G-B` 与 `G+B-2R`；CHROM 使用 `3R-2G` 与 `1.5R+G-1.5B`。
4. 波形去线性趋势、加 Hann 窗，在 0.7–3 Hz（42–180 次/分钟）范围做 DFT 峰值估计。显示波形为 POS 投影信号，非心电图，也不是诊断性脉搏波。
5. 门控：至少 15 秒、有效帧率 ≥12、帧间最大间隔 ≤250ms、均值亮度 30–235、平均归一化运动 ≤0.012。丢脸或采样中断重置连续窗口。
6. 两算法心率差 ≤6 次/分钟，各自峰值 ±0.12Hz 的带内能量占比均 ≥0.5，质量分数 ≥50 才显示心率。质量分数为频谱集中度、算法一致性和运动惩罚的启发式组合，不是概率、准确率或临床置信区间。

这些门槛尚未由真人数据标定。相同光照伪影也可能同时欺骗两个算法；算法一致不构成独立验证。没有生理周期信号的常量输入必须被拒绝，但周期性运动仍可能产生假阳性。频率分辨率由窗口时长决定；未做峰值插值或谐波消歧。范围外心率无法可靠评估。亮度与运动门控可能对不同人群产生偏差。

选择经典投影法是因为可解释、无需训练、适合低依赖浏览器原型，**不代表它们最准确**。这是便于研究的工程实现，尚未逐项复现原论文全部处理细节。参考：

- de Haan & Jeanne, *Robust Pulse Rate From Chrominance-Based rPPG*, IEEE TBME (2013), DOI: 10.1109/TBME.2013.2266196。
- Wang et al., *Algorithmic Principles of Remote PPG*, IEEE TBME (2017), DOI: 10.1109/TBME.2016.2609282。
- https://github.com/phuselab/pyVHR
- https://github.com/ubicomplab/rPPG-Toolbox
- https://github.com/google-ai-edge/mediapipe

pyVHR / rPPG-Toolbox 预留作离线评测参考，未集成，也未声称结果与其一致。OpenCV 在后续离线视频与参考信号评测中有用；当前纯浏览器路径无需后端 OpenCV 或 Python MediaPipe。

## 测试

```bash
npm test
.venv/bin/python -m pytest -q
```

Node 测试验证 54/72/108/150 BPM 合成颜色信号恢复、恒定输入拒绝、短记录、低帧率、运动、暗光/过曝、断帧、无效值和时间戳抖动。合成信号不代表真人表现。Python 测试验证页面、健康检查、隐私头、无视频上传路由和本地模型资源。

本次实际测试与未测范围见 `VALIDATION.md`。

## 后续验证与研究接口

`researchSnapshot()` 导出纯标量的版本化窗口摘要，预留呼吸、HRV、问卷模块状态。没有开启这些估计，也没有心理评分。心率会话摘要不是 HRV；在验证逐搏间期精度之前禁止进行 HRV 解释。

下一阶段需征得参与者同意，使用同步接触式 PPG/ECG 参考，评估静息、说话、头动、不同照度/肤色/摄像头；明确参考设备延迟和窗口对齐。报告 MAE、RMSE、偏差/一致性界限、有效覆盖率、拒绝率及按人群/条件分层结果，同时统计拒绝窗口，避免只报告成功样本。为不同算法保持同样的数据划分与预处理，评估谐波误判和参数敏感性。未经该验证，不宣称摄像头可稳定准确测量真人心率。

可选浏览器集成测试（需先启动服务）：`CHROMIUM_PATH=/usr/bin/chromium node tests/browser-smoke.cjs`。没有系统 Chromium 时可用 `npx playwright install chromium` 安装匹配浏览器后省略该环境变量。测试使用假摄像头，验证本地模型加载、无脸拒绝及停止/重启流程，不验证真人心率。
