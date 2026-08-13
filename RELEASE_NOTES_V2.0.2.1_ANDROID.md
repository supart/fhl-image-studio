# FHL Image Studio 方汤圆版 V2.0.2.1 Android

发布日期：2026-06-30

这是 Android V2.0.2.1 的正式发布记录。本版本在 V2.0.2 基础上同步桌面端小版本修复，并补齐 Android 后台生成完成通知。

## 主要升级

- 修复 FHL Responses / `gpt-image-2` 在明确选择比例和尺寸时输出比例不稳定的问题。
- 对 FHL Responses + `gpt-image-2` + explicit size 禁用 `partial_images`，避免中间预览影响最终比例。
- 根据选择比例追加中文硬约束，覆盖 `1:1`、横版和竖版生成。
- Android 端保留 APIMart / RunningHub 独立比例语义，不把 APIMart/RH 比例参数误转成 FHL 像素尺寸。
- Android 一键配置流程补齐 FHL / RunningHub 配置入口，API Key 不进入源码或发布包。
- Android 原生后台任务新增完成/失败通知；生成成功后通知栏提示 `图片已生成`，点通知可回到 App。
- App 从桌面回到前台时会重新 attach 原生任务记录，降低 WebView 后台冻结导致结果不同步的概率。

## 发布整理

- 正式应用显示名：`FHL Image Studio 方汤圆版 V2.0.2.1`。
- 包名：`top.fangtangyuan.fhlstudio.android`。
- 版本名：`V2.0.2.1`。
- 版本号：`1050002`。
- API Key、RunningHub Key、本地配置、生成图、日志、审计文件、keystore 和签名密码文件不进入源码仓库或发布包。
- 本次发布使用本机 release keystore 签名；keystore 和密码文件保存在 `.local/android-release/`，不会上传 GitHub。

## 已知未迁移

- 桌面版 360 / Panorama 高级工作流尚未迁移到 Android，仍作为后续二期移动交互任务处理。
- 真机长时间发热测试未作为本次阻塞项；模拟器后台任务和真实出图已验证。

## 本次发布验证

- `npm test`：通过，215 个测试通过。
- `npm run build:android`：通过，仅有 Vite chunk size 警告。
- `assembleRelease`：通过，使用本机 release keystore 签名。
- `apksigner verify --verbose --print-certs`：通过，APK Signature Scheme v1/v2 验证通过。
- `aapt dump badging`：确认包名 `top.fangtangyuan.fhlstudio.android`，版本名 `V2.0.2.1`，版本号 `1050002`，应用显示名 `FHL Image Studio 方汤圆版 V2.0.2.1`。
- 模拟器真实出图验证：
  - `1:1`：请求 `1024x1024`，实际 `1254x1254`。
  - `16:9`：请求 `1536x864`，实际 `1672x941`。
  - `9:16`：请求 `864x1536`，实际 `941x1672`。
  - `2:1`：请求 `1536x768`，实际 `1774x887`。
  - `1:2`：请求 `768x1536`，实际 `887x1774`。
- 后台生成验证：前台开始 FHL Responses 任务后退到桌面，任务在后台成功完成，保存到相册 `Pictures/ImageStudio`，通知栏出现 `图片已生成`。
- 发布前隐私扫描：未发现高置信 API Key、token、keystore、APK/ZIP 或本地配置进入 Git 文件列表。

## 发布资产

- APK：`FHL-Image-Studio-方汤圆版-V2.0.2.1-Android-Release-20260630.apk`
  - SHA256：`E85ACE9A1159DF9AA24B2EAD1DA3B6DFBF6C23AF0E9A3F1762353C843EAB23A8`
- ZIP：`FHL-Image-Studio-方汤圆版-V2.0.2.1-Android-Release-20260630.zip`
- SHA256 汇总：`FHL-Image-Studio-方汤圆版-V2.0.2.1-Android-Release-20260630.sha256.txt`
