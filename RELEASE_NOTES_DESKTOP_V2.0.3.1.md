# FHL Image Studio macOS V2.0.3.1

这是基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版，不是上游官方版本。本版按 GNU AGPLv3 发布完整对应源码，不内置任何 API Key、账号配置、历史记录、测试图片或用户数据。

V2.0.3.1 是 V2.0.3 的 macOS 补丁版本。本次 Release 只新增 macOS Apple Silicon DMG、完整对应源码 ZIP 和 SHA256 校验文件；不上传 Windows 或 Android 成品，也不删除或覆盖既有 `v2.0.3` Release。

## 本次修复

- 修复一键配置并验证 FHL Images API 后，工作区和右侧上游区域仍可能显示“未配置”的状态同步问题。
- 当当前连接为空时，自动选择第一个已经配置的 FHL Images 槽；已有有效的 APIMart、RunningHub 或其他当前连接不会被覆盖。
- API Key 密码输入框支持 macOS 原生右键菜单，可以直接使用“粘贴”。
- 保留 V2.0.3 的 AVIF 图片反推崩溃修复、FHL 文本与 Images 凭据分离、10 Key 连续池、历史记录和 360 工作台功能。

## 人工验证

- 已完成一键配置、连接状态刷新和真实生图检查。
- 已在生产版 FHL Images API Key 输入框上确认右键菜单显示可用的“粘贴”。
- 替换安装后，原有本机配置和历史记录仍可正常读取。

## 安装与升级

1. 下载并打开 `FHL-Image-Studio-Desktop-V2.0.3.1-macOS-AppleSilicon.dmg`。
2. 将 `FHL Studio.app` 拖入 `Applications`。
3. 如果系统提示已有旧版本，选择“替换”。应用程序本体会更新，本机图片、历史记录和 Keychain 凭据不会因替换 App 而删除。
4. 当前 DMG 使用 ad-hoc 签名且未进行 Apple 公证；首次启动时请在 Finder 中右键应用并选择“打开”。

系统要求：macOS 13 或更高版本，仅支持 Apple Silicon（arm64）。

## Release 资产

- `FHL-Image-Studio-Desktop-V2.0.3.1-macOS-AppleSilicon.dmg`
- `FHL-Image-Studio-Desktop-V2.0.3.1-Source.zip`
- `SHA256SUMS.txt`

## 默认设置与安全

本次正式资产使用默认设置并确认不包含：

- API Key、访问令牌、Keychain 数据或真实账号配置。
- `cli.env.local`、`fhl-api.local.json`、WebKit 登录状态或本机设置。
- 用户生成图片、测试导入图、历史数据库、运行日志或 raw 响应文件。
- `node_modules`、前端 `dist`、`build/bin`、缓存或临时运行目录。

示例配置 `config/cli.env.example` 中的 `IMAGE_STUDIO_API_KEY` 保持为空。用户必须在自己的 Mac 上配置 API；请勿在 Issue、讨论或聊天中发送 API Key。

## 已知限制

- 不支持 Intel Mac、Mac App Store 或自动更新。
- 当前版本未进行 Apple 公证，首次启动存在 Gatekeeper 提示。
- FHL Images、APIMart 和 RunningHub 的可用性、额度及限流由各自上游服务决定。

## 开源致谢

- 原项目：[RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio)
- 方汤圆修改版：[supart/fhl-image-studio](https://github.com/supart/fhl-image-studio)
