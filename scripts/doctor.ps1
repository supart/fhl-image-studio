[CmdletBinding()]
param(
  [switch]$Json,
  [switch]$RequireClean
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$checks = [System.Collections.Generic.List[object]]::new()
$failed = $false

function Add-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail
  )

  $script:checks.Add([pscustomobject]@{
    name = $Name
    passed = $Passed
    detail = $Detail
  })
  if (-not $Passed) {
    $script:failed = $true
  }
}

function Invoke-TextCommand {
  param(
    [string]$Command,
    [string[]]$Arguments = @()
  )

  $output = & $Command @Arguments 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
  return $output.Trim()
}

$requiredPaths = @(
  "AGENTS.md",
  "go.work",
  "image-studio\wails.json",
  "image-studio\frontend\package.json"
)
$missingPaths = @($requiredPaths | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) })
Add-Check "workspace-root" ($missingPaths.Count -eq 0) $(
  if ($missingPaths.Count -eq 0) { $root } else { "missing: $($missingPaths -join ', ')" }
)

try {
  $nodeVersion = Invoke-TextCommand "node" @("--version")
  Add-Check "node-24" ($nodeVersion -match '^v24\.') $nodeVersion
} catch {
  Add-Check "node-24" $false $_.Exception.Message
}

try {
  $goVersion = Invoke-TextCommand "go" @("version")
  $goMatches = [regex]::Match($goVersion, 'go1\.26\.(\d+)')
  $goSupported = $goMatches.Success -and [int]$goMatches.Groups[1].Value -ge 3
  Add-Check "go-1.26.3+" $goSupported $goVersion
} catch {
  Add-Check "go-1.26.3+" $false $_.Exception.Message
}

try {
  $wailsVersion = Invoke-TextCommand "wails" @("version")
  Add-Check "wails-2.12.0" ($wailsVersion -match 'v2\.12\.0') (($wailsVersion -split "`r?`n")[0])
} catch {
  Add-Check "wails-2.12.0" $false $_.Exception.Message
}

try {
  $gitRoot = Invoke-TextCommand "git" @("-C", $root, "rev-parse", "--show-toplevel")
  $gitRoot = (Resolve-Path -LiteralPath $gitRoot).Path
  Add-Check "independent-git-root" ($gitRoot -eq $root) $gitRoot

  $originUrl = Invoke-TextCommand "git" @("-C", $root, "remote", "get-url", "origin")
  $expectedOrigin = "https://github.com/supart/fhl-image-studio.git"
  Add-Check "origin-read-only-policy" ($originUrl -eq $expectedOrigin) $originUrl

  $upstream = ""
  try {
    $upstream = Invoke-TextCommand "git" @("-C", $root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
  } catch {
    $upstream = ""
  }
  Add-Check "no-branch-upstream" ([string]::IsNullOrWhiteSpace($upstream)) $(
    if ([string]::IsNullOrWhiteSpace($upstream)) { "none" } else { $upstream }
  )

  $pushUrl = ""
  try {
    $pushUrl = Invoke-TextCommand "git" @("-C", $root, "config", "--get", "remote.origin.pushurl")
  } catch {
    $pushUrl = ""
  }
  Add-Check "no-configured-pushurl" ([string]::IsNullOrWhiteSpace($pushUrl)) $(
    if ([string]::IsNullOrWhiteSpace($pushUrl)) { "none" } else { $pushUrl }
  )

  if ($RequireClean) {
    $status = Invoke-TextCommand "git" @("-C", $root, "status", "--porcelain")
    Add-Check "clean-working-tree" ([string]::IsNullOrWhiteSpace($status)) $(
      if ([string]::IsNullOrWhiteSpace($status)) { "clean" } else { $status }
    )
  }

  $tracked = @(git -C $root ls-files)
  $forbiddenTracked = @($tracked | Where-Object {
    $_ -match '(^|/)cli\.env\.local$' -or
    $_ -match '(^|/)config/webview/' -or
    $_ -match '(^|/)node_modules/' -or
    (($_ -match '(^|/)(input|output|intermediate)/') -and ($_ -notmatch '\.gitkeep$')) -or
    $_ -match '\.(exe|log)$'
  })
  Add-Check "forbidden-files-untracked" ($forbiddenTracked.Count -eq 0) $(
    if ($forbiddenTracked.Count -eq 0) { "none" } else { $forbiddenTracked -join ', ' }
  )

  $ignoreProbes = @(
    "config/cli.env.local",
    "config/webview/probe.dat",
    "input/probe.png",
    "output/probe.png",
    "intermediate/probe.png",
    "image-studio/build/bin/probe.exe",
    "image-studio/frontend/node_modules/probe.js",
    "image-studio/frontend/test-results/probe.json",
    "image-studio/frontend/probe.log"
  )
  $notIgnored = @()
  foreach ($probe in $ignoreProbes) {
    git -C $root check-ignore --no-index --quiet -- $probe
    if ($LASTEXITCODE -ne 0) {
      $notIgnored += $probe
    }
  }
  Add-Check "ignore-rules" ($notIgnored.Count -eq 0) $(
    if ($notIgnored.Count -eq 0) { "all probes ignored" } else { "not ignored: $($notIgnored -join ', ')" }
  )
} catch {
  Add-Check "git-safety" $false $_.Exception.Message
}

$result = [pscustomobject]@{
  ok = -not $failed
  root = $root
  checks = $checks
}

if ($Json) {
  $result | ConvertTo-Json -Depth 5
} else {
  foreach ($check in $checks) {
    $status = if ($check.passed) { "PASS" } else { "FAIL" }
    Write-Output ("[{0}] {1}: {2}" -f $status, $check.name, $check.detail)
  }
}

if ($failed) {
  exit 1
}
