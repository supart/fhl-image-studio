# FHL Image Studio macOS V2.0.4

这是基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版，不是上游官方版本。本版按 GNU AGPLv3 发布完整对应源码，不内置任何 API Key、账号配置、Keychain 数据、历史记录、测试图片或用户数据。

V2.0.4 是独立的 macOS Universal 更新。本次 Release 只提供 macOS 成品、完整对应源码 ZIP 和 SHA-256 校验文件，不上传或覆盖 Windows、Android 和 Photoshop 插件资产，也不替代其他平台的 Latest Release。

## 从 V2.0.3.1 升级

- 主程序由仅 Apple Silicon 升级为 Universal，同时包含 arm64 与 x86_64，最低系统版本保持 macOS 13.0。
- 恢复 V2.0.3 已验证的紧凑蓝灰 Fluent 视觉，包括栏宽、密度、圆角、浅色/深色色调和 macOS 交通灯安全区。
- 对齐 Windows V2.0.4 的完整工作区：一键配置、完整 FHL 配置、Images/Responses 模式切换、文生图/图生图切换、完整工具栏、状态栏、历史面板和底部输出目录入口均已恢复。
- 保留 V2.0.4 的 10 API 池、连续生成、批次任务、动态模型、标注、本地编辑、素材管理和 360 工作台，不通过回退旧版文件实现视觉恢复。
- 平台能力继续使用真实 macOS 宿主：Keychain、WKWebView、原生文件及目录面板、Finder 操作、原生拖拽、Core Image / Metal 图像链路和 `⌘` 快捷键保持不变。
- 修复 macOS 原生文件拖拽主线程处理、`/var` 与 `/private/var` 路径归一化、输出目录安全边界、默认日志目录和 CLI 路径分隔符等平台问题。

## 工作区与任务更新

- Header 恢复一键/完整配置、FHL Images 与 Responses 切换、推广信息、社区入口、GitHub、Star 和主题操作。
- 左侧 Compose/Advanced 面板恢复紧凑布局，并保留文生图、图生图、连续生成、批量任务和高级参数。
- 中央区域恢复完整源图操作、单排工具栏、任务状态、传输量、seed、style、耗时和 revised prompt 信息。
- 右侧完整历史面板提供模式计数、搜索、日期筛选、批次队列、最近作品、素材管理、提示词分组和完整相册。
- Footer 恢复输出目录、GitHub、反馈、今日/累计统计、运行状态和版本信息。
- 桌面端继续提供仅回环访问的 Photoshop Bridge；独立 UXP 插件不包含在本次 Release 中。

## 安装与升级

1. 下载 `FHL-Image-Studio-Desktop-V2.0.4-macOS-Universal.dmg` 和 `SHA256SUMS.txt`，校验文件完整性。
2. 打开 DMG，将 `FHL Studio.app` 拖入 `Applications`。
3. 如果系统提示已有旧版本，选择“替换”。替换 App 不会主动删除本机图片、历史记录、设置或 Keychain 凭据。
4. 本版使用 ad-hoc 签名和 hardened runtime，未使用 Developer ID 签名，也未进行 Apple 公证。首次启动请在 Finder 中右键应用并选择“打开”，再确认系统提示。
5. 新安装需要在应用内配置自己的 API；正式包不提供默认 Key 或共享账号。

同一 macOS 账户从旧版升级时，应用可能继续读取该账户已有的本地配置、历史记录和 Keychain 凭据。这不表示发布包包含用户 API；新 Mac 或新用户账户会以默认未配置状态启动。

## 数据位置

- 生成图片：`~/Pictures/FHL Studio`
- 应用配置：`~/Library/Application Support/fhl-studio`
- 运行日志：`~/Library/Logs/FHL Studio`
- API 凭据：macOS Keychain，service 为 `FHL Studio`

## Release 资产

- `FHL-Image-Studio-Desktop-V2.0.4-macOS-Universal.dmg`
- `FHL-Image-Studio-Desktop-V2.0.4-Source.zip`
- `SHA256SUMS.txt`

将三个文件下载到同一目录后，可运行：

```bash
shasum -a 256 -c SHA256SUMS.txt
```

也可以只对单个下载文件运行 `shasum -a 256 <文件名>`，再与 `SHA256SUMS.txt` 中同名文件的值比较。发布说明不固定写入哈希值，以 Release 同页上传的校验文件为准。

## 默认设置与安全

正式 DMG 只包含 `FHL Studio.app`、Applications 快捷入口和 `README_MACOS.md`。正式资产不包含：

- API Key、访问令牌、Keychain 数据或真实账号配置
- `cli.env.local`、`fhl-api.local.json`、WebKit 状态或本机设置
- 用户生成图片、测试图片、导入图片、历史数据库、运行日志或 raw 响应
- `node_modules`、前端 `dist`、`build/bin`、缓存或临时运行目录
- 已弃用的独立 CLI 或 Codex Skill 安装器

用户必须在自己的 Mac 上配置 API。请勿在 Issue、讨论、日志或聊天中发送 API Key。

## 已知限制

- 当前版本未使用 Developer ID 签名且未进行 Apple 公证，首次启动存在 Gatekeeper 提示。
- x86_64 切片已完成构建与静态验证，但尚未在 Intel Mac 实机启动；Intel 用户如遇问题请附 macOS 版本和崩溃报告，但不要附 API Key。
- 不提供 Mac App Store 包或自动更新。
- Photoshop UXP 插件需独立安装和验收，不随本次 macOS Release 上传。
- FHL Images、FHL Responses、APIMart 和 RunningHub 的可用性、额度及限流由各自上游服务决定。

## 开源致谢

- 原项目：[RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio)
- 方汤圆修改版：[supart/fhl-image-studio](https://github.com/supart/fhl-image-studio)
