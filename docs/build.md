# 构建与发布

本文档以当前桌面版 `V2.0.3` 源码树为准。正式交付目标包括 Windows 10/11 x64 Portable 与 macOS 13+ Apple Silicon DMG；本源码树不包含 `android-shell/`，不能直接构建 APK。

## V2.0.3 交付形态

| 产物 | 定位 | 说明 |
| --- | --- | --- |
| GitHub 仓库与源码归档 | 主体 | AGPLv3 开源源码，是项目的主要交付和协作入口。 |
| `FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable.zip` | Windows 便利包 | 唯一预编译 Windows 包，解压后由包内启动脚本运行，数据默认保存在包内。 |
| `FHL-Image-Studio-Desktop-V2.0.3-macOS-AppleSilicon.dmg` | Mac 成品包 | arm64 Wails App、CLI、Codex Skill 安装器与安装说明。 |
| `FHL-Image-Studio-Desktop-V2.0.3-Source.zip` | 完整对应源码 | 排除 API、用户数据、日志、缓存和二进制的可重建源码。 |

已发布版本从 [GitHub Releases](https://github.com/supart/fhl-image-studio/releases) 下载。项目不提供 Setup、MSI 或 MSIX；Windows 用户直接解压 Portable ZIP。

## 环境要求

- Windows 10/11 x64 或 macOS 13+ Apple Silicon。
- Node.js 24.13.1。
- Go 1.26.3。
- Wails CLI v2.12.0。

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
powershell -ExecutionPolicy Bypass -File .\scripts\package-windows-portable-v2.0.3.ps1
```

Portable ZIP 解压后使用 `一键启动FHL Studio V2.0.3.cmd`。包内 `.fhl-studio-portable` 标记决定数据边界，GUI 输出位于 `output\images`，CLI 输出位于 `output`，WebView 数据位于 `config\webview`。

## 干净源码包

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-release-source-v2.0.3.ps1
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
go test ./...
go vet ./...

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

## macOS 与 Linux

构建、临时签名并验证 Apple Silicon DMG：

```bash
bash scripts/package-local-macos-app.sh
node scripts/verify-local-macos-release.mjs
bash scripts/package-release-source.sh
bash scripts/create-release-checksums.sh
```

Mac 构建固定使用 `VITE_TARGET_PLATFORM=macos` 和 `VITE_DESKTOP_UI_VARIANT=windows-parity`，数据位置遵循 macOS 标准目录。Linux 仍需要目标系统的 GTK/WebKitGTK 开发依赖。

## Android 说明

当前目录没有 `android-shell/`、Gradle 工程或 APK 签名配置。`npm run build:android` 与 `npm run build:android-pad` 只能验证前端目标；`docs/android-v2.0.2.1-handoff.md` 和 `docs/mumu-android-debug.md` 是旧版本或外部 Android 项目的协作资料。

## 版本与 CI

- `scripts/sync-version-metadata.mjs` 用于同步 Wails 和前端版本元数据。
- `.github/workflows/ci.yml` 运行前端、Worker、Go、Windows Wails 构建和发布安全检查。
- `.github/workflows/release.yml` 响应 `v2.0.3` 标签，构建 Windows Portable、Mac DMG、完整 Source ZIP 和 SHA256 校验文件。
- 本地 V2.0.3 验收结果记录在 [V2.0.3_ACCEPTANCE_REPORT.md](../V2.0.3_ACCEPTANCE_REPORT.md)。
