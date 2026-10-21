# 第一阶段验证记录

验证范围：Python 3.12、Node.js 24、Linux Chromium；没有连接真人摄像头或生理参考设备。

- Node 信号单元测试：12 项通过，0 失败，0 跳过。合成 54/72/108/150 BPM 信号在允许频率分辨率内恢复；恒定、短时、低帧率、过暗/过曝、过大运动、断帧和 NaN 输入拒绝；时间抖动重采样通过。
- FastAPI 测试：3 项通过，0 失败，0 跳过。页面、健康状态、隐私响应头、无上传路由、本地 JS/WASM/模型资源通过。出现 1 项上游 Starlette/AnyIO 弃用警告，不影响结果。
- 实际 uvicorn 进程启动成功，HTTP `/api/health` 返回 `status=ok`、`processing=browser-local`、`model_assets=true`。
- Chromium 假摄像头浏览器检查：实际加载本地 MediaPipe JS、WASM 和模型；无脸画面不输出心率；停止释放摄像头；没有浏览器未捕获异常或第三方网络请求。该检查不验证真人检测精度或测量准确率。
- 首次浏览器检查失败：CSP 阻止旧版 MediaPipe 的动态函数构造。添加该运行时必需的 `unsafe-eval` 后重新验证通过，连接仍限同源。兼容性取舍见 README。

未验证：真人摄像头的有效皮肤采样、实时 FPS 和心率准确性；光照、运动、肤色分层效果；Safari/Firefox/移动设备；真实授权拒绝/硬件故障；HRV、呼吸或心理状态推断。不能据合成测试声称第一阶段科研假设已成立。

## 可重复执行

```bash
bash scripts/install.sh
npm test
.venv/bin/python -m pytest -q
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
# 另一个终端，可选的浏览器集成测试：
# 使用已有 Chromium：
CHROMIUM_PATH=/usr/bin/chromium node tests/browser-smoke.cjs
# 或先 npx playwright install chromium，再 node tests/browser-smoke.cjs
```

测试使用假摄像头，不应替代真人与接触式 PPG/ECG 对照。没有发布到公网，也没有提交或推送 Git。
