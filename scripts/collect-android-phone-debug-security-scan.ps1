[CmdletBinding()]
param(
  [string]$RepoRoot = (Join-Path $PSScriptRoot ".."),
  [Parameter(Mandatory = $true)][string]$ApkPath,
  [Parameter(Mandatory = $true)][string]$ExpectedApkSha256,
  [string]$Device = "emulator-5554",
  [string]$Adb = "adb",
  [string]$Package = "top.fangtangyuan.fhlstudio.android.debug",
  [Parameter(Mandatory = $true)][string]$OutputJson
)

$ErrorActionPreference = "Stop"
$resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot).Path
$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$outputParent = Split-Path -Parent $OutputJson
if ($outputParent) { New-Item -ItemType Directory -Force -Path $outputParent | Out-Null }
$resolvedOutput = [IO.Path]::GetFullPath($OutputJson)
$outputStem = [IO.Path]::GetFileNameWithoutExtension($resolvedOutput)
$safetyJson = Join-Path $outputParent "$outputStem-source-apk-safety.json"
$safetyRetryJson = Join-Path $outputParent "$outputStem-source-apk-safety-retry.json"

function Resolve-Executable {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (Test-Path -LiteralPath $Name -PathType Leaf) { return (Resolve-Path -LiteralPath $Name).Path }
  $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue
  if (-not $command) { throw "Executable was not found: $Name" }
  return $command.Source
}

function Invoke-Captured {
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [int]$TimeoutSeconds = 60
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FileName
  $startInfo.Arguments = (@($Arguments | ForEach-Object {
    $value = [string]$_
    if ($value -notmatch '[\s"]') { return $value }
    return '"' + ($value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
  }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Unable to start process: $FileName" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { }
      $process.WaitForExit()
      throw "Process timed out: $FileName"
    }
    $process.WaitForExit()
    return [pscustomobject]@{
      exitCode = [int]$process.ExitCode
      stdout = [string]$stdoutTask.GetAwaiter().GetResult()
      stderr = [string]$stderrTask.GetAwaiter().GetResult()
    }
  }
  finally { $process.Dispose() }
}

function Get-SafetyFlags {
  param([AllowNull()][string]$Text)
  $value = [string]$Text
  $secret = [regex]::IsMatch($value, '(?i)\bsk-[a-z0-9_-]{20,}\b') -or
    [regex]::IsMatch($value, '(?i)\bbearer\s+[a-z0-9._~+/=-]{20,}\b') -or
    [regex]::IsMatch($value, '(?i)["''](?:api[_-]?key|token|secret)["'']\s*[:=]\s*["''][a-z0-9._~+/=-]{20,}["'']')
  $windowsUsersPattern = '[a-z]:\\' + 'Users\\[^\\\r\n]+\\'
  $macUsersPattern = '/' + 'Users/[^/\r\n]+/'
  $privatePath = [regex]::IsMatch($value, "(?i)(?:$windowsUsersPattern|$macUsersPattern)")
  return [pscustomobject]@{ secret = $secret; privatePath = $privatePath }
}

function Get-DeviceText {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  $result = Invoke-Captured -FileName $script:AdbExecutable -Arguments @(
    "-s", $Device, "exec-out", "run-as", $Package, "cat", $RelativePath
  ) -TimeoutSeconds 45
  if ($result.exitCode -ne 0) { throw "Unable to read device file: $RelativePath" }
  return [string]$result.stdout
}

function Test-TextCandidate {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  if ($RelativePath -match '(?i)(?:\.png|\.jpe?g|\.webp|\.gif|\.mp4|\.db|\.sqlite|\.ldb|\.pak|\.bin|\.dat)$') { return $false }
  if ($RelativePath -match '(?i)(?:^|/)(?:files/(?:jobs|log)|shared_prefs|app_webview|no_backup|backup)(?:/|$)') { return $true }
  return $false
}

$script:AdbExecutable = Resolve-Executable -Name $Adb
$apkHash = (Get-FileHash -LiteralPath $resolvedApk -Algorithm SHA256).Hash.ToUpperInvariant()
$apkItem = Get-Item -LiteralPath $resolvedApk -Force

$safetyCommand = Join-Path $resolvedRepo "scripts\check-android-release-safety.ps1"
$safetyProcess = Invoke-Captured -FileName (Resolve-Executable -Name "powershell.exe") -Arguments @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $safetyCommand,
  "-Root", $resolvedRepo, "-ZipPath", $resolvedApk, "-OutputJson", $safetyJson
) -TimeoutSeconds 600
$safety = if (Test-Path -LiteralPath $safetyJson) {
  Get-Content -Raw -Encoding UTF8 -LiteralPath $safetyJson | ConvertFrom-Json
} else { $null }
$sourceScanAttempts = 1
$firstSourceReadErrors = if ($safety) { [int]$safety.root.readErrors + [int]$safety.archive.readErrors } else { 0 }
$onlyTransientReadErrors = $safety -and $firstSourceReadErrors -gt 0 -and [int]$safety.issueCount -eq $firstSourceReadErrors
if ($onlyTransientReadErrors) {
  Start-Sleep -Milliseconds 250
  $sourceScanAttempts = 2
  $safetyProcess = Invoke-Captured -FileName (Resolve-Executable -Name "powershell.exe") -Arguments @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $safetyCommand,
    "-Root", $resolvedRepo, "-ZipPath", $resolvedApk, "-OutputJson", $safetyRetryJson
  ) -TimeoutSeconds 600
  $safety = if (Test-Path -LiteralPath $safetyRetryJson) {
    Get-Content -Raw -Encoding UTF8 -LiteralPath $safetyRetryJson | ConvertFrom-Json
  } else { $null }
}

