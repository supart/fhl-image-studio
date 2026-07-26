param(
  [string]$SourceRoot = "",
  [string]$OutputRoot = "",
  [string]$GoExe = "",
  [string]$WailsExe = "",
  [switch]$SkipBuild,
  [switch]$SkipCliBuild
)

$ErrorActionPreference = "Stop"

$Version = "2.0.3"
$DisplayVersion = "V2.0.3"
$ExeName = "FHL Studio 方汤圆版 V2.0.3.exe"
$PackageName = "FHL-Image-Studio-Desktop-V2.0.3-Windows-Portable"

function Resolve-SourceRoot {
  param([string]$Value)
  if ($Value.Trim()) {
    return (Resolve-Path -LiteralPath $Value).Path
  }
  return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

function Ensure-Dir {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Copy-IfExists {
  param([string]$From, [string]$To)
  if (Test-Path -LiteralPath $From) {
    Copy-Item -LiteralPath $From -Destination $To -Force
  }
}

function Resolve-ToolCommand {
  param(
    [string]$Name,
    [string]$ExplicitPath
  )

  if ($ExplicitPath.Trim()) {
    $resolved = (Resolve-Path -LiteralPath $ExplicitPath -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
      throw "$Name 不是可执行文件: $resolved"
    }
    return $resolved
  }

  $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "当前 PATH 找不到 $Name。请安装该工具，或通过显式参数指定可执行文件。"
  }
  return $command.Source
}

function Add-ToolDirectoryToPath {
  param([string]$ToolPath)

  $toolDirectory = Split-Path -Parent $ToolPath
  $pathEntries = @($env:PATH -split ';')
  if ($pathEntries -notcontains $toolDirectory) {
    $env:PATH = "$toolDirectory;$env:PATH"
  }
}

function Assert-StrictChildPath {
  param(
    [string]$Parent,
    [string]$Child,
    [string]$Label
  )

  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $childFull = [System.IO.Path]::GetFullPath($Child)
  $prefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $childFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label 必须位于允许目录内: $parentFull"
  }
  return $childFull
}

