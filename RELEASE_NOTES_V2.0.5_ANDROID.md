# FHL Image Studio 方汤圆版 Android V2.0.5 更新说明（阶段候选）

状态：阶段 Debug 候选已完成验证，尚未正式发布
基线：`v2.0.4-android` / `bbe7668609798873923005046366e44068e75eb6`
目标版本：`V2.0.5 / 1050005`

## 本次升级

- 生图模型目录与文本模型目录完全隔离，使用当前 FHL Images 槽位的 Key、Base URL 和 provider 请求 `/v1/models`。
- 生图目录升级为动态 GPT Image 2.x：接受 provider 返回且满足精确规则的未来 minor/后缀 ID，保留精确大小写；拒绝非法 ID、文本/Embedding/音频等非图像模型和仅图像输入模型。
- 裸 `gpt-image-2.5` 仅作为不可调用诊断项显示；非 GPT Image 2.x 图像候选显示固定“不支持”原因，不能选择或提交。
- 旧 V2.0.4 Profile 在重新获取目录并明确选择模型前不能提交 FHL 生图；Key、Base URL、provider 或模型变化会使验证失效。
- 手机和平板主创作区新增“普通图像 / 透明 PNG”。透明仅对已验证、可生成、minor 不低于 5、非裸 2.5 且 provider 明确允许透明的精确 GPT Image 2.x 开放。
- 透明请求固定使用 PNG、`background=transparent` 和一次透明背景指令；普通模式保持 V2.0.4 请求格式。
- Images edit 继续按原顺序重复 `image` multipart 字段，不改成 `image[]`。
- 最终透明结果在成功历史、正式落盘和任务成功前校验 PNG 签名、可解码性、可见像素与真实 Alpha；失败码统一为 `invalid_transparent_output`。
- provider、精确模型、验证时间、目录身份、API 模式、背景、格式、最终 prompt 和参考图顺序冻结到任务与历史；恢复和重试不读取当前 UI 偷换来源。
- 启动改为两阶段：Profile、工作区、模型和主题先显示，活动槽凭据以“确认中”安全占位；只优先读取活动槽 Key，其余历史媒体、输出目录和原生任务延后并行恢复。
- 原生任务恢复移出 Android UI 线程并合并重复 `onCreate/onResume` 请求；回前台固定重新读取 registry、单调合并任务、补写历史/当前任务结果，再建立订阅并只按所需 `jobId` 重放事件。
- 成功任务只有在本地图片历史真正恢复后才退订；媒体暂不可用时按 `250ms / 1s / 3s` 有限退避重试，仍失败则保留到下次回前台补偿。旧终态只补历史，不覆盖新任务或用户当前画布。
- 前台服务与生成结果拆分通知频道：服务频道为 LOW，成功/失败结果频道为 DEFAULT；通知权限或展示失败不影响任务终态和回前台恢复。
- Android API Key 输入和十槽批量输入恢复系统原生长按粘贴；粘贴只更新草稿，显式保存/测试后才写入凭据存储。
- 修复透明 PNG 在 Android 画布中显示成黑底：正式原图仍保持真实 Alpha，原生缩略图现在按 Alpha 选择 PNG/JPEG 并返回正确 MIME；旧 PNG 对应的 JPEG 缩略图会从正式 PNG 重新生成预览。
- 修复 FHL 十槽统一模型选择与逐槽验证状态冲突：统一入口将自动验证所有已配置且启用的槽位，全部成功后才原子应用同一生图模型；空槽和停用槽跳过，任一目标槽失败则保留原配置。
- FHL 池单槽设置只读显示统一模型状态，不再要求用户逐个 API 获取目录或调整生图参数；尺寸、比例、质量、背景、格式和 Seed 继续由工作区统一管理。
- FHL 十槽共同模型改为固定高度卡片：进入配置页后自动扫描凭据并验证目录，顶部不再暴露手动获取流程；卡片内保留低强调刷新与显式“保存统一模型”。
- 模型选择改为卡片内点击展开的可滚动 listbox：默认只显示当前模型/占位，选中后自动收起，不再把全部动态模型项同时堆在卡片里；保留禁用原因、键盘 Escape 和点击外部收起。
- Keystore 扫描异常显示脱敏错误并可重试；只有全部目标槽当前模型均非空且一致时才预选，不自动切换模型或自动保存。
- Android 画布：图生图运行时即使保留参考图也会显示单次等待预览层，收到流式预览后自动切换；连续缩放、双指缩放和拖拽不会再因旧回调回弹。
- 十槽目录采用安全并集展示和共同可用交集提交：模型缺失的槽位以安全槽号显示原因，生成/编辑/透明能力对全部目标槽做 AND 合并；刷新失败保留上次成功列表和当前模型，但禁止本次保存。
- 原生 `/v1/models` 为每个槽生成不透明 receipt；“保存统一模型”校验全部 receipt 后生成批次 proof。Profile、请求、任务、历史和冻结重放均携带能力快照与 proof，缺失、伪造或能力放大一律失败关闭。

