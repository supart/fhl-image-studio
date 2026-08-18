[CmdletBinding()]
param(
  [ValidatePattern('^windows-v2\.0\.4-(dev\.\d+|rc\.\d+)$')]
  [string]$Tag = ""
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$devRoot = (Split-Path -Parent (Split-Path -Parent $root))
$archiveRoot = Join-Path $devRoot "开发归档"
$checkJson = Join-Path $root ".tmp\v2.0.4-milestone-check.json"

function Invoke-Git {
  param([string[]]$Arguments)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git -C $root @Arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($code -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($output.Trim())"
  }
  return $output.Trim()
}

function Get-FileSha256 {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $root ".git"))) {
  throw "The V2.0.4 source root is not a Git repository."
}

$status = Invoke-Git @("status", "--porcelain")
if (-not [string]::IsNullOrWhiteSpace($status)) {
  throw "Milestone archive requires a clean working tree:`n$status"
}

$branch = Invoke-Git @("branch", "--show-current")
if ($branch -ne "codex/windows-v2.0.4-development") {
  throw "Milestone archives must be created from codex/windows-v2.0.4-development. Found: $branch"
}

$head = Invoke-Git @("rev-parse", "HEAD")
$createTag = $false
if ([string]::IsNullOrWhiteSpace($Tag)) {
  $headTags = @((Invoke-Git @("tag", "--points-at", "HEAD", "--list", "windows-v2.0.4-*")) -split "`r?`n" |
    Where-Object { $_ -match '^windows-v2\.0\.4-(dev\.\d+|rc\.\d+)$' })
  if ($headTags.Count -gt 1) {
    throw "HEAD has multiple V2.0.4 milestone tags: $($headTags -join ', ')"
  }
  if ($headTags.Count -eq 1) {
    $Tag = $headTags[0]
  } else {
    $devNumbers = @((Invoke-Git @("tag", "--list", "windows-v2.0.4-dev.*")) -split "`r?`n" |
      ForEach-Object {
        if ($_ -match '^windows-v2\.0\.4-dev\.(\d+)$') { [int]$Matches[1] }
      })
    $nextDevNumber = if ($devNumbers.Count -eq 0) { 0 } else { [int](($devNumbers | Measure-Object -Maximum).Maximum) + 1 }
    $Tag = "windows-v2.0.4-dev.$nextDevNumber"
    $createTag = $true
  }
} else {
  try {
    $tagCommit = Invoke-Git @("rev-list", "-n", "1", $Tag)
  } catch {
    $tagCommit = ""
    $createTag = $true
  }
}

if (-not $createTag) {
  $tagCommit = Invoke-Git @("rev-list", "-n", "1", $Tag)
  if ($tagCommit -ne $head) {
    throw "$Tag points to $tagCommit, but HEAD is $head. Archive the exact verified commit."
  }
}

$checkScript = Join-Path $root "scripts\dev-check.ps1"
& $checkScript -Level Milestone -JsonPath $checkJson
if ($LASTEXITCODE -ne 0) {
  throw "Milestone checks failed. No archive was created."
}

$checkedHead = Invoke-Git @("rev-parse", "HEAD")
if ($checkedHead -ne $head) {
  throw "HEAD changed during Milestone checks. Expected $head, found $checkedHead."
}
if ($createTag) {
  Invoke-Git @("tag", "-a", $Tag, "-m", "Windows V2.0.4 verified development milestone", $head) | Out-Null
  Write-Output "Created local milestone tag: $Tag"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archiveDir = Join-Path $archiveRoot "$stamp-$Tag"
if (Test-Path -LiteralPath $archiveDir) {
  throw "Archive directory already exists: $archiveDir"
}
New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null

$bundlePath = Join-Path $archiveDir "$Tag.bundle"
$sourceZipPath = Join-Path $archiveDir "$Tag-source.zip"
Invoke-Git @("bundle", "create", $bundlePath, "--all") | Out-Null
Invoke-Git @("bundle", "verify", $bundlePath) | Out-Null
Invoke-Git @("archive", "--format=zip", "--prefix=$Tag/", "--output=$sourceZipPath", $Tag) | Out-Null

$bundleHash = Get-FileSha256 $bundlePath
$sourceHash = Get-FileSha256 $sourceZipPath
$manifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  product = "Windows desktop V2.0.4"
  tag = $Tag
  commit = $head
  branch = $branch
  baseline = "windows-v2.0.3-release"
  originPolicy = "origin retained for read-only reference; pushes require explicit authorization"
  files = @(
    [ordered]@{ name = (Split-Path -Leaf $bundlePath); sha256 = $bundleHash },
    [ordered]@{ name = (Split-Path -Leaf $sourceZipPath); sha256 = $sourceHash }
  )
  verification = Get-Content -Raw -LiteralPath $checkJson | ConvertFrom-Json
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $archiveDir "ARCHIVE-MANIFEST.json") -Encoding utf8

$readme = @"
# Windows V2.0.4 里程碑归档

标签：$Tag
提交：$head
生成时间：$($manifest.generatedAt)

## 文件

- ``$Tag.bundle``：Git 完整历史，可用于恢复仓库。
- ``$Tag-source.zip``：只包含 Git 跟踪源码和文档，不包含本机配置、用户图片、日志、EXE 或 ZIP 产物。
- `ARCHIVE-MANIFEST.json`：校验值、版本和验证结果。

## 恢复

1. 将本目录复制到安全位置。
2. 使用 Git 从 `.bundle` 创建新的恢复仓库或恢复分支。
3. 不要覆盖正在使用的 V2.0.4 开发目录。

本归档只针对 Windows 桌面版 V2.0.4；V2.0.3 及更早版本不在本归档内。
"@
$readme | Set-Content -LiteralPath (Join-Path $archiveDir "恢复说明.md") -Encoding utf8

Remove-Item -LiteralPath $checkJson -Force -ErrorAction SilentlyContinue
Write-Output "V2.0.4 milestone archived: $archiveDir"
Write-Output "Bundle SHA-256: $bundleHash"
Write-Output "Source SHA-256: $sourceHash"
