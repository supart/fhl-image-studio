# FHL Image Studio 方汤圆修改版 V2.0.3

> 开源致谢：Image-Studio 原作者 RoseKhlifa
>
> 原项目地址：https://github.com/RoseKhlifa/Image-Studio
>
> 方汤圆修改版项目地址：https://github.com/supart/fhl-image-studio

FHL Image Studio 方汤圆修改版是基于 Image-Studio 的独立修改发行版，面向桌面端图片生成、图生图、编辑和提示词工作流。本仓库为桌面版 `V2.0.3` 源码，采用 AGPLv3 发布，不内置任何 API Key、测试图片或个人本机配置。

本项目与上游原项目无隶属、背书或维护关系。请在二次分发、公开部署或网络服务使用时遵守 AGPLv3 的源码提供义务。

## 主要功能

- 文生图、图生图、编辑模式，支持多参考图。
- 提示词模块：复制、清空、模板/历史、基础 AI 优化、指令改写提示词。
- 反推提示词：导入图片后上传给支持视觉输入的文本模型，返回中文文生图 prompt。
- FHL 文本与生图凭据彻底分离：独立 `gpt-5.5` Responses 文本 API 服务于 AI 优化和图片反推，Images Key 不参与文本请求。
- FHL Images 连续池：固定 10 个独立 Key 槽，按每 API `1–5` 并发计算总容量，批量任务保留独立任务、API 来源、取消和结果。
- 工作区：多标签工作区分别保存 prompt、参数、源图、当前结果和运行状态。
- 历史记录：本地 IndexedDB 保存，支持搜索、筛选、复用参数、设置源图和导入导出。
- 大批量预览：结果网格、历史相册和批量输入队列使用虚拟滚动；列表加载 AVIF 缩略图，打开大图时才读取原图。
- 画布：缩放、拖动、蒙版、标注、裁剪/旋转/翻转、对比查看。
- 360 工作台：支持 2:1 全景生成、外部全景导入、重新打镜头、输出管理、手动贴回、外部替换图贴回和精细蒙版贴图。
- 参数：比例、尺寸、质量、输出格式、出图张数、seed、negative prompt、风格模板。
- 上游配置：支持 FHL、APIMart、RH 以及 OpenAI 兼容 Responses API / Images API 路径；桌面端 API Key 走系统安全存储，RH Key 可写入本地 8117 桥接模块。
- API 凭据库：集中查看脱敏状态并提供一键真实清空，清理当前及兼容命名空间、系统凭据和本地配置副本。
- Photoshop 扩展：桌面进程提供仅回环访问的单任务 Bridge；独立 UXP 插件可读取选区/图层参考并把结果回写 Photoshop，不在插件中重复配置 API。
- 4K/画布优化：默认优先使用轻量预览源渲染，保留原图用于保存、分享和后续编辑。
- 开源交付：本次 GitHub Release 提供完整对应源码和 macOS Apple Silicon DMG，不上传 Windows 成品。

## 目录结构

```text
.
├── image-studio/          # Wails 桌面应用：Go 后端 + React/TypeScript 前端
├── go-cli/                # FHL 图像生成 CLI 与共享客户端
├── shared/                # 前端/CLI 共享内核
├── cloudflare-worker/     # 可选中转 Worker
├── config/                # 示例配置，仅保留 .example
├── scripts/               # 构建、验证、封包和合规扫描脚本
├── docs/                  # 文档中心、专题说明与按日期变更记录
├── LICENSES/              # 上游历史许可证记录
├── LICENSE                # AGPLv3
├── NOTICE.md              # 来源与致谢
├── COMPLIANCE.md          # 合规说明
└── CHANGELOG.md           # 版本更新记录
```

Photoshop UXP 插件作为与桌面版、安卓版并列的独立项目维护，位于整体工作区根目录的 `FHL-Image-Studio方汤圆版-PS插件开发/`。它不混入本桌面源码归档，也不打进 Windows Portable 或 Mac DMG。

