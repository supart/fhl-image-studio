# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`。
- 当前程序内部版本：`V2.0.3`；仅在功能稳定并进入封板批次后统一升级为 `V2.0.4`。
- 当前批次：V2.0.4 开发工作区初始化已完成，等待第一个功能或修复任务。
- GitHub 状态：本分支只存在于本机，未推送、未创建 PR、未修改 Release。

## 开发边界

- 唯一代码入口是当前目录；不得修改桌面版整理区中的 V2.0.3 正式版、旧开发版或历史证据。
- 保留稳定存储 namespace `fhl-image-studio-desktop`、开发 namespace `fhl-image-studio-desktop-dev` 和既有 V2.0.3 迁移标记。
- 不从旧版本复制 API Key、`*.local`、`config/webview`、用户图片、输出、日志、缓存、`node_modules`、EXE 或 ZIP。
- Photoshop 插件和 Android 是独立项目，不进入本开发批次。
- 未经用户单独授权，不运行真实或付费生图验证。

## 当前验证

- 正式标签和提交：已核对。
- 新目录及本地开发分支：已建立。
- 前端：`npm ci` 安装 324 个包；TypeScript 通过；Node `581/581`、UI `24/24` 通过；Windows 构建转换 1,956 个模块。
- Lint：`0` 错误、既有 `63` 条允许警告。
- 桌面端与 CLI：`go test ./...` 和 `go vet ./...` 全部通过。
- Worker：零依赖、无 lockfile，直接运行内置 Node 测试，`5/5` 通过。
- 干净源码合规扫描：`0` 项问题；开发依赖和 `frontend/dist` 已恢复为 Git 忽略的本地开发文件。
- 私有数据扫描：无 `cli.env.local`、`fhl-api.local.json`、`config/webview`、用户图片、日志、EXE 或 ZIP。
- 隔离复核：桌面版根说明四个 SHA-256、V2.0.3 两个正式 ZIP SHA-256 和正式目录时间均与初始化前一致。

## 恢复点

从中断恢复时先运行 `git status --short --branch`，再阅读：

- `docs/changes/2026-08-16-windows-v2.0.4-development-bootstrap.md`
- 外层 `..\..\项目日志.md`

下一批从用户指定的第一个 V2.0.4 功能或修复开始；不要提前执行版本号总替换。