## Android 兼容性

- 保留 FHL Images 与 Responses 双协议，不把 Responses 作为失败后的自动备用路由。
- 保留 FHL1-FHL10 十槽、Android Keystore、每槽并发 4、总池并发 40、提交幂等、原生后台任务、完成通知和冷启动恢复。
- 保留进程真正被系统杀死时的防重复扣费策略：无法确认结果的 Images/Responses POST 标记为 interrupted，不自动重新提交。
- 保留 APIMart 与 RunningHub 各自的比例和请求语义；两者不启用本版本的原生透明参数。
- 首次安装仍不内置 API Key，源码、APK、日志和报告不包含凭据、Keystore、签名密码或用户图片。

## 验证状态

### 模型选择弹层修复（2026-11-10，本地构建完成）

- 统一模型面板契约测试、完整前端 `440/440`、TypeScript、`npm run build:android`、Android JVM `71/71`、强制 `assembleDebug`、包内前端资源和 v2 Debug 签名均通过。
- 新 Debug APK：`14,851,331` 字节，SHA-256 `BB0B2659B1A08ABB6CB2663F4C320FE08B4EFA457087A6E7B4E3904765ED6DB4`；包名 `top.fangtangyuan.fhlstudio.android.debug`，`V2.0.5-debug / 1050005`。候选位于忽略目录 `release-assets/V2.0.5-Android-Device-Test-Debug-20261110-model-picker/`，不是正式发布包。
- `codex_api36` 的 API 36、无凭据策略和 ready 状态已由 MCP 确认；因本会话未提供 `TY_ANDROID_MCP_APK`、`TY_ANDROID_MCP_INSTALL_SCRIPT`、`TY_ANDROID_MCP_PACKAGE` 映射，本批未安装 APK 或执行 UI 点击验收，lease 已释放。不得将设备交互写为通过。
- 本批没有真实目录请求和付费生图；未读取/输入/复制/截图/记录 Key，未 push、打 Tag 或创建 Release。Gradle 强制构建触发的 `npm ci` 审计报告 7 个漏洞（1 low、1 moderate、5 high），未自动升级依赖。

- 动态 GPT Image 2.x 升级已完成本地构建与 2K 模拟器安装验收；下面较早候选记录仅作历史对照，当前候选以本节最后一项为准。

