# Issue 12 根因调查（0.6.3-rc）

所有“已经验证”仅限其明确范围；合成验证不是人体准确性验证。真机状态：**DEVICE_TEST_REQUIRED**。分支 `fix/issue-12-rppg-root-cause`（基于 3528e13），未合并、未部署生产。

## CI 回归修复

- `benchmark.yml` 在全新 venv 中安装 `requirements-benchmark.lock` 后运行 `validate-phase4.py`；新增独立参考测试在收集时导入 `scipy.signal.detrend`，原锁文件缺少 SciPy。最小修复仅补充 `scipy==1.16.3`，保留参考测试及所有断言。该版本的[官方依赖声明](https://github.com/scipy/scipy/blob/v1.16.3/pyproject.toml)为 Python ≥3.11、NumPy ≥1.25.2 且 <2.6，兼容 CI 的 Python 3.12 与 `numpy==2.2.6`。
- 检查新增测试、`check-issue12-reference.py`、`plot-*.py` 及 CI 调用路径后，没有发现其他必需而未锁定的 Python 包。Matplotlib 仅用于独立绘图脚本（包括 `npm run evidence:issue12` 的绘图步骤），pytest 和 `validate-phase4.py` 不导入或执行它们，因此不加入 benchmark 锁文件；本地绘图仍需另行安装 Matplotlib。
- `validate-phase4.py` 动态枚举 `benchmark/*.py`、`scripts/*.py`、`tests/*.py` 和锁文件生成 `source-hashes.json`；新增 Python 文件会自动纳入，绘图脚本只读取源码计算哈希，不执行导入。没有固定源码文件数或旧哈希断言需要更新；真实数据 inventory 和 624 行合成回归断言不受本次依赖修复影响。
- **已经验证（复现与修复）**：协调人按 CI 方式在全新 clone 中用 Python 3.12.15 + `bash scripts/install-benchmark.sh` 建 `.venv` 后运行 `.venv/bin/python scripts/validate-phase4.py --out outputs/phase4-validation`：c6dacda 原锁文件下复现同样的 `Unexpected failure: …/pytest.log`（`ModuleNotFoundError: No module named 'scipy'`，与 GitHub run 40158181387 的 pytest.log 一致）；补充 `scipy==1.16.3` 后同一流程 `129 passed`、validate-phase4 退出 0。
- 本地 `/workspace/xy-venv` 下 validate-phase4 在 `environment.freeze.txt` 失败的原因是该 venv 的 pip 自身损坏（`No module named 'pip._internal.operations.build'`，`pip freeze` 无法运行），属本机环境问题，与仓库代码无关。

## Phase 1（先于任何源代码修改完成）

审计基线：3528e13（web 0.6.1）。以下行号均指该基线，可用 `git show 3528e13:路径 | nl -ba` 独立复核。

|阶段|文件、函数、行号|实际输入 → 输出|拒绝/失败分支|
|---|---|---|---|
|1 摄像头|web/app.js start 135–160；frame 113–119；web/frame-pump.js tick 42–53 / select 25–40|前置 ideal 640×480、30 FPS → **320 像素宽**等比例冻结 canvas；同一 canvas 送模型和取色；performance.now()/1000 为秒|权限、相机、模型错误 app 145–161；busy、48 ms 限速、未解码/未前进帧不提交；send 拒绝计 inference_errors；无帧 watchdog app 130–133|
|2 人脸|app onResults 95–100；start 153–154|FaceMesh maxNumFaces=2、置信度 .6 → landmarks；恰好一脸才取 ROI|no_face / multiple_faces；landmark 越界 face_out_of_frame；旧 token 回调忽略|
|3 皮肤区域|web/roi.js faceGeometry 4–11 / sampleROI 13–31|额头、左右颊三多边形（索引 3）→ 有效点集合|landmark 非有限、边缘、宽 .20–.85、左右比例 .55、倾斜 .15；所谓 skin 是 RGB 每通道 10–245 的启发式，**不是皮肤分类器**；每区至少20点、总80点、有效率≥.8|
|4 RGB|roi sampleROI 16–40|每多边形 bounding box **12×12 点网格**，floor 到单像素，isPointInPath → 所有有效点等权 RGB 均值；最多432候选点|前后有效对应点少于80 → unstable_roi；网格随 landmark 移动，会更换空间像素；不是全区域积分|
|5 时间与采样|app 99–110；frame-pump 7,44–48；web/measurement.js observe 20–41|提交前单调时钟秒 → sample.t；有效帧连续45秒；analyze fs=(N−1)/(t末−t首)|即时 gap>.25秒、推理延迟>.25秒、motion>3、displacement>.012、曝光异常使当前段作废；状态机明确提示重新对准，从45秒重新采样，**不拼接**；分析 duration<15、gap>.25、fs不在12–65拒绝|
|6 归一化/去趋势|web/signal.js analyze 63–64；extract 4–17；spectrum 24–30；benchmark/signal.py pulse 5–24 / heart_rate 33–40|按平均 fs 线性重采样；1.6秒局部 RGB/通道均值−1；波形局部去均值、Hann 加权重叠；频谱前线性去趋势|RGB 非有限、格式错误；局部通道均值<1跳过（Python ≤0报错）；常量波形拒绝|
|7 滤波|signal.js 23–34；signal.py 40–42|**没有时域带通滤波**；Hann 后仅扫描 .7–3 Hz DFT 频点|带外功率不计入谱门；不能仅由“没有带通”推断实际手机失败|
|8 POS|signal.js extract 10–15；signal.py 18–23|归一化 r,g,b → x=g−b，y=g+b−2r；h=x+std(x)/std(y)·y → 加权波形|analyze 在62行提前返回时完全不调用；分母下限1e−10|
|9 CHROM|同上|x=3r−2g，y=1.5r+g−1.5b；h=x−std(x)/std(y)·y → 波形|同上；当前实现无原论文带通步骤，不能宣称完整原论文实现|
|10 谱峰|signal.js spectrum 23–42；benchmark/quality.py reliable_heart_rate 62–89|线性去趋势+Hann、.7–3 Hz DFT → 最大频点候选 BPM（无插值）|<4秒/非有限、std<1e−8、功率<1e−12；主峰±1 bin集中度<.60 → diffuse_spectrum；半频±1 bin/峰>.04 → harmonic_ambiguity；±1 bin以外最大/峰>.04 → competing_periodicity|
|11 输入质量门|signal.js analyze 44–62；quality.py input_quality 22–59|单脸有效ROI、motion和displacement → lightCV、motion P95、chromaStd|max亮度235/min30；motion>3或位移P95>.012；lightCV>.08；**max std(R/(R+G+B),G/总,B/总)<.0005** → no_chromatic_pulse_evidence；Python 对帧空间降采样、运动残差后用同一颜色门|
|12 最终输出|signal.js 65–69；app recordWindow 29–36 / stop 74–93|两个谱均合格且相差≤6 BPM → POS四舍五入至0.1、quality=100×较小集中度；否则 bpm/pos/chrom=null，score=0|任一谱拒绝取POS原因优先；不一致拒绝；app捕获异常、非有限结果；partial强制失败；session_end持久化并停止相机|

### 精确原因路径

- **已经验证（代码路径）**：`no_chromatic_pulse_evidence` 唯一生产返回点为 signal.js:62（Python twin quality.py:57–58）；它在 resample/POS/CHROM 的63–65行之前。900 valid samples 是采集条件合格的计数，不代表颜色门合格。该门测量颜色比例的波动，不能判断是否存在心率频带周期。
- **已经验证（代码路径）**：`pos_reason/chrom_reason` 只在 signal.js:66、两个 spectrum 完成后赋值。app.js:35（window）、:87（session_end）将未赋值的字段 fallback 为 `not_evaluated`。因此本次不是900帧都被模型丢弃，而是进入算法后在颜色门提前退出；输出为null不是0。
- **根据证据推断（依赖所给日志真实对应此版本）**：45.010秒、900样本、20 FPS、0 inference errors 的会话已经到达颜色门且未通过，**末尾窗口 chromaStd < .0005**。日志没有保存该数值，不能恢复具体值或判断有没有真实脉搏。
- **已经验证（代码路径）**：`diffuse_spectrum` 的生产返回路径为 signal.js:41 → analyze:67；Python quality.py:83–84。意味着曾进入POS/CHROM，但至少一个波形的集中度<.60；不能从该汇总原因推断是运动、ROI噪声还是生理原因。
- **已经验证**：app.js:107仅保留16.1秒；:31仅选末尾16秒。45秒倒计时和900帧不等于45秒全部参加最终频谱。20 FPS下通常约320–321帧、频点间隔约3.75 BPM；45秒约1.33 BPM。
- **尚未验证**：真实手机颜色序列、频谱、ROI噪声、自动曝光影响均不可回放；本仓库无该手机原始RGB。不得把可复现算法缺陷等同于已经定位手机全部故障。

Phase 1 文档已在任何源代码编辑前落盘。后续行号以实际代码及 baseline diff 为准。

## Phase 3 基线证据（先运行原算法，再决定修复）

- **已经验证**：`node scripts/synthetic-matrix.mjs --baseline --label baseline` 在未修改的 signal.js 上运行，90案例、2接受，预先标记 SNR 应充足的 normal/weak/drift/jitter 共32例，0/32接受；30纯正弦，6被拒绝。完整逐例表：[baseline.md](issue-12-artifacts/baseline.md)，原始数据：[baseline.json.gz](issue-12-artifacts/baseline.json.gz)（体积原因仓库内为 gzip；`npm run evidence:issue12` 会重新生成未压缩 JSON），原算法字节快照：[baseline-signal.mjs](issue-12-artifacts/baseline-signal.mjs)。快照 SHA256 保存在 JSON，重生成使用快照而非修复版。
- **已经验证**：16秒60 BPM normal chromaStd=0.0003165045922289561 < .0005，但旁路诊断POS/CHROM集中度=.9895399391389271/.9905628379549325；weak chromaStd=.00012212297872204794，集中度=.9318741837723088/.9245410566604731，候选均59.81308411214953 BPM。旁路诊断只作证据，未替代生产analyze输出。
- **已经验证**：16秒1.03125Hz纯正弦，集中度=.9793784155386815、secondary=.04108033380305337；生产拒绝 competing_periodicity。主瓣仍然高度集中，因此本案例不是 diffuse_spectrum 的数学故障。Hann 两端第一零点相距中心约2 bin，±1之外仍含主瓣；将此功率叫“第二周期”不成立。
- **已经验证**：.12Hz、2.5%共同亮度漂移的60 BPM案例两谱集中度=.9871580649904682/.9890060079064438；本案例未证明缺少带通导致拒绝，不据此加滤波。

### 合成假设及文献范围

- **根据证据推断（模型假设）**：DC=[170,120,100]、绿色AC/DC=.1%（weak）/.3%（normal），红蓝较小；这采用任务要求的.1%–.5%量级，**不是测得手机幅度或已验证全人群范围**。每帧256独立像素，加SD=.5读出噪声再逐像素取整8 bit后平均；noise场景SD=3。20 FPS，jitter场景±8 ms；种子12026。16/45秒均含端点，因此321/901样本；原app时间切片也可能包含321点。
- **已经验证（文献来源范围）**：[Wang等2017作者论文页](https://research.tue.nl/nl/publications/algorithmic-principles-of-remote-ppg/)、[作者预印本](https://pure.tue.nl/ws/portalfiles/portal/31563684/TBME_00467_2016_R1_preprint.pdf)支持皮肤反射模型及POS投影；[de Haan与Jeanne 2013](https://doi.org/10.1109/TBME.2013.2266196)为CHROM来源。文献用于公式及建模背景，不能作为本手机幅度、准确性或具体工程阈值的验证。

## Phase 4 修复决策（证据范围）

- **已经验证：Case B（RGB 中存在有效周期，但质量门逻辑在 POS/CHROM 之前错误拦截）**——在合成数据范围内已证明。按任务书定义：A=原始 RGB 无有效脉搏（ROI/曝光/白平衡等），C=算法正常但手机采集不到有效信号。真实手机是否还同时存在 A/C 问题**尚未验证**（没有手机原始 RGB），不得宣称已排除 A/C 或已修好手机。
- 将颜色方差门改为仅拒绝数值上恒定颜色比例的检查（1e−10数值epsilon）；不再用宽带颜色方差幅度作为“有无脉搏”判据。频带周期证据仍必须由两个独立投影的谱门及一致性通过。此epsilon不代表生理幅度阈值。
- secondary的候选排除范围从±1改为±2 bin，与Hann主瓣匹配；.04阈值不变，集中度±1≥.60、半频≤.04及所有运动/曝光/采集门不变。不加入新插值/带通/ROI策略，不改状态机。
- **已经验证（参考PR范围）**：查看了PR15引用分支diff。该PR也提出诊断trace/per-region RGB；本次独立基线支持添加这些观测信息（且用户明确要求），重新实现。未复用其Butterworth、新POS/CHROM重叠方式、全窗口比较/ROI加权选择等算法改动，因为本次证据尚不足。PR15仍保留.0005门且未修复Hann竞争周期排除范围，不能作为本次修复证明。

### Phase 3/4 最终前后对照（已经验证：合成范围）

|指标|原版基线|修复版|
|---|---:|---:|
|主矩阵案例总数|90|90|
|normal / weak / drift / jitter，4心率×2时长，误差≤5 BPM|0 / 32|32 / 32|
|上述已接受正例最大绝对误差|无已接受结果，不能记作0误差|0.6 BPM|
|含脉搏的高噪声stress接受数（不要求全通过）|2 / 8|4 / 8|
|运动正例拒绝数（有脉搏但遥测不合格）|8 / 8|8 / 8|
|平坦、白噪声、色噪声、motion_only、periodic_light、带外周期，误接受数|0 / 42|0 / 42|
|纯正弦频谱拒绝数（16/45秒、3频率、5 bin偏移）|6 / 30|0 / 30|
|额外不可辨识颜色伪影（不混入正例）误接受|0 / 2|2 / 2，**已知限制**|

逐例门值/阈值、候选、SNR及原因：[baseline.md](issue-12-artifacts/baseline.md)、[after.md](issue-12-artifacts/after.md)；完整JSON同名（仓库内为 `.json.gz`）。JSON中的 `result` 是真正生产决定；`spectra` / `observedGates` 是对相同样本先线性重采样再调用相应版本extract/spectrum的旁路观测，即使生产在输入门退出也计算，**不用于输出BPM或计为生产通过**。修复版 `result.diagnostics.gates` 区分 evaluated / not evaluated；未计算值为null。SNR定义为 `10log10(主峰±1 bin功率/其余带内功率)`，不是与接触式PPG对比的生理SNR，也没有新增一个未经校准的SNR阈值。

- **已经验证**：16秒60 BPM weak修复后59.8 BPM，quality=92；chromaStd仍为.00012212297872204794，未人为增加输入脉搏。POS/CHROM集中度仍为.9318741837723088/.9245410566604731，secondary=.013323189852783399/.016211376351064687，half=0/0，SNR=11.360455617227359/10.882154824734865 dB。修复了错误预门，不是伪造更强的信号。
- **已经验证**：集中度门±1≥.60没有使本次纯正弦失败，保留；secondary≤.04、half≤.04阈值保持，secondary仅排除Hann主瓣±2；没有调低这些质量阈值。
- **已经验证**：时间由performance.now()/1000给出，生产计算fs使用秒；20 FPS样本、毫秒误用、重复时间戳和>250 ms间断均有回归测试。12/20/30/60 FPS直接正弦频率检查通过。无时域滤波器，因此不存在本版本某个带通系数把Hz误作归一化频率的路径。
- **已经验证（公式范围）**：独立NumPy矩阵投影参考与生产POS/CHROM核心系数、局部归一化、当前Hann重叠策略一致。Scipy detrend + NumPy rFFT对照直接JS DFT。360条前/后观测波形最大绝对误差3.408731630294426e−16。修复后180谱指标最大绝对误差1.035838081975271e−13。见[reference-check.json](issue-12-artifacts/reference-check.json)。**这不是完整原论文管线一致性证明**：本项目的hop、重叠方式和CHROM无带通都是已公开的实现变体，尚未用人体验证其最佳性；本轮不改。
- **已经验证（第三处数值一致性修复）**：独立参考发现原版半频掩码用 `abs(f−peak.f/2)<=fs/n` 时，浮点运算可能漏掉边界bin。90例×2方法中40条观测与整数参考不一致（这些样本中半频门通过/拒绝未翻转）；最大指标差.428774213850047。构造321点、主峰k=24、次峰k=13振幅.3时，原版half=.022698132799469518，而真正边界峰比=.09002263190511417。原版仍由secondary拒绝，但错误标为competing_periodicity。修复JS/Python为 `abs(2*k−peak.k)<=2`，半频度量与原因一致；新增回归。不能据此断言这是手机故障原因。

图表（均本地生成，不依赖网络）：

- [颜色门与32个正例](issue-12-artifacts/baseline-color-gate.png)
- [前后接受矩阵](issue-12-artifacts/before-after-matrix.png)（noise列含真实脉搏；红色代表拒绝，不全是错误）
- [Hann主瓣边界](issue-12-artifacts/hann-main-lobe.png)
- [原版波形提取后的频谱](issue-12-artifacts/baseline-spectra.png)
- [修复后weak波形及频谱](issue-12-artifacts/after-weak-waveforms.png)
- [导出→同源回放→绘图示例](issue-12-artifacts/replay.png)（文件名synthetic明确为合成数据）

### ROI 假设的定量结果

**已经验证（受控合成图像，不是真实人脸）**：`node scripts/roi-jitter-experiment.mjs` 调用实际sampleROI；320×240静态uint8纹理图、408有效点、种子12026，只平移landmark，不加入脉搏。密集积分只作观测对照，未接入生产。

|landmark平移幅度（每轴±像素）|点采样chromaStd|密集对照chromaStd|点采样motion P95|displacement P95|生产结果|
|---|---:|---:|---:|---:|---|
|0|1.72085e−15|8.32667e−16|0|0|恒定颜色拒绝|
|.2|.0002210704|.0000212259|.3609406|.00297574|diffuse_spectrum|
|.6|.0004072386|.0000416389|1.2604523|.00854591|diffuse_spectrum|
|1|.0004402370|.0000643314|1.8796411|.01386481|excessive_motion|

**根据证据推断**：当前点网格在某些空间纹理上会把亚像素定位抖动转换成与弱脉搏同量级、甚至更大的颜色噪声；.6像素实验颜色std约为weak正例的3.3倍，且即时运动门可能放行。**尚未验证**：手机真实纹理、定位误差、相关像素数、JPEG/ISP降噪、自动曝光下噪声量级。因此不能选定A或C为手机最终根因，也不把密集积分直接作为未经设备证实的修复。完整数据：[roi-jitter.json](issue-12-artifacts/roi-jitter.json)。

### 协调人独立复核（不依赖 Codex 的合成器）

**已经验证**：协调人另写了一个极简合成器 `scripts/independent-gate-check.mjs`（DC=[170,120,100]，绿/红/蓝相对 AC=0.3%/0.1%/0.15%，16 秒、20 FPS），直接调用原版字节快照 `baseline-signal.mjs`：4 个心率下无噪声脉搏全部被 `no_chromatic_pulse_evidence` 拒绝（chromaStd≈2.7e−4 < 5e−4），POS/CHROM 未运行（pos_reason/chrom_reason 为空 → app 写成 `not_evaluated`）；而加入每帧 SD=0.3 的独立噪声后 chromaStd 升到≈6.7e−4、越过颜色门，随即在谱门被判 `diffuse_spectrum`（75 BPM 为 `competing_periodicity`）。即：**原颜色门对干净信号拒绝、对加噪信号放行，与“脉搏证据”方向相反**；而用户真机上观察到的两种失败（`no_chromatic_pulse_evidence`+`not_evaluated`，以及 `diffuse_spectrum`）都能由“弱但真实的脉搏 + 不同噪声水平”在原代码中复现。输出：[independent-gate-check.log](issue-12-artifacts/independent-gate-check.log)。同一脚本对修复版（`independent-gate-check-after.mjs`）：无噪声/低噪声 12/12 接受、误差≤0.4 BPM；SD=0.3 噪声 4/4 仍被谱门拒绝（谱门阈值未改）。输出：[independent-gate-check-after.log](issue-12-artifacts/independent-gate-check-after.log)。

**根据证据推断**：这说明真机的两次失败与该门缺陷**相容**，但不能证明真机信号中确实含有足够强的脉搏——这一点只能靠下一次开启诊断模式的真机导出来验证。

## Phase 2 诊断模式及离线工具（已经验证：代码与本地单元回放；UI待浏览器复验）

- UI复选框默认不勾选，不持久化；必须在开始本次测量前主动启用，有颜色时间序列的隐私提示。测量中锁定该开关；取消、刷新、清空或新测量清除旧诊断。
- 只保留内存4096个样本、256个事件、8个分析窗口，上限外标记truncated；不把诊断trace写入localStorage或现有CSV/JSON记录；不新增上传。只记录标量、ROI均色和3区均色，白名单排除像素grid、关键点、图像、视频。既有JSON/CSV格式和导出逻辑保持。
- 全时间序列记录t（秒）、segment、测量阶段、真实拒绝原因、整体/额头/左颊/右颊RGB、颜色阈值有效点比例/计数、位置x/y/width、位移、motion、亮度与相邻亮度变化。这里的skinRatio是颜色范围启发式有效比例，不能当作真实皮肤分类置信度；分区左右按原始未镜像landmark组命名。
- 对实际分析窗口导出raw、线性重采样RGB、用于显示的全局normalized RGB、真实局部归一化窗口mean/alpha、POS/CHROM波形、带内bins/主峰/第二峰/半频峰、候选BPM、SNR、逐门值/算符/阈值/是否已评估、最终原因和版本/commit。若算法提前退出，未运行的波形/谱为null，门标为未评估；不编造波形。
- 检测失败RGB/亮度/运动缺失值为null，失败BPM为null，从不伪装为0。首帧有效ROI的motion=0仍是原采集代码“没有前帧”的初始化约定，不是把失败信号补0。
- 导出按钮本地Blob下载，受浏览器下载能力限制。播放原始颜色没有设备RGB则无法恢复；本工具不会把旧摘要日志当作RGB。
- 回放只分析记录的同一segment、phase=measuring/complete、精确起止和数量匹配的窗口；缺帧/截断拒绝回放，不拼接；partial停止保留失败状态。载入的录制版本与当前回放版本分别输出，使用**同一web/signal.js analyze**，不另写一套JS算法。

```bash
# 所有合成矩阵、ROI实验、参考核对、PNG及回放示例，一条命令重生成
npm run evidence:issue12

# 本地真实诊断文件（先由本人主动启用、下载）
node scripts/replay-diagnostics.mjs /path/to/xinyun-diagnostics.json /tmp/replay.json
/workspace/xy-venv/bin/python scripts/plot-diagnostics.py /tmp/replay.json /tmp/replay.png

# 全部验证并留存日志；任一项失败或环境受阻都会如实非零退出
/workspace/xy-venv/bin/python scripts/validate-issue12.py
```

### 尚未解决的限制（不能把本轮结果写成“已修好手机”）

- **尚未验证**：真实iPhone/微信45秒能否得到可靠且准确的BPM；旧日志无法回放。一次diffuse_spectrum的真实原因仍未知。
- **已经验证：不可辨识反例**：把motion_only合成RGB保持不变，只把外部motion/displacement伪影遥测改为正常值，生产会接受75 BPM附近的非心脏颜色周期。相同观测无法判断物理来源；原版高幅度伪影也已在既有parity fixture中被接受。**“所有非心脏周期伪影均必须拒绝”不能由当前RGB与遥测接口保证**。本次明确记为2/2误接受，不计作成功案例；不添加靠标签识别合成case的门。需要真实设备数据、可信运动/照明观测及独立验证，不可随意调阈值承诺解决。
- **已经验证**：本轮42个可观测负例（含色噪声、共同周期照明、明确运动遥测和带外周期）误接受0；这不等于真实分布误接受率为0，也不能抹去上面的反例。
- **尚未验证**：诊断开启在手机上的内存/耗时与帧率；像素相关会降低256像素独立噪声假设的有效平均收益；单一纹理/照明漂移/固定种子样本不能代表各种肤色、自动曝光和压缩条件。
- **已经验证（仅桌面引擎模拟）**：新增诊断UI在 Chromium/WebKit 自动化中通过（见最终验证记录）；**尚未验证**其在 iPhone 微信内置浏览器中的表现。

## 真机复验协议与空记录模板 — DEVICE_TEST_REQUIRED

1. 协调人审查diff及本报告，确认部署版本0.6.3-rc与真实commit；浏览器回归先在可运行服务器的环境重跑。不要使用旧缓存版本。
2. iPhone，记录机型、iOS版本、微信版本、前置相机、照明和固定方式；同环境Safari作对照。本人自愿启用诊断；不采集姓名、图像或录像，不上传生理颜色序列。
3. 参考HR设备与手机时钟同步；连续稳定参考读数，记录观察时间而不是只记事后录入时间。最后16秒的中点约在测量第37秒；按现有±2秒匹配规则记录该时刻参考值，同时记录45秒内参考范围。
4. 正对镜头完成45秒连续有效采样，保留半屏预览、倒计时、对齐及中断提示；若中断，应明确显示作废和重新计时，不拼接。记录真实连续时长、有效样本和FPS；失败保留null和原始原因。提前停止属于失败，不把倒计时完成当作心率成功。
5. 各会话导出原有CSV/JSON及独立诊断JSON，本地回放并绘图。至少记录静止稳定光线的多次重复；运动/光照负对照与静止测量分开，不以参考值驱动相机输出或挑选最接近的窗口。
6. 比较camera BPM与对应时刻参考BPM：有输出才计算绝对误差，没输出误差记null；同时评估成功率、拒绝率、已接受结果误差及伪影错误输出。未经独立设备验收，全部标记DEVICE_TEST_REQUIRED。

|状态|会话ID|机型/iOS/微信|浏览器/前置确认|版本/commit|camera BPM|reference BPM/设备/观察时间|绝对误差|quality|成功/失败原因|实际连续采样秒|样本/FPS|诊断/普通导出文件|照明/运动/中断|
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|DEVICE_TEST_REQUIRED|待填|待填|待填|待填|null|待填|null|待填|待填|待填|待填|本地路径|待填|

## 供另一模型独立复核

- **已经验证的可重放证据**：先检查baseline-signal.mjs与 `git show 3528e13:web/signal.js` 字节一致、报告Phase 1旧行号正确；再运行evidence命令，核对JSON sourceSHA256、固定种子和所有数字。不要只读通过率。
- 重点审查：颜色门是否只是数值恒定判断，是否保留所有采集/曝光/运动门；secondary排除±2是否符合Hann主瓣；半频整数边界是否与Python完全一致；未通过是否始终null；所有新诊断门是否区分已评估/未评估。
- 检查参考实现范围：独立矩阵投影/FFT对照只能验证数学实现，不能证明当前重叠策略/无带通优于原论文或手机人体有效。查明颜色伪影2/2接受被明确披露，禁止把它隐藏在“所有负例0误接受”结论里。
- 检查隐私、内存上限、默认关闭、localStorage与原有导出不含trace；诊断segment是否跟随作废/开始，回放是否拒绝数量不匹配；partial finalReason是否与停止原因一致。
- **尚未验证的验收必须保持待测**：真机不填通过；下一个审查者可复跑浏览器脚本，再依据新的手机RGB决定是否需研究A/C、ROI平均、滤波或其他改动。不要以本合成矩阵拟合阈值代替新证据。

## 最终验证记录（真实运行输出）

最终验证入口：`/workspace/xy-venv/bin/python scripts/validate-issue12.py`。Codex 首次在其沙箱中运行时，服务器与 Chromium 因 `EPERM` 无法启动（ENVIRONMENT_BLOCKED）；随后协调人在同一台机器的非沙箱 shell 中重新运行同一脚本（浏览器脚本超时由180秒放宽到900秒，仅为容纳两引擎完整45秒用例），**全部 11 项 PASS、服务器 STARTED、0 失败**。机器可读结果：[validation/summary.json](issue-12-artifacts/validation/summary.json)，各项日志在 `issue-12-artifacts/validation/`。

|命令/范围|结果|实际输出摘要|
|---|---|---|
|`npm test`|已经验证 PASS|31 tests / 31 pass / 0 fail（原23 + 新增8）|
|`node tests/<name>.test.js` ×4|已经验证 PASS|frame-pump / issue12 / measurement / mobile 逐文件直接运行均退出0|
|`/workspace/xy-venv/bin/python -m pytest -q`|已经验证 PASS|129 passed（原117 + 新增12）|
|`/workspace/xy-venv/bin/python scripts/check-mobile-parity.py`|已经验证 PASS|12 组 JS/Python 提取与谱指标逐值一致；非人体验证|
|`/workspace/xy-venv/bin/python scripts/check-issue12-reference.py`|已经验证 PASS|180 baseline + 180 after 波形独立核对；修复版谱指标最大误差 1.04e−13|
|`npm run build`|已经验证 PASS|dist，9 modelAssets，version=0.6.3-rc|
|`npm start`（4173）|已经验证 STARTED|本地 HTTP 200|
|`node tests/mobile-browser.mjs`|已经验证 PASS（桌面引擎+模拟摄像头，非真机）|Chromium/WebKit 共 7 个 PASS 场景（生命周期故障注入、权限、取消、后台、导出、断帧恢复、45 秒对准/倒计时/重置/停止/导出/布局）|
|`node tests/measurement-browser.mjs`|已经验证 PASS（桌面引擎+模拟摄像头，非真机）|Chromium、WebKit 45 秒流程各 PASS；含诊断模式默认关闭、WebKit 显式启用后导出诊断 JSON、失败时 bpm=null|
|`npm run evidence:issue12`|已经验证 PASS，且可复现|协调人重跑后 baseline/after JSON 与 Markdown 的 SHA256 与 Codex 首次生成的完全一致|
|`git -c core.whitespace=cr-at-eol diff --check`|已经验证 PASS|—|

本轮没有修改任何已有单元断言以追求通过。已有浏览器脚本只把当前build显示断言从0.6.1更新到0.6.3-rc；历史UI_CONTRACT_ONLY注入样本继续保留旧版本（它本来就不是相机输出）。新增默认关闭/显式启用/下载/失败null/刷新清除断言；原45秒、半屏、暂停、重新对齐、自动结束和导出断言均保留，并已在非沙箱环境复跑通过。

### 修改文件清单

**已经验证（git工作区，不含任何提交/推送/切分支）**：

- `web/signal.js`：仅三处算法语义修复（恒定颜色预门、Hann竞争主瓣、半频整数边界）及可选诊断trace。
- `benchmark/quality.py`：对应三处门与SNR观测；`benchmark/signal.py`提取公式未改。
- `web/roi.js`：可选计数、分区均值、位置元数据，点采样与所有拒绝规则未改。
- `web/diagnostics.js`（新增）、`web/app.js`、`web/index.html`：主动启用、本地内存上限、白名单导出、segment及停止原因；状态机实现未改。
- `web/build-info.js`、`scripts/build-mobile.mjs`：0.6.3-rc，build从单一版本源取值；commit字段机制未改。
- `scripts/synthetic-fixtures.mjs`、`scripts/synthetic-matrix.mjs`、`scripts/roi-jitter-experiment.mjs`、`scripts/check-issue12-reference.py`（新增）：固定种子、保存前后证据与独立核对。
- `scripts/replay-diagnostics.mjs`、`scripts/plot-diagnostics.py`、`scripts/plot-issue12.py`、`scripts/validate-issue12.py`（新增）：本地回放、离线绘图、真实验证日志。
- `scripts/check-mobile-parity.py`、`package.json`：扩展度量parity和单命令重生成。
- `tests/issue12.test.js`、`tests/test_issue12_reference.py`（新增）、`tests/measurement-browser.mjs`：生产算法回归、独立数值参考和诊断UI验收。
- `scripts/independent-gate-check.mjs`、`scripts/independent-gate-check-after.mjs`（新增，协调人独立复核）；`scripts/validate-issue12.py` 浏览器用例超时 180→900 秒；`.gitignore` 忽略可重生成的大体积 `after.json`/`baseline.json`（仓库保留 `.json.gz`）；`web/index.html` 顶部版本徽标改为 v0.6.3-rc。
- `docs/issue-12-root-cause-report.md`、`docs/issue-12-artifacts/`（新增）：本报告、原版字节快照、JSON/Markdown/PNG与真实命令日志。所有synthetic文件都不是设备记录。

**尚未验证的停止边界**：本轮可交付已定位的算法缺陷和诊断工具；没有条件完成真机准确性验收。不扩大算法改动范围来猜测手机数据。下一步是可运行环境中的浏览器复验，以及按上述协议取得新的、本人主动导出的iPhone/微信RGB诊断。
