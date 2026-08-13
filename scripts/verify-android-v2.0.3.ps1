param(
  [ValidateSet("Quick", "Full", "Release")]
  [string]$Stage = "Quick",
  [string]$ReportRoot = "",
  [string]$ReleaseSourceRoot = "",
  [string]$LiveAcceptanceReport = "",
  [string]$LiveAcceptanceEvidenceRoot = "",
  [string]$ExpectedCommit = "",
  [ValidatePattern("^[A-Za-z0-9._-]+$")]
  [string]$BuildId = "local"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$officialReleaseCertificateSha256 = "6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$executionRoot = $repoRoot
if ($Stage -eq "Release") {
  if (-not $ReleaseSourceRoot.Trim()) {
    throw "Release verification requires -ReleaseSourceRoot with a clean staging directory."
  }
  $executionRoot = (Resolve-Path -LiteralPath $ReleaseSourceRoot).Path
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $ReportRoot.Trim()) {
  $developmentRoot = Split-Path -Parent (Split-Path -Parent $repoRoot)
  $acceptanceRoot = Get-ChildItem -LiteralPath $developmentRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "V2.0.3-*" } |
    Select-Object -First 1
  $reportBase = if ($acceptanceRoot) {
    Join-Path $acceptanceRoot.FullName "automated"
  } else {
    Join-Path $repoRoot ".tmp\android-v2.0.3-audit"
  }
  $ReportRoot = Join-Path $reportBase "$stamp-$($Stage.ToLowerInvariant())"
}
New-Item -ItemType Directory -Force -Path $ReportRoot | Out-Null
$ReportRoot = (Resolve-Path -LiteralPath $ReportRoot).Path

$startedAt = Get-Date
$script:steps = New-Object System.Collections.Generic.List[object]
$script:stepIndex = 0
$fatalMessage = ""

function Protect-AuditText {
  param([AllowNull()][object]$Value)

  $text = [string]$Value
  foreach ($name in @("IMAGE_STUDIO_KEYSTORE_PASSWORD", "IMAGE_STUDIO_KEY_PASSWORD", "IMAGE_STUDIO_KEY_ALIAS")) {
    $secret = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrEmpty($secret)) { $text = $text.Replace($secret, "<redacted>") }
  }
  return [Regex]::Replace($text, '(?i)\bsk-[a-z0-9_-]{12,}\b', '<api-key:redacted>')
}

function Add-AuditStep {
  param(
    [string]$Name,
    [string]$Command,
    [int]$ExitCode,
    [double]$DurationMs,
    [string]$LogName,
    [object]$Tests = $null
  )

  $script:steps.Add([pscustomobject]@{
    id = $Name
    command = $Command
    status = if ($ExitCode -eq 0) { "passed" } else { "failed" }
    exitCode = $ExitCode
    durationMs = [math]::Round($DurationMs, 0)
    logPath = $LogName
    tests = $Tests
  })
}

function Invoke-AuditStep {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments
  )

  $script:stepIndex += 1
  $logName = "{0:D2}-{1}.log" -f $script:stepIndex, ($Name -replace "[^A-Za-z0-9._-]", "-")
  $logPath = Join-Path $ReportRoot $logName
  $stepStartedAt = Get-Date
  $exitCode = 0
  $output = @()

  if (-not (Test-Path -LiteralPath $WorkingDirectory)) {
    $output = @("Working directory not found: $WorkingDirectory")
    $exitCode = 1
  } else {
    Push-Location $WorkingDirectory
    try {
      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      $global:LASTEXITCODE = 0
      $output = @(& $FilePath @Arguments 2>&1)
      $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    } catch {
      $output = @($_ | Out-String)
      $exitCode = 1
    } finally {
      if ($null -ne $previousErrorActionPreference) {
        $ErrorActionPreference = $previousErrorActionPreference
      }
      Pop-Location
    }
  }

  $renderedOutput = @($output | ForEach-Object { Protect-AuditText -Value ($_.ToString()) })
  Set-Content -LiteralPath $logPath -Encoding UTF8 -Value $renderedOutput
  $durationMs = ((Get-Date) - $stepStartedAt).TotalMilliseconds
  $commandText = Protect-AuditText ("$FilePath $($Arguments -join ' ')".Trim())
  Add-AuditStep $Name $commandText $exitCode $durationMs $logName
}

function Add-AssertionStep {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$SuccessMessage,
    [string]$FailureMessage
  )

  $script:stepIndex += 1
  $logName = "{0:D2}-{1}.log" -f $script:stepIndex, ($Name -replace "[^A-Za-z0-9._-]", "-")
  $message = if ($Passed) { $SuccessMessage } else { $FailureMessage }
  $message | Set-Content -LiteralPath (Join-Path $ReportRoot $logName) -Encoding UTF8
  Add-AuditStep $Name "internal assertion" $(if ($Passed) { 0 } else { 1 }) 0 $logName
}

function Read-AndroidServiceIdentity {
  param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [Parameter(Mandatory = $true)][string]$ExpectedIdentity
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ApkPath)
  $expectedPresent = $false
  $randomIdentities = New-Object System.Collections.Generic.HashSet[string]
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName -notlike "assets/assets/*.js") { continue }
      $reader = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
      try {
        $source = $reader.ReadToEnd()
      }
      finally {
        $reader.Dispose()
      }
      if ($source.Contains($ExpectedIdentity)) { $expectedPresent = $true }
      foreach ($match in [regex]::Matches($source, 'vite-[a-z0-9]+-[a-z0-9]+')) {
        [void]$randomIdentities.Add($match.Value)
      }
    }
  }
  finally {
    $archive.Dispose()
  }
  return [ordered]@{
    expected = $ExpectedIdentity
    expectedPresent = $expectedPresent
    randomIdentityCount = $randomIdentities.Count
  }
}