$deviceState = Invoke-Captured -FileName $script:AdbExecutable -Arguments @("-s", $Device, "get-state")
$connected = $deviceState.exitCode -eq 0 -and $deviceState.stdout.Trim() -eq "device"
$deviceReport = [ordered]@{
  connected = $connected
  state = $deviceState.stdout.Trim()
  package = $Package
  filesListed = 0
  filesScanned = 0
  bytes = 0L
  secretPatternFiles = 0
  privatePathFiles = 0
  forbiddenFiles = 0
  readErrors = 0
  categories = [ordered]@{
    sharedPreferences = [ordered]@{ files = 0; scanned = 0; secretPatternFiles = 0; privatePathFiles = 0; readErrors = 0 }
    jobsPayload = [ordered]@{ files = 0; scanned = 0; secretPatternFiles = 0; privatePathFiles = 0; readErrors = 0 }
    webView = [ordered]@{ files = 0; scanned = 0; secretPatternFiles = 0; privatePathFiles = 0; readErrors = 0 }
    logs = [ordered]@{ files = 0; scanned = 0; secretPatternFiles = 0; privatePathFiles = 0; readErrors = 0 }
    backups = [ordered]@{ files = 0; scanned = 0; secretPatternFiles = 0; privatePathFiles = 0; readErrors = 0 }
  }
}

