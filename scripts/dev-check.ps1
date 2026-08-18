[CmdletBinding()]
param(
  [ValidateSet("Fast", "Batch", "Milestone")]
  [string]$Level = "Fast",
  [string]$JsonPath = ""
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$checks = [System.Collections.Generic.List[object]]::new()
$failed = $false

function Add-Check {
  param([string]$Name, [bool]$Passed, [string]$Detail)
  $checks.Add([pscustomobject]@{
    name = $Name
    passed = $Passed
    detail = $Detail
  })
  if (-not $Passed) { $script:failed = $true }
}

function Invoke-Step {
  param(
    [string]$Name,
    [string]$Command,
    [string]$WorkingDirectory = $root
  )

  Push-Location $WorkingDirectory
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = (& cmd.exe /d /c $Command 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
  } catch {
    $output = $_.Exception.Message
    $code = 1
  } finally {
    $ErrorActionPreference = $previousPreference
    Pop-Location
  }

  $detail = if ([string]::IsNullOrWhiteSpace($output)) { "exit $code" } else { $output }
  if ($detail.Length -gt 4000) { $detail = $detail.Substring($detail.Length - 4000) }
  Add-Check $Name ($code -eq 0) $detail
}

function Invoke-PowerShellStep {
  param([string]$Name, [string[]]$Arguments)
  $scriptPath = Join-Path $root "scripts\doctor.ps1"
  & $scriptPath @Arguments | Out-Null
  $code = $LASTEXITCODE
  Add-Check $Name ($code -eq 0) $(if ($code -eq 0) { "passed" } else { "exit $code" })
}

Set-Location $root

Invoke-Step "git-diff-check" "git -c core.autocrlf=false -c core.safecrlf=false diff --check"
Invoke-Step "version-metadata" "node scripts/sync-version-metadata.mjs --check"
Invoke-PowerShellStep "workspace-doctor" @()

$staged = @(git -C $root diff --cached --name-only)
$forbiddenStaged = @($staged | Where-Object {
  $_ -match '(^|/)(input|output|intermediate)/' -and $_ -notmatch '(^|/)(input|output|intermediate)/\.gitkeep$' -or
  $_ -match '(^|/)(node_modules|config/webview|frontend/dist|build/bin)/' -or
  $_ -match '(^|/)(cli\.env\.local|.*\.local(?:\.json)?|.*\.log|.*\.exe)$' -or
  $_ -match '(^|/)开发归档/'
})
Add-Check "staged-file-safety" ($forbiddenStaged.Count -eq 0) $(
  if ($forbiddenStaged.Count -eq 0) { "no private or generated files staged" } else { $forbiddenStaged -join ", " }
)

if ($Level -in @("Batch", "Milestone")) {
  $frontend = Join-Path $root "image-studio\frontend"
  $imageStudio = Join-Path $root "image-studio"
  $cli = Join-Path $root "go-cli"
  $worker = Join-Path $root "cloudflare-worker"

  Invoke-Step "frontend-typecheck" "npm run typecheck" $frontend
  Invoke-Step "frontend-lint" "npm run lint" $frontend
  Invoke-Step "frontend-node-tests" "npm run test:node" $frontend
  Invoke-Step "frontend-ui-tests" "npm run test:ui" $frontend
  Invoke-Step "desktop-go-test" "go test . ./backend" $imageStudio
  Invoke-Step "desktop-go-vet" "go vet . ./backend" $imageStudio
  Invoke-Step "cli-go-test" "go test ./..." $cli
  Invoke-Step "cli-go-vet" "go vet ./..." $cli
  Invoke-Step "worker-tests" "npm test" $worker
  Invoke-Step "local-smoke-check" "node scripts/local-smoke-check.mjs"
}

if ($Level -eq "Milestone") {
  $frontend = Join-Path $root "image-studio\frontend"
  $imageStudio = Join-Path $root "image-studio"
  Invoke-Step "windows-frontend-build" "npm run build:windows" $frontend
  Invoke-Step "windows-wails-build" "wails build -platform windows/amd64 -clean" $imageStudio
  Invoke-Step "source-compliance" "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-compliance-package.ps1 -Root ."
  $status = (& git -C $root status --porcelain | Out-String).Trim()
  Add-Check "clean-working-tree" ([string]::IsNullOrWhiteSpace($status)) $(
    if ([string]::IsNullOrWhiteSpace($status)) { "clean" } else { $status }
  )
  Add-Check "manual-browser-e2e-required" $true "Run Codex browser/Wails E2E and record the result in docs/changes before archiving."
}

$result = [pscustomobject]@{
  ok = -not $failed
  level = $Level
  root = $root
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  checks = $checks
}

if (-not [string]::IsNullOrWhiteSpace($JsonPath)) {
  $parent = Split-Path -Parent $JsonPath
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $JsonPath -Encoding utf8
}

foreach ($check in $checks) {
  $status = if ($check.passed) { "PASS" } else { "FAIL" }
  Write-Output ("[{0}] {1}: {2}" -f $status, $check.name, $check.detail)
}

if ($failed) { exit 1 }