function Get-Step {
  param([string]$Name)
  return $script:steps | Where-Object { $_.id -eq $Name } | Select-Object -Last 1
}

function Read-NodeTestSummary {
  param([string]$StepName)

  $step = Get-Step $StepName
  if (-not $step) { return $null }
  $text = Get-Content -Raw -Encoding UTF8 (Join-Path $ReportRoot $step.logPath)
  $summary = [ordered]@{}
  foreach ($field in @("tests", "pass", "fail", "skipped")) {
    $matches = [regex]::Matches($text, "(?m)^[^\r\n]*\b$field\s+(\d+)\s*$")
    $summary[$field] = if ($matches.Count -gt 0) {
      [int]$matches[$matches.Count - 1].Groups[1].Value
    } else {
      $null
    }
  }
  $step.tests = [pscustomobject]$summary
  return $step.tests
}

function Read-AndroidJvmSummary {
  param([string]$AndroidRoot)

  $resultRoot = Join-Path $AndroidRoot "app\build\test-results\testDebugUnitTest"
  $files = @(Get-ChildItem -LiteralPath $resultRoot -Filter "TEST-*.xml" -File -ErrorAction SilentlyContinue)
  $summary = [ordered]@{ tests = 0; pass = 0; fail = 0; skipped = 0; suites = $files.Count }
  foreach ($file in $files) {
    [xml]$xml = Get-Content -Raw -Encoding UTF8 $file.FullName
    $suite = $xml.testsuite
    $tests = [int]$suite.tests
    $failures = [int]$suite.failures + [int]$suite.errors
    $skipped = [int]$suite.skipped
    $summary.tests += $tests
    $summary.fail += $failures
    $summary.skipped += $skipped
    $summary.pass += ($tests - $failures - $skipped)
  }
  $step = Get-Step "android-jvm-tests"
  if ($step) { $step.tests = [pscustomobject]$summary }
  return [pscustomobject]$summary
}

