# 第三阶段数据与权重核查（2026-10-22）

这份表更新 PR #4 的历史状态。实际网络记录、文件大小和 SHA256 在
[sources.json](../reports/logs/phase3/source-audit/sources.json)。没有向仓库提交人脸视频、参与者许可表或参考信号。

| 来源 | 获取、研究许可、参与者同意 | 同步与划分 | 当前结果 |
|---|---|---|---|
| [UBFC-rPPG 官方页面](https://sites.google.com/view/ybenezeth/ubfcrppg)及其[官方目录](https://drive.google.com/drive/folders/1o0XU4gTIo46YfwaWjIgbtCncc-oF44Xk) | 页面说明研究共享，目录含 Agreement.xlsx 与 readme.txt；已实际下载核查。选定 subject1/3 的数据共享栏均为 X。readme 禁止发表21/27图像，旧表对21还标记不同意数据共享，故排除二者，不将公开链接解读为商业/再分发授权。 | DATASET_2 三行分别为 PPG、设备 HR、秒时间戳；官方明确论文采用接触 PPG 导出 HR 而非设备 HR。本框架设备 HR 口径不冒称复现论文。视频时钟/掉帧、参考延迟尚未实测核对。1/3仅为下载探针，不构成正式测试集。 | 文档可获取；两个视频均返回下载额度限制。**BLOCKED：未完成真实评测**，不能继续沿用“没有任何许可证据”的旧说法。 |
| [PURE 官方入口](https://www.tu-ilmenau.de/en/university/departments/department-of-computer-science-and-automation/profile/institutes-and-groups/institute-of-computer-and-systems-engineering/group-for-neuroinformatics-and-cognitive-robotics/data-sets-code/pulse-rate-detection-dataset-pure) | 官方入口已访问，细节页再次读取超时；本次未获得该项目申请批准或原始文件，未代签/发邮件。 | 四个选定 checkpoint 训练数据为 PURE，现有框架阻止用 PURE 测这些权重。完整训练受试者身份未知。 | NOT_ACQUIRED；不能用作当前深度模型独立测试。 |
| [LGI-PPGI 作者仓库](https://github.com/partofthestars/LGI-PPGI-DB) | 仓库标示 CC-BY-4.0，但作者 README 同时说明下载暂不可用。未从第三方镜像搬运。 | 作者描述摄像头与 CMS50E 同步、附时间戳；未取得本地同步证据。 | NOT_ACQUIRED；仅作为可用性核查候选。 |

正式真实数据计划：先固定全部可获准参与者清单、哈希、跨会话统一匿名 subject_id，再按受试者划分
train/validation/test（种子2026）；不把同一个人的不同窗口分到不同集合。当前没有真实分割文件，不能声称已完成。
阈值只能在 validation 上标定，test 只用于冻结后的最终评估。需核查预训练身份重叠；仅换数据集名称并不能证明没有同一人。
UBFC 公开描述包含室内光照、Logitech C920、运动/交互，但本次未拿到视频或可核验肤色标签；不由地区/民族推断肤色，不报告未测的分组精度。

## 权重与预处理

固定 rPPG-Toolbox 提交 `b7500b848f84ad7f86e277b4612563b69f4f88f9`。
本次重新下载四模型源文件并校验，四个 SHA256 均匹配 [toolbox.lock.json](../benchmark/toolbox.lock.json)。
上游源码为 Responsible AI Source Code License v1.1，并非无限制许可；PhysNet 作者另有研究/非商业限制。
锁定表的权重摘要来自 PR #4 历史校验，本次**没有重新下载、校验或执行权重**，不能冒充本轮验证。
权重独立许可尚未解决；当前隔离基础环境无 torch、模型 checkout 和 CUDA 推理环境。

模型各自 resize、归一化、帧块、补尾策略沿用 [模型清单](model_inventory.md)；共享时间窗与参考定义保持一致。
四深度模型本轮统一 `NOT_RUN`，无替代预测。PhysMamba 还需可用 CUDA/mamba_ssm。
PR #4 的历史 CPU 合成 forward 不计入本轮六模型真人基准结果。

引用：Bobbia, Macwan, Benezeth, Mansouri, Dubois, *Unsupervised skin tissue segmentation for remote photoplethysmography*, Pattern Recognition Letters, 2017。
