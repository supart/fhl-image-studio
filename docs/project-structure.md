# 项目结构

本文档记录桌面版 `V2.0.3` 当前源码树，最后核对日期为 `2026-07-25`。项目文档的分类和归档位置见[文档中心](./README.md)。

## 顶层目录

```text
.
├── .github/workflows/     # CI 与版本发布工作流
├── image-studio/          # Wails 桌面应用：Go 后端 + React/TypeScript 前端
├── go-cli/                # 独立图像生成 CLI 与共享 Go 客户端
├── shared/                # 前端、Worker 共用的请求内核
├── cloudflare-worker/     # 可选远程中转 Worker
├── config/                # CLI 配置模板与本机私有配置位置
├── runtime/               # 本地或打包后的 CLI 运行文件
├── scripts/               # 构建、验证、Portable 和合规脚本
├── docs/                  # 文档中心、专题说明与详细变更记录
├── input/                 # 本机 CLI 输入目录，不进入干净发布包
├── intermediate/          # 本机中间文件目录，不进入干净发布包
├── output/                # 本机 CLI 输出与日志目录，不进入干净发布包
├── LICENSES/              # 上游历史许可证记录
├── README.md              # 产品与仓库总览
├── CHANGELOG.md           # 跨版本更新记录
├── PROJECT_CONTEXT.md     # 当前开发断点与恢复信息
├── RELEASE_NOTES_*.md     # 各版本发布说明
└── V*_ACCEPTANCE_REPORT.md # 版本验收报告
```

当前这份桌面源码树不包含 `android-shell/`。`docs/` 中的 Android 和跨平台文件是历史记录或协作参考，不是本仓库当前可直接执行的 Android 构建入口。

整体工作区另有独立的 `FHL-Image-Studio方汤圆版-PS插件开发/`。它与桌面源码、安卓版并列维护，拥有自己的 manifest、UXP 代码、测试、文档和 CCX，不复制到本桌面源码包或 Portable 中。

## `image-studio/`

Wails 桌面主程序，也是源码运行和 Windows Portable 的 UI 宿主。

```text
image-studio/
├── backend/               # 桌面服务、任务、媒体、持久化与凭据桥接
├── frontend/              # React + TypeScript 前端
├── build/                 # 图标、清单与 Wails 构建资源
├── config/                # 桌面侧静态配置
├── docs/                  # Wails 子项目资料
├── e2e_*.go               # 打包桌面 E2E 服务与本地模拟接口
├── main.go                # Wails 入口
├── wails.json             # 桌面应用与版本元数据
└── go.mod
```

`backend/` 的主要职责：

- `service.go`、`job_manager.go`：生成任务生命周期、并发与取消。
- `desktop_api.go`：前端可调用的桌面桥接入口。
- `credentials.go`、`credential_cleanup.go`：系统安全存储与 API 清理。
- `cli_config.go`：源码直构和 Portable 的 CLI 配置同步。
- `media.go`：原图、缩略图和受控媒体访问。
- `persistence*.go`：正式版、开发版命名空间及本地状态持久化。
- `dialogs.go`、`imports.go`、`imageops*.go`：文件选择、导入和图像操作。
- `paths.go`：桌面数据根目录、输出目录和文件名规则。
- `ps_bridge.go`：Photoshop 插件专用的回环 HTTP 会话、单任务生命周期、Profile 能力与结果服务。

`frontend/` 的关键结构：

```text
frontend/
├── dev/                   # 仅 Vite/Codex 开发环境使用的本地任务代理
├── scripts/               # 平台构建与测试入口
├── src/
│   ├── app/               # 顶层装配、hooks 与 modal gates
│   ├── components/        # 工作台、画布、设置和平台 UI
│   ├── lib/               # 存储、配置、媒体与平台无关工具
│   ├── platform/          # Wails、浏览器和 Android 运行时适配
│   ├── state/             # Zustand 状态、调度与工作区运行时
│   ├── styles/            # 全局样式和平台主题
│   └── types/             # 前端领域类型
├── test/                  # Node 逻辑与契约测试
├── test-ui/               # Vitest + Testing Library UI 测试
├── wailsjs/               # Wails 生成的前端绑定
└── package.json
```

