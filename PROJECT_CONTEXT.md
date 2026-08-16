# FHL Studio Windows V2.0.4 开发交接

## 当前状态

- 开发目标：Windows 桌面版 `V2.0.4`。
- 正式基线：标签 `windows-v2.0.3-release`，提交 `814da3e64566cc2e7838378639a3c5e7b6e8b948`。
- 当前本地分支：`codex/windows-v2.0.4-development`。
- 当前活动产品版本：`V2.0.4`；界面、Wails、桌面 Go、CLI、E2E、构建与发布链已由 `product-version.json` 统一。
- 当前批次：批次 1“统一 V2.0.4 产品身份”已实现并完成自动化、合规、Codex 浏览器三视口验收和本地提交；下一批为“恢复默认但保留 API”。
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
- 版本门禁：`sync-version-metadata.mjs --check`、PowerShell 发布脚本语法和 `compute-version.sh 2.0.4` 通过。
- 前端：TypeScript 通过；Node `582/582`、UI `25/25` 通过；Windows 构建转换 1,956 个模块。
- Lint：`0` 错误、既有 `63` 条允许警告。
- 桌面端与 CLI：`go test ./...` 和 `go vet ./...` 全部通过。
- Worker：零依赖、无 lockfile，直接运行内置 Node 测试，`5/5` 通过。
- 干净源码合规扫描：仅含 Git 跟踪/待提交文件的临时快照为 `0` 项问题，快照已删除；依赖与构建缓存继续留在 Git 忽略位置。
- 私有数据扫描：无 `cli.env.local`、`fhl-api.local.json`、`config/webview`、用户图片、日志、EXE 或 ZIP。
- 隔离复核：桌面版根说明四个 SHA-256、V2.0.3 两个正式 ZIP SHA-256 和正式目录时间均与初始化前一致。
- Codex 浏览器入口：V2.0.4 Windows Vite 仍固定在 `http://127.0.0.1:5173/` 和开发命名空间 `fhl-image-studio-desktop-dev`。
- 浏览器确认顶部 `V2.0.4`、底部/关于页 `v2.0.4`；文生图/图生图、360 空状态、设置、390px 创作/画布/历史导航和全屏进出均通过真实点击。
- 默认 `1213x930`、`768x1024`、`390x844` 均无页面级横向溢出，控制台 `0` warning/error；没有点击生成、连接测试、提示词调用或其他付费路径。
- 浏览器仍保留当前开发命名空间的 API Profile、已配置状态、历史和工作区。本批没有读取或输出 Key，也没有修改稳定命名空间。
- 提交前首次 Go/Bash 复跑因受限环境拒绝默认 `AppData` Go 缓存/Temp 和 WSL 服务而失败；代码测试未产生断言失败。随后使用仓库忽略的 `.tmp`、桌面精确包 `.`/`./backend` 和 Git for Windows Bash 复跑全部通过，临时目录已删除。

## 架构审计结论

- 优先级顺序：设置默认工厂与 reset policy -> 本批触及组件的精确 selector -> `host.ts` 内部能力拆分 -> JS/Go golden contracts -> Bridge/CLI 职责收窄。
- Worker 的动态上游覆盖在公开部署时存在任意转发风险，留到后端加固批次按部署用途设计 allowlist、鉴权和限额。
- 不做 Store 或状态框架重写；每批只迁移一个可独立验证的领域。

## 恢复点

从中断恢复时先运行 `git status --short --branch`，再阅读：

- `docs/changes/2026-08-16-windows-v2.0.4-development-bootstrap.md`
- `docs/changes/2026-08-17-windows-v2.0.4-codex-browser-ui.md`
- `docs/changes/2026-08-17-windows-v2.0.4-product-identity.md`
- 外层 `..\..\项目日志.md`

下一批只实现“恢复默认但保留 API”：先用隔离数据和行为测试证明不会调用凭据删除，再在 Codex 浏览器执行一次真实开发命名空间初始化。按用户计划清理工作区、运行态、历史、提示词历史、预设、素材组和界面偏好；完整保留 API Profile、URL、模型、代理、FHL 文本/Images、RunningHub、传输配置、密钥提示与凭据。严禁 `localStorage.clear()`、现有永久 API 清空函数、真实 API 调用和稳定命名空间写入。
