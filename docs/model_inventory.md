# 四模型清单与实测状态

核查日期：2026-10-22。只用于生理信号研究；“已跑通”仅指加载和合成输入 forward，**真人准确率全部未验证**。

## 共同来源与许可

可信实现选择 [rPPG-Toolbox](https://github.com/ubicomplab/rPPG-Toolbox)，固定提交
`b7500b848f84ad7f86e277b4612563b69f4f88f9`（下文所有相对链接均固定此版本）。
现场核查其 model、trainer、infer config 和 final_model_release，**四种均原生支持**，无需冒充独立模型或替换模型。
本仓库仅实现轻量推理桥接，不复制上游源码/权重，不声称复现整个 Toolbox 训练/评估流程。

- [上游 LICENSE](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/LICENSE)：Responsible AI Source Code License v1.1，含用途及再分发限制，并非可任意使用的 MIT。
- PhysNet [作者仓库](https://github.com/ZitongYu/PhysNet) README 明示 research only / commercial use not allowed；Toolbox 的 PhysNet 文件头同时出现 MIT 和非商业描述，**不能据此忽略非商业限制**。
- PhysFormer [作者仓库](https://github.com/ZitongYu/PhysFormer) 有 VIPL-HR fold1 权重 Google Drive 链接；本次未使用该权重，不能与 PURE 权重混淆。
- final_model_release 没有在本次核查中找到单独说明权重授权的文件；代码许可不自动证明所有数据/权重权利。研究使用须审阅上游条款，其他用途及再分发仍属许可阻塞；CLI 要求明确 `--acknowledge-toolbox-license`，不自动下载或接受许可。
- 模型和权重路径、SHA256 见 [toolbox.lock.json](../benchmark/toolbox.lock.json)。本次已实际读取这些权重并核对摘要，不仅仅发现链接。

## 逐模型

| 模型 | 论文、代码、配置、权重 | 选定权重训练数据 | 选定输入与依赖 | 硬件及实测状态/阻塞 |
|---|---|---|---|---|
| PhysNet | [BMVC 2019](https://bmvc2019.org/wp-content/uploads/papers/0186-paper.pdf)；[代码](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/neural_methods/model/PhysNet.py)；[配置](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/configs/infer_configs/PURE_UBFC-rPPG_PHYSNET_BASIC.yaml)；[权重](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/final_model_release/PURE_PhysNet_DiffNormalized.pth) | PURE，依据发布名称/对应配置；无完整训练参与者清单 | 30 FPS；128 帧=4.27s；72×72；NCTHW；DiffNormalized；PyTorch | **已跑通（工程）**：CPU strict state_dict 加载、480 帧推理通过；非商业限制；真人未验证 |
| EfficientPhys | [WACV 2023](https://openaccess.thecvf.com/content/WACV2023/papers/Liu_EfficientPhys_Enabling_Simple_Fast_and_Accurate_Camera-Based_Cardiac_Measurement_WACV_2023_paper.pdf)；[代码](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/neural_methods/model/EfficientPhys.py)；[配置](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/configs/infer_configs/PURE_UBFC-rPPG_EFFICIENTPHYS.yaml)；[权重](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/final_model_release/PURE_EfficientPhys.pth) | PURE，同上 | 30 FPS；180 帧=6s；72×72；TCHW；Standardized；frame_depth=10；追加最后一帧供模型内部 diff；PyTorch | **已跑通（工程）**：CPU 加载、480 帧通过；权重独立许可未确认；真人未验证 |
| PhysFormer | [CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/papers/Yu_PhysFormer_Facial_Video-Based_Physiological_Measurement_With_Temporal_Difference_Transformer_CVPR_2022_paper.pdf)；[代码](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/neural_methods/model/PhysFormer.py)；[配置](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/configs/infer_configs/PURE_UBFC-rPPG_PHYSFORMER_BASIC.yaml)；[权重](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/final_model_release/PURE_PhysFormer_DiffNormalized.pth) | PURE；不同于作者 VIPL-HR fold1，训练受试者清单未提供 | 30 FPS；160 帧=5.33s；128×128；NCTHW；DiffNormalized；dim96/ff144/heads4/layers12/theta.7/gra_sharp2；PyTorch | **已跑通（工程）**：CPU 加载、480 帧通过；真人未验证；需验证本适配器与上游端到端一致性 |
| PhysMamba | [arXiv:2409.12031](https://doi.org/10.48550/arXiv.2409.12031)；[可信代码](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/neural_methods/model/PhysMamba.py)；[配置](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/configs/infer_configs/PURE_UBFC-rPPG_PHYSMAMBA_BASIC.yaml)；[权重](https://github.com/ubicomplab/rPPG-Toolbox/blob/b7500b848f84ad7f86e277b4612563b69f4f88f9/final_model_release/PURE_PhysMamba_DiffNormalized.pth) | PURE，同上 | 30 FPS；128 帧=4.27s；128×128；NCTHW；DiffNormalized；PyTorch、timm、mamba_ssm 及兼容 CUDA 扩展 | **环境阻塞**：权重存在并已校验；当前 CPU 环境无 CUDA/mamba_ssm，未加载、未推理；不能标成权重缺失或已集成验证 |

本次工程实测：Python 3.12.14 / torch 2.6.0+cpu / AMD EPYC 9V74，torch 2 线程，无 GPU。
原始加载/forward 时间、成功失败逐项记录于 [model-probe.json](../reports/logs/model-probe.json)。
这些输入是随机像素，不是生理准确性测试。模型输入规范针对所选 Toolbox 配置，不是各论文所有版本的通用要求。

## 数据获取核查

| 候选 | 同步参考与条件 | 使用条件/本次状态 |
|---|---|---|
| [UBFC-rPPG](https://sites.google.com/view/ybenezeth/ubfcrppg) | 视频和 ground_truth.txt；Toolbox UBFC loader 描述包含参考 PPG、参考 HR、时间戳 | 首选小规模跨数据集验证（PURE 权重 → UBFC）。尚未取得/审阅本项目授权、原始数据及同步说明，**未下载真人录像**；不能将公开链接视为任意再分发许可 |
| [PURE](https://www.tu-ilmenau.de/universitaet/fakultaeten/fakultaet-informatik-und-automatisierung/profil/institute-und-fachgebiete/institut-fuer-technische-informatik-und-ingenieurinformatik/fachgebiet-neuroinformatik-und-kognitive-robotik/data-sets-code/pulse-rate-detection-dataset-pure) | 参考脉搏信号与逐帧数据；Toolbox 提供 loader | 作者申请获取。当前四权重训练于 PURE，不能用同数据集测试后称跨数据集泛化；程序保守阻止 PURE 深度模型评估 |
| [iBVP](https://github.com/PhysiologicAILab/iBVP-Dataset) | 30 FPS RGB/热成像与耳部 PPG、参考质量标签；官方描述 124×3min | 学术主管签署 [EULA](https://github.com/PhysiologicAILab/iBVP-Dataset/blob/main/assets/EULA_iBVP-Dataset.pdf)，作者审核通过后提供链接；压缩约400GB。部分参与者有媒体使用限制。未获 EULA 授权，不自动申请、不下载；其 PPG 需额外生成接触式参考 HR，本提交不冒称已有 iBVP 专用导入器 |

没有取得同时满足合法研究使用、同步参考和可审阅许可的本地真人数据。因此交付可执行通用视频/时间戳/参考 HR 导入器、固定本地清单格式和阻塞列表；不提供编造的真人成绩。