- V2.0.4 修改前基线：前端 `364/365`（唯一失败为旧 PowerShell 缺少 `Get-FileHash`）、Worker `5/5`、Android JVM `54/54`、`build:android` 与 `assembleDebug` 通过。
- 启动/后台稳定性变更后的前端完整测试为 `401/402`；唯一失败仍是 V2.0.4 修改前基线已知的本机旧 PowerShell 缺少 `Get-FileHash`。TypeScript、`build:android`、Android JVM `63/63` 和强制 `assembleDebug` 通过；Worker 未受本批影响，未重复运行。
- 2K API 36 模拟器 instrumentation `17/17` 通过。首次 JVM 命令只因临时 `Q:` 路径未继承 SDK 环境而在依赖解析前停止，绑定 SDK 后重跑通过，不是产品失败；临时映射已解除。
- 上一批 Debug APK（已被下方粘贴修复候选取代）：`14,775,605` 字节，SHA-256 `EAAE8DB8EA82BA8918878D0E35809593012F754D3369F112DF3612FA57B32A20`。APK v2 签名验证通过，使用 Android Debug 证书，不是正式发布附件。
- `codex_api36` 已按备份后最小修改调整为 `1440x3200 @ 560 dpi`，boot、ADB 和 Companion 均 ready；项目审核脚本最终 FreshInstall 通过，MCP 包清单和 fresh screen 确认版本、`MainActivity` 及首次安装空配置界面。第一次安装脚本实际成功，只有外层包装器因空 `$LASTEXITCODE` 发生误报；后续以 `$?` 判定的最终安装明确通过。
- 当前真实验收使用 `ty-android-mcp` 的 API 36、`1440x3200 @ 560 dpi` 模拟器，用户手动配置 FHL 凭据；自动化未读取、输入、复制、截图或记录 Key。
- 粘贴/后台修复后的前端完整测试为 `407/408`；唯一失败是旧 Windows PowerShell 缺少 `Get-FileHash`，不是产品断言。TypeScript、`build:android`、Android JVM `63/63`、强制 `assembleDebug` 和画布/后台聚焦测试 `87/87` 通过。
- 已成功核对的 Images 项：`gpt-image-2 + JPEG` 普通图像、Flare + WebP 普通图像、Flare + 透明 PNG（Home 后台完成/通知/回前台恢复）、Sunburst + 透明 PNG（前台/Alpha 门禁）。每项均核对成功终态、历史、当前画布和实际 MIME。
- 最后一项 Responses + Flare 透明 PNG 真实提交返回 provider `503 No available channel for model gpt-5.5`，按 fail-closed 规则停止，未重试、未换模型、未换协议；因此 Responses 真实成功和剩余未提交矩阵项不宣称通过。
- 当前 Debug APK：`V2.0.5-debug / 1050005`，包名 `top.fangtangyuan.fhlstudio.android.debug`，SHA-256 `C5D64A651271A8642CE2DABC121A65614BFAA4F150F8B6789E4DD8EBA891BC57`，大小 `14,776,656` 字节；仅 Debug 验证包，不是正式签名附件。
- 透明预览修复后的最新本地 Debug APK 已取代上一候选：SHA-256 `B218442E52FAFFD73727DCDD20A3FF6C71CD7DDB4648E385055E85695FF01A89`，大小 `15,102,828` 字节。前端 `408/408`、TypeScript、Android 构建、JVM `64/64` 和 AndroidTest 编译打包通过；当前 MCP 缺少 APK 安装能力，因此该精确哈希尚未在模拟器覆盖安装，不能记作设备实测通过。
- 后续已按 `ty-android-mcp` 项目审核流程完成该精确哈希的 `MatrixStartup` 覆盖安装；设备内 SHA-256 一致，`V2.0.5-debug / 1050005` 包身份、十槽配置保留、2K fresh screen 和透明 PNG 控件均已复核，观察期外部 POST 为 `0`。此前“尚未覆盖安装”的状态已关闭。

### 十槽统一配置最终验证（2026-11-08）

- 统一入口逐槽使用各自 Keystore Key 获取 `/v1/models`，对已配置且启用的目标槽求精确模型交集；全部成功后只写入一次公共目录并原子应用相同验证元数据，失败不改变旧配置。
- 停用后重新启用 FHL 槽会清除旧验证时间、目录 Base URL 和 provider；新增回归覆盖携带旧元数据的绕过尝试。单槽页面仅显示统一管理状态，工作区生图参数保持统一。
- 前端完整测试 `419/419`，聚焦统一配置/启用状态 `20/20`，TypeScript、`npm run build:android`、Android JVM `64/64`、强制 `assembleDebug` 全部通过；Worker 未受本批影响，未重复执行。
- 当前 Debug APK：`top.fangtangyuan.fhlstudio.android.debug`，`V2.0.5-debug / 1050005`，大小 `14,784,153` 字节，SHA-256 `83678233B1A5FA4CA32EC4F0B622A6CCBE5E8EBD283678E15881ED0D5411AEB1`；Debug 签名，仅用于本地验证，不是正式发布包。
- `codex_api36`：API 36，`1440x3200 @ 560 dpi`。审核 `install -r` 覆盖安装保留用户配置；真实模型目录验证在新候选上成功，10 个活动槽均验证并应用 `gpt-image-2.5-sunburst`，首页提交门禁提示消失；本批未执行付费生图。
- 20 次配置态冷启动均恢复首页：WebView shell P95 `538ms`；包含 MCP fresh-read 与安全凭据确认的“已配置”状态 P95 `2618ms`、中位数 `2383ms`。脱敏计时报告：`artifacts/android-v205-unified-config-20261108/startup-timing-20.json`。
- API Key、Keystore、原始响应、用户图片和完整 UI 树均未进入源码、日志、截图或报告；未 push、未打 Tag、未创建 GitHub Release。

## 发布状态

