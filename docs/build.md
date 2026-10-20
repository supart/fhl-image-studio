# 构建与发布

本文档以当前桌面版 `V2.0.4` 源码树为准。Windows 与 macOS 使用独立发布路线；仓库仍保留 Linux 和 Android 前端目标，但本源码树不包含 `android-shell/`，不能直接构建 APK。

## V2.0.4 交付形态

| 产物 | 定位 | 说明 |
| --- | --- | --- |
| GitHub 仓库与源码归档 | 主体 | AGPLv3 开源源码，是项目的主要交付和协作入口。 |
| `FHL-Image-Studio-Desktop-V2.0.4-Windows-Portable.zip` | Windows 便利包 | 封板时生成的唯一预编译 Windows 包；当前开发阶段尚未生成。 |
| `FHL-Image-Studio-Desktop-V2.0.4-macOS-Universal.dmg` | macOS 便利包 | 包含 arm64 与 x86_64，最低 macOS 13.0；使用 ad-hoc 签名和 hardened runtime，未公证。 |
| `FHL-Image-Studio-Desktop-V2.0.4-Source` | 本地验收暂存 | 封板时生成的干净源码；排除 API、用户图片、日志、本机配置、WebView 数据和二进制。 |

已发布版本从 [GitHub Releases](https://github.com/supart/fhl-image-studio/releases) 下载。项目不提供 Setup、MSI 或 MSIX；Windows 用户直接解压 Portable ZIP。

## 环境要求

- Windows 10/11 x64。
- Node.js 20 或更新版本。
- Go 1.25.5；`image-studio/go.mod` 当前声明 `toolchain go1.26.3`。
- Wails CLI v2.12+。

## 克隆与启动源码

```powershell
git clone https://github.com/supart/fhl-image-studio.git
cd fhl-image-studio
.\start-ui.cmd
```

直接使用 Wails 开发模式：

```powershell
cd .\image-studio
wails dev
```

`image-studio/wails.json` 会调用前端安装、构建和开发脚本。前端按 `VITE_TARGET_PLATFORM` 选择 Windows、macOS、Linux 或 Android 主题与壳层。

## 前端开发与测试

```powershell
cd .\image-studio\frontend
npm ci
npm run dev:windows
npm run typecheck
npm run lint
npm run test:node
npm run test:ui
npm run build:windows
```

可用的其他前端目标包括 `dev:macos`、`dev:linux`、`dev:android`、`dev:android-pad` 及对应的 `build:*` 命令。这些命令只生成前端资源；Android APK 仍需要外部 Android 壳层源码。

## Windows 桌面 EXE

```powershell
cd .\image-studio
wails build -platform windows/amd64 -clean
```

输出位于 `image-studio\build\bin`。这是开发和打包中间产物，不作为单独安装产品发布。

## Windows Portable

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-windows-portable.ps1
```

Portable ZIP 解压后使用 `一键启动FHL Studio V2.0.4.cmd`。包内 `.fhl-studio-portable` 标记决定数据边界，GUI 输出位于 `output\images`，CLI 输出位于 `output`，WebView 数据位于 `config\webview`。

Portable 根目录还会由上述打包脚本自动生成固定文件
`FHL Studio Photoshop 对接文件.json`。该文件是跨桌面版本稳定的非敏感启动元数据，字段固定为：

```json
{
  "productId": "fhl-image-studio-desktop",
  "integrationFileFormatMajor": 1,
  "psBridgeProtocolMajor": 1,
  "launchPath": "FHL Studio 方汤圆版 V2.0.4.exe",
  "displayName": "FHL Studio 方汤圆版",
  "desktopVersion": "V2.0.4"
}
```

`launchPath` 只能是 Portable 根目录内的相对路径，打包时会拒绝绝对路径、`..` 路径穿越、包外解析结果和不存在的启动目标。`desktopVersion` 仅用于显示和诊断，不能作为插件兼容判断；Bridge 是否可用仍以当前实例的
`GET /fhl-ps/v1/health`、`POST /fhl-ps/v1/session`、`GET /fhl-ps/v1/profile` 和
capabilities 协商为准。该文件不包含 API Key、Session Token、Base URL、Credential Manager、用户配置、图片或绝对路径；`.fhl-studio-portable` 标记继续独立保留。

后续 V2.0.5、V2.1.0 继续使用同一文件名和字段语义，只更新显示版本和包内相对启动目标。源码开发期可以在临时目录生成副本做合同测试，但不得把临时文件当作正式 Portable 发布物。

## 干净源码包

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-release-source.ps1
```

发布前继续运行安全检查：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-release-safety.ps1 -ReleaseRoot "C:\path\to\portable" -ZipPath "C:\path\to\portable.zip"
powershell -ExecutionPolicy Bypass -File .\scripts\check-compliance-package.ps1 -Root "C:\path\to\source"
```

## 桌面 E2E

```cmd
scripts\start-desktop-e2e.cmd
```

默认隔离端口为 `9230`。E2E 模式、模拟参数和媒体回归规则见 [desktop-e2e-test-mode.md](./desktop-e2e-test-mode.md)。自动验收不得擅自发起真实付费生图。

## Go 与 Worker 验证

```powershell
cd .\image-studio
go test . ./backend
go vet . ./backend

cd ..\go-cli
go test ./...
go vet ./...

cd ..\cloudflare-worker
npm test
```

跨运行时模拟验证还可运行：

```powershell
node .\scripts\verify-local-platform-kernel.mjs
node .\scripts\local-smoke-check.mjs
```

`scripts/live-verify.mjs` 会访问真实上游，必须在明确授权并准备本机私有环境变量后单独运行。

## macOS Universal 与发布三件套

本机构建、签名、启动并验证真实应用包：

```bash
./script/build_and_run.sh --verify
```

从已验证的 `.app` 生成 DMG，并从明确 Git 提交生成干净源码 ZIP 与校验文件：

```bash
assets="/absolute/path/to/release-assets"
mkdir -p "$assets"
./scripts/package-macos-release.sh --output-dir "$assets"
./scripts/package-release-source.sh --ref HEAD --output-dir "$assets"
./scripts/create-release-checksums.sh --output-dir "$assets"
node scripts/verify-macos-release-assets.mjs --assets-dir "$assets"
```

DMG 根目录只允许 `FHL Studio.app`、Applications 链接和 `README_MACOS.md`。源码 ZIP 使用 `git archive`，不会复制未跟踪、忽略或只存在于本机工作树的 API 配置、图片、日志和缓存。发布流程见 `.github/workflows/macos-release.yml`：发布分支只生成候选，精确注解标签 `v2.0.4` 才创建 GitHub Release，且不改变其他平台的 Latest 状态。

Linux 需要目标系统的 GTK/WebKitGTK 开发依赖，再在 `image-studio/` 中执行对应 `wails build`。Linux 当前不在 V2.0.4 正式交付验收范围内。

## Android 说明

当前目录没有 `android-shell/`、Gradle 工程或 APK 签名配置。`npm run build:android` 与 `npm run build:android-pad` 只能验证前端目标；`docs/android-v2.0.2.1-handoff.md` 和 `docs/mumu-android-debug.md` 是旧版本或外部 Android 项目的协作资料。

## 版本与 CI

- `product-version.json` 是产品版本唯一来源；`scripts/sync-version-metadata.mjs --check` 校验所有活动元数据，`--write` 执行受控同步。
- `.github/workflows/ci.yml` 运行前端、Worker、Go、Windows Wails 构建和发布安全检查。
- `.github/workflows/release.yml` 只接受 `windows-v2.0.4-release`，构建 Portable ZIP 并附加到 GitHub Release；当前开发阶段不执行。
- `.github/workflows/macos-release.yml` 在 `codex/macos-v2.0.4-release` 上执行候选构建，在精确注解标签 `v2.0.4` 上重建、验证并发布 macOS 三项资产，`make_latest=false`。
- V2.0.3 的历史验收结果继续保存在 [V2.0.3_ACCEPTANCE_REPORT.md](../V2.0.3_ACCEPTANCE_REPORT.md)。
