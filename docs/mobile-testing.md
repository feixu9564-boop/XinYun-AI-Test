# Current mobile version: v0.6.0 / Issue #12

See [the current implementation, acceptance checklist and device procedure](../reports/issue12.md). The sections below describe the historical v0.5/v0.5.1 release; its 120-second rolling-window UI is superseded by a stable-alignment + 45-second continuous acquisition flow. The overall attempt cap remains 120 seconds. Physical iPhone acceptance is DEVICE_TEST_REQUIRED.

# Issue #9 — 手机使用、独立部署与CSV规范

## 实际部署

已于2026-10-22发布独立研究站点：
https://xinyun-mobile-research-20261022.tasty-iris-5068.chatgpt.site

Sites返回`succeeded`，初始交付为版本2。本轮采样修补前读取到站点访问模式已为public，更新时保留现状，未调用权限变更接口。
当前站点按托管平台已有访问设置开放，若平台出现登录或安全检查请按页面完成。普通未认证命令行请求收到Cloudflare 403，不能将curl结果作为手机登录访问结果。
桌面内嵌浏览器的标签已显示本应用标题，但完整自动化读取超时；已发布站点的手机摄像头仍须用户实测。
原生产系统未修改。网页无数据库、账号资料收集或上传接口。

## iPhone Safari 操作

1. 在Safari中打开上面的HTTPS网址。不要把电脑的`localhost`地址复制到手机，也不要在微信/QQ内嵌浏览器中测试。建议iOS16及以上；具体设备版本尚未验证。
2. 如果要求登录，使用本站所有者对应的ChatGPT账号。填写匿名编号，例如`P001`，不要填写姓名。仅本人或知情同意的自愿成年人参与。
3. 勾选参与确认，点击「开始测量」。在系统摄像头提示中选择允许。程序请求前置摄像头、禁用音频；若检测到后置摄像头会停止。
4. 检查预览朝向本人，手机固定、面部正对镜头、额头与双颊无遮挡、照明稳定。绿色轮廓表示自动跟踪的采样区域，并不证明皮肤或活体已验证。
5. 保持至少16秒；之后每4秒更新一个16秒窗口。需至少12 FPS，不能有超过250毫秒采样缺口。每次最长120秒，处理上限约20 FPS，以降低耗电。实际电量、发热尚未真机测量。
6. 指夹设备稳定后，观察读数并立即输入「参考心率」、点击「记录参考值」。若录入延迟，取消「刚刚观察到」并填写实际观察时间。可从第8秒开始每隔约4秒记录，持续测量，让读数落在后续完整窗口的中部。手动读数不等同于连续同步PPG参考。
7. 点击停止，确认摄像头指示灯关闭。点击导出CSV；Safari中查看下载列表或「文件」。也可分享CSV并选择「存储到文件」。分享仅由用户主动发起。
8. 重新测量会建立新会话并保留旧记录。记录只在同一浏览器、同一站点中保存；无痕模式、清理网站数据、存储配额可能影响保存，请及时导出。清空需二次确认。

若权限被拒绝，请在Safari当前网站的摄像头权限设置中改为允许，再重试。切后台、锁屏/系统暂停、页面离开或相机断开会停止，不会静默重开摄像头；返回后点击重新测量。
Android Chrome采用同一流程，在网站设置中允许摄像头。未检测到人脸、多个面孔、曝光异常、运动、ROI不足、低帧率或频谱歧义都会显示原因，BPM留空。

## 可复现开发与部署

Node22，固定`@mediapipe/face_mesh@0.4.1633559619`和`playwright@1.62.1`（沿用PR #1锁文件）。

```sh
npm ci --ignore-scripts
npm run build
npm start
```

产物`dist/`包含网页与完整模型/WASM资产（模型约17MB），全部同源加载，无运行时CDN依赖。
`dist/assets-manifest.json`记录模型哈希；构建必须先成功。摄像头只在页面内存处理，无MediaRecorder、视频上传或磁盘视频存储。

若另行托管，将`dist/`部署到**新建的独立HTTPS静态项目**。仓库提供`netlify.toml`，创建新的Netlify站点、选择此分支即可构建；该配置未在Netlify实际部署。不关联已有生产站点。其他静态主机须支持`.wasm` MIME、相对路径、摄像头权限与HTTPS，不能把HTTP局域网访问当作交付。
不需要服务器密钥或模型API密钥。Sites自身的账号访问保护由托管平台处理。

## 测试

```sh
npm test
npx playwright install chromium webkit
# 保持 npm start 运行，然后：
npm run test:browser
# Python环境装 requirements-benchmark.lock 后：
python scripts/validate-mobile.py --out outputs/mobile-new
```