当前仅在 `codex/android-v2.0.5-upgrade` 本地开发和验证。未 push、未创建 `v2.0.5-android` Tag、未创建 GitHub Release、未生成正式签名 APK，也未修改 V2.0.4 Tag、Release 或正式附件。

### Android 画布修复最终验证（2026-11-08）

- 图生图在保留参考图/currentImage 时会显示单次等待占位；真实 Images 回归中观察到 `等待第 1 张预览`，随后由最终“一只钓鱼的小猫”结果接管画布，通知、历史和参考图均正常。
- 缩放工具栏 `26% → 31% → 26%`、拖拽后的比例保持和重置视图已在 2K 模拟器复核；双击/pinch 仅执行尝试，accessibility 文本无法独立确认数值变化，未将其写为通过。
- 最终本地 Debug APK：`V2.0.5-debug / 1050005`，包名 `top.fangtangyuan.fhlstudio.android.debug`，大小 `14,784,310` 字节，SHA-256 `3D6AEBEAF689DE804FE9E0E44042FF378832B5D642EA26BEE0D0ABE9E424C4E8`。前端 `421/421`、TypeScript、`build:android`、Android JVM `64/64`、`assembleDebug` 均通过。
- `codex_api36`（API 36，`1440x3200 @ 560 dpi`）已覆盖安装该 APK，租约已释放；证据目录已脱敏。当前仍为本地开发验证，不 push、不打 Tag、不创建 Release、不生成正式签名包。

### 固定统一模型面板最终验证（2026-11-09）

- 聚焦测试 `28/28`、完整前端 `426/426`、TypeScript、`npm run build:android`、Android JVM `64/64` 和强制 `assembleDebug` 均通过；Worker 未受本批影响，未重复执行。
- 安全扫描覆盖工作树 409 个文件、414 个可达 Git Blob 和 APK 925 个条目，问题数为 0。
- 最新 Debug 候选：`top.fangtangyuan.fhlstudio.android.debug`，`V2.0.5-debug / 1050005`，`14,785,860` 字节，SHA-256 `A72B2A3CBFC85886DBC2DCDA8AF13C32FFB203F5757D5E72EA7B4057F6040F01`；v2 签名通过，使用 Android Debug 证书，不是正式发布包。
- `codex_api36`（API 36，`1440x3200 @ 560 dpi`）完成该精确哈希的覆盖安装与 fresh screen；固定卡片自动验证 10 个活动槽，手动刷新恢复 ready，显式保存后确认 10 槽可共同调度。30 秒安装观察期为 0 点击、0 任务、0 上游 POST。
- 设备证据已将传输端点和工作区内部 ID 脱敏，JSON 与 manifest 哈希复核通过；API Key、Keystore、原始响应和用户图片均未进入证据，租约已释放。
- 本候选可发给其他设备安装测试，并与正式 V2.0.4 并存；它不等同于正式 Release 签名包，也不能用于验证正式版原地升级。

### 动态 GPT Image 2.x 目录升级验证（2026-11-10）

- 动态目录、缓存 v2、未来 2.x、模糊别名、非法/重复/非图像过滤、显式能力禁用、十槽安全并集与共同交集、透明资格和原生 proof 的聚焦测试均已纳入完整回归。
- 完整前端 `440/440`、TypeScript、`npm run build:android`、Worker `5/5`、Android JVM `71/71`、androidTest 编译打包、强制 `assembleDebug`、`git diff --check` 和安全扫描通过。
- 安全扫描覆盖 411 个工作树文件、515 个可达 Git Blob 和 925 个 APK 条目，问题数为 0；APK 为 `top.fangtangyuan.fhlstudio.android.debug / V2.0.5-debug / 1050005`，v2 Debug 签名有效。
- API 36 的 `codex_api36` 以 `1440x3200 @ 560 dpi` 完成审核覆盖安装、包清单复核、启动和 fresh screen；10 个既有活动槽保留，观察期 0 点击、0 任务、0 上游 POST。
- 本批没有进入会自动逐槽验证的凭据面板，真实目录 GET 和付费生图均为 0；没有读取、输入、复制、OCR、截图或记录 API Key。
- 最终 Debug 外测文件、大小和 SHA-256 以忽略目录 `release-assets/V2.0.5-Android-Device-Test-Debug-20261110/` 中的哈希与说明为准；旧 `A72B2A3C...F6040F01` 不再是候选。