function Build-CliRuntime {
  param(
    [string]$Root,
    [string]$GoCommand
  )

  $cliDir = Join-Path $Root "go-cli"
  $outDir = Join-Path $Root "runtime\cli"
  $outExe = Join-Path $outDir "gptcodex-image.exe"
  Ensure-Dir $outDir
  Push-Location $cliDir
  try {
    $ldflags = "-s -w -X github.com/yuanhua/image-gptcodex/cmd/gptcodex-image.packageVersion=$DisplayVersion -X github.com/yuanhua/image-gptcodex/pkg/client.Version=$Version"
    & $GoCommand build -trimpath -ldflags $ldflags -o $outExe .\cmd\gptcodex-image
    if ($LASTEXITCODE -ne 0) {
      throw "CLI 构建命令失败，退出码: $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
  if (-not (Test-Path -LiteralPath $outExe)) {
    throw "CLI EXE 构建失败: $outExe"
  }
}

$Root = Resolve-SourceRoot $SourceRoot
$ImageStudioRoot = Join-Path $Root "image-studio"
if (-not (Test-Path -LiteralPath (Join-Path $ImageStudioRoot "wails.json"))) {
  throw "找不到 Wails 项目: $ImageStudioRoot"
}

if ($OutputRoot.Trim()) {
  $ReleaseAssets = [System.IO.Path]::GetFullPath($OutputRoot)
} else {
  $ReleaseAssets = Join-Path (Resolve-Path -LiteralPath (Join-Path $Root "..")).Path "发布附件"
}
Ensure-Dir $ReleaseAssets
$ReleaseAssets = (Resolve-Path -LiteralPath $ReleaseAssets).Path

$PackageRoot = Assert-StrictChildPath $ReleaseAssets (Join-Path $ReleaseAssets $PackageName) "便携包目录"
$ZipPath = Assert-StrictChildPath $ReleaseAssets (Join-Path $ReleaseAssets "$PackageName.zip") "便携包压缩文件"

$BuildBin = Join-Path $ImageStudioRoot "build\bin"
$BuiltExe = Assert-StrictChildPath $BuildBin (Join-Path $BuildBin $ExeName) "Wails 构建产物"
$GoCommand = ""
if (-not $SkipCliBuild -or -not $SkipBuild) {
  $GoCommand = Resolve-ToolCommand "go" $GoExe
  Add-ToolDirectoryToPath $GoCommand
}

if (-not $SkipCliBuild) {
  Build-CliRuntime $Root $GoCommand
}

$BuildStartedAt = $null
if (-not $SkipBuild) {
  $wails = Resolve-ToolCommand "wails" $WailsExe
  $BuildStartedAt = [DateTime]::UtcNow
  Push-Location $ImageStudioRoot
  try {
    $env:IMAGE_STUDIO_PRODUCT_VERSION = $Version
    $env:IMAGE_STUDIO_FRONTEND_VERSION = $Version
    $env:VITE_APP_VERSION = $Version
    $env:IMAGE_STUDIO_STORAGE_NAMESPACE = "fhl-image-studio-desktop"
    & $wails build -platform windows/amd64 -clean -ldflags "-X github.com/yuanhua/image-gptcodex/pkg/client.Version=$Version"
    if ($LASTEXITCODE -ne 0) {
      throw "Wails 构建命令失败，退出码: $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $BuiltExe)) {
  throw "找不到精确命名的 Wails 构建产物: $BuiltExe"
}
if ($BuildStartedAt) {
  $builtItem = Get-Item -LiteralPath $BuiltExe
  if ($builtItem.LastWriteTimeUtc -lt $BuildStartedAt.AddSeconds(-2)) {
    throw "Wails 构建产物不是本次构建生成的文件: $BuiltExe"
  }
}

if (Test-Path -LiteralPath $PackageRoot) {
  Assert-StrictChildPath $ReleaseAssets $PackageRoot "待替换便携包目录" | Out-Null
  Remove-Item -LiteralPath $PackageRoot -Recurse -Force
}
Ensure-Dir $PackageRoot

Copy-Item -LiteralPath $BuiltExe -Destination (Join-Path $PackageRoot $ExeName) -Force
Copy-Item -LiteralPath (Join-Path $Root "scripts\portable-windows-launcher-v2.0.3.cmd") -Destination (Join-Path $PackageRoot "一键启动FHL Studio V2.0.3.cmd") -Force
Copy-Item -LiteralPath (Join-Path $Root "scripts\portable-windows-launcher-v2.0.3.ps1") -Destination (Join-Path $PackageRoot "portable-windows-launcher-v2.0.3.ps1") -Force

foreach ($dir in @("input", "output", "output\images", "output\thumbs", "output\previews", "output\log", "intermediate", "config")) {
  Ensure-Dir (Join-Path $PackageRoot $dir)
}
Ensure-Dir (Join-Path $PackageRoot "runtime")
Ensure-Dir (Join-Path $PackageRoot "runtime\cli")
New-Item -ItemType File -Path (Join-Path $PackageRoot ".fhl-studio-portable") -Force | Out-Null

Copy-IfExists (Join-Path $Root "README.md") (Join-Path $PackageRoot "README.md")
Copy-IfExists (Join-Path $Root "NOTICE.md") (Join-Path $PackageRoot "NOTICE.md")
Copy-IfExists (Join-Path $Root "COMPLIANCE.md") (Join-Path $PackageRoot "COMPLIANCE.md")
Copy-IfExists (Join-Path $Root "LICENSE") (Join-Path $PackageRoot "LICENSE")
Copy-IfExists (Join-Path $Root "RELEASE_NOTES_DESKTOP_V2.0.3.md") (Join-Path $PackageRoot "RELEASE_NOTES_DESKTOP_V2.0.3.md")
Copy-IfExists (Join-Path $Root "config\cli.env.example") (Join-Path $PackageRoot "config\cli.env.example")
Copy-IfExists (Join-Path $Root "image-cli.cmd") (Join-Path $PackageRoot "image-cli.cmd")
Copy-IfExists (Join-Path $Root "AGENTS.md") (Join-Path $PackageRoot "AGENTS.md")
Copy-IfExists (Join-Path $Root "SKILL.md") (Join-Path $PackageRoot "SKILL.md")
$skillInstaller = Get-ChildItem -LiteralPath $Root -Filter "*CodexSkill.cmd" -File -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($skillInstaller) {
  Copy-Item -LiteralPath $skillInstaller.FullName -Destination (Join-Path $PackageRoot $skillInstaller.Name) -Force
}
Copy-IfExists (Join-Path $Root "runtime\cli\gptcodex-image.exe") (Join-Path $PackageRoot "runtime\cli\gptcodex-image.exe")

$Guide = @"
# FHL Studio 方汤圆版 $DisplayVersion Windows 便携版

## 启动方式

双击 `一键启动FHL Studio V2.0.3.cmd`。

这个启动器只负责创建包内目录、设置便携包根目录并启动 EXE，不需要 Node、npm、Vite 或 5173 端口。

## 包内目录

- `input/`：导入和拖入的图片。
- `output/images/`：生成的原图。
- `output/thumbs/`、`output/previews/`：缩略图和生成中预览。
- `output/log/`：启动日志和上游响应日志。
- `intermediate/`：中间处理文件。
- `config/`：本机配置目录。

## API Key

发布包不内置任何 API Key。首次使用请在应用顶部打开上游 API 配置，选择 FHL、APIMart 或 RH，并填入你自己的 Key 或桥接地址。

## Codex 全局 Skill 使用流程

正确顺序：

1. 先双击 `一键启动FHL Studio V2.0.3.cmd` 打开桌面端。
2. 在桌面端手动配置 API，点击保存并测试，确认连接成功。
3. 再双击 `安装CodexSkill.cmd` 安装全局 Skill。
4. 新开任意 Codex 项目，使用 `fhl-image-studio-v2-0-3` Skill。
5. Codex 会先读取 Skill 目录里的 `PACKAGE_ROOT.txt` 找到本软件位置，再运行 `image-cli.cmd --status --json` 检查当前 API。

`PACKAGE_ROOT.txt` 只记录软件目录，不保存 API Key。不要把 API Key 发到 Codex 对话里；API 以桌面端同步出来的当前配置为准。
"@
Set-Content -LiteralPath (Join-Path $PackageRoot "使用说明.md") -Value $Guide -Encoding UTF8

if (Test-Path -LiteralPath $ZipPath) {
  Assert-StrictChildPath $ReleaseAssets $ZipPath "待替换便携包压缩文件" | Out-Null
  Remove-Item -LiteralPath $ZipPath -Force
}
Compress-Archive -LiteralPath $PackageRoot -DestinationPath $ZipPath -Force

Write-Host "[FHL package] Package: $PackageRoot"
Write-Host "[FHL package] Zip:     $ZipPath"
