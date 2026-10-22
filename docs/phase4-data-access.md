# Issue #7：数据访问、许可和接入

**真实数据 BLOCKED。** 用户已确认没有已获批的真人数据，也没有可提供的 IEEE DataPort 账号。
本轮按确认后的范围交付本地接入、许可核查、自动化测试与日志。没有替用户申请、签署许可或发送邮件。

## 官方渠道核查（2026-10-22）

| 数据集/官方证据 | 获取与许可事实 | 本轮具体状态 |
|---|---|---|
| [PURE 官方页](https://www.tu-ilmenau.de/en/university/departments/department-of-computer-science-and-automation/profile/institutes-and-groups/institute-of-computer-and-systems-engineering/group-for-neuroinformatics-and-cognitive-robotics/data-sets-code/pulse-rate-detection-dataset-pure) | 仅处理学术机构邮箱的申请；公司申请不被接受。页面描述10人、60段、30Hz视频和60Hz接触式参考。实际权利仍以获批条款为准。 | 浏览工具读取了申请条件；本地HTTP审计遇证书链错误。未获授权，不请求受限文件。四个现用checkpoint训练于PURE，不能直接作为独立测试集。 |
| [UBFC-rPPG 官方页](https://sites.google.com/view/ybenezeth/ubfcrppg)及[官方目录](https://drive.google.com/drive/folders/1o0XU4gTIo46YfwaWjIgbtCncc-oF44Xk) | 官方称研究共享；上轮实际下载核验的许可表/readme摘要仍保留。不能推导商业或任意再分发授权；排除存在授权冲突的21/27，绝不发表人脸/原始参考。 | 上轮是Google配额阻塞；**本轮两次官方subject1请求是TLS EOF错误**，二者不混淆。无新增完整视频、无同步核验。 |
| [COHFACE 官方跳转](https://www.idiap.ch/en/dataset/cohface) → [Zenodo记录4081054](https://zenodo.org/records/4081054) | 文件受限，非商业研究EULA，要求机构永久职位签署人和机构邮箱。官方描述40人、160段、20Hz视频及同步生理信号。 | 浏览工具读取条件；本地HTTP审计TLS EOF。未申请，未获文件权限。 |
| [MMPD 作者仓库](https://github.com/McJackTang/MMPD_rPPG_dataset) | 数据限学术、禁止商业用途，需教师用机构邮箱提交签署协议。仓库MIT代码标签不等于数据许可。 | 作者README已下载并记录SHA256；未签署/申请。不能把公开示例动画当同步生理测试集。 |
| [LGI-PPGI 作者仓库](https://github.com/partofthestars/LGI-PPGI-DB) | 仓库显示CC-BY-4.0，但作者README说明下载暂不可用。 | 浏览已核查；本地README请求TLS EOF；没有使用未核实镜像或假定完整同意范围。 |
| [UBFC-Phys 官方页](https://sites.google.com/view/ybenezeth/ubfc-phys) → [IEEE DataPort](https://ieee-dataport.org/open-access/ubfc-phys-2) | 作者提供IEEE与dat@UBFC两个渠道。IEEE页面本地HTTP200，显示下载需登录，开放访问需免费账号；不能因此声称付费订阅必须，也不能推定所有再分发权利。 | 未登录，无用户可用账号。未直接调用被登录门遮挡的存储地址。 |
| [UBFC-Phys 官方dat@UBFC替代入口](https://search-data.ubfc.fr/FR-18008901306731-2022-05-05_UBFC-Phys-A-Multimodal-Dataset-For.html) | 从作者页取得的独立官方渠道。 | 浏览请求503，本地请求证书链错误；许可、文件和同步均未核验。未关闭TLS校验。 |

以上人数/帧率是发布方描述，不是本轮采样测量；本地视频数、受试者数和真实评测窗口数均为0。
本轮网络响应的URL、哈希、时间与原始异常见 [access.json](../reports/logs/phase4/access/access.json)、
[下载重试日志](../reports/logs/phase4/ubfc-retry.log)。浏览成功与本地TLS失败来自不同访问途径，不互相覆盖。
UBFC旧许可表的哈希和参与者限制见 [前轮核查](phase3-data-license.md)，未虚报为本轮重新取得授权。

## 可复现本地接入

新增 `python -m benchmark.ingest_ubfc` 支持 **UBFC DATASET_2**，不声称支持全部候选数据格式。
它读取官方三行 ground_truth.txt：接触PPG、设备HR、参考秒时间戳。
本版本参考BPM采用CMS50E设备HR；接触PPG做有限性/变异性与完整性核查，**不从其波形重算HR**。
因此不等于UBFC论文的接触PPG频域参考流程，设备算法延迟与两种HR口径差异仍需真人数据验证。
不可用摄像头估计作为参考，不自动把参考时间起点清零。

1. 复制 [空计划](phase4-empty-plan.json) 到被Git忽略的 `data/plan.json`。
2. 填写实际数据版本、官方来源、用途许可审核、预训练身份重叠审核；提供本地授权证据文件路径和SHA256。
3. 将 [记录模板](phase4-record.example.json) 填入 `records`。模板中的ROI、时长、offset都是示例，不是默认核验结论。
4. 受试者使用跨会话统一匿名ID；在查看测试结果前固定train/validation/test，三个集合必须都有独立受试者。
5. 每条记录提供视频、原始参考、真实帧时间戳、逐帧质量CSV和同步证据的路径/哈希。

帧CSV为 `timestamp_s`，从视频起点0计时；质量CSV为 `timestamp_s,face_count,roi_valid`，与帧逐行对应。
需要真实核验的人脸数和皮肤ROI有效性，不能填全1占位。来源可以是审阅后的检测/跟踪结果或逐帧人工核验，
本工具没有新造一个未经验证的人脸检测器。同步约定为 `video_time=reference_time+reference_offset_s`，必须说明依据。
标称FPS/帧序号本身不足以证明无掉帧或同步。工具不会自动缩短声明时长掩盖失败。

```text
python -m benchmark.ingest_ubfc data/plan.json --out data/ingest-check --preflight-only
python -m benchmark.ingest_ubfc data/plan.json --out data/ingested
```

第一条只验证材料/哈希/划分；通过不代表同步已被程序独立认证。第二条解析参考、检查时间覆盖、解码并复用现有ROI/质量CSV导入。
每条记录写入样本数、受试者ID、实际FPS、参考采样率/间隔、输入/NPZ哈希及导入耗时。失败保留在inventory中；
任何一条失败都不发出可评估manifest，不静默剔除失败记录。设备HR缺测保留，后续按窗口拒绝。
所有原始输入、授权/同步材料、参考CSV及NPZ必须留在本地data目录，不提交GitHub。

退出码：0为材料预检/导入成功（仍未评估），1为有明确数据阻塞，2为配置/路径错误；目录已存在时拒绝覆盖。
网络核查可另建隔离环境安装 `requirements-audit.lock`，执行：

```text
python scripts/audit-phase4-access.py --out outputs/access-new --probe-ubfc-video
```

网络审计只核查官方来源；成功读取页面不代表获授权。不要对配额错误循环重试。

## 数据解除阻塞后需要用户配合的事项

- 选择具备实际资格的数据获取路线：学术机构批准的PURE/COHFACE/MMPD，或可合法使用的UBFC/UBFC-Phys。
- 对需申请的来源，由有资格的机构人员完成申请/签署；提供获批范围、研究或商业用途限制及本地数据路径。
- 如选IEEE DataPort，由用户完成账号建立/登录和必要条款流程，再交付获准本地文件；不要在聊天中发送密码。
- 提供同步和参考设备延迟的证据、原始逐帧时钟/质量核验；有依据的光照、运动、设备、肤色标签才进入分层。
- 四深度模型仍需解决权重适用许可、固定checkpoint和预训练身份重叠；PhysMamba另需兼容CUDA/mamba_ssm环境。

随后才在真实validation调优、冻结质量策略，使用隔离test报告误差/覆盖与剩余失败。地区或族裔不能代替肤色标签。