Linux CI安装浏览器使用`npx playwright install --with-deps chromium webkit`。
自动化明确分成：真实FaceMesh/WASM处理无脸假摄像头；Chromium/WebKit生命周期故障注入。
这些都是工程验证，不是假装的真人或iPhone测量。用户真机验收清单见报告。

## CSV v1

UTF-8 BOM、RFC4180引号转义、CRLF换行；字符串公式前缀转义。JSON也可导出。
所有窗口（含失败）与事件均保留。失败BPM为空，不能用0或上一窗口的结果填充。

| 字段 | 含义 |
|---|---|
| schema_version, record_type | 1；session_start / camera_ready / window / session_end / reference |
| session_id, subject_id | 随机会话ID、用户匿名编号；会话中锁定 |
| recorded_at | 写入时间，UTC ISO8601 |
| window_start, window_end | 计划窗口起止UTC；结束时剩余不完整窗口保留并拒绝 |
| sample_start, sample_end | 窗口内实际采样起止UTC；无采样则空 |
| status, reason | accepted / insufficient_signal / 事件状态及具体原因码 |
| bpm, pos_bpm, chrom_bpm | 仅通过全部质量条件时输出；失败均空 |
| quality, fps, sample_count | 实验性频谱质量0–100、有效采样率、样本数；非准确率 |
| reference_id, reference_bpm | 独立人工参考事件及其读数 |
| reference_observed_at | 用户实际观察时间，默认点击记录时刻，可手动指定 |
| reference_recorded_at | 真实录入时间，不能替代观察时间 |
| reference_match | matched_instant_within_2s / unmatched |
| algorithm_version | mobile-pos-chrom-v1/experimental-v1 |
| user_agent | 浏览器提供的UA，仅本地记录，非设备身份认证 |
| camera_width, camera_height, camera_facing | 相机报告的分辨率、方向；未提供方向记unknown |

匹配规则：同会话、同匿名编号，观察时间落在实际采样区间内且距区间中点不超过2秒；多条取离中点最近者。停止后才观察到的读数不会倒填到此前窗口。
帧时钟用单调`performance.now()`映射到会话UTC，系统时钟漂移超过2秒会停止。

```sh
python scripts/analyze-mobile-csv.py /path/to/xinyun.csv --out outputs/phone-review.json
```

复核脚本重新验证引用的参考事件、身份、时间和读数，不盲信`reference_match`。
输出MAE、RMSE、bias、绝对误差P50/P90/P95、有效输出覆盖率、拒绝率及失败原因。
误差仅来自有效配对；无配对指标为null。覆盖率分母包含全部窗口。重叠窗口不独立，不生成虚假的独立样本置信区间。
不要把含身份信息的文件或原始人脸视频提交GitHub；程序本身不生成视频文件。

## 依赖与参考

- [原PR #1](https://github.com/feixu9564-boop/XinYun-AI-Test/pull/1)：FaceMesh、额头/双颊多边形、滑动POS/CHROM实现。
- [PR #6](https://github.com/feixu9564-boop/XinYun-AI-Test/pull/6)：实验性频谱拒绝策略；未经真人标定。
- [Google MediaPipe FaceMesh源文档](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md)：定位与ROI实现依据。上游MediaPipe为Apache-2.0；保持锁定包与官方来源。
- [WebKit inline video政策](https://webkit.org/blog/6784/new-video-policies-for-ios/)：使用muted、playsinline；此文档不是本项目真机测试证明。

## v0.5.1 采样诊断扩展

页面测量时保留右上角预览，CSV新增以下可选字段，旧记录仍可读取：

- `capture_version`：capture-v0.5.1；不代表算法阈值改动。
- `scheduler_source`：decoded_counter / video_callback / media_time_fallback。
- `video_callbacks`、`frames_submitted`、`model_completions`、`model_results`：累计回调、提交、send完成、结果返回次数。
- `face_frames`、`last_sample_reason`：单人面部返回次数及最近采样原因；不代表活体或正确皮肤识别。
- `pending_inference_ms`：尚未完成的推理耗时。
- `last_video_time`、`video_ready_state`、`video_paused`、`document_visibility`、`preview_visible`：停止前的媒体/页面状态（session_end记录在释放相机前快照）。
- `stop_reason`：结束余段同时保留导致停机的原因，避免只有window_too_short而缺少上游信息。

请在Safari打开原网址并加`?v=0.5.1`，确认版本后再测；旧本地记录不会清空。
[修补说明与证据边界](../reports/capture-v051.md)。