function Resolve-AndroidSdkRoot {
  foreach ($candidate in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $localProperties = Join-Path $executionRoot "android-shell\local.properties"
  if (Test-Path -LiteralPath $localProperties) {
    $line = Get-Content -LiteralPath $localProperties -Encoding UTF8 |
      Where-Object { $_ -match '^sdk\.dir=' } |
      Select-Object -First 1
    if ($line) {
      $candidate = ($line -replace '^sdk\.dir=', '').Replace('\:', ':').Replace('\\', '\')
      if (Test-Path -LiteralPath $candidate) {
        return (Resolve-Path -LiteralPath $candidate).Path
      }
    }
  }
  throw "Android SDK was not found. Set ANDROID_SDK_ROOT or check android-shell/local.properties."
}

function Resolve-ApkAnalyzer {
  param([string]$SdkRoot)

  $command = Get-Command "apkanalyzer.bat" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = Join-Path $SdkRoot "cmdline-tools\latest\bin\apkanalyzer.bat"
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  throw "apkanalyzer.bat was not found."
}

function Read-StepOutput {
  param([string]$StepName)

  $step = Get-Step $StepName
  if (-not $step) { return "" }
  $lines = @(Get-Content -LiteralPath (Join-Path $ReportRoot $step.logPath) -Encoding UTF8)
  return (($lines | Where-Object { $_.Trim() } | Select-Object -Last 1) -join "").Trim()
}

function Get-ToolVersion {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$PreferredPattern = ""
  )
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = 0
    $output = @(& $FilePath @Arguments 2>&1)
    $lines = @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
    if ($PreferredPattern) {
      $preferred = $lines | Where-Object { $_ -match $PreferredPattern } | Select-Object -First 1
      if ($preferred) { return $preferred }
    }
    return (($lines | Select-Object -First 1) -join "")
  } catch {
    return "unavailable"
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function New-AsciiRepositoryMapping {
  param([string]$Root)

  if (-not [regex]::IsMatch($Root, '[^\x00-\x7F]')) {
    return [pscustomobject]@{ root = $Root; drive = "" }
  }

  foreach ($codePoint in 90..68) {
    $drive = "$([char]$codePoint):"
    if (Test-Path -LiteralPath "$drive\") { continue }
    $global:LASTEXITCODE = 0
    $null = & subst.exe $drive $Root 2>&1
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath "$drive\")) {
      return [pscustomobject]@{ root = "$drive\"; drive = $drive }
    }
  }
  throw "No free drive letter is available for the ASCII Gradle path mapping."
}

function Resolve-SubstBackedPath {
  param([string]$Path)

  if ($env:OS -ne "Windows_NT" -or -not [System.IO.Path]::IsPathRooted($Path)) { return $Path }
  $root = [System.IO.Path]::GetPathRoot($Path)
  if (-not $root -or $root.Length -lt 2) { return $Path }
  if (-not ("AndroidV203.PathResolver" -as [type])) {
    Add-Type -Namespace AndroidV203 -Name PathResolver -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
public static extern uint QueryDosDevice(string deviceName, System.Text.StringBuilder targetPath, int maxLength);
'@
  }
  $target = New-Object System.Text.StringBuilder 32768
  $deviceName = $root.TrimEnd("\")
  $length = [AndroidV203.PathResolver]::QueryDosDevice($deviceName, $target, $target.Capacity)
  if ($length -gt 4) {
    $resolvedRoot = $target.ToString()
    if ($resolvedRoot.StartsWith("\??\", [System.StringComparison]::Ordinal)) {
      $resolvedRoot = $resolvedRoot.Substring(4)
      if ([System.IO.Path]::IsPathRooted($resolvedRoot)) {
        return (Join-Path $resolvedRoot $Path.Substring($root.Length))
      }
    }
  }
  return $Path
}

$debugApkMetadata = $null
$releaseApkMetadata = $null
$liveAcceptance = $null
$environmentInfo = [ordered]@{}
$liveApiResult = [ordered]@{
  executed = $false
  totalJobs = 0
  slotDistribution = [pscustomobject]@{}
}
$mappedDrive = ""
$previousPrebuiltFrontend = $env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND
$previousGitCommit = $env:IMAGE_STUDIO_GIT_COMMIT
$previousBuildId = $env:IMAGE_STUDIO_BUILD_ID

try {
  $frontendRoot = Join-Path $executionRoot "image-studio\frontend"
  $compatFrontendRoot = Resolve-SubstBackedPath $frontendRoot
  $workerRoot = Join-Path $executionRoot "cloudflare-worker"
  $mapping = New-AsciiRepositoryMapping $executionRoot
  $mappedDrive = $mapping.drive
  $gradleExecutionRoot = $mapping.root
  $androidRoot = Join-Path $gradleExecutionRoot "android-shell"
  $realAndroidRoot = Join-Path $executionRoot "android-shell"
  $gradle = Join-Path $androidRoot "gradlew.bat"
  $sdkRoot = Resolve-AndroidSdkRoot
  $apkanalyzer = Resolve-ApkAnalyzer $sdkRoot
  $buildCommit = ((& git -C $executionRoot rev-parse HEAD 2>$null) -join "").Trim().ToLowerInvariant()
  if ($Stage -in @("Full", "Release")) {
    Add-AssertionStep "android-build-commit" ($buildCommit -match '^[0-9a-f]{40}$') "Android build commit is explicit." "Android build requires a full Git commit."
    $env:IMAGE_STUDIO_GIT_COMMIT = $buildCommit
    $env:IMAGE_STUDIO_BUILD_ID = $BuildId
  }

  $buildTools = @(Get-ChildItem -LiteralPath (Join-Path $sdkRoot "build-tools") -Directory -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name)
  $environmentInfo = [ordered]@{
    node = Get-ToolVersion "node.exe" @("--version")
    npm = Get-ToolVersion "npm.cmd" @("--version")
    java = Get-ToolVersion "java.exe" @("-version") '^(openjdk|java) version'
    gradle = Get-ToolVersion $gradle @("--version", "--console=plain") '^Gradle\s+8\.7$'
    androidSdkRoot = $sdkRoot
    buildTools = $buildTools
  }
  Add-AssertionStep "node-24.13.1" ($environmentInfo.node -eq "v24.13.1") "Node 24.13.1 is active." "Node 24.13.1 is required."
  Add-AssertionStep "jdk-17" ($environmentInfo.java -match 'version "17(?:\.|\")') "JDK 17 is active." "JDK 17 is required."
  Add-AssertionStep "gradle-8.7" ($environmentInfo.gradle -eq "Gradle 8.7") "Gradle 8.7 is active." "Gradle 8.7 is required."
  Add-AssertionStep "build-tools-34-present" ($buildTools -contains "34.0.0") "Android Build Tools 34.0.0 is installed." "Android Build Tools 34.0.0 is missing."

  if ($Stage -eq "Release") {
    $isSeparateRoot = -not $executionRoot.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)
    $isAsciiPath = -not [regex]::IsMatch($executionRoot, '[^\x00-\x7F]')
    $releaseDirty = @(& git -C $executionRoot status --porcelain 2>$null)
    $releaseHead = (& git -C $executionRoot rev-parse HEAD 2>$null) -join ""
    $stalePaths = @(@(
      (Join-Path $executionRoot "image-studio\frontend\dist"),
      (Join-Path $executionRoot "android-shell\app\build"),
      (Join-Path $executionRoot "dist")
    ) | Where-Object { Test-Path -LiteralPath $_ })
    $staleApks = @(Get-ChildItem -LiteralPath $executionRoot -Filter "*.apk" -File -Recurse -ErrorAction SilentlyContinue)
    Add-AssertionStep "release-staging-is-separate" $isSeparateRoot "Release staging is separate from the development repository." "Release staging must not be the development repository."
    Add-AssertionStep "release-staging-path-is-ascii" $isAsciiPath "Release staging path is ASCII-only." "Release staging path must be ASCII-only."
    Add-AssertionStep "release-staging-is-git" ([bool]$releaseHead) "Release staging has a Git HEAD." "Release staging is not a readable Git checkout."
    Add-AssertionStep "release-staging-is-clean" ($releaseDirty.Count -eq 0) "Release staging Git worktree is clean." "Release staging Git worktree is dirty."
    Add-AssertionStep "release-staging-expected-commit" ($ExpectedCommit -match '^[0-9a-fA-F]{40}$' -and $releaseHead -eq $ExpectedCommit) "Release staging HEAD matches the expected final commit." "Release requires -ExpectedCommit matching the staging HEAD."
    Add-AssertionStep "release-staging-has-no-old-output" (($stalePaths.Count + $staleApks.Count) -eq 0) "Release staging has no old build output or APK." "Release staging contains old build output or APK files."

    $acceptanceExists = $LiveAcceptanceReport.Trim() -and (Test-Path -LiteralPath $LiveAcceptanceReport -PathType Leaf)
    $acceptanceRootExists = $LiveAcceptanceEvidenceRoot.Trim() -and (Test-Path -LiteralPath $LiveAcceptanceEvidenceRoot -PathType Container)
    Add-AssertionStep "live-acceptance-report-present" $acceptanceExists "Live API acceptance report exists." "Release requires -LiveAcceptanceReport."
    Add-AssertionStep "live-acceptance-evidence-root-present" $acceptanceRootExists "Live API raw evidence root exists." "Release requires -LiveAcceptanceEvidenceRoot."
    if ($acceptanceExists -and $acceptanceRootExists) {
      $acceptance = Get-Content -Raw -Encoding UTF8 $LiveAcceptanceReport | ConvertFrom-Json
      $acceptanceHashForVerification = (([string]$acceptance.apkSha256) -replace ':|\s', '').ToUpperInvariant()
      Invoke-AuditStep "live-acceptance-raw-evidence" $executionRoot "powershell.exe" @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $executionRoot "scripts\finalize-android-emulator-acceptance.ps1"),
        "-Mode", "Verify",
        "-EvidenceRoot", (Resolve-Path -LiteralPath $LiveAcceptanceEvidenceRoot).Path,
        "-AggregateReport", (Resolve-Path -LiteralPath $LiveAcceptanceReport).Path,
        "-ExpectedApkSha256", $acceptanceHashForVerification,
        "-ExpectedGitCommit", $releaseHead,
        "-ExpectedBuildId", $BuildId
      )
      $acceptance = Get-Content -Raw -Encoding UTF8 $LiveAcceptanceReport | ConvertFrom-Json
      $liveAcceptance = $acceptance
      $slotDistribution = [ordered]@{}
      $allSlotsPresent = $true
      foreach ($slot in 1..10) {
        $label = "FHL$slot"
        $property = $acceptance.slotDistribution.PSObject.Properties[$label]
        $count = if ($property) { [int]$property.Value } else { 0 }
        $slotDistribution[$label] = $count
        if ($count -lt 1) { $allSlotsPresent = $false }
      }
      $requiredScenarioJobs = [ordered]@{
        singleClick = 1
        tenSlotRoundRobin = 10
        pool40 = 40
        queue60 = 60
        homeBackground = 10
        coldStartInterrupt = 10
        api36Stability = 80
        api28 = 1
        api34Phone = 1
        api34Tablet = 1
        api36 = 1
        offlineFailureAttribution = 1
      }
      $allScenariosPassed = $true
      $scenarioCountsMatch = $true
      foreach ($scenario in $requiredScenarioJobs.Keys) {
        $property = $acceptance.scenarios.PSObject.Properties[$scenario]
        if (-not $property -or -not [bool]$property.Value) { $allScenariosPassed = $false }
        $countProperty = $acceptance.scenarioJobs.PSObject.Properties[$scenario]
        if (-not $countProperty -or [int]$countProperty.Value -ne [int]$requiredScenarioJobs[$scenario]) {
          $scenarioCountsMatch = $false
        }
      }
      $acceptanceStatusPassed = [string]$acceptance.status -eq "passed"
      $releaseEvidenceSource = [string]$acceptance.evidenceSource -eq "ReleaseLogcat"
      $acceptanceHash = (([string]$acceptance.apkSha256) -replace ':|\s', '').ToUpperInvariant()
      $installedAcceptanceHash = (([string]$acceptance.installedApkSha256) -replace ':|\s', '').ToUpperInvariant()
      $acceptanceCertificate = (([string]$acceptance.apkCertificateSha256) -replace ':|\s', '').ToLowerInvariant()
      $acceptanceCommit = ([string]$acceptance.candidateGitCommit).ToLowerInvariant()
      $acceptanceVerifierCommit = ([string]$acceptance.verifierGitCommit).ToLowerInvariant()
      $expectedServiceIdentity = "android-V2.0.3-$($releaseHead.ToLowerInvariant())-$BuildId"
      $bindingMatches =
        $acceptanceHash -match '^[0-9A-F]{64}$' -and
        $installedAcceptanceHash -eq $acceptanceHash -and
        $acceptanceCommit -eq $releaseHead.ToLowerInvariant() -and
        $acceptanceVerifierCommit -match '^[0-9a-f]{40}$' -and
        [string]$acceptance.apkBuildId -eq $BuildId -and
        [string]$acceptance.apkServiceIdentity -eq $expectedServiceIdentity -and
        [string]$acceptance.package -eq "top.fangtangyuan.fhlstudio.android" -and
        $acceptanceCertificate -eq $officialReleaseCertificateSha256 -and
        ([string]$acceptance.apkDebuggable).ToLowerInvariant() -eq "false"
      $emulatorVerified = [bool]$acceptance.emulator.verified
      $realDeviceVerified = [bool]$acceptance.realDevice.verified
      $releaseStateMatches = [string]$acceptance.releaseState -eq "emulator-complete-pending-real-device"
      Add-AssertionStep "live-acceptance-status" $acceptanceStatusPassed "Live API acceptance status is passed." "Live API acceptance status is not passed."
      Add-AssertionStep "live-acceptance-source" $releaseEvidenceSource "Live API acceptance uses ReleaseLogcat." "Live API acceptance must use ReleaseLogcat."
      Add-AssertionStep "live-acceptance-exact-jobs" ([bool]$acceptance.executed -and [int]$acceptance.totalJobs -eq 216) "Live API acceptance has exactly 216 jobs." "Live API acceptance must contain exactly 216 executed jobs."
      Add-AssertionStep "live-acceptance-all-slots" $allSlotsPresent "Live API acceptance includes FHL1 through FHL10." "Live API acceptance is missing one or more FHL slots."
      Add-AssertionStep "live-acceptance-scenarios" $allScenariosPassed "All required live scenarios passed." "One or more required live scenarios did not pass."
      Add-AssertionStep "live-acceptance-scenario-counts" $scenarioCountsMatch "Every live scenario has its exact required task count." "One or more live scenarios has the wrong task count."
      Add-AssertionStep "live-acceptance-binding" $bindingMatches "Live API acceptance is bound to the product commit, Build ID, package, certificate, and installed APK hash." "Live API acceptance binding is incomplete or mismatched."
      Add-AssertionStep "live-acceptance-emulator" ($emulatorVerified -and -not $realDeviceVerified -and $releaseStateMatches) "Emulator acceptance is complete and explicitly pending real-device confirmation." "Acceptance state must be emulator-complete-pending-real-device with no real-device claim."
      $liveApiResult = [ordered]@{
        executed = [bool]$acceptance.executed
        totalJobs = [int]$acceptance.totalJobs
        slotDistribution = [pscustomobject]$slotDistribution
        evidenceSource = [string]$acceptance.evidenceSource
        apkSha256 = $acceptanceHash
        candidateGitCommit = $acceptanceCommit
        verifierGitCommit = $acceptanceVerifierCommit
        emulatorVerified = $emulatorVerified
        realDeviceVerified = $realDeviceVerified
        releaseState = [string]$acceptance.releaseState
        reportPath = (Resolve-Path -LiteralPath $LiveAcceptanceReport).Path
      }
    }

    $env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND = "0"
    Invoke-AuditStep "frontend-npm-ci" $frontendRoot "npm.cmd" @("ci")
    if (Test-Path -LiteralPath (Join-Path $workerRoot "package-lock.json")) {
      Invoke-AuditStep "worker-npm-ci" $workerRoot "npm.cmd" @("ci")
    }
    Invoke-AuditStep "android-clean" $androidRoot $gradle @("clean", "--no-daemon", "--console=plain", "--stacktrace")
  }

  Invoke-AuditStep "frontend-tests" $frontendRoot "npm.cmd" @("test")
  [void](Read-NodeTestSummary "frontend-tests")
  Invoke-AuditStep "frontend-typescript" $frontendRoot (Join-Path $frontendRoot "node_modules\.bin\tsc.cmd") @("--noEmit", "--pretty", "false")
  Invoke-AuditStep "worker-check" $workerRoot "npm.cmd" @("run", "check")
  Invoke-AuditStep "worker-tests" $workerRoot "npm.cmd" @("test")
  [void](Read-NodeTestSummary "worker-tests")
  if ($Stage -in @("Full", "Release")) {
    Invoke-AuditStep "frontend-android-build" $frontendRoot "npm.cmd" @("run", "build:android")
    $env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND = "1"
  }
  Invoke-AuditStep "android-jvm-tests" $androidRoot $gradle @(
    ":app:testDebugUnitTest",
    "--no-daemon",
    "--console=plain",
    "--stacktrace"
  )
  $jvmSummary = Read-AndroidJvmSummary $realAndroidRoot
  Add-AssertionStep "android-jvm-tests-present" ($jvmSummary.tests -gt 0) "Android JVM tests executed: $($jvmSummary.tests)." "Android JVM test task executed zero tests."

  if ($Stage -in @("Full", "Release")) {
    Invoke-AuditStep "android-compat" $compatFrontendRoot "npm.cmd" @("run", "test:android-compat:full")
    Invoke-AuditStep "android-lint" $androidRoot $gradle @(
      ":app:lintDebug",
      "--no-daemon",
      "--console=plain",
      "--stacktrace"
    )
    Invoke-AuditStep "android-debug-build" $androidRoot $gradle @(
      ":app:assembleDebug",
      "--no-daemon",
      "--console=plain",
      "--stacktrace"
    )

    $debugApk = Join-Path $realAndroidRoot "app\build\outputs\apk\debug\app-debug.apk"
    $debugBuildPassed = (Get-Step "android-debug-build").exitCode -eq 0
    $debugApkPresent = $debugBuildPassed -and (Test-Path -LiteralPath $debugApk)
    Add-AssertionStep "debug-apk-present" $debugApkPresent "Fresh Debug APK exists." "The current Debug build did not produce an APK: $debugApk"
    if ($debugApkPresent) {
      $manifestFields = [ordered]@{
        applicationId = "application-id"
        versionName = "version-name"
        versionCode = "version-code"
        minSdk = "min-sdk"
        targetSdk = "target-sdk"
        debuggable = "debuggable"
      }
      foreach ($entry in $manifestFields.GetEnumerator()) {
        Invoke-AuditStep "debug-manifest-$($entry.Key)" $executionRoot $apkanalyzer @("manifest", $entry.Value, $debugApk)
      }
      $debugApkMetadata = [ordered]@{
        path = $debugApk
        sizeBytes = (Get-Item -LiteralPath $debugApk).Length
        sha256 = (Get-FileHash -LiteralPath $debugApk -Algorithm SHA256).Hash
        applicationId = Read-StepOutput "debug-manifest-applicationId"
        versionName = Read-StepOutput "debug-manifest-versionName"
        versionCode = Read-StepOutput "debug-manifest-versionCode"
        minSdk = Read-StepOutput "debug-manifest-minSdk"
        targetSdk = Read-StepOutput "debug-manifest-targetSdk"
        debuggable = Read-StepOutput "debug-manifest-debuggable"
      }
      $debugMetadataMatches =
        $debugApkMetadata.applicationId -eq "top.fangtangyuan.fhlstudio.android.debug" -and
        $debugApkMetadata.versionName -eq "V2.0.3-debug" -and
        $debugApkMetadata.versionCode -eq "1050003" -and
        $debugApkMetadata.minSdk -eq "28" -and
        $debugApkMetadata.targetSdk -eq "34" -and
        $debugApkMetadata.debuggable -eq "true"
      Add-AssertionStep "debug-apk-metadata" $debugMetadataMatches "Debug APK metadata matches V2.0.3." "Debug APK metadata does not match the V2.0.3 contract."
      $expectedServiceIdentity = "android-V2.0.3-$buildCommit-$BuildId"
      $serviceIdentity = Read-AndroidServiceIdentity -ApkPath $debugApk -ExpectedIdentity $expectedServiceIdentity
      $debugApkMetadata["serviceIdentity"] = $serviceIdentity
      Add-AssertionStep "debug-service-identity" $serviceIdentity.expectedPresent "Debug APK contains the deterministic Android service identity." "Debug APK does not contain the expected deterministic Android service identity."
      Add-AssertionStep "debug-random-service-identity-absent" ($serviceIdentity.randomIdentityCount -eq 0) "Debug APK contains no random Vite service identity." "Debug APK still contains a random Vite service identity."
    }
  }

  if ($Stage -eq "Release") {
    foreach ($required in @(
      "IMAGE_STUDIO_KEYSTORE_PATH",
      "IMAGE_STUDIO_KEYSTORE_PASSWORD",
      "IMAGE_STUDIO_KEY_ALIAS",
      "IMAGE_STUDIO_KEY_PASSWORD"
    )) {
      $present = [bool][Environment]::GetEnvironmentVariable($required)
      Add-AssertionStep "release-env-$($required.ToLowerInvariant())" $present "$required is set." "$required is missing."
    }

    Invoke-AuditStep "release-safety-source" $executionRoot "powershell.exe" @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", (Join-Path $executionRoot "scripts\check-android-release-safety.ps1"),
      "-Root", $executionRoot
    )
    Invoke-AuditStep "android-release-build" $androidRoot $gradle @(
      ":app:assembleRelease",
      "--no-daemon",
      "--console=plain",
      "--stacktrace"
    )

    $releaseApk = Join-Path $realAndroidRoot "app\build\outputs\apk\release\app-release.apk"
    $apksigner = Join-Path $sdkRoot "build-tools\34.0.0\apksigner.bat"
    $releaseBuildPassed = (Get-Step "android-release-build").exitCode -eq 0
    $releaseApkPresent = $releaseBuildPassed -and (Test-Path -LiteralPath $releaseApk)
    Add-AssertionStep "release-apk-present" $releaseApkPresent "Fresh Release APK exists." "The current Release build did not produce an APK: $releaseApk"
    Add-AssertionStep "apksigner-present" (Test-Path -LiteralPath $apksigner) "apksigner exists." "apksigner is missing: $apksigner"
    if ($releaseApkPresent -and (Test-Path -LiteralPath $apksigner)) {
      Invoke-AuditStep "release-signature" $executionRoot $apksigner @("verify", "--verbose", "--print-certs", $releaseApk)
      $releaseManifestFields = [ordered]@{
        applicationId = "application-id"
        versionName = "version-name"
        versionCode = "version-code"
        minSdk = "min-sdk"
        targetSdk = "target-sdk"
        debuggable = "debuggable"
      }
      foreach ($entry in $releaseManifestFields.GetEnumerator()) {
        Invoke-AuditStep "release-manifest-$($entry.Key)" $executionRoot $apkanalyzer @("manifest", $entry.Value, $releaseApk)
      }
      $releaseApkMetadata = [ordered]@{
        path = $releaseApk
        sizeBytes = (Get-Item -LiteralPath $releaseApk).Length
        sha256 = (Get-FileHash -LiteralPath $releaseApk -Algorithm SHA256).Hash
        applicationId = Read-StepOutput "release-manifest-applicationId"
        versionName = Read-StepOutput "release-manifest-versionName"
        versionCode = Read-StepOutput "release-manifest-versionCode"
        minSdk = Read-StepOutput "release-manifest-minSdk"
        targetSdk = Read-StepOutput "release-manifest-targetSdk"
        debuggable = Read-StepOutput "release-manifest-debuggable"
      }
      $releaseMetadataMatches =
        $releaseApkMetadata.applicationId -eq "top.fangtangyuan.fhlstudio.android" -and
        $releaseApkMetadata.versionName -eq "V2.0.3" -and
        $releaseApkMetadata.versionCode -eq "1050003" -and
        $releaseApkMetadata.minSdk -eq "28" -and
        $releaseApkMetadata.targetSdk -eq "34" -and
        $releaseApkMetadata.debuggable -eq "false"
      Add-AssertionStep "release-apk-metadata" $releaseMetadataMatches "Release APK metadata matches V2.0.3." "Release APK metadata does not match the V2.0.3 contract."

      $signatureText = Get-Content -Raw -Encoding UTF8 (Join-Path $ReportRoot (Get-Step "release-signature").logPath)
      $signatureMatch = [regex]::Match($signatureText, '(?i)certificate SHA-256 digest:\s*([0-9a-f]{64})')
      $actualCertificate = if ($signatureMatch.Success) { $signatureMatch.Groups[1].Value.ToLowerInvariant() } else { "" }
      $v2SignatureMatch = [regex]::Match($signatureText, '(?im)^Verified using v2 scheme[^:]*:\s*(true|false)\s*$')
      $releaseV2Signed = $v2SignatureMatch.Success -and $v2SignatureMatch.Groups[1].Value.ToLowerInvariant() -eq "true"
      Add-AssertionStep "release-certificate-sha256" ($actualCertificate -eq $officialReleaseCertificateSha256) "Release certificate SHA-256 matches." "Release certificate SHA-256 does not match."
      Add-AssertionStep "release-signature-v2" $releaseV2Signed "Release APK uses APK Signature Scheme v2." "Release APK must use APK Signature Scheme v2."
      $expectedReleaseIdentity = "android-V2.0.3-$buildCommit-$BuildId"
      $releaseServiceIdentity = Read-AndroidServiceIdentity -ApkPath $releaseApk -ExpectedIdentity $expectedReleaseIdentity
      $releaseApkMetadata["serviceIdentity"] = $releaseServiceIdentity
      $releaseApkMetadata["certificateSha256"] = $actualCertificate
      $releaseApkMetadata["signatureV2"] = $releaseV2Signed
      Add-AssertionStep "release-service-identity" $releaseServiceIdentity.expectedPresent "Release APK contains the deterministic Android service identity." "Release APK does not contain the expected deterministic Android service identity."
      Add-AssertionStep "release-random-service-identity-absent" ($releaseServiceIdentity.randomIdentityCount -eq 0) "Release APK contains no random Vite service identity." "Release APK still contains a random Vite service identity."
      if ($null -ne $liveAcceptance) {
        $acceptanceMatchesBuiltApk =
          ((([string]$liveAcceptance.apkSha256) -replace ':|\s', '').ToUpperInvariant()) -eq ([string]$releaseApkMetadata.sha256).ToUpperInvariant() -and
          ((([string]$liveAcceptance.installedApkSha256) -replace ':|\s', '').ToUpperInvariant()) -eq ([string]$releaseApkMetadata.sha256).ToUpperInvariant() -and
          [string]$liveAcceptance.apkServiceIdentity -eq $expectedReleaseIdentity -and
          (([string]$liveAcceptance.apkCertificateSha256) -replace ':', '').ToLowerInvariant() -eq $actualCertificate
        Add-AssertionStep "live-acceptance-built-apk" $acceptanceMatchesBuiltApk "The 216-task acceptance report matches this exact Release APK." "The 216-task acceptance report does not match this exact Release APK."
      }

      Invoke-AuditStep "release-safety-apk" $executionRoot "powershell.exe" @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $executionRoot "scripts\check-android-release-safety.ps1"),
        "-Root", $executionRoot,
        "-ZipPath", $releaseApk
      )
    }
  }
} catch {
  $fatalMessage = $_.Exception.Message
}