if ($connected) {
  $find = Invoke-Captured -FileName $script:AdbExecutable -Arguments @(
    "-s", $Device, "exec-out", "run-as", $Package, "find", ".", "-type", "f"
  ) -TimeoutSeconds 120
  if ($find.exitCode -ne 0) { $deviceReport["readErrors"] = [int]$deviceReport["readErrors"] + 1 }
  $paths = @($find.stdout -split "`r?`n" | ForEach-Object {
    $path = $_.Trim()
    if ($path.StartsWith("./")) { $path = $path.Substring(2) }
    if ($path -match '^[A-Za-z0-9_./-]+$' -and $path.Length -gt 0) { $path }
  })
  $deviceReport["filesListed"] = $paths.Count
  foreach ($path in $paths) {
    $categoryName = if ($path -match '(?i)^shared_prefs/') { "sharedPreferences" }
      elseif ($path -match '(?i)^files/jobs/') { "jobsPayload" }
      elseif ($path -match '(?i)^app_webview/') { "webView" }
      elseif ($path -match '(?i)^files/log/') { "logs" }
      elseif ($path -match '(?i)^(?:no_backup|backup)/') { "backups" }
      else { $null }
    if (-not $categoryName) { continue }
    $category = $deviceReport["categories"][$categoryName]
    $category["files"] = [int]$category["files"] + 1
    if ($path -match '(?i)(?:^|/)(?:cli\.env\.local|fhl-api\.local\.json|browser-jobs\.v1\.json)$') {
      $deviceReport["forbiddenFiles"] = [int]$deviceReport["forbiddenFiles"] + 1
    }
    if (-not (Test-TextCandidate -RelativePath $path)) { continue }
    $category["scanned"] = [int]$category["scanned"] + 1
    $deviceReport["filesScanned"] = [int]$deviceReport["filesScanned"] + 1
    try {
      $text = Get-DeviceText -RelativePath $path
      $deviceReport["bytes"] = [long]$deviceReport["bytes"] + [Text.Encoding]::UTF8.GetByteCount($text)
      $flags = Get-SafetyFlags -Text $text
      if ($flags.secret) {
        $deviceReport["secretPatternFiles"] = [int]$deviceReport["secretPatternFiles"] + 1
        $category["secretPatternFiles"] = [int]$category["secretPatternFiles"] + 1
      }
      if ($flags.privatePath) {
        $deviceReport["privatePathFiles"] = [int]$deviceReport["privatePathFiles"] + 1
        $category["privatePathFiles"] = [int]$category["privatePathFiles"] + 1
      }
    }
    catch {
      $deviceReport["readErrors"] = [int]$deviceReport["readErrors"] + 1
      $category["readErrors"] = [int]$category["readErrors"] + 1
    }
  }
}

$issueCount = 0
if (-not $connected) { $issueCount += 1 }
if ($apkHash -ne $ExpectedApkSha256.ToUpperInvariant()) { $issueCount += 1 }
if ($safety) {
  $issueCount += [int]$safety.issueCount
} else { $issueCount += 1 }
$issueCount += [int]$deviceReport["secretPatternFiles"] + [int]$deviceReport["privatePathFiles"] +
  [int]$deviceReport["forbiddenFiles"] + [int]$deviceReport["readErrors"]

$report = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToString("o")
  status = if ($issueCount -eq 0) { "passed" } else { "failed" }
  issueCount = $issueCount
  apk = [ordered]@{
    file = [IO.Path]::GetFileName($resolvedApk)
    bytes = [long]$apkItem.Length
    sha256 = $apkHash
    expectedSha256 = $ExpectedApkSha256.ToUpperInvariant()
    hashMatches = $apkHash -eq $ExpectedApkSha256.ToUpperInvariant()
  }
  sourceAndApk = $safety
  sourceAndApkScan = [ordered]@{
    attempts = $sourceScanAttempts
    firstReadErrors = $firstSourceReadErrors
    reportFile = if ($sourceScanAttempts -eq 2) { [IO.Path]::GetFileName($safetyRetryJson) } else { [IO.Path]::GetFileName($safetyJson) }
  }
  device = $deviceReport
  rules = [ordered]@{
    fullApiKeyText = "not recorded; count only"
    keySuffixText = "not recorded; count only"
    promptText = "not recorded"
    status = "No credential or private path content is written to this report."
  }
}

[IO.File]::WriteAllText($resolvedOutput, ($report | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "Android phone debug security scan: $($report.status)"
Write-Host "Issues: $($report.issueCount)"
Write-Host "Report: $resolvedOutput"
if ($report.issueCount -gt 0) { exit 1 }
