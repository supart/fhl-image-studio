param(
  [string]$SourceRoot = "",
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

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

function Copy-Tree {
  param([string]$From, [string]$To)
  if (-not (Test-Path -LiteralPath $From)) { return }
  Ensure-Dir $To
  $excludedDirs = @(
    ".git", ".local", ".tmp", ".tmp-cli-smoke-output", "node_modules", "dist", "test-results",
    "bin", "data", "webview", "input", "output", "intermediate"
  )
  $excludedFiles = @(
    "*.exe", "*.exe~", "*.log", "*.tmp", "*.local", "*.local.json",
    "cli.env.local", "fhl-api.local.json", "browser-jobs.v1.json",
    "package-lock.json.md5", "package.json.md5"
  )
  robocopy $From $To /E /XD $excludedDirs /XF $excludedFiles /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "复制目录失败: $From -> $To (robocopy exit $LASTEXITCODE)"
  }
}

$Root = Resolve-SourceRoot $SourceRoot
$ManifestPath = Join-Path $Root "product-version.json"
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  throw "找不到产品版本清单: $ManifestPath"
}
& node (Join-Path $Root "scripts\sync-version-metadata.mjs") --check
if ($LASTEXITCODE -ne 0) {
  throw "产品版本元数据不一致，请先运行版本同步。"
}
$VersionConfig = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$DisplayVersion = [string]$VersionConfig.displayVersion
$PackageName = "FHL-Image-Studio-Desktop-$DisplayVersion-Source"
$CurrentReleaseNotes = "RELEASE_NOTES_DESKTOP_$DisplayVersion.md"
$CurrentAcceptanceReport = "$DisplayVersion`_ACCEPTANCE_REPORT.md"
if ($OutputRoot.Trim()) {
  $ReleaseRoot = $OutputRoot
} else {
  $ReleaseRoot = Join-Path (Resolve-Path -LiteralPath (Join-Path $Root "..")).Path "release-source"
}
Ensure-Dir $ReleaseRoot

$StageRoot = Join-Path $ReleaseRoot $PackageName
$resolvedReleaseRoot = (Resolve-Path -LiteralPath $ReleaseRoot).Path
if (Test-Path -LiteralPath $StageRoot) {
  $resolvedStageRoot = (Resolve-Path -LiteralPath $StageRoot).Path
  if (-not $resolvedStageRoot.StartsWith($resolvedReleaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理发布目录外的路径: $resolvedStageRoot"
  }
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
Ensure-Dir $StageRoot

foreach ($file in @(
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "AGPL-合规说明.md",
  "CHANGELOG.md",
  "COMPLIANCE.md",
  "go.work",
  "go.work.sum",
  "image-cli.cmd",
  "LICENSE",
  "NOTICE.md",
  "product-version.json",
  "README.md",
  "RELEASE_NOTES_DESKTOP_V2.0.1.md",
  "RELEASE_NOTES_DESKTOP_V2.0.2.md",
  "RELEASE_NOTES_DESKTOP_V2.0.2.1.md",
  "RELEASE_NOTES_DESKTOP_V2.0.3.md",
  $CurrentReleaseNotes,
  "V2.0.3_ACCEPTANCE_REPORT.md",
  $CurrentAcceptanceReport,
  "start-ui.cmd",
  "一键启动FHL Studio.cmd"
)) {
  Copy-IfExists (Join-Path $Root $file) (Join-Path $StageRoot $file)
}

# Windows PowerShell 5.1 can misread UTF-8 script literals without BOM.
# Keep an ASCII-only fallback for required Chinese-named release files.
foreach ($pattern in @(
  "AGPL-*.md"
)) {
  Get-ChildItem -LiteralPath $Root -Filter $pattern -File -ErrorAction SilentlyContinue |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $StageRoot $_.Name) -Force
    }
}

foreach ($dir in @(".github", "cloudflare-worker", "docs", "go-cli", "image-studio", "LICENSES", "scripts", "shared")) {
  Copy-Tree (Join-Path $Root $dir) (Join-Path $StageRoot $dir)
}

Ensure-Dir (Join-Path $StageRoot "config")
Copy-IfExists (Join-Path $Root "config\cli.env.example") (Join-Path $StageRoot "config\cli.env.example")

foreach ($dir in @("input", "output", "output\log", "intermediate", "runtime", "runtime\cli")) {
  Ensure-Dir (Join-Path $StageRoot $dir)
  New-Item -ItemType File -Path (Join-Path $StageRoot "$dir\.gitkeep") -Force | Out-Null
}

powershell -ExecutionPolicy Bypass -File (Join-Path $StageRoot "scripts\check-compliance-package.ps1") -Root $StageRoot
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "[FHL source release] Source: $StageRoot"
