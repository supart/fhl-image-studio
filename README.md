# FHL Image Studio 方汤圆版

> 基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版。本项目不隶属于、不代表、也不由上游项目维护。

本仓库按 GNU AGPLv3.0 公开完整对应源码。Android V2.0.5 不内置 API Key，用户需要在应用内自行配置自己的服务凭据。

## Android V2.0.5（开发验证中）

- 包名：`top.fangtangyuan.fhlstudio.android`
- 版本：`V2.0.5 / 1050005`
- 系统要求：Android 9（API 28）及以上
- 默认生图协议：FHL `Images API`
- 备用协议：保留 FHL `Responses API`，只影响之后提交的新任务
- 正式签名证书 SHA-256：`6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36`

### 主要能力

- 10 个 FHL API 槽位统一配置，凭据使用 Android Keystore 加密保存。
- 批量粘贴最多10个 API，只显示固定掩码，确认预填后仍需用户主动保存和测试。
- FHL池每槽最多4个运行任务、总池最多40个；同槽FIFO并按全局最老可运行任务调度。
- 一次点击只创建一组任务，提交ID、槽位、协议和来源在提交时冻结，付费POST不自动换Key重提。
- Android 原生后台生成、持久任务对账、完成通知、历史来源标签和冷启动防重复提交；真正未知的 Images/Responses 付费 POST 仍中断关闭，不自动重发。
- 启动先恢复 Profile、工作区、模型和主题；活动槽凭据显示“确认中”，凭据、历史媒体、输出目录和原生任务随后并行恢复，不再让十槽 Keystore 读取阻塞首屏。
- 回到前台会重新读取原生任务 registry，按时间单调合并并补写结果；旧终态不会抢占当前画布，媒体暂未就绪时有限重试并留待下次回前台补偿。
- 前台服务使用 LOW 通知频道，生成完成和失败使用独立 DEFAULT 结果频道；通知权限失败不改变任务终态或历史恢复。
- 快速设置可折叠并记忆状态；批量结果在手机上固定两列并按可见行虚拟化。
- 文生图、图生图、多参考图、画布编辑、历史回用、保存原图和系统分享。
- FHL Responses 文本配置可从 `/v1/models` 获取模型列表，反推提示词和提示词优化共用用户保存的文本模型。
- FHL Images 多参考图使用重复的 `image` 字段，并新增 `4:3`、`3:4` 比例。
- 生图模型目录动态接收 provider 返回的精确 GPT Image 2.x ID，并保留未来 minor/后缀；非法 ID、非图像模型、仅图像输入模型和不可调用的裸 `gpt-image-2.5` 均失败关闭。
- 十槽面板展示安全并集，但只有所有已启用且有凭据的槽位共同存在、共同允许生成的模型才能保存；能力按全部目标槽保守合并。
- 手机和平板主创作区支持普通图像与透明 PNG；透明要求精确 GPT Image 2.x、minor 不低于 5、provider 明确允许、有效原生目录证明和 PNG 输出，最终结果必须包含真实 Alpha。
- provider、精确模型、验证目录、API 模式、背景、格式、prompt 和参考图顺序冻结到任务、历史与重试，不从当前 UI 偷换来源。

## 首次使用

1. 取得经审核的 APK 后安装并打开应用；当前 V2.0.5 开发分支尚未发布正式 APK。
2. 点击“一键配置”，进入“FHL API 10槽”。
3. 逐槽配置，或使用“批量配置10个API”粘贴；应用不会提供或自动下载任何Key。
4. 保存并测试已填写槽位；十槽面板会自动验证目录，用户只需选择全部活动槽位共同可用的精确模型并点击“保存统一模型”。
5. 用小任务确认服务可用；默认使用 Images API，只有上游规则需要时再从顶部切换 Responses API。

## 从源码构建

