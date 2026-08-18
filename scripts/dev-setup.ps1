[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$expectedBranch = "codex/windows-v2.0.4-development"
$expectedOrigin = "https://github.com/supart/fhl-image-studio.git"
$baselineTag = "windows-v2.0.3-release"
$developmentTag = "windows-v2.0.4-dev.0"
$developmentBaselineCommit = "e29d40fb60dc88e14a8bcfad6942714b35759576"

function Invoke-GitText {
  param([string[]]$Arguments)
  $result = & git -C $root @Arguments 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($result.Trim())"
  }
  return $result.Trim()
}

function Assert-Equal {
  param([string]$Name, [string]$Actual, [string]$Expected)
  if ($Actual -ne $Expected) {
    throw "$Name mismatch. Expected '$Expected', got '$Actual'."
  }
}

Set-Location $root

$gitRoot = (Invoke-GitText @("rev-parse", "--show-toplevel"))
Assert-Equal "Git root" ([IO.Path]::GetFullPath($gitRoot)) ([IO.Path]::GetFullPath($root))

$bootstrapAllowed = @(
  "AGENTS.md",
  "PROJECT_CONTEXT.md",
  "README.md",
  ".gitmessage.txt",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  "scripts/doctor.ps1",
  "scripts/dev-setup.ps1",
  "scripts/dev-check.ps1",
  "scripts/archive-v2.0.4.ps1",
  "docs/development-workflow.md",
  "docs/changes/_TEMPLATE.md",
  "docs/changes/2026-08-18-windows-v2.0.4-development-environment.md"
)
$dirtyEntries = @(git -C $root status --porcelain=v1 --untracked-files=all)
$dirtyPaths = @($dirtyEntries | ForEach-Object {
  if ($_.Length -ge 4) { $_.Substring(3) } else { $_ }
})
$unexpectedChanges = @($dirtyPaths | Where-Object { $_ -notin $bootstrapAllowed })
if ($unexpectedChanges.Count -gt 0) {
  throw "Only the known development-environment files may be pending during first setup. Unexpected changes:`n$($unexpectedChanges -join "`n")"
}

$branch = Invoke-GitText @("branch", "--show-current")
if ($branch -ne $expectedBranch -and $branch -notmatch '^codex/windows-v2\.0\.4-feature/.+') {
  throw "Unexpected V2.0.4 branch '$branch'. Expected '$expectedBranch' or a codex/windows-v2.0.4-feature/* branch."
}

$origin = Invoke-GitText @("remote", "get-url", "origin")
Assert-Equal "origin URL" $origin $expectedOrigin

$upstream = ""
try {
  $upstream = Invoke-GitText @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
} catch {
  $upstream = ""
}
if (-not [string]::IsNullOrWhiteSpace($upstream)) {
  throw "The V2.0.4 branch must not track an upstream branch. Found '$upstream'."
}

$pushUrl = ""
try {
  $pushUrl = Invoke-GitText @("config", "--get", "remote.origin.pushurl")
} catch {
  $pushUrl = ""
}
if (-not [string]::IsNullOrWhiteSpace($pushUrl)) {
  throw "remote.origin.pushurl is configured. Remove it before enabling the local-first workflow."
}

$manifest = Get-Content -Raw (Join-Path $root "product-version.json") | ConvertFrom-Json
if ([string]$manifest.version -ne "2.0.4" -or [string]$manifest.displayVersion -ne "V2.0.4") {
  throw "product-version.json is not the V2.0.4 development manifest."
}

& git -C $root merge-base --is-ancestor $baselineTag HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Current HEAD is not based on $baselineTag."
}

& git -C $root config core.hooksPath .githooks
& git -C $root config pull.ff only
& git -C $root config push.autoSetupRemote false
& git -C $root config commit.template .gitmessage.txt

$tagExists = $true
try {
  $tagCommit = Invoke-GitText @("rev-list", "-n", "1", $developmentTag)
} catch {
  $tagExists = $false
  $tagCommit = ""
}

if ($tagExists) {
  if ($tagCommit -ne $developmentBaselineCommit) {
    throw "$developmentTag must remain at the original V2.0.4 baseline $developmentBaselineCommit. Found $tagCommit."
  }
} elseif ($branch -eq $expectedBranch) {
  $head = Invoke-GitText @("rev-parse", "HEAD")
  if ($head -ne $developmentBaselineCommit) {
    throw "Cannot create $developmentTag because HEAD is $head, not the original V2.0.4 baseline $developmentBaselineCommit."
  }
  & git -C $root tag -a $developmentTag -m "V2.0.4 local development baseline" HEAD
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create $developmentTag."
  }
  Write-Output "Created local baseline tag: $developmentTag"
} else {
  throw "$developmentTag does not exist. Switch to $expectedBranch before creating the baseline tag."
}

$doctor = Join-Path $root "scripts\doctor.ps1"
& $doctor -Json
if ($LASTEXITCODE -ne 0) {
  throw "Development environment doctor reported failures."
}

Write-Output "V2.0.4 local development environment is ready."
Write-Output "Branch: $branch"
Write-Output "Baseline: $developmentTag"
Write-Output "Hooks: .githooks"
Write-Output "Remote: origin retained for read-only reference; pushes require explicit authorization."