if ($mappedDrive) {
  $global:LASTEXITCODE = 0
  $null = & subst.exe $mappedDrive /D 2>&1
  if ($LASTEXITCODE -ne 0 -and -not $fatalMessage) {
    $fatalMessage = "Failed to remove temporary drive mapping $mappedDrive."
  }
}
if ($null -eq $previousPrebuiltFrontend) {
  Remove-Item Env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND -ErrorAction SilentlyContinue
} else {
  $env:IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND = $previousPrebuiltFrontend
}
if ($null -eq $previousGitCommit) {
  Remove-Item Env:IMAGE_STUDIO_GIT_COMMIT -ErrorAction SilentlyContinue
} else {
  $env:IMAGE_STUDIO_GIT_COMMIT = $previousGitCommit
}
if ($null -eq $previousBuildId) {
  Remove-Item Env:IMAGE_STUDIO_BUILD_ID -ErrorAction SilentlyContinue
} else {
  $env:IMAGE_STUDIO_BUILD_ID = $previousBuildId
}

$branch = (& git -C $executionRoot branch --show-current 2>$null) -join ""
$head = (& git -C $executionRoot rev-parse HEAD 2>$null) -join ""
$dirtyLines = @(& git -C $executionRoot status --short 2>$null)
$finishedAt = Get-Date
$failedSteps = @($script:steps | Where-Object { $_.exitCode -ne 0 })
$passed = (-not $fatalMessage) -and ($failedSteps.Count -eq 0)
$reportedSourceRoot = $executionRoot
if ($Stage -eq "Release") {
  $reportedSourceRoot = "<release-staging>"
  $environmentInfo.androidSdkRoot = "<android-sdk>"
  foreach ($step in $script:steps) {
    $step.command = $step.command.Replace($executionRoot, "<release-staging>")
    if ($LiveAcceptanceEvidenceRoot.Trim() -and (Test-Path -LiteralPath $LiveAcceptanceEvidenceRoot)) {
      $step.command = $step.command.Replace((Resolve-Path -LiteralPath $LiveAcceptanceEvidenceRoot).Path, "<acceptance-evidence>")
    }
    if ($LiveAcceptanceReport.Trim() -and (Test-Path -LiteralPath $LiveAcceptanceReport)) {
      $step.command = $step.command.Replace((Resolve-Path -LiteralPath $LiveAcceptanceReport).Path, "<acceptance-report>")
    }
  }
  if ($debugApkMetadata) { $debugApkMetadata.path = "android-shell/app/build/outputs/apk/debug/app-debug.apk" }
  if ($releaseApkMetadata) { $releaseApkMetadata.path = "android-shell/app/build/outputs/apk/release/app-release.apk" }
  if ($liveApiResult.reportPath) { $liveApiResult.reportPath = Split-Path -Leaf $liveApiResult.reportPath }
  if ($fatalMessage) { $fatalMessage = $fatalMessage.Replace($executionRoot, "<release-staging>") }
}
$result = [ordered]@{
  schemaVersion = 1
  mode = $Stage
  runId = "$stamp-$($Stage.ToLowerInvariant())"
  startedAt = $startedAt.ToString("o")
  finishedAt = $finishedAt.ToString("o")
  durationMs = [math]::Round(($finishedAt - $startedAt).TotalMilliseconds, 0)
  overall = if ($passed) { "passed" } else { "failed" }
  sourceRoot = $reportedSourceRoot
  git = [ordered]@{
    branch = $branch
    head = $head
    dirtyCount = $dirtyLines.Count
  }
  environment = $environmentInfo
  checks = $script:steps
  apk = [ordered]@{
    debug = $debugApkMetadata
    release = $releaseApkMetadata
  }
  liveApi = $liveApiResult
  releaseDisposition = if ($Stage -eq "Release" -and $passed) { "emulator-complete-pending-real-device" } else { "not-ready" }
  publishAllowed = $false
  failure = $fatalMessage
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $ReportRoot "audit-report.json") -Encoding UTF8