更细的前端分层规则见 [frontend/src/README.md](../image-studio/frontend/src/README.md)。

## `go-cli/`

共享 Go 图像请求客户端和独立 CLI。

```text
go-cli/
├── cmd/gptcodex-image/    # CLI 入口
├── internal/              # 文件保存等 CLI 内部实现
├── pkg/client/            # Responses、Images、SSE、重试与错误归因
├── testdata/              # 测试数据
└── go.mod
```

`image-studio/go.mod` 通过本地 `replace` 复用 `go-cli`，因此桌面应用和 CLI 应共享请求字段、上游错误分类及输出规则，避免维护两套实现。

## `shared/`

`shared/kernel/` 存放前端和 Cloudflare Worker 共用的 JavaScript 请求内核、类型声明与测试数据。平台宿主代码不得反向混入这里。

## `cloudflare-worker/`

可选的远程 Worker 内核，包含 `src/`、`test/`、`package.json` 和 `wrangler.toml`。它复用 `shared/kernel/` 构造上游请求。部署与配置见 [cloudflare-worker/README.md](../cloudflare-worker/README.md)。

## 配置与数据边界

- `config/cli.env.example` 是可提交的配置模板；`config/cli.env.local` 是本机私有文件，不得进入源码包或发布产物。
- `runtime/cli/` 用于本地或发布负载中的 CLI 二进制，不是用户数据目录。
- 根目录 `input/`、`intermediate/`、`output/` 只服务源码/Portable CLI 工作流，干净发布源码和 Portable 负载必须排除其中的用户内容。
- Portable 的作品、历史、WebView 数据和 CLI 私有配置都位于包根目录；API 凭据仍由 Windows Credential Manager 保存，发布包不得携带凭据。

## `scripts/`

当前主要脚本：

- `package-windows-portable-v2.0.3.ps1`：构建 Windows 免安装 Portable ZIP。
- `prepare-release-source-v2.0.3.ps1`：准备不含私有数据和二进制的源码包。
- `check-release-safety.ps1`、`check-compliance-package.ps1`：发布负载与合规扫描。
- `start-desktop-e2e.cmd`：启动隔离的桌面 E2E 模式。
- `verify-local-platform-kernel.mjs`、`local-smoke-check.mjs`：跨运行时和本地模拟验证。
- `package-local-macos-app.sh`、`verify-local-macos-release.mjs`：macOS arm64 App/DMG 构建与验证。
- `package-release-source.sh`、`check-release-source.mjs`：完整对应源码包与跨平台安全扫描。

## Workflows

- `.github/workflows/ci.yml`：源码测试、构建和安全检查。
- `.github/workflows/release.yml`：版本标签对应的发布构建流程。

## 文档边界

- `README.md` 只保留产品定位和入口级说明。
- `docs/` 保存稳定使用说明、架构、构建、故障排查和专题资料。
- `docs/changes/` 保存按日期拆分的实现、排错和验证过程。
- `CHANGELOG.md`、`RELEASE_NOTES_*.md`、`V*_ACCEPTANCE_REPORT.md` 分别承担版本摘要、单版本交付说明和验收证据。
- `PROJECT_CONTEXT.md` 只承担当前开发交接，不继续堆叠长期产品说明。

## 维护约束

- 跨平台宿主差异放入 `image-studio/frontend/src/platform/`。
- 纯业务状态放入 `state/`，平台桥接细节留在 `platform/` 或 Go backend。
- OpenAI 兼容请求规范优先收口到 `shared/kernel/` 或 `go-cli/pkg/client/`。
- 密钥明文不得进入 Zustand、localStorage、日志、测试、文档或发布负载。
- 开源源码与 Portable 共用业务代码；Portable 的文件写入必须保持在包根边界内。