需要 JDK 17、Node.js 24.13.1、Android SDK 34和Build Tools 34.0.0。正式Release必须提供四项签名环境变量，缺少时构建直接失败，不会回退到Debug签名。

```powershell
cd image-studio/frontend
npm ci
npm test
npm run build:android

cd ../../android-shell
$env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND='1'
$env:IMAGE_STUDIO_ANDROID_VERSION_NAME='V2.0.5'
$env:IMAGE_STUDIO_ANDROID_VERSION_CODE='1050005'
$env:IMAGE_STUDIO_GIT_COMMIT=(git -C .. rev-parse HEAD)
$env:IMAGE_STUDIO_BUILD_ID='android-v2.0.5-release'
./gradlew.bat testDebugUnitTest lintRelease assembleRelease
```

签名路径、别名和密码使用 `IMAGE_STUDIO_KEYSTORE_PATH`、`IMAGE_STUDIO_KEY_ALIAS`、`IMAGE_STUDIO_KEYSTORE_PASSWORD`、`IMAGE_STUDIO_KEY_PASSWORD` 传入，不能提交到仓库。

## 验证与限制

- V2.0.4 修改前基线已复核：前端完整测试 `364/365`（唯一失败为旧 Windows PowerShell 缺少 `Get-FileHash`）、Worker `5/5`、Android JVM `54/54`、`npm run build:android` 和 `:app:assembleDebug` 通过。
- 动态 GPT Image 2.x 升级回归：前端 `440/440`、TypeScript、`npm run build:android`、Worker `5/5`、Android JVM `71/71`、androidTest 编译打包、强制 `assembleDebug` 和安全扫描均通过。
- 当前外测产物为 `V2.0.5-debug / 1050005`、包名 `top.fangtangyuan.fhlstudio.android.debug`，使用 Android Debug 证书，可与正式包并存，不是正式发布包；最终文件大小和 SHA-256 记录在本机忽略的设备测试交付目录。
- `codex_api36` 已由 `ty-android-mcp` 验证为 API 36、`1440x3200 @ 560 dpi`；审核覆盖安装、包清单、`MainActivity` 和 fresh screen 通过，安装观察期为 0 点击、0 任务、0 上游 POST。本批未进入带凭据的自动验证面板，因此没有新增真实目录请求。
- 真实 API Images 验收的已通过项和 Responses provider 503 停止记录见 `RELEASE_NOTES_V2.0.5_ANDROID.md`；本次固定面板验收未触发付费生图。所有凭据操作均由用户手动完成，自动化不读取或记录 Key。
- Responses生图通道保留，但验证期间官方上游曾返回HTTP 503；共享测试账户也可能受到429限流。
- 本版本未执行216次正式真实API发布门禁。请先小规模验证自己的服务配额，不要将限流结果当作本地调度失败。

## 源码与安全

- 本仓库和正式APK不包含API Key、用户图片、生成历史、任务日志、Keystore或签名密码。
- API配置仅在用户设备本地保存；Android凭据使用系统Keystore加密引用。
- APK/ZIP作为GitHub Release附件，不提交进Git树；Tag与额外源码ZIP必须来自同一公开提交。
- 许可证见 [LICENSE](./LICENSE)，上游署名见 [NOTICE.md](./NOTICE.md)，历史MIT文本见 [LICENSES/UPSTREAM-MIT-v1.0.7.txt](./LICENSES/UPSTREAM-MIT-v1.0.7.txt)。

## 发布

Android V2.0.5 当前只在本地分支开发验证，尚未 push、打 Tag 或创建 Release。阶段 Debug 外测包已整理到本机忽略目录；正式 Release 仍需单独授权和受保护签名材料。计划独立 Tag 为 `v2.0.5-android`；草案见 [RELEASE_NOTES_V2.0.5_ANDROID.md](./RELEASE_NOTES_V2.0.5_ANDROID.md)。手动 GitHub Actions 只生成审核附件，不会自动创建 Release。
