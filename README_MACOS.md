# FHL Studio V2.0.4 for macOS

## 系统要求

- macOS 13 或更高版本
- Apple Silicon（arm64）或 Intel（x86_64）Mac
- 本版是 Universal 应用；Apple Silicon 已用于本机运行验收，Intel 切片已完成构建与静态验证，但尚未在 Intel Mac 实机启动

## 下载与校验

GitHub Release 提供以下三个文件：

- `FHL-Image-Studio-Desktop-V2.0.4-macOS-Universal.dmg`
- `FHL-Image-Studio-Desktop-V2.0.4-Source.zip`
- `SHA256SUMS.txt`

将三个文件下载到同一目录后，可以在终端中校验：

```bash
shasum -a 256 -c SHA256SUMS.txt
```

也可以只对 DMG 运行 `shasum -a 256`，再与 `SHA256SUMS.txt` 中同名文件的值比较。

## 安装与首次打开

1. 打开 DMG，将 `FHL Studio.app` 拖入 `Applications`。
2. 本版使用 ad-hoc 签名和 hardened runtime，未使用 Developer ID 签名，也未进行 Apple 公证。首次启动请在 Finder 中右键 `FHL Studio.app`，选择“打开”，再确认系统提示。
3. 进入应用内的 FHL 配置，填写并测试自己的 API。新安装不会自带可用 API。

如果直接双击被 Gatekeeper 阻止，请不要修改应用包内容；回到 Finder 使用右键“打开”完成首次授权。替换安装新版本后，macOS 可能会再次要求确认。

## 从旧版升级

将新版本拖入 `Applications`，出现提示时选择“替换”。替换应用本体不会主动迁移、清除或覆盖以下用户数据：

- `~/Pictures/FHL Studio` 中的图片与输出
- `~/Library/Application Support/fhl-studio` 中的应用配置和工作数据
- `~/Library/Logs/FHL Studio` 中的日志
- macOS Keychain 中由用户保存的 API 凭据

因此，同一 macOS 账户升级后可能继续读取该账户原有的配置、历史和 Keychain 凭据。这不表示 DMG 内含这些数据；在新 Mac 或新用户账户中启动时，应用会保持默认未配置状态。

## V2.0.4 重点

- 在 macOS 原生宿主能力不变的前提下，恢复 V2.0.3 的紧凑蓝灰 Fluent 视觉与 Windows V2.0.4 的完整工作区功能。
- 恢复一键配置、完整 FHL 配置、Images/Responses 模式切换、文生图/图生图切换、输出目录入口、状态栏与完整历史面板。
- 保留 10 个 FHL Images API 槽、连续生成、批量任务、动态模型、标注、本地编辑和 360 工作台。
- 继续使用 macOS Keychain、WKWebView、原生文件及目录面板、Finder 操作、原生拖拽和 `⌘` 快捷键。
- 主程序同时包含 arm64 与 x86_64，最低系统版本统一为 macOS 13.0。

## 发布包边界

DMG 只包含 `FHL Studio.app`、Applications 快捷入口和本说明。正式发布资产不包含：

- API Key、访问令牌、Keychain 数据或真实账号配置
- 用户生成图片、测试图片、导入图片或历史记录
- 运行日志、raw 响应、WebKit 数据或本机设置
- `node_modules`、前端 `dist`、`build/bin`、缓存或临时运行目录
- 已弃用的独立 CLI 或 Codex Skill 安装器

应用运行后会在当前用户目录中创建自己的配置、输出、日志和 WebView 数据；不要把已经运行过的本机目录重新打包分发。

## 已知限制

- 当前版本未进行 Apple 公证，首次打开存在 Gatekeeper 提示。
- Intel x86_64 切片尚未在 Intel Mac 实机启动验证。
- 不提供 Mac App Store 包或自动更新。
- Photoshop UXP 插件是独立交付物，不包含在本次 macOS Release 资产中。
- FHL Images、FHL Responses、APIMart 和 RunningHub 的可用性、额度及限流由各自上游服务决定。

## 开源

与 DMG 对应的干净源码位于同一 GitHub Release 的 `FHL-Image-Studio-Desktop-V2.0.4-Source.zip`。本项目按 GNU AGPLv3 提供对应源码。