## 文档入口

完整文档导航和归档规则见 [docs/README.md](./docs/README.md)。常用入口：

- [使用与上游配置](./docs/usage.md)
- [功能说明](./docs/features.md)
- [数据位置与故障排除](./docs/troubleshooting.md)
- [构建与发布](./docs/build.md)
- [项目结构](./docs/project-structure.md)
- [macOS 安装与数据位置](./README_MACOS.md)
- [V2.0.3 发布说明](./RELEASE_NOTES_DESKTOP_V2.0.3.md)
- [V2.0.3 验收报告](./V2.0.3_ACCEPTANCE_REPORT.md)

单批实现和排错过程记录在 [`docs/changes/`](./docs/changes/)；`PROJECT_CONTEXT.md` 只用于当前开发断点和接手恢复，不作为长期产品说明。

## 运行源码版

要求：

- Node.js 24.13.1
- Go 1.26.3
- Wails CLI v2.12.0，用于桌面构建

Windows 预览：

```powershell
.\start-ui.cmd
```

macOS 预览（Mac 宿主 + Windows 完整 UI）：

```bash
cd image-studio
VITE_DESKTOP_UI_VARIANT=windows-parity wails dev
```

### 桌面 E2E 测试模式

用于让 Codex 浏览器或普通浏览器接管打包后的桌面 UI，回归参考图双击、比例选择、API 配置弹窗、360 工作台等流程。

常用启动命令：

```cmd
scripts\start-desktop-e2e.cmd
```

只启动浏览器镜像、不打开桌面窗口：

```cmd
"image-studio\build\bin\FHL Studio 方汤圆版 V2.0.3.exe" --e2e-only --e2e-port 9230
```

启动后打开：

```text
http://127.0.0.1:9230/
```

详细说明见 [docs/desktop-e2e-test-mode.md](./docs/desktop-e2e-test-mode.md)。

Windows Portable 免安装包（唯一预编译 Windows 发行形态）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-windows-portable-v2.0.3.ps1
```

生成后的用户包使用 `一键启动FHL Studio V2.0.3.cmd` 启动，不依赖 Node、Vite 或 5173 预览服务。生成内容默认保存在便携包内的 `output/`，导入图在 `input/`，中间文件在 `intermediate/`，日志在 `output/log/`。

macOS Apple Silicon DMG：

```bash
bash scripts/package-local-macos-app.sh
node scripts/verify-local-macos-release.mjs
```

Mac 图片、配置和日志分别保存到 `~/Pictures/FHL Studio`、`~/Library/Application Support/fhl-studio` 和 `~/Library/Logs/FHL Studio`。未公证的本地签名版首次需右键“打开”。

发布源码暂存：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-release-source-v2.0.3.ps1
```

这个脚本会复制一份干净源码树用于 GitHub 发布，保留当前架构目录和占位文件，但排除 `cli.env.local`、`config/webview/`、生成图片、日志、缓存和 EXE。

Mac 与 CI 使用完整对应源码包：

```bash
bash scripts/package-release-source.sh
bash scripts/create-release-checksums.sh
```

### CLI / Codex Skill

包根 `image-cli.cmd` 是 Codex 和手动 CLI 的固定入口，会调用 `runtime\cli\gptcodex-image.exe`。源码目录和 Portable 都默认读写各自包根的 `input/`、`output/`、`output/log/`、`intermediate/` 与 `config/cli.env.local`，不依赖注册表或系统安装目录。

macOS 使用 `image-cli`，调用 DMG 或 Codex Skill 安装的 arm64 CLI，并与 GUI 共享 Application Support 内的活动 Profile。

```bash
./image-cli --status --json
```

```powershell
.\image-cli.cmd --status --json
```