$markdown = New-Object System.Collections.Generic.List[string]
$markdown.Add("# Android V2.0.3 $Stage Verification")
$markdown.Add("")
$markdown.Add("- Result: **$($result.overall)**")
$markdown.Add("- Branch: ``$branch``")
$markdown.Add("- Commit: ``$head``")
$markdown.Add("- Source: ``$reportedSourceRoot``")
$markdown.Add("- Duration: $($result.durationMs) ms")
$markdown.Add("- Dirty entries: $($dirtyLines.Count)")
$markdown.Add("- Live API jobs: $($liveApiResult.totalJobs)$(if ($liveApiResult.executed) { ' (imported acceptance evidence)' } else { ' (not executed by this script)' })")
$markdown.Add("- Release disposition: ``$($result.releaseDisposition)``")
$markdown.Add("- Public publishing allowed: ``false``")
if ($fatalMessage) { $markdown.Add("- Fatal error: $fatalMessage") }
$markdown.Add("")
$markdown.Add("| Check | Status | Exit | Duration ms | Tests | Log |")
$markdown.Add("|---|---|---:|---:|---:|---|")
foreach ($step in $script:steps) {
  $testCount = if ($step.tests -and $null -ne $step.tests.tests) { $step.tests.tests } else { "" }
  $markdown.Add("| $($step.id) | $($step.status) | $($step.exitCode) | $($step.durationMs) | $testCount | $($step.logPath) |")
}
if ($debugApkMetadata) {
  $markdown.Add("")
  $markdown.Add("## Debug APK")
  $markdown.Add("")
  $markdown.Add("- Path: ``$($debugApkMetadata.path)``")
  $markdown.Add("- SHA-256: ``$($debugApkMetadata.sha256)``")
  $markdown.Add("- Application ID: ``$($debugApkMetadata.applicationId)``")
  $markdown.Add("- Version: ``$($debugApkMetadata.versionName) / $($debugApkMetadata.versionCode)``")
  $markdown.Add("- SDK: ``min $($debugApkMetadata.minSdk) / target $($debugApkMetadata.targetSdk)``")
}
if ($releaseApkMetadata) {
  $markdown.Add("")
  $markdown.Add("## Release APK")
  $markdown.Add("")
  $markdown.Add("- Path: ``$($releaseApkMetadata.path)``")
  $markdown.Add("- SHA-256: ``$($releaseApkMetadata.sha256)``")
  $markdown.Add("- Application ID: ``$($releaseApkMetadata.applicationId)``")
  $markdown.Add("- Version: ``$($releaseApkMetadata.versionName) / $($releaseApkMetadata.versionCode)``")
  $markdown.Add("- SDK: ``min $($releaseApkMetadata.minSdk) / target $($releaseApkMetadata.targetSdk)``")
}
$markdown | Set-Content -LiteralPath (Join-Path $ReportRoot "audit-report.md") -Encoding UTF8

Write-Host "Android V2.0.3 $Stage report: $ReportRoot"
if (-not $passed) {
  exit 1
}
