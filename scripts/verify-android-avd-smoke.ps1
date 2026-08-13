[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AvdName,
  [Parameter(Mandatory = $true)][int]$ExpectedApiLevel,
  [Parameter(Mandatory = $true)][string]$ApkPath,
  [Parameter(Mandatory = $true)][string]$ExpectedApkSha256,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$Adb = "adb",
  [string]$Emulator = "emulator",
  [int]$EmulatorPort = 0,
  [switch]$WipeData,
  [string]$Package = "top.fangtangyuan.fhlstudio.android.debug",
  [string]$AndroidTestApkPath = "",
  [string]$InstrumentationClass = "",
  [string]$InstrumentationTarget = "",
  [int]$BootTimeoutSeconds = 240,
  [int]$ObservationSeconds = 30
)

$ErrorActionPreference = "Stop"
$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$resolvedTestApk = if ($AndroidTestApkPath.Trim()) {
  (Resolve-Path -LiteralPath $AndroidTestApkPath).Path
} else {
  ""
}
$resolvedInstrumentationTarget = if ($InstrumentationTarget.Trim()) {
  $InstrumentationTarget.Trim()
} else {
  "$Package.test/androidx.test.runner.AndroidJUnitRunner"
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$reportPath = Join-Path $resolvedOutput "smoke-report.json"
$logPath = Join-Path $resolvedOutput "redacted-submit-lines.log"
$instrumentationLogPath = Join-Path $resolvedOutput "instrumentation.log"
$apkHash = (Get-FileHash -LiteralPath $resolvedApk -Algorithm SHA256).Hash.ToUpperInvariant()
$apkItem = Get-Item -LiteralPath $resolvedApk -Force

function Resolve-Executable {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (Test-Path -LiteralPath $Name -PathType Leaf) { return (Resolve-Path -LiteralPath $Name).Path }
  $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue
  if (-not $command) { throw "Executable was not found: $Name" }
  return $command.Source
}

function Invoke-Tool {
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
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
    if (-not $process.Start()) { throw "Unable to start $FileName" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { }
      $process.WaitForExit()
      throw "Timed out running $FileName"
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

function Invoke-Adb {
  param([Parameter(Mandatory = $true)][string[]]$Arguments, [int]$TimeoutSeconds = 60)
  return Invoke-Tool -FileName $script:AdbExecutable -Arguments $Arguments -TimeoutSeconds $TimeoutSeconds
}

function Get-DeviceSerials {
  $result = Invoke-Adb -Arguments @("devices")
  return @(
    $result.stdout -split "`r?`n" |
      Where-Object { $_ -match '^\s*(emulator-\d+|[A-Za-z0-9._:-]+)\s+device\s' } |
      ForEach-Object { ([regex]::Match($_, '^\s*(\S+)\s+device\s')).Groups[1].Value }
  )
}

function Get-RunAsRegistry {
  $result = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "exec-out", "run-as", $Package, "cat", "files/jobs/android-jobs.v1.json")
  $raw = ([string]$result.stdout).Trim()
  # A fresh install has no jobs directory yet. Some adb/run-as versions write
  # the missing-file diagnostic to stdout, so only JSON-looking output is a
  # registry candidate; an actual malformed JSON file remains a hard failure.
  if ($result.exitCode -ne 0 -or [string]::IsNullOrWhiteSpace($raw) -or $raw -notmatch '^\{') {
    return [pscustomobject]@{ groups = @(); rawAvailable = $false }
  }
  try {
    $parsed = $raw | ConvertFrom-Json
    return [pscustomobject]@{ groups = @($parsed.groups); rawAvailable = $true }
  }
  catch {
    throw "The device job registry was not valid JSON."
  }
}

$script:AdbExecutable = Resolve-Executable -Name $Adb
$script:EmulatorExecutable = Resolve-Executable -Name $Emulator
$report = [ordered]@{
  schemaVersion = 1
  status = "running"
  avd = $AvdName
  deviceSerial = $null
  expectedApiLevel = $ExpectedApiLevel
  actualApiLevel = $null
  package = $Package
  apk = [ordered]@{
    file = [IO.Path]::GetFileName($resolvedApk)
    bytes = [long]$apkItem.Length
    sha256 = $apkHash
    expectedSha256 = $ExpectedApkSha256.ToUpperInvariant()
    hashMatches = $apkHash -eq $ExpectedApkSha256.ToUpperInvariant()
  }
  installed = $false
  instrumentation = [ordered]@{
    requested = [bool]$resolvedTestApk
    testApkSha256 = if ($resolvedTestApk) { (Get-FileHash -LiteralPath $resolvedTestApk -Algorithm SHA256).Hash } else { "" }
    target = $resolvedInstrumentationTarget
    class = $InstrumentationClass.Trim()
    passed = $false
    tests = 0
  }
  packageMetadata = ""
  observationSeconds = $ObservationSeconds
  registryFileAvailable = $false
  registryGroups = 0
  redactedSubmitLineCount = 0
  issues = @()
}
$emulatorProcess = $null

try {
  $beforeSerials = @(Get-DeviceSerials)
  $emulatorArguments = @(
    "-avd", $AvdName, "-no-snapshot", "-no-boot-anim", "-no-audio", "-gpu", "swiftshader_indirect"
  )
  if ($WipeData) { $emulatorArguments += "-wipe-data" }
  if ($EmulatorPort -gt 0) { $emulatorArguments += @("-port", [string]$EmulatorPort) }
  $emulatorProcess = Start-Process -FilePath $script:EmulatorExecutable -ArgumentList $emulatorArguments -PassThru -WindowStyle Hidden
  $expectedSerial = if ($EmulatorPort -gt 0) { "emulator-$EmulatorPort" } else { $null }
  $deadline = (Get-Date).AddSeconds($BootTimeoutSeconds)
  do {
    Start-Sleep -Seconds 3
    $serials = @(Get-DeviceSerials)
    $newSerial = if ($expectedSerial) {
      # A freshly launched emulator can answer `get-state` before it is listed
      # reliably by `adb devices`; the fixed port is authoritative here.
      $state = Invoke-Adb -Arguments @("-s", $expectedSerial, "get-state") -TimeoutSeconds 10
      if ($state.exitCode -eq 0 -and $state.stdout.Trim() -eq "device") {
        $expectedSerial
      } else {
        @($serials | Where-Object { $_ -eq $expectedSerial }) | Select-Object -First 1
      }
    } else {
      @($serials | Where-Object { $beforeSerials -notcontains $_ }) | Select-Object -First 1
    }
  } while (-not $newSerial -and (Get-Date) -lt $deadline)
  if (-not $newSerial) { throw "AVD did not appear as an adb device within $BootTimeoutSeconds seconds." }
  $script:TargetSerial = [string]$newSerial
  $report.deviceSerial = $script:TargetSerial

  $bootDeadline = (Get-Date).AddSeconds($BootTimeoutSeconds)
  do {
    Start-Sleep -Seconds 3
    $boot = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "shell", "getprop", "sys.boot_completed")
    $bootComplete = $boot.stdout.Trim() -eq "1"
  } while (-not $bootComplete -and (Get-Date) -lt $bootDeadline)
  if (-not $bootComplete) { throw "AVD did not finish booting within $BootTimeoutSeconds seconds." }

  $api = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "shell", "getprop", "ro.build.version.sdk")
  $report.actualApiLevel = [int]$api.stdout.Trim()
  if ([int]$report.actualApiLevel -ne $ExpectedApiLevel) { $report.issues += "API level mismatch." }

  $install = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "install", "-r", $resolvedApk) -TimeoutSeconds 180
  $report.installed = $install.exitCode -eq 0 -and $install.stdout -match "Success"
  if (-not $report.installed) { throw "APK install failed." }

  if ($resolvedTestApk) {
    $testInstall = Invoke-Adb -Arguments @(
      "-s", $script:TargetSerial, "install", "-r", "-t", $resolvedTestApk
    ) -TimeoutSeconds 180
    if ($testInstall.exitCode -ne 0 -or $testInstall.stdout -notmatch "Success") {
      throw "Android test APK install failed."
    }
    $instrumentationArguments = @("-s", $script:TargetSerial, "shell", "am", "instrument", "-w", "-r")
    if ($InstrumentationClass.Trim()) {
      $instrumentationArguments += @("-e", "class", $InstrumentationClass.Trim())
    }
    $instrumentationArguments += $resolvedInstrumentationTarget
    $instrumentation = Invoke-Adb -Arguments $instrumentationArguments -TimeoutSeconds 300
    $instrumentationText = (($instrumentation.stdout, $instrumentation.stderr) -join "`n").Trim()
    [IO.File]::WriteAllText($instrumentationLogPath, $instrumentationText + "`n", [Text.UTF8Encoding]::new($false))
    $testMatch = [regex]::Match($instrumentationText, 'OK \((\d+) tests?\)')
    $report.instrumentation.tests = if ($testMatch.Success) { [int]$testMatch.Groups[1].Value } else { 0 }
    $report.instrumentation.passed = $instrumentation.exitCode -eq 0 -and $testMatch.Success
    if (-not $report.instrumentation.passed) { throw "Android instrumentation failed." }
  }

  $metadata = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "shell", "dumpsys", "package", $Package)
  $metadataLines = @($metadata.stdout -split "`r?`n" | Where-Object { $_ -match 'versionName=|versionCode=' })
  $report.packageMetadata = (($metadataLines -join " ") -replace '\s+', ' ').Trim()
  if ($report.packageMetadata -notmatch 'versionName=V2\.0\.3-debug' -or $report.packageMetadata -notmatch 'versionCode=1050003') {
    $report.issues += "Package metadata did not report V2.0.3-debug / 1050003."
  }

  $null = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "logcat", "-c")
  $resolve = Invoke-Adb -Arguments @(
    "-s", $script:TargetSerial, "shell", "cmd", "package", "resolve-activity", "--brief",
    "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", $Package
  )
  $component = @($resolve.stdout -split "`r?`n" | Where-Object { $_ -match "^$([Regex]::Escape($Package))/.+" })[-1]
  if ([string]::IsNullOrWhiteSpace($component)) { throw "Launcher activity could not be resolved." }
  $null = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "shell", "am", "start", "-W", "-n", $component)
  Start-Sleep -Seconds $ObservationSeconds

  $registry = Get-RunAsRegistry
  $report.registryFileAvailable = [bool]$registry.rawAvailable
  $report.registryGroups = @($registry.groups).Count
  if (@($registry.groups).Count -ne 0) { $report.issues += "Fresh AVD created native jobs before any user submission." }

  $logcat = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "logcat", "-d", "-v", "brief") -TimeoutSeconds 120
  $submitLines = @($logcat.stdout -split "`r?`n" | Where-Object {
    $_ -match '(?i)upstream_submit_attempt|submitandroidjobs|api[- ]key|\bsk-[a-z0-9_-]{20,}\b|https?://[^\s]+\s+POST\b|\bPOST\s+https?://'
  })
  $safeLines = @($submitLines | ForEach-Object {
    $_ -replace '(?i)\bsk-[a-z0-9_-]{20,}\b', '<api-key:redacted>'
  })
  $report.redactedSubmitLineCount = $safeLines.Count
  [IO.File]::WriteAllLines($logPath, $safeLines, [Text.UTF8Encoding]::new($false))
  if ($safeLines.Count -ne 0) { $report.issues += "Startup log contained a submit-related line." }
}
catch {
  $report.issues += ([string]$_.Exception.Message)
}
finally {
  if ($script:TargetSerial) {
    try { $null = Invoke-Adb -Arguments @("-s", $script:TargetSerial, "emu", "kill") -TimeoutSeconds 30 } catch { }
  }
  if ($emulatorProcess -and -not $emulatorProcess.HasExited) {
    try { $emulatorProcess.WaitForExit(15000) } catch { }
    if (-not $emulatorProcess.HasExited) {
      try { $emulatorProcess.Kill() } catch { }
    }
  }
  # If adb never exposed the serial, `emu kill` cannot run and the emulator
  # wrapper may leave its QEMU child behind. Clean only this named AVD so a
  # failed smoke run cannot poison the next device-matrix run.
  try {
    $avdPattern = [regex]::Escape($AvdName)
    $qemuChildren = @(Get-CimInstance Win32_Process -Filter "Name='qemu-system-x86_64.exe'" |
      Where-Object { $_.CommandLine -match "-avd\s+$avdPattern(?:\s|$)" })
    foreach ($child in $qemuChildren) {
      Stop-Process -Id ([int]$child.ProcessId) -Force -ErrorAction SilentlyContinue
    }
  } catch { }
}

$report.status = if (@($report.issues).Count -eq 0) { "passed" } else { "failed" }
[IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "Android AVD smoke ${AvdName}: $($report.status)"
Write-Host "Report: $reportPath"
if ($report.status -ne "passed") { exit 1 }
