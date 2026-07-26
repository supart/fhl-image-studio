# FHL Image Studio macOS V2.0.3

这是基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版，不是上游官方版本。本版按 GNU AGPLv3 发布完整对应源码，不内置任何 API Key、账号配置或用户数据。

V2.0.3 是当前 macOS 正式版。本次 GitHub Release 只上传 macOS Apple Silicon 成品、完整源码 ZIP 和 SHA256 校验文件；不上传 Windows 或 Android 成品，也不修改既有 Release。

## 从 V2.0.2.1 升级

上一版 `v2.0.2.1` 的 Release 正文为空，主要交付的是 Windows Portable，并修复了 FHL Responses / `gpt-image-2` 在明确尺寸下的比例选择问题。V2.0.3 已完整包含该修复，并新增以下升级：

- 首次提供 macOS 13+ Apple Silicon 完整 DMG，内容区与桌面 V2.0.3 保持一致。
- FHL 文本 API 与 Images Key 完全分离；AI 优化和图片反推使用独立 `gpt-5.5` 文本路由。
- FHL Images 支持固定 10 个独立 Key 槽，并发按每个 API 单独计算。
- 批量任务改为独立 job 和即时补位，结果网格、完整相册与输入队列使用虚拟滚动。
- 历史记录取消 120 条破坏性裁剪，397 项压力测试工作区可以恢复。
- 新增 API 凭据库与安全清空流程，覆盖 Keychain、旧命名空间和本地 CLI 配置副本。
- 修复 macOS 图片反推导入 AVIF 预览时被 hardened runtime 终止的问题。

## macOS 版本重点

- 支持 macOS 13 或更高版本，仅支持 Apple Silicon（arm64）。
- 使用 macOS Keychain、WKWebView、原生文件对话框、Finder 拖放与 Core Image / Metal 图像链路。
- DMG 内含 `FHL Studio.app`、arm64 CLI、Codex Skill 安装器、macOS 使用说明和 Applications 快捷入口。
- 反推提示词已完成签名后的 AVIF 回归测试，并通过一次真实 FHL `gpt-5.5` 图片反推验证。
- hardened runtime 只增加 Wazero AVIF 回退所需的最小可执行内存权限；未开启 JIT、库验证绕过或 App Sandbox 权限。

## 功能与性能更新

- 文生图、图生图、编辑、多参考图、批量生成、历史记录、素材管理和画布编辑继续统一在桌面工作区内。
- FHL 10 Key 连续池保留每个任务的 API 来源、取消状态、结果与失败记录；任务结束后立即补充空闲并发。
- 列表只加载 384px AVIF 缩略图，打开、复制、编辑或导出时才读取原图。
- 360 工作台支持 2:1 全景生成、外部全景导入、镜头编辑、自动/手动/导入贴回和独立羽化控制。
- 完成贴回后的全景作为终态保存，不再重复显示贴回入口。
- 桌面端提供仅回环访问的 Photoshop Bridge；独立 UXP 插件不包含在本次 Release 资产中。

## 安装

1. 下载并打开 `FHL-Image-Studio-Desktop-V2.0.3-macOS-AppleSilicon.dmg`。
2. 将 `FHL Studio.app` 拖入 `Applications`。
3. 首次启动请在 Finder 中右键应用并选择“打开”，再确认系统安全提示。
4. 进入应用设置，填写并测试自己的 FHL、APIMart 或 RunningHub API。

当前 DMG 使用 ad-hoc 签名且未进行 Apple 公证，因此首次启动需要 Finder 右键“打开”。完成一次授权后，可以正常双击启动。

## 数据位置

- 生成图片：`~/Pictures/FHL Studio`
- 应用配置：`~/Library/Application Support/fhl-studio`
- 运行日志：`~/Library/Logs/FHL Studio`
- API 凭据：macOS Keychain

## Release 资产

- `FHL-Image-Studio-Desktop-V2.0.3-macOS-AppleSilicon.dmg`
- `FHL-Image-Studio-Desktop-V2.0.3-Source.zip`
- `SHA256SUMS.txt`

完整源码 ZIP 与 DMG 对应，另有 GitHub 自动生成的 tag 源码归档。请使用 `SHA256SUMS.txt` 校验下载文件。

## 安全与合规

本次正式资产已确认不包含：

- API Key、访问令牌、Keychain 数据或真实账号配置。
- `cli.env.local`、`fhl-api.local.json`、WebKit 登录状态或本机设置。
- 用户生成图片、测试导入图、历史数据库、运行日志或 raw 响应文件。
- `node_modules`、前端 `dist`、`build/bin`、缓存或临时运行目录。

示例配置 `config/cli.env.example` 中的 `IMAGE_STUDIO_API_KEY` 保持为空。用户必须在自己的 Mac 上配置 API；请勿在 Issue、讨论或聊天中发送 API Key。

## 验收结果

- 前端 Node 测试：561/561 通过。
- UI 测试：12/12 通过。
- Go CLI 与桌面后端测试、race、vet：通过。
- App 与内置 CLI：arm64、最低 macOS 13.0、签名和权限检查通过。
- `codesign --verify --deep --strict` 与 `hdiutil verify`：通过。
- 完整源码 ZIP：699 项，发布安全扫描通过，无私有配置或编译成品。
- 本机发布前清理：`FHL Studio` Keychain 项为 0，CLI 私有配置和 WebKit 状态为空。

完整构建与验收记录见 `V2.0.3_ACCEPTANCE_REPORT.md`。

## 已知限制

- 不支持 Intel Mac、Mac App Store 或自动更新。
- 当前版本未进行 Apple 公证，首次启动存在 Gatekeeper 提示。
- Photoshop UXP 插件仍需真实 Photoshop 2023 环境做最终人工验收，因此不随本次 Release 上传。
- FHL Images、APIMart 和 RunningHub 的可用性、额度及限流由各自上游服务决定。

## 开源致谢

- 原项目：[RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio)
- 方汤圆修改版：[supart/fhl-image-studio](https://github.com/supart/fhl-image-studio)