`--status --json` 只读返回当前包版本、活动 API、模型、尺寸与目录状态；API Key 只显示是否已配置，不会打印明文。`fhl-image-studio-v2-0-3` Skill 使用这个状态自动跟随桌面 UI 当前同步的 profile。

### Codex 全局 Skill 使用流程

推荐顺序是先在桌面端配置 API，再让 Codex 读取全局 Skill：

1. 将 Windows 便携包解压到稳定目录，不要每次运行都更换位置。
2. 双击 `一键启动FHL Studio V2.0.3.cmd` 打开桌面端。
3. 在桌面端手动配置 FHL / APIMart / RH，点击保存并测试，确认连接成功。
4. 双击 `安装CodexSkill.cmd`，安装 `fhl-image-studio-v2-0-3` 到当前用户的 Codex skills 目录。
5. 安装脚本会写入 `PACKAGE_ROOT.txt`，记录当前包根路径；这个文件只保存路径，不保存 API Key。
6. 新开任意 Codex 项目后，让 Codex 使用 `fhl-image-studio-v2-0-3`，先运行状态检查：

```cmd
cmd /c "cd /d ^"<packageRoot>^" && image-cli.cmd --status --json"
```

如果状态里 `apiKeyConfigured:false`，请回到桌面端配置并测试 API；不要把 API Key 发到 Codex 对话里。配置成功后，Codex 会通过包根 `config\cli.env.local` 自动读取当前活动 API。

前端检查：

```powershell
cd .\image-studio\frontend
npm ci
npm test
npm run build
```

Wails 桌面构建：

```powershell
cd .\image-studio
wails build
```

发布安全检查：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-compliance-package.ps1 -Root .
```

CI 会在 GitHub Actions 中执行 Go、前端及平台构建和发布安全检查。正式 `v2.0.3` 使用已经人工验收的本地 Mac DMG、完整 Source ZIP 和 SHA256；Release 重建工作流只允许手动触发，避免 tag 创建时覆盖已测试成品。

## API 配置

本仓库不包含任何可用 API Key。桌面端 FHL 配置分为两个互不复用的区域：

- `FHL 文本 API`：固定使用 Responses 与 `gpt-5.5`，只服务 AI 优化和图片反推。
- `FHL Images 连续池`：固定 10 个独立生图 Key 槽，只服务文生图、图生图和批量任务。

普通 Profile、APIMart 或其他兼容上游按需要填写：

- Base URL
- API Key
- 文本模型 ID
- 图片模型 ID
- Responses API 或 Images API 模式

一键配置入口：

- FHL：文本 Key 与 10 个 Images Key 分别保存并分别测试，不创建共用 Key 的普通 profile。
- APIMart：可选择已有 API 或获取 API，已有 Key 时切到 APIMart 异步 profile。
- RH：可选择已有 API 或获取 API，已有 API 时默认使用 `http://127.0.0.1:8117` 桥接地址并创建 `RH-1 全能图像2`、`RH-1 全能图像G2` 两套 profile。

桌面端会尽量使用系统安全存储保存 API Key。示例配置只保留 `.example` 文件，真实配置请放在本机私有路径，切勿提交到 GitHub。

## 发布源码不包含

本次发布源码和便携包准备流程会排除：

- `input/`、`output/`、`intermediate/`
- `output/log/`
- `node_modules/`
- `image-studio/frontend/dist/`
- `image-studio/build/bin/`
- `.local/`、`*.local`、`*.local.json`
- `cli.env.local`、`fhl-api.local.json`
- 测试生成图、运行日志、浏览器任务日志、API Key、本机缓存

## 合规

- 发布协议：GNU Affero General Public License v3.0
- 上游来源：RoseKhlifa/Image-Studio
- 修改版地址：supart/fhl-image-studio
- 无内置 API Key
- 无内置用户图片、测试图、运行日志或个人配置

详细说明见 [COMPLIANCE.md](./COMPLIANCE.md) 和 [NOTICE.md](./NOTICE.md)。
