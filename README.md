# FHL Image Studio 方汤圆版

> 基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版。本项目不隶属于、不代表、也不由上游项目维护。

本仓库按 GNU AGPLv3.0 公开完整对应源码。Android V2.0.3 不内置 API Key，用户需要在应用内自行配置自己的服务凭据。

## Android V2.0.3

- 包名：`top.fangtangyuan.fhlstudio.android`
- 版本：`V2.0.3 / 1050003`
- 系统要求：Android 9（API 28）及以上
- 默认生图协议：FHL `Images API`
- 备用协议：保留 FHL `Responses API`，只影响之后提交的新任务
- 正式签名证书 SHA-256：`6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36`

### 主要能力

- 10 个 FHL API 槽位统一配置，凭据使用 Android Keystore 加密保存。
- 批量粘贴最多10个 API，只显示固定掩码，确认预填后仍需用户主动保存和测试。
- FHL池每槽最多4个运行任务、总池最多40个；同槽FIFO并按全局最老可运行任务调度。
- 一次点击只创建一组任务，提交ID、槽位、协议和来源在提交时冻结，付费POST不自动换Key重提。
- Android原生后台生成、完成通知、历史来源标签和冷启动防重复提交。
- 快速设置可折叠并记忆状态；批量结果在手机上固定两列并按可见行虚拟化。
- 文生图、图生图、多参考图、画布编辑、历史回用、保存原图和系统分享。

## 首次使用

1. 安装正式APK并打开应用。
2. 点击“一键配置”，进入“FHL API 10槽”。
3. 逐槽配置，或使用“批量配置10个API”粘贴；应用不会提供或自动下载任何Key。
4. 保存并测试已填写槽位后，用小任务确认服务可用。
5. 默认使用Images API；只有上游规则需要时再从顶部切换Responses API。

## 从源码构建

需要 JDK 17、Node.js 24.13.1、Android SDK 34和Build Tools 34.0.0。正式Release必须提供四项签名环境变量，缺少时构建直接失败，不会回退到Debug签名。

```powershell
cd image-studio/frontend
npm ci
npm test
npm run build:android

cd ../../android-shell
$env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND='1'
$env:IMAGE_STUDIO_ANDROID_VERSION_NAME='V2.0.3'
$env:IMAGE_STUDIO_ANDROID_VERSION_CODE='1050003'
$env:IMAGE_STUDIO_GIT_COMMIT=(git -C .. rev-parse HEAD)
$env:IMAGE_STUDIO_BUILD_ID='android-v2.0.3-release'
./gradlew.bat testDebugUnitTest lintRelease assembleRelease
```

签名路径、别名和密码使用 `IMAGE_STUDIO_KEYSTORE_PATH`、`IMAGE_STUDIO_KEY_ALIAS`、`IMAGE_STUDIO_KEYSTORE_PASSWORD`、`IMAGE_STUDIO_KEY_PASSWORD` 传入，不能提交到仓库。

## 验证与限制

- 前端362项、Worker 5项、Android JVM 53项以及32项移动布局矩阵已通过。
- API 28、API 34手机/平板和API 36.1模拟器完成开发版功能验证；用户于2026年8月13日确认真机测试正常，未记录设备型号和系统版本。
- Responses生图通道保留，但验证期间官方上游曾返回HTTP 503；共享测试账户也可能受到429限流。
- 本版本未执行216次正式真实API发布门禁。请先小规模验证自己的服务配额，不要将限流结果当作本地调度失败。

## 源码与安全

- 本仓库和正式APK不包含API Key、用户图片、生成历史、任务日志、Keystore或签名密码。
- API配置仅在用户设备本地保存；Android凭据使用系统Keystore加密引用。
- APK/ZIP作为GitHub Release附件，不提交进Git树；Tag与额外源码ZIP必须来自同一公开提交。
- 许可证见 [LICENSE](./LICENSE)，上游署名见 [NOTICE.md](./NOTICE.md)，历史MIT文本见 [LICENSES/UPSTREAM-MIT-v1.0.7.txt](./LICENSES/UPSTREAM-MIT-v1.0.7.txt)。

## 发布

Android使用独立Tag `v2.0.3-android`。详细更新见 [RELEASE_NOTES_V2.0.3_ANDROID.md](./RELEASE_NOTES_V2.0.3_ANDROID.md)，审核和上传步骤见 [GITHUB_UPLOAD_STEPS.md](./GITHUB_UPLOAD_STEPS.md)。GitHub Actions只生成审核附件，不会自动创建Release。
