# FHL Image Studio 方汤圆版

> 基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版。本项目不隶属于、不代表、也不由上游项目维护。

本仓库按 GNU AGPLv3.0 公开完整对应源码。Android 首次安装不内置 API Key；用户须自行配置服务凭据。

## Android V2.0.5

- 版本：`V2.0.5 / 1050005`
- 正式包名：`top.fangtangyuan.fhlstudio.android`
- 最低系统：Android 9（API 28）
- 默认协议：FHL Images API；保留独立的 FHL Responses API
- 正式签名证书：沿用 Android V2.0.4，SHA-256 `6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36`

### 主要能力

- FHL Images 十槽统一配置，凭据由 Android Keystore 保护；每槽最多并发 4 项，总池最多 40 项。
- 动态 GPT Image 2.x 目录、十槽安全并集和共同可用模型选择；配置变化后重新验证，模型和能力证明冻结到任务。
- Images 与 Responses 双协议、原生后台任务恢复、完成通知、历史记录和防重复提交保护。
- 文生图、图生图、多参考图、画布编辑、历史回用、普通图像和经 Alpha 校验的透明 PNG。
- FHL Responses 文本模型用于提示词优化与反推；APIMart、RunningHub 保持各自请求和比例语义。

## 升级与测试包

- 正式包使用原包名和 V2.0.4 正式签名，覆盖升级可保留该正式包的数据；模型目录身份或配置变化后，需在 FHL Images 十槽页重新验证并保存统一模型。
- Debug 外测包使用独立包名 `top.fangtangyuan.fhlstudio.android.debug` 和 Android Debug 证书，可与正式包并存；它不继承正式包配置，不能验证正式版原地升级。
- 用户报告：Android 手机上安装测试通过；该结果为用户反馈，不代表本轮正式签名包已完成构建或本轮独立复验。
- 本地 Debug 候选的功能和哈希记录见本地忽略的 `release-assets/`，Debug APK 不是正式 Release 附件。

## 构建与验证

需要 JDK 17、Node.js 24.13.1、Android SDK 34 和 Build Tools 34.0.0。正式 Release 构建必须提供 `IMAGE_STUDIO_KEYSTORE_PATH`、`IMAGE_STUDIO_KEYSTORE_PASSWORD`、`IMAGE_STUDIO_KEY_ALIAS`、`IMAGE_STUDIO_KEY_PASSWORD`；缺少任一项时 Gradle 会失败关闭，不回退到 Debug 签名。签名值和 Keystore 不得进入源码、Git、日志或附件。

```powershell
cd image-studio/frontend
npm ci
npm test
npm run build:android
npx tsc --noEmit

cd ../../android-shell
$env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND='1'
$env:IMAGE_STUDIO_ANDROID_VERSION_NAME='V2.0.5'
$env:IMAGE_STUDIO_ANDROID_VERSION_CODE='1050005'
$env:IMAGE_STUDIO_GIT_COMMIT=(git -C .. rev-parse HEAD)
$env:IMAGE_STUDIO_BUILD_ID='android-v2.0.5-release'
./gradlew.bat testDebugUnitTest lintRelease assembleRelease
```

正式 APK、源码 ZIP 和最终附件必须按 [GITHUB_UPLOAD_STEPS.md](./GITHUB_UPLOAD_STEPS.md) 完成签名身份核验、隐私扫描和 SHA-256 复核后方可发布。

## 发布状态

本分支对应 Android V2.0.5。正式 APK 与完整对应源码以独立 Tag `v2.0.5-android` 的 Release 附件为准，实际签名包验收与哈希见 Release 正文；不合入 `main`，不改变跨平台 latest 标记。详细更新说明见 [RELEASE_NOTES_V2.0.5_ANDROID.md](./RELEASE_NOTES_V2.0.5_ANDROID.md)，发布步骤见 [GITHUB_UPLOAD_STEPS.md](./GITHUB_UPLOAD_STEPS.md)。

本仓库和正式 APK 不得包含 API Key、用户图片、生成历史、任务日志、Keystore 或签名密码。许可证见 [LICENSE](./LICENSE)，上游署名见 [NOTICE.md](./NOTICE.md)。
