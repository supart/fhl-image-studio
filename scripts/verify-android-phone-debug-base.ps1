<#
.SYNOPSIS
Verifies one frozen Android V2.0.3 Debug APK without clearing app data or changing the pool cursor directly.

.DESCRIPTION
FreshInstall requires the package to be absent, installs it once, and verifies the empty default state.
Upgrade requires an installed baseline APK, captures a redacted configured-state snapshot, installs the
candidate with adb install -r, and proves that the configured state and encrypted credentials survive.
Preflight performs no generation. Startup observes the first configured process launch for at least 30 seconds.
Sequential submits ten tasks from the current persisted cursor. ResumeExistingSequential can recover
one interrupted host-side Sequential checkpoint without repeating accepted native tasks.
Pool40 and Queue60 submit four or six complete ten-slot UI cycles against one external frozen APK.
They never build the APK. Each ten-click block is fail-closed and is never replayed after a CDP error.
CompatibilitySingle is an isolated
API 28 compatibility check: it accepts only configured FHL1, proves CTA/navigation geometry, then
submits one task. It is not evidence for the formal ten-slot gate. ColdStart force-stops one confirmed
in-flight direct task and requires interruption with zero new POST attempts after restart.
CompatibilityWorkflow is a zero-submit API 28 UI workflow. It reuses the newest successful history
image, exercises canvas annotations and local image transforms, saves the result, then reuses history
again. It fails if any native group, task, or upstream POST appears.
MatrixSingle is an isolated one-slot phone/tablet Images check. It observes 30 seconds with no work,
then performs one one-shot official FHL submission through the visible phone or tablet compose action.
Use PromptFile for a custom prompt so prompt content never appears in the process command line.

.EXAMPLE
.\scripts\verify-android-phone-debug-base.ps1 -Scenario Preflight -ApkPath <candidate.apk> -ExpectedApkSha256 <sha256> -Device emulator-5554
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("FreshInstall", "Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "Preflight", "Single", "Sequential", "Pool40", "Queue60", "Startup", "MatrixStartup", "MatrixSingle", "Offline", "Home", "ColdStart", "CompatibilitySingle", "CompatibilityWorkflow")]
    [string]$Scenario,

    [Parameter(Mandatory = $true)]
    [string]$ApkPath,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedApkSha256,

    [string]$ExpectedBaselineApkSha256 = "",

    [string]$ExpectedGitCommit = "",

    [ValidateSet("images", "responses")]
    [string]$ExpectedFHLTransportMode = "images",

    [ValidateSet("DebugRunAs", "ReleaseLogcat")]
    [string]$EvidenceSource = "DebugRunAs",

    [ValidateSet("", "singleClick", "tenSlotRoundRobin", "pool40", "queue60", "homeBackground", "coldStartInterrupt", "api36Stability", "api28", "api34Phone", "api34Tablet", "api36", "offlineFailureAttribution")]
    [string]$AcceptanceRole = "",

    [string]$Adb = "adb",
    [string]$Device = "emulator-5554",
    [string]$Package = "top.fangtangyuan.fhlstudio.android.debug",
    [string]$PromptFile = "",
    [string]$WorkspaceId = "",
    [string]$OutputDirectory = "",
    [int]$CdpPort = 9225,
    [int]$TerminalTimeoutSeconds = 480,
    [int]$ObservationSeconds = 30,
    [switch]$SkipInstall,
    [switch]$FinalizeExistingSequential,
    [switch]$ResumeExistingSequential,
    [switch]$ResumeAuditOnly,
    [switch]$StabilityFinalRun,
    [switch]$RunInternalLoadAuditSelfTest,
    [switch]$RunInternalResponsesCapabilityAuditSelfTest
)

$ErrorActionPreference = "Stop"

$script:AdbExecutable = $null
$script:ForwardEstablished = $false
$script:ForwardPrepared = $false
$script:PreviousForwardRemote = ""
$script:BaselineRegistry = $null
$script:BaselineAttempts = @()
$script:ResolvedWorkspaceId = ""
$script:MeasurementBaselineReady = $false
$script:AirplaneModeChanged = $false
$script:LastNetworkValidationSource = ""
$script:LoadAuditBaselineIdentities = $null
$script:LoadAuditEvents = [ordered]@{}
$script:LoadAuditCaptureOrder = 0
$script:LoadHostSamples = @()
$script:LoadCheckpoint = $null
$script:ResolvedApkCertificateSha256 = ""
$script:ResolvedApkDebuggable = $null
$script:RuntimeMetricsBefore = $null
$script:UpgradeBeforeSnapshot = $null
$script:ReleaseLogcatProcessIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$terminalStatuses = @("succeeded", "failed", "cancelled", "interrupted")
$sequentialMinimumIntervalMilliseconds = 7000L
$responsesCapabilityMinimumIntervalMilliseconds = 7000L
$responsesCapabilitySlotTimeoutSeconds = 120
$transportPreferenceDurabilityWaitSeconds = 5
$repoRoot = Split-Path -Parent $PSScriptRoot
$officialReleaseCertificateSha256 = "6B04A805E50CF66E37C740AD0336BBDF6445653F93802005967BABF472E8DA36"
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot "artifacts\android-phone-debug-base\$runStamp-$($Scenario.ToLowerInvariant())"
}
$reportPath = Join-Path $OutputDirectory "acceptance-report.json"
$markdownPath = Join-Path $OutputDirectory "README.md"
$attemptsPath = Join-Path $OutputDirectory "upstream-submit-attempts.json"
$loadAuditPath = Join-Path $OutputDirectory "native-scheduler-audit.json"
$loadSamplesPath = Join-Path $OutputDirectory "host-queue-samples.json"
$loadMetricsPath = Join-Path $OutputDirectory "scheduler-metrics.json"
$loadCheckpointPath = Join-Path $OutputDirectory "load-checkpoint.json"
$releaseLogcatPath = Join-Path $OutputDirectory "release-logcat-audit-redacted.txt"
$evidenceManifestPath = Join-Path $OutputDirectory "evidence-manifest.json"
$deviceRuntimeMetricsPath = Join-Path $OutputDirectory "device-runtime-metrics.json"
$crashAnrLogcatPath = Join-Path $OutputDirectory "crash-anr-logcat-redacted.txt"
$compatibilityWorkflowScreenshotPath = Join-Path $OutputDirectory "compatibility-workflow-final.png"
$compatibilityWorkflowLogcatPath = Join-Path $OutputDirectory "compatibility-workflow-logcat-redacted.txt"
$resumeSnapshotPath = Join-Path $OutputDirectory "host-timeout-recovery-snapshot.json"
$resumeAuditPath = Join-Path $OutputDirectory "sequential-resume-audit.json"
$resumeJournalPath = Join-Path $OutputDirectory "sequential-resume-journal.json"
$resumeClickPath = Join-Path $OutputDirectory "fhl4-click-checkpoint.json"
$resumeFailurePath = Join-Path $OutputDirectory "sequential-resume-failure.json"
if ($EvidenceSource -eq "ReleaseLogcat" -and (Test-Path -LiteralPath $OutputDirectory)) {
    $outputItem = Get-Item -LiteralPath $OutputDirectory -Force
    if (($outputItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "ReleaseLogcat OutputDirectory cannot be a symbolic link or reparse point."
    }
    if (@(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -gt 0) {
        throw "ReleaseLogcat requires a new empty OutputDirectory for every run."
    }
}
$PromptText = "A clean product photograph of a red ceramic sphere on a white studio background."
if (-not [string]::IsNullOrWhiteSpace($PromptFile)) {
    if (-not (Test-Path -LiteralPath $PromptFile -PathType Leaf)) { throw "PromptFile was not found: $PromptFile" }
    $PromptText = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PromptFile).Path, [Text.Encoding]::UTF8).Trim()
}

function ConvertTo-RedactedText {
    param([AllowNull()][object]$Value)

    $text = [string]$Value
    if (-not [string]::IsNullOrWhiteSpace($PromptText)) {
        $text = $text.Replace($PromptText, "<prompt:redacted>")
    }
    $text = [Regex]::Replace($text, "(?i)\bsk-[a-z0-9_-]{12,}\b", "<api-key:redacted>")
    if ($text.Length -gt 500) { return $text.Substring(0, 500) }
    return $text
}

function Write-AtomicJsonArtifact {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText(
            $temporary,
            (ConvertTo-Json -InputObject $Value -Depth 16) + "`n",
            [Text.UTF8Encoding]::new($false)
        )
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

function Get-ApkBuildIdentity {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$GitCommit
    )

    $normalizedCommit = $GitCommit.Trim().ToLowerInvariant()
    if ($normalizedCommit -notmatch "^[0-9a-f]{40}$") {
        throw "APK build identity requires a complete Git commit."
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $identityPrefix = "android-V2.0.3-$normalizedCommit-"
    $identityPattern = [Regex]::new(
        [Regex]::Escape($identityPrefix) + "[A-Za-z0-9._-]+",
        [Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    $identities = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.Length -le 0 -or $entry.Length -gt 8MB -or
                $entry.FullName -notmatch "(?i)^assets/.*\.(?:js|mjs|html|json|txt)$") {
                continue
            }
            $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8, $true)
            try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
            foreach ($match in $identityPattern.Matches($content)) {
                $windowStart = [Math]::Max(0, $match.Index - 160)
                $window = $content.Substring($windowStart, $match.Index - $windowStart)
                if ($window.Contains("IMAGE_STUDIO_SERVICE_INSTANCE_ID")) {
                    [void]$identities.Add($match.Value)
                }
            }
        }
    }
    finally {
        $archive.Dispose()
    }
    if ($identities.Count -ne 1) {
        throw "APK does not contain exactly one deterministic service identity for the expected Git commit."
    }
    $serviceIdentity = [string]@($identities)[0]
    $buildId = $serviceIdentity.Substring($identityPrefix.Length)
    if ([string]::IsNullOrWhiteSpace($buildId)) {
        throw "APK deterministic service identity is missing its explicit Build ID."
    }
    return [pscustomobject][ordered]@{
        serviceIdentity = $serviceIdentity
        buildId = $buildId
        gitCommit = $normalizedCommit
    }
}

function ConvertTo-NativeArgument {
    param([AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-NativeProcessCapture {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
        [int]$TimeoutSeconds = 120
    )

    if ($TimeoutSeconds -lt 1) { throw "Native process timeout must be positive." }

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FileName
    $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "Unable to start native process: $FileName" }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { $process.Kill() } catch { }
            $process.WaitForExit()
            throw "Native process timed out after $TimeoutSeconds seconds."
        }
        $process.WaitForExit()
        return [pscustomobject]@{
            exitCode = $process.ExitCode
            stdout = $stdoutTask.GetAwaiter().GetResult()
            stderr = $stderrTask.GetAwaiter().GetResult()
        }
    }
    finally {
        $process.Dispose()
    }
}

function Resolve-AdbExecutable {
    if (Test-Path -LiteralPath $Adb -PathType Leaf) {
        return (Resolve-Path -LiteralPath $Adb).Path
    }
    $command = Get-Command $Adb -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) { throw "adb was not found: $Adb" }
    return $command.Source
}

function Resolve-AndroidSdkRoot {
    foreach ($candidate in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate) -and
            (Test-Path -LiteralPath $candidate -PathType Container)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    $platformTools = Split-Path -Parent $script:AdbExecutable
    $fromAdb = Split-Path -Parent $platformTools
    if (Test-Path -LiteralPath $fromAdb -PathType Container) { return $fromAdb }
    throw "Android SDK root could not be resolved from ANDROID_SDK_ROOT, ANDROID_HOME, or adb."
}

function Resolve-AndroidSdkTool {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("apkanalyzer", "apksigner")][string]$Name,
        [Parameter(Mandatory = $true)][string]$SdkRoot
    )

    $command = Get-Command "$Name.bat" -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) { return $command.Source }
    if ($Name -eq "apkanalyzer") {
        $preferred = Join-Path $SdkRoot "cmdline-tools\latest\bin\apkanalyzer.bat"
        if (Test-Path -LiteralPath $preferred -PathType Leaf) { return $preferred }
        $candidates = @(Get-ChildItem -LiteralPath (Join-Path $SdkRoot "cmdline-tools") -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "bin\apkanalyzer.bat" } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    }
    else {
        $preferred = Join-Path $SdkRoot "build-tools\34.0.0\apksigner.bat"
        if (Test-Path -LiteralPath $preferred -PathType Leaf) { return $preferred }
        $candidates = @(Get-ChildItem -LiteralPath (Join-Path $SdkRoot "build-tools") -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "apksigner.bat" } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    }
    if ($candidates.Count -gt 0) { return $candidates[0] }
    throw "$Name was not found in the Android SDK."
}

function Get-ReleaseApkEvidenceMetadata {
    param([Parameter(Mandatory = $true)][string]$Path)

    $sdkRoot = Resolve-AndroidSdkRoot
    $apkanalyzer = Resolve-AndroidSdkTool -Name "apkanalyzer" -SdkRoot $sdkRoot
    $apksigner = Resolve-AndroidSdkTool -Name "apksigner" -SdkRoot $sdkRoot
    $fieldCommands = [ordered]@{
        applicationId = "application-id"
        versionName = "version-name"
        versionCode = "version-code"
        minSdk = "min-sdk"
        targetSdk = "target-sdk"
        debuggable = "debuggable"
    }
    $metadata = [ordered]@{}
    foreach ($field in $fieldCommands.GetEnumerator()) {
        $capture = Invoke-NativeProcessCapture -FileName $apkanalyzer -Arguments @(
            "manifest", [string]$field.Value, $Path
        )
        if ([int]$capture.exitCode -ne 0) {
            throw "apkanalyzer could not read Release APK field $($field.Key)."
        }
        $value = @(([string]$capture.stdout -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 1)
        if ($value.Count -ne 1) { throw "apkanalyzer returned no Release APK field $($field.Key)." }
        $metadata[$field.Key] = [string]$value[0].Trim()
    }
    $signature = Invoke-NativeProcessCapture -FileName $apksigner -Arguments @(
        "verify", "--verbose", "--print-certs", $Path
    )
    if ([int]$signature.exitCode -ne 0) { throw "apksigner rejected the Release APK." }
    $signatureText = "$( [string]$signature.stdout )`n$( [string]$signature.stderr )"
    $certificateMatch = [Regex]::Match(
        $signatureText,
        "(?i)certificate SHA-256 digest:\s*([0-9a-f:]{64,95})"
    )
    if (-not $certificateMatch.Success) { throw "Release certificate SHA-256 could not be read." }
    $v2Match = [Regex]::Match($signatureText, "(?im)^Verified using v2 scheme[^:]*:\s*(true|false)\s*$")
    if (-not $v2Match.Success -or $v2Match.Groups[1].Value.ToLowerInvariant() -ne "true") {
        throw "Release APK is not verified with APK Signature Scheme v2."
    }
    return [pscustomobject][ordered]@{
        applicationId = [string]$metadata.applicationId
        versionName = [string]$metadata.versionName
        versionCode = [string]$metadata.versionCode
        minSdk = [string]$metadata.minSdk
        targetSdk = [string]$metadata.targetSdk
        debuggable = [string]$metadata.debuggable
        certificateSha256 = ($certificateMatch.Groups[1].Value -replace ":", "").ToUpperInvariant()
        signatureV2 = $true
    }
}

function Invoke-AdbText {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $result = Invoke-NativeProcessCapture -FileName $script:AdbExecutable -Arguments $Arguments
    $text = ([string]$result.stdout).Trim()
    if ([int]$result.exitCode -ne 0 -and -not $AllowFailure) {
        $diagnostic = ((@([string]$result.stdout, [string]$result.stderr) | Where-Object { $_.Trim() }) -join "`n").Trim()
        throw "adb failed with exit code $($result.exitCode): $(ConvertTo-RedactedText $diagnostic)"
    }
    return $text
}

function Test-DeviceConnected {
    $devices = Invoke-AdbText -Arguments @("devices")
    return [Regex]::IsMatch($devices, "(?m)^$([Regex]::Escape($Device))\s+device\s*$")
}

function Get-DeviceEvidenceMetadata {
    $sdkText = Invoke-AdbText -Arguments @("-s", $Device, "shell", "getprop", "ro.build.version.sdk")
    $characteristics = Invoke-AdbText -Arguments @("-s", $Device, "shell", "getprop", "ro.build.characteristics") -AllowFailure
    $model = Invoke-AdbText -Arguments @("-s", $Device, "shell", "getprop", "ro.product.model") -AllowFailure
    $sizeText = Invoke-AdbText -Arguments @("-s", $Device, "shell", "wm", "size")
    $densityText = Invoke-AdbText -Arguments @("-s", $Device, "shell", "wm", "density")
    $sizeMatches = [Regex]::Matches($sizeText, "(?im)(?:physical|override) size:\s*(\d+)x(\d+)")
    $densityMatches = [Regex]::Matches($densityText, "(?im)(?:physical|override) density:\s*(\d+)")
    if ($sdkText -notmatch "^\d+$" -or $sizeMatches.Count -eq 0 -or $densityMatches.Count -eq 0) {
        throw "Android device SDK, display size, or density could not be resolved."
    }
    $size = $sizeMatches[$sizeMatches.Count - 1]
    $density = [int]$densityMatches[$densityMatches.Count - 1].Groups[1].Value
    $width = [int]$size.Groups[1].Value
    $height = [int]$size.Groups[2].Value
    if ($density -le 0 -or $width -le 0 -or $height -le 0) { throw "Android device display metadata is invalid." }
    $smallestWidthDp = [int][Math]::Floor(([Math]::Min($width, $height) * 160.0) / $density)
    $formFactor = if ($characteristics -match "(?i)(^|,)tablet(,|$)" -or $smallestWidthDp -ge 600) { "tablet" } else { "phone" }
    return [ordered]@{
        sdkInt = [int]$sdkText
        formFactor = $formFactor
        model = $model.Trim()
        characteristics = $characteristics.Trim()
        widthPx = $width
        heightPx = $height
        densityDpi = $density
        smallestWidthDp = $smallestWidthDp
    }
}

function Get-DeviceRuntimeSnapshot {
    $meminfo = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "meminfo", $Package) -AllowFailure
    $gfxinfo = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "gfxinfo", $Package) -AllowFailure
    $thermal = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "thermalservice") -AllowFailure
    $pssMatch = [Regex]::Match($meminfo, "(?im)^\s*TOTAL PSS:\s*(\d+)")
    if (-not $pssMatch.Success) { $pssMatch = [Regex]::Match($meminfo, "(?im)^\s*TOTAL\s+(\d+)\s+") }
    $framesMatch = [Regex]::Match($gfxinfo, "(?im)^\s*Total frames rendered:\s*(\d+)")
    $jankyMatch = [Regex]::Match($gfxinfo, "(?im)^\s*Janky frames:\s*(\d+)")
    $frozenFrames = 0
    foreach ($match in [Regex]::Matches($gfxinfo, "(?i)(\d+)ms=(\d+)")) {
        if ([int]$match.Groups[1].Value -ge 700) { $frozenFrames += [int]$match.Groups[2].Value }
    }
    $thermalMatch = [Regex]::Match($thermal, "(?im)^\s*Thermal\s+Status:\s*(\d+)\s*$")
    if (-not $pssMatch.Success) { throw "Android runtime PSS could not be captured." }
    return [ordered]@{
        capturedAt = (Get-Date).ToString("o")
        totalPssKiB = [long]$pssMatch.Groups[1].Value
        totalFrames = if ($framesMatch.Success) { [long]$framesMatch.Groups[1].Value } else { 0L }
        jankyFrames = if ($jankyMatch.Success) { [long]$jankyMatch.Groups[1].Value } else { 0L }
        frozenFrames = [long]$frozenFrames
        thermalStatus = if ($thermalMatch.Success) { [int]$thermalMatch.Groups[1].Value } else { -1 }
    }
}

function Save-DeviceRuntimeArtifacts {
    param([Parameter(Mandatory = $true)][object]$Report, [switch]$AllowFailure)

    if ($EvidenceSource -ne "ReleaseLogcat" -or [string]::IsNullOrWhiteSpace([string]$Report.acceptanceRole)) { return }
    try {
        if ($null -eq $script:RuntimeMetricsBefore) { $script:RuntimeMetricsBefore = Get-DeviceRuntimeSnapshot }
        $after = Get-DeviceRuntimeSnapshot
        $rawCrashLog = Invoke-AdbText -Arguments @(
            "-s", $Device, "logcat", "-d", "-v", "epoch", "AndroidRuntime:E", "ActivityManager:E", "*:S"
        ) -AllowFailure
        $crashLines = @($rawCrashLog -split "`r?`n" | Where-Object {
            $_ -match [Regex]::Escape($Package) -and $_ -match "(?i)Process:|ANR in|FATAL EXCEPTION|crash"
        } | ForEach-Object { ConvertTo-RedactedText $_ })
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        [IO.File]::WriteAllLines($crashAnrLogcatPath, $crashLines, [Text.UTF8Encoding]::new($false))
        $runtime = [ordered]@{
            schemaVersion = 1
            before = $script:RuntimeMetricsBefore
            after = $after
            pssDeltaKiB = [long]$after.totalPssKiB - [long]$script:RuntimeMetricsBefore.totalPssKiB
            frozenFrameDelta = [long]$after.frozenFrames - [long]$script:RuntimeMetricsBefore.frozenFrames
            crashOrAnrCount = $crashLines.Count
            noCrashOrAnr = $crashLines.Count -eq 0
        }
        Write-AtomicJsonArtifact -Path $deviceRuntimeMetricsPath -Value $runtime
        $Report.runtimeMetrics = $runtime
        $Report.artifacts["deviceRuntimeMetrics"] = [IO.Path]::GetFileName($deviceRuntimeMetricsPath)
        $Report.artifacts["crashAnrLogcat"] = [IO.Path]::GetFileName($crashAnrLogcatPath)
        if (-not $AllowFailure -and ($crashLines.Count -ne 0 -or [int]$after.thermalStatus -ge 3 -or
            [long]$script:RuntimeMetricsBefore.frozenFrames -ne 0 -or [long]$after.frozenFrames -ne 0 -or
            [long]$runtime.frozenFrameDelta -ne 0)) {
            throw "Release emulator runtime evidence detected a crash, ANR, severe thermal state, or frozen frame."
        }
    }
    catch {
        if (-not $AllowFailure) { throw }
    }
}

function Save-DebugTransportCrashAnrArtifact {
    param([Parameter(Mandatory = $true)][object]$Report, [switch]$AllowFailure)

    if ($EvidenceSource -ne "DebugRunAs" -or $Scenario -notin @("TransportPersistence", "TransportToResponses", "ResponsesCapability")) { return }
    try {
        $rawCrashLog = Invoke-AdbText -Arguments @(
            "-s", $Device, "logcat", "-d", "-v", "epoch", "AndroidRuntime:E", "ActivityManager:E", "*:S"
        ) -AllowFailure
        $crashLines = @($rawCrashLog -split "`r?`n" | Where-Object {
            $_ -match [Regex]::Escape($Package) -and $_ -match "(?i)Process:|ANR in|FATAL EXCEPTION|crash"
        } | ForEach-Object { ConvertTo-RedactedText $_ })
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        [IO.File]::WriteAllLines($crashAnrLogcatPath, $crashLines, [Text.UTF8Encoding]::new($false))
        $Report.runtimeMetrics = [ordered]@{
            crashOrAnrCount = $crashLines.Count
            noCrashOrAnr = $crashLines.Count -eq 0
        }
        $Report.artifacts["crashAnrLogcat"] = [IO.Path]::GetFileName($crashAnrLogcatPath)
        if (-not $AllowFailure -and $crashLines.Count -ne 0) {
            throw "Transport mode evidence detected a crash or ANR."
        }
    }
    catch {
        if (-not $AllowFailure) { throw }
    }
}

function Test-PackageInstalled {
    $path = Invoke-AdbText -Arguments @("-s", $Device, "shell", "pm", "path", $Package) -AllowFailure
    return $path -match "package:"
}

function Get-RunAsFileText {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $result = Invoke-NativeProcessCapture -FileName $script:AdbExecutable -Arguments @(
        "-s", $Device, "exec-out", "run-as", $Package, "cat", $RelativePath
    )
    $diagnostic = ((@([string]$result.stdout, [string]$result.stderr) | Where-Object { $_.Trim() }) -join "`n")
    # Some Android images print a missing-file diagnostic to stdout while still
    # returning exit code 0. Treat both streams as the same missing-file case.
    if ($diagnostic -match [Regex]::Escape($RelativePath) -and $diagnostic -match "(?i)no such file") {
        return ""
    }
    if ([int]$result.exitCode -ne 0) {
        throw "Unable to read protected device file ${RelativePath}: $(ConvertTo-RedactedText $diagnostic)"
    }
    return [string]$result.stdout
}

function Get-NativeRegistrySummaryFromRunAs {
    $raw = Get-RunAsFileText -RelativePath "files/jobs/android-jobs.v1.json"
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [pscustomobject]@{ groups = @(); groupIds = @(); taskIds = @(); pendingCount = 0 }
    }
    try {
        $registry = $raw | ConvertFrom-Json
        $groups = @(
            foreach ($group in @($registry.groups)) {
                [pscustomobject]@{
                    groupId = [string]$group.groupId
                    workspaceId = [string]$group.workspaceId
                    clientSubmissionId = [string]$group.clientSubmissionId
                    requestRunId = [string]$group.requestRunId
                    createdAt = [long]$group.createdAt
                    apiMode = [string]$group.apiMode
                    apiLabel = [string]$group.apiLabel
                    fhlImagesPoolSlot = if ($null -ne $group.fhlImagesPoolSlot) { [int]$group.fhlImagesPoolSlot } else { $null }
                    slots = @(
                        foreach ($slot in @($group.slots)) {
                            $errorText = [string]$slot.errorMessage
                            $errorClass = if ($errorText -match "(?i)\b(401|403)\b|unauthori[sz]ed|forbidden") {
                                "auth"
                            } elseif ($errorText -match "(?i)network|connect|resolve|host|timeout|timed out|socket") {
                                "network"
                            } elseif (-not [string]::IsNullOrWhiteSpace($errorText)) {
                                "other"
                            } else {
                                $null
                            }
                            [pscustomobject]@{
                                jobId = [string]$slot.jobId
                                status = [string]$slot.status
                                stage = [string]$slot.stage
                                bytes = [long]$slot.bytes
                                createdAt = if ($null -ne $slot.createdAt) { [long]$slot.createdAt } else { $null }
                                startedAt = if ($null -ne $slot.startedAt) { [long]$slot.startedAt } else { $null }
                                finishedAt = if ($null -ne $slot.finishedAt) { [long]$slot.finishedAt } else { $null }
                                updatedAt = [long]$slot.updatedAt
                                queueSequence = if ($null -ne $slot.queueSequence) { [long]$slot.queueSequence } else { 0L }
                                reservationActive = [bool]$slot.reservationActive
                                reservationKind = [string]$slot.reservationKind
                                reservationSlot = if ($null -ne $slot.reservationSlot) { [int]$slot.reservationSlot } else { 0 }
                                cancelRequested = [bool]$slot.cancelRequested
                                settledAt = if ($null -ne $slot.settledAt) { [long]$slot.settledAt } else { $null }
                                errorClass = $errorClass
                                apiMode = [string]$slot.apiMode
                                apiLabel = [string]$slot.apiLabel
                                fhlImagesPoolSlot = if ($null -ne $slot.fhlImagesPoolSlot) { [int]$slot.fhlImagesPoolSlot } else { $null }
                            }
                        }
                    )
                }
            }
        )
        $taskIds = @($groups | ForEach-Object { @($_.slots) } | ForEach-Object { [string]$_.jobId } | Where-Object { $_ })
        $pendingCount = @($groups | ForEach-Object { @($_.slots) } | Where-Object { @("queued", "running") -contains [string]$_.status }).Count
        return [pscustomobject]@{
            groups = $groups
            groupIds = @($groups | ForEach-Object { [string]$_.groupId } | Where-Object { $_ })
            taskIds = $taskIds
            pendingCount = $pendingCount
        }
    }
    catch {
        throw "The native job registry could not be parsed safely."
    }
}

function Get-NativeRegistrySummary {
    if ($EvidenceSource -eq "DebugRunAs") {
        return Get-NativeRegistrySummaryFromRunAs
    }
    if ($EvidenceSource -eq "ReleaseLogcat") {
        return Get-NativeRegistrySummaryFromBridge
    }
    throw "Unsupported evidence source: $EvidenceSource"
}

function Get-RegistryDelta {
    param(
        [Parameter(Mandatory = $true)][object]$Before,
        [Parameter(Mandatory = $true)][object]$After
    )

    $knownGroups = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $knownTasks = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($id in @($Before.groupIds)) { [void]$knownGroups.Add([string]$id) }
    foreach ($id in @($Before.taskIds)) { [void]$knownTasks.Add([string]$id) }
    return [pscustomobject]@{
        groupIds = @($After.groupIds | Where-Object { -not $knownGroups.Contains([string]$_) })
        taskIds = @($After.taskIds | Where-Object { -not $knownTasks.Contains([string]$_) })
    }
}

function Assert-NativeRegistryStateUnchanged {
    param(
        [Parameter(Mandatory = $true)][object]$Before,
        [Parameter(Mandatory = $true)][object]$After,
        [Parameter(Mandatory = $true)][string]$Context
    )

    $beforeGroups = @($Before.groupIds | Where-Object { $_ } | Sort-Object -Unique)
    $afterGroups = @($After.groupIds | Where-Object { $_ } | Sort-Object -Unique)
    $beforeTasks = @($Before.taskIds | Where-Object { $_ } | Sort-Object -Unique)
    $afterTasks = @($After.taskIds | Where-Object { $_ } | Sort-Object -Unique)
    if (
        @(Compare-Object -ReferenceObject $beforeGroups -DifferenceObject $afterGroups).Count -ne 0 -or
        @(Compare-Object -ReferenceObject $beforeTasks -DifferenceObject $afterTasks).Count -ne 0
    ) {
        throw "$Context changed existing native group or task identities."
    }
    if ([int]$After.pendingCount -ne 0) {
        throw "$Context left $($After.pendingCount) queued or running native task(s)."
    }
}

function Assert-UpstreamAttemptStateUnchanged {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After,
        [Parameter(Mandatory = $true)][string]$Context
    )

    $beforeIdentities = @($Before | ForEach-Object { Get-AttemptIdentity $_ } | Sort-Object -Unique)
    $afterIdentities = @($After | ForEach-Object { Get-AttemptIdentity $_ } | Sort-Object -Unique)
    if (@(Compare-Object -ReferenceObject $beforeIdentities -DifferenceObject $afterIdentities).Count -ne 0) {
        throw "$Context changed the persisted upstream submit-attempt identities."
    }
}

function Assert-RegistryDeltaMatches {
    param(
        [Parameter(Mandatory = $true)][object]$Before,
        [Parameter(Mandatory = $true)][object]$After,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$ExpectedGroupIds,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$ExpectedTaskIds,
        [Parameter(Mandatory = $true)][string]$Context
    )

    $delta = Get-RegistryDelta -Before $Before -After $After
    $actualGroupIds = @($delta.groupIds | Sort-Object -Unique)
    $actualTaskIds = @($delta.taskIds | Sort-Object -Unique)
    $expectedGroups = @($ExpectedGroupIds | Where-Object { $_ } | Sort-Object -Unique)
    $expectedTasks = @($ExpectedTaskIds | Where-Object { $_ } | Sort-Object -Unique)
    $groupMismatch = @(
        Compare-Object -ReferenceObject $expectedGroups -DifferenceObject $actualGroupIds
    ).Count -ne 0
    $taskMismatch = @(
        Compare-Object -ReferenceObject $expectedTasks -DifferenceObject $actualTaskIds
    ).Count -ne 0
    if ($groupMismatch -or $taskMismatch) {
        throw "$Context registry delta no longer matches the already accepted explicit clicks."
    }
    return $delta
}

function Get-PendingRegistryCount {
    return [int](Get-NativeRegistrySummary).pendingCount
}

function Install-CandidateApk {
    if ($SkipInstall) { return }
    if (Test-PackageInstalled) {
        if ($EvidenceSource -eq "ReleaseLogcat") {
            throw "ReleaseLogcat refuses to overwrite an installed package without Bridge queue evidence. Install once on a clean package, then use -SkipInstall."
        }
        else {
            Assert-RunAsAvailable
            $pendingBeforeInstall = Get-PendingRegistryCount
            if ($pendingBeforeInstall -ne 0) {
                throw "Refusing to install over $pendingBeforeInstall queued or running native task(s)."
            }
        }
    }
    $installResult = Invoke-AdbText -Arguments @("-s", $Device, "install", "-r", $ApkPath)
    if ($installResult -notmatch "(?m)^Success\s*$") {
        throw "adb install -r did not report Success."
    }
}

function Grant-NotificationPermissionForVerification {
    $sdk = [int](Invoke-AdbText -Arguments @("-s", $Device, "shell", "getprop", "ro.build.version.sdk")).Trim()
    if ($sdk -lt 33) { return }
    Invoke-AdbText -Arguments @(
        "-s", $Device, "shell", "pm", "grant", $Package,
        "android.permission.POST_NOTIFICATIONS"
    ) | Out-Null
    $permissions = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "package", $Package)
    if ($permissions -notmatch "android\.permission\.POST_NOTIFICATIONS:\s+granted=true") {
        throw "FreshInstall could not prepare the notification permission deterministically."
    }
}

function Get-InstalledApkSha256 {
    $packagePaths = Invoke-AdbText -Arguments @("-s", $Device, "shell", "pm", "path", $Package)
    $remotePaths = @(
        $packagePaths -split "`r?`n" |
            Where-Object { $_ -match "^package:" } |
            ForEach-Object { $_.Substring("package:".Length).Trim() }
    )
    $remoteApk = @($remotePaths | Where-Object { $_ -match "/base\.apk$" })[0]
    if ([string]::IsNullOrWhiteSpace($remoteApk)) { $remoteApk = @($remotePaths)[0] }
    if ([string]::IsNullOrWhiteSpace($remoteApk)) { throw "Installed base APK path could not be resolved." }
    $digest = Invoke-AdbText -Arguments @("-s", $Device, "shell", "sha256sum", $remoteApk)
    $match = [Regex]::Match($digest, "(?i)\b[0-9a-f]{64}\b")
    if (-not $match.Success) { throw "Installed base APK SHA-256 could not be read." }
    return $match.Value.ToUpperInvariant()
}

function Assert-RunAsAvailable {
    $result = Invoke-AdbText -Arguments @("-s", $Device, "shell", "run-as", $Package, "pwd")
    if ([string]::IsNullOrWhiteSpace($result)) {
        throw "run-as is unavailable; this verifier requires the debuggable phone-base package."
    }
}

function Stop-App {
    Invoke-AdbText -Arguments @("-s", $Device, "shell", "am", "force-stop", $Package) | Out-Null
}

function Get-AppProcessId {
    return (Invoke-AdbText -Arguments @("-s", $Device, "shell", "pidof", $Package) -AllowFailure).Trim()
}

function Wait-AppProcessStopped {
    $deadline = (Get-Date).AddSeconds(15)
    do {
        if ([string]::IsNullOrWhiteSpace((Get-AppProcessId))) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "The Android app process did not stop after force-stop."
}

function Start-App {
    $resolved = Invoke-AdbText -Arguments @(
        "-s", $Device, "shell", "cmd", "package", "resolve-activity", "--brief",
        "-a", "android.intent.action.MAIN",
        "-c", "android.intent.category.LAUNCHER",
        $Package
    )
    $component = @($resolved -split "`r?`n" | Where-Object {
        $_ -match "^$([Regex]::Escape($Package))/.+$"
    })[-1]
    if ([string]::IsNullOrWhiteSpace($component)) {
        throw "Launcher activity could not be resolved for $Package."
    }
    Invoke-AdbText -Arguments @(
        "-s", $Device, "shell", "am", "start", "-W", "-n", $component
    ) | Out-Null
}

function Get-AirplaneModeEnabled {
    $state = Invoke-AdbText -Arguments @("-s", $Device, "shell", "cmd", "connectivity", "airplane-mode")
    if ($state -match "(?i)enabled") { return $true }
    if ($state -match "(?i)disabled") { return $false }
    throw "Android airplane-mode state could not be resolved."
}

function Get-DefaultNetworkState {
    $raw = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "connectivity")
    $active = [Regex]::Match($raw, "Active default network:\s*(\d+)")
    if (-not $active.Success) {
        return [pscustomobject]@{ networkId = $null; validated = $false }
    }
    $networkId = $active.Groups[1].Value
    $networkLine = @($raw -split "`r?`n" | Where-Object { $_ -match "network\{$([Regex]::Escape($networkId))\}" })[0]
    return [pscustomobject]@{
        networkId = $networkId
        validated = [bool]($networkLine -match "\bVALIDATED\b")
    }
}

function Test-UpstreamTcpReachability {
    $result = Invoke-NativeProcessCapture -FileName $script:AdbExecutable -Arguments @(
        "-s", $Device, "shell", "sh", "-c", "echo -n | toybox nc -w 10 -q 1 www.fhl.mom 443"
    ) -TimeoutSeconds 20
    return ([int]$result.exitCode -eq 0)
}

function Wait-DefaultNetworkValidation {
    param([Parameter(Mandatory = $true)][bool]$ExpectedValidated)

    $deadline = (Get-Date).AddSeconds(90)
    $consecutiveMatches = 0
    do {
        $state = Get-DefaultNetworkState
        $targetReachable = $false
        if ($ExpectedValidated -and -not [bool]$state.validated) {
            $targetReachable = Test-UpstreamTcpReachability
        }
        $matches = if ($ExpectedValidated) {
            [bool]$state.validated -or $targetReachable
        } else {
            -not [bool]$state.validated
        }
        if ($matches) {
            $consecutiveMatches += 1
            if ($consecutiveMatches -ge 3) {
                $source = if ([bool]$state.validated) { "android-validated" } elseif ($targetReachable) { "fhl-tcp-443" } else { "android-unvalidated" }
                $script:LastNetworkValidationSource = $source
                return [pscustomobject]@{
                    networkId = $state.networkId
                    validated = [bool]$state.validated
                    targetReachable = $targetReachable
                    source = $source
                }
            }
        } else {
            $consecutiveMatches = 0
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Android default network validation did not reach the expected state."
}

function Set-AirplaneModeEnabled {
    param([Parameter(Mandatory = $true)][bool]$Enabled)

    $target = if ($Enabled) { "enable" } else { "disable" }
    if ($Enabled) { $script:AirplaneModeChanged = $true }
    Invoke-AdbText -Arguments @("-s", $Device, "shell", "cmd", "connectivity", "airplane-mode", $target) | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        if ((Get-AirplaneModeEnabled) -eq $Enabled) {
            $networkState = Wait-DefaultNetworkValidation -ExpectedValidated (-not $Enabled)
            if (-not $Enabled) { $script:AirplaneModeChanged = $false }
            return $networkState
        }
    } while ((Get-Date) -lt $deadline)
    throw "Android airplane mode did not reach the requested state."
}

function Get-CompletionNotificationIds {
    $raw = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "notification", "--noredact")
    return @(
        foreach ($line in @($raw -split "`r?`n")) {
            if ($line -notmatch "NotificationRecord\(" -or $line -notmatch [Regex]::Escape($Package)) { continue }
            $match = [Regex]::Match($line, "\bid=(\d+)\b")
            if (-not $match.Success) { continue }
            $id = [int]$match.Groups[1].Value
            if ($id -ge 207550900 -and $id -le 207567283) { $id }
        }
    ) | Sort-Object -Unique
}

function Get-JavaStringHashCode {
    param([Parameter(Mandatory = $true)][string]$Value)

    [long]$hash = 0
    foreach ($character in $Value.ToCharArray()) {
        $hash = (($hash * 31) + [int]$character) % 4294967296L
    }
    if ($hash -ge 2147483648L) { $hash -= 4294967296L }
    return [int]$hash
}

function Get-ExpectedCompletionNotificationId {
    param([Parameter(Mandatory = $true)][string]$JobId)

    $hash = Get-JavaStringHashCode -Value $JobId
    return 207550900 + ([int]$hash -band 0x3fff)
}

function Get-CompletionNotificationFingerprint {
    param([Parameter(Mandatory = $true)][int]$NotificationId)

    $raw = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "notification", "--noredact")
    $escapedPackage = [Regex]::Escape($Package)
    $pattern = "(?ms)^\s*NotificationRecord\([^\r\n]*$escapedPackage[^\r\n]*\bid=$NotificationId\b[^\r\n]*\).*?(?=^\s*NotificationRecord\(|\z)"
    $match = [Regex]::Match($raw, $pattern)
    if (-not $match.Success) { return [pscustomobject]@{ exists = $false; fingerprint = ""; correctChannel = $false } }
    $bytes = [Text.Encoding]::UTF8.GetBytes($match.Value)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
    return [pscustomobject]@{
        exists = $true
        fingerprint = $fingerprint
        correctChannel = [bool]($match.Value -match "\b(?:channel|channelId)=fhl_studio_generation\b")
    }
}

function Get-AndroidJobServiceState {
    $raw = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "activity", "services", $Package)
    $escapedPackage = [Regex]::Escape($Package)
    $pattern = "(?ms)^\s*\* ServiceRecord\{[^\r\n]*$escapedPackage/[^\r\n]*AndroidJobService[^\r\n]*\}.*?(?=^\s*\* ServiceRecord\{|\z)"
    $match = [Regex]::Match($raw, $pattern)
    if (-not $match.Success) {
        return [pscustomobject]@{ exists = $false; foreground = $false; notificationIdCorrect = $false }
    }
    return [pscustomobject]@{
        exists = $true
        foreground = [bool]($match.Value -match "\bisForeground=true\b")
        notificationIdCorrect = [bool]($match.Value -match "\bforegroundId=207550870\b")
    }
}

function Assert-NotificationPermissionGranted {
    $raw = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "package", $Package)
    if ($raw -notmatch "android\.permission\.POST_NOTIFICATIONS:\s+granted=true") {
        throw "POST_NOTIFICATIONS is not granted for the debug package."
    }
}

function Clear-DeviceLogcat {
    Invoke-AdbText -Arguments @("-s", $Device, "logcat", "-c") | Out-Null
}

function Save-CompatibilityWorkflowScreenshot {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $remotePath = "/data/local/tmp/fhl-image-studio-compatibility-workflow-$runStamp.png"
    try {
        Invoke-AdbText -Arguments @("-s", $Device, "shell", "screencap", "-p", $remotePath) | Out-Null
        Invoke-AdbText -Arguments @("-s", $Device, "pull", $remotePath, $compatibilityWorkflowScreenshotPath) | Out-Null
        if (-not (Test-Path -LiteralPath $compatibilityWorkflowScreenshotPath -PathType Leaf)) {
            throw "Compatibility workflow screenshot was not pulled from the device."
        }
        $screenshot = Get-Item -LiteralPath $compatibilityWorkflowScreenshotPath
        if ($screenshot.Length -lt 1024) {
            throw "Compatibility workflow screenshot is unexpectedly small."
        }
        return $screenshot.Name
    }
    finally {
        Invoke-AdbText -Arguments @("-s", $Device, "shell", "rm", "-f", $remotePath) -AllowFailure | Out-Null
    }
}

function Write-CompatibilityWorkflowLogcat {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $appProcessId = Get-AppProcessId
    if ([string]::IsNullOrWhiteSpace($appProcessId)) {
        throw "Compatibility workflow App process is unavailable for scoped logcat capture."
    }
    $raw = Invoke-AdbText -Arguments @("-s", $Device, "logcat", "-d", "-v", "threadtime", "--pid=$appProcessId")
    $safeLines = @($raw -split "`r?`n" | ForEach-Object { ConvertTo-RedactedText $_ })
    [IO.File]::WriteAllLines(
        $compatibilityWorkflowLogcatPath,
        $safeLines,
        [Text.UTF8Encoding]::new($false)
    )
    return [IO.Path]::GetFileName($compatibilityWorkflowLogcatPath)
}

function Save-CompatibilityWorkflowArtifacts {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [switch]$AllowFailure
    )

    if ($Scenario -ne "CompatibilityWorkflow" -or -not $script:AdbExecutable) { return }
    if ($null -eq $Report.artifacts) {
        $Report.artifacts = [ordered]@{ screenshot = ""; redactedLogcat = "" }
    }
    if ($AllowFailure) {
        try { $Report.artifacts.screenshot = Save-CompatibilityWorkflowScreenshot } catch { }
        try { $Report.artifacts.redactedLogcat = Write-CompatibilityWorkflowLogcat } catch { }
        return
    }
    $Report.artifacts.screenshot = Save-CompatibilityWorkflowScreenshot
    $Report.artifacts.redactedLogcat = Write-CompatibilityWorkflowLogcat
}

function Get-CompatibilityOutputDirectory {
    $expression = @'
(async()=>new Promise((resolve,reject)=>{
  const requestId="compat-output-"+Date.now()+"-"+Math.floor(Math.random()*1000000);
  const previousResolve=window.__imageStudioNativeResolve;
  const previousReject=window.__imageStudioNativeReject;
  const restore=()=>{
    window.__imageStudioNativeResolve=previousResolve;
    window.__imageStudioNativeReject=previousReject;
  };
  window.__imageStudioNativeResolve=(id,payload)=>{
    if(id!==requestId){if(previousResolve)previousResolve(id,payload);return;}
    restore();
    resolve(String(payload||""));
  };
  window.__imageStudioNativeReject=(id,message)=>{
    if(id!==requestId){if(previousReject)previousReject(id,message);return;}
    restore();
    reject(new Error(String(message||"GetOutputDir failed")));
  };
  window.AndroidImageStudio.invoke(requestId,"GetOutputDir","[]");
}))()
'@
    $directory = [string](Invoke-CdpExpression -Expression $expression)
    if ([string]::IsNullOrWhiteSpace($directory)) {
        throw "Compatibility workflow could not resolve the Android output directory."
    }
    return $directory.Trim()
}

function Get-CompatibilityOutputFiles {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $raw = Invoke-AdbText -Arguments @(
        "-s", $Device, "shell", "find", $Directory, "-maxdepth", "1", "-type", "f"
    ) -AllowFailure
    return @(
        $raw -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}

function Get-CompatibilityOutputFileSize {
    param([Parameter(Mandatory = $true)][string]$Path)

    $raw = Invoke-AdbText -Arguments @("-s", $Device, "shell", "stat", "-c", "%s", $Path)
    $size = 0L
    if (-not [long]::TryParse($raw.Trim(), [ref]$size) -or $size -le 0) {
        throw "Compatibility workflow saved output is missing or empty."
    }
    return $size
}

function Get-RedactedPathFingerprint {
    param([Parameter(Mandatory = $true)][string]$Path)

    $bytes = [Text.Encoding]::UTF8.GetBytes($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace "-", "").ToUpperInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-UpstreamRequestDiagnosticCount {
    if ($EvidenceSource -eq "ReleaseLogcat") {
        $raw = Get-ReleaseLogcatRaw
        return @($raw -split "`r?`n" | Where-Object {
            $match = [Regex]::Match($_, "^\s*\d+(?:\.\d+)?\s+(\d+)\s+\d+\s+[A-Z]\s+FHLImageStudioJobs\s*:")
            $match.Success -and $script:ReleaseLogcatProcessIds.Contains($match.Groups[1].Value) -and
                $_ -match "FHL Images request|upstream_submit_attempt"
        }).Count
    }
    $raw = Invoke-AdbText -Arguments @("-s", $Device, "logcat", "-d", "-v", "brief")
    return @($raw -split "`r?`n" | Where-Object {
        $_ -match "FHL Images request|upstream_submit_attempt"
    }).Count
}

function Assert-AppActivityBackgrounded {
    $activities = Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "activity", "activities")
    $resumed = @($activities -split "`r?`n" | Where-Object {
        $_ -match "(?i)^\s*(?:mResumedActivity|topResumedActivity|ResumedActivity)\s*[:=]"
    })
    if ($resumed.Count -eq 0) { throw "The resumed Activity could not be resolved after KEYCODE_HOME." }
    if (@($resumed | Where-Object { $_ -match [Regex]::Escape($Package) }).Count -ne 0) {
        throw "The Activity remained foreground after KEYCODE_HOME."
    }
}

function Send-Home {
    Invoke-AdbText -Arguments @("-s", $Device, "shell", "input", "keyevent", "KEYCODE_HOME") | Out-Null
    Start-Sleep -Seconds 1
    Assert-AppActivityBackgrounded
}

function Prepare-CdpForward {
    if ($script:ForwardPrepared) { return }
    $forwardList = Invoke-AdbText -Arguments @("forward", "--list")
    foreach ($line in @($forwardList -split "`r?`n")) {
        $parts = @($line -split "\s+" | Where-Object { $_ })
        if ($parts.Count -lt 3 -or $parts[1] -ne "tcp:$CdpPort") { continue }
        if ($parts[0] -ne $Device) {
            throw "CDP port $CdpPort is already forwarded for another Android device."
        }
        $script:PreviousForwardRemote = [string]$parts[2]
        break
    }
    $script:ForwardPrepared = $true
}

function Connect-WebView {
    $deadline = (Get-Date).AddSeconds(30)
    $appProcessId = ""
    do {
        Start-Sleep -Milliseconds 500
        $appProcessId = (Invoke-AdbText -Arguments @("-s", $Device, "shell", "pidof", $Package) -AllowFailure).Trim()
    } while ([string]::IsNullOrWhiteSpace($appProcessId) -and (Get-Date) -lt $deadline)
    if ([string]::IsNullOrWhiteSpace($appProcessId)) {
        throw "Android app process did not start: $Package"
    }
    if ($EvidenceSource -eq "ReleaseLogcat") {
        [void]$script:ReleaseLogcatProcessIds.Add($appProcessId)
    }

    Prepare-CdpForward
    Invoke-AdbText -Arguments @("-s", $Device, "forward", "--remove", "tcp:$CdpPort") -AllowFailure | Out-Null
    Invoke-AdbText -Arguments @("-s", $Device, "forward", "tcp:$CdpPort", "localabstract:webview_devtools_remote_$appProcessId") | Out-Null
    $script:ForwardEstablished = $true

    do {
        try {
            $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json" -TimeoutSec 3)
            if ($targets.Count -gt 0 -and $targets[0].webSocketDebuggerUrl) { return }
        }
        catch {
            # The WebView debugging endpoint appears after the first page is loaded.
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Android WebView CDP target was not available on port $CdpPort."
}

function Start-AppAndConnect {
    Start-App
    Connect-WebView
}

function Invoke-CdpExpressionOnce {
    param(
        [Parameter(Mandatory = $true)][string]$Expression,
        [int]$TimeoutSeconds = 30
    )

    $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json" -TimeoutSec 10)
    $target = @($targets | Where-Object { $_.webSocketDebuggerUrl })[0]
    if (-not $target) { throw "Android WebView CDP target was not found." }

    $socket = New-Object System.Net.WebSockets.ClientWebSocket
    $timeout = New-Object System.Threading.CancellationTokenSource
    $timeout.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))
    $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $timeout.Token).GetAwaiter().GetResult() | Out-Null
    try {
        $payload = @{
            id = 1
            method = "Runtime.evaluate"
            params = @{
                expression = $Expression
                awaitPromise = $true
                returnByValue = $true
                userGesture = $true
            }
        } | ConvertTo-Json -Depth 6 -Compress
        $sendBytes = [Text.Encoding]::UTF8.GetBytes($payload)
        $sendSegment = New-Object 'System.ArraySegment[byte]' -ArgumentList (, $sendBytes)
        $socket.SendAsync(
            $sendSegment,
            [Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            $timeout.Token
        ).GetAwaiter().GetResult() | Out-Null

        $buffer = New-Object byte[] 1048576
        while ($socket.State -eq [Net.WebSockets.WebSocketState]::Open) {
            $stream = New-Object IO.MemoryStream
            try {
                do {
                    $receiveSegment = New-Object 'System.ArraySegment[byte]' -ArgumentList (, $buffer)
                    $received = $socket.ReceiveAsync($receiveSegment, $timeout.Token).GetAwaiter().GetResult()
                    if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
                        throw "Android WebView CDP target closed the connection."
                    }
                    $stream.Write($buffer, 0, $received.Count)
                } while (-not $received.EndOfMessage)

                $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
                if ($message.id -ne 1) { continue }
                if ($message.error) { throw [string]$message.error.message }
                if ($message.result.exceptionDetails) {
                    $description = [string]$message.result.exceptionDetails.exception.description
                    if ([string]::IsNullOrWhiteSpace($description)) {
                        $description = [string]$message.result.exceptionDetails.text
                    }
                    throw (ConvertTo-RedactedText $description)
                }
                return $message.result.result.value
            }
            finally {
                $stream.Dispose()
            }
        }
        throw "Android WebView CDP connection ended without a result."
    }
    finally {
        if ($socket.State -eq [Net.WebSockets.WebSocketState]::Open) {
            $closeTimeout = New-Object System.Threading.CancellationTokenSource
            $closeTimeout.CancelAfter([TimeSpan]::FromSeconds(2))
            try {
                $socket.CloseAsync(
                    [Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
                    "done",
                    $closeTimeout.Token
                ).GetAwaiter().GetResult() | Out-Null
            }
            catch {
                $socket.Abort()
            }
            finally {
                $closeTimeout.Dispose()
            }
        }
        $socket.Dispose()
        $timeout.Dispose()
    }
}

function Invoke-CdpExpression {
    param(
        [Parameter(Mandatory = $true)][string]$Expression,
        [int]$TimeoutSeconds = 30
    )

    $transientPattern = 'Execution context was destroyed|CDP target closed the connection|CDP connection ended without a result|WebSocket.*closed'
    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
        try {
            return Invoke-CdpExpressionOnce -Expression $Expression -TimeoutSeconds $TimeoutSeconds
        }
        catch {
            $message = [string]$_.Exception.Message
            if ($attempt -ge 3 -or $message -notmatch $transientPattern) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
    throw "Android WebView CDP expression exhausted its transient reconnect attempts."
}

function Get-BrowserState {
    $expression = @'
(()=>{
  const keys=Object.keys(localStorage);
  const profilesSuffix="gptcodex.profiles";
  const cursorSuffix="gptcodex.androidFHLImagesPoolCursor.v1";
  const sessionSuffix="gptcodex.workspaceSession.v1";
  const transportSuffix="gptcodex.fhlTransportMode.v1";
  const activeProfileSuffix="gptcodex.activeProfileId";
  const isOfficialFHL=profile=>{
    try{
      const url=new URL(String(profile&&profile.baseURL||""));
      return url.protocol==="https:"&&url.hostname.toLowerCase()==="www.fhl.mom"&&
        (url.port===""||url.port==="443")&&!url.username&&!url.password&&!url.search&&!url.hash&&
        ["","/","/v1","/v1/"].includes(url.pathname);
    }catch{return false;}
  };
  const candidates=keys.filter(key=>key.endsWith(profilesSuffix)).map(profileKey=>{
    const prefix=profileKey.slice(0,-profilesSuffix.length);
    let profiles=[];
    let session={};
    try{profiles=JSON.parse(localStorage.getItem(profileKey)||"[]");}catch{}
    try{session=JSON.parse(localStorage.getItem(prefix+sessionSuffix)||"{}");}catch{}
    const slots=(Array.isArray(profiles)?profiles:[])
      .filter(profile=>profile&&(profile.apiMode==="images"||profile.apiMode==="responses")&&
        isOfficialFHL(profile)&&Number.isInteger(profile.fhlImagesPoolSlot))
      .map(profile=>({
        slot:profile.fhlImagesPoolSlot,
        enabled:profile.continuousPoolEnabled!==false,
        hasKeyHint:typeof profile.fhlImagesPoolKeyHint==="string"&&profile.fhlImagesPoolKeyHint.trim().length>0
      }))
      .filter(profile=>profile.slot>=1&&profile.slot<=10)
      .sort((a,b)=>a.slot-b.slot);
    const rawCursor=Number(localStorage.getItem(prefix+cursorSuffix));
    const activeProfileId=String(localStorage.getItem(prefix+activeProfileSuffix)||"");
    const activeProfile=Array.isArray(profiles)
      ?profiles.find(profile=>profile&&profile.id===activeProfileId)
      :null;
    const activeWorkspace=Array.isArray(session&&session.workspaces)
      ?session.workspaces.find(workspace=>workspace&&workspace.id===session.activeWorkspaceId)
      :null;
    const namespace=prefix.startsWith("image-studio.")
      ?prefix.slice("image-studio.".length).replace(/\.$/,"")
      :"";
    const score=slots.filter(slot=>slot.enabled&&slot.hasKeyHint).length;
    return {
      prefix,
      namespace,
      score,
      slots,
      cursor:Number.isInteger(rawCursor)&&rawCursor>=1&&rawCursor<=10?rawCursor:1,
      cursorStored:localStorage.getItem(prefix+cursorSuffix)!==null,
      transportPreference:String(localStorage.getItem(prefix+transportSuffix)||""),
      workspaceId:session&&typeof session.activeWorkspaceId==="string"?session.activeWorkspaceId:"",
      continuousGenerateTest:activeWorkspace?activeWorkspace.continuousGenerateTest!==false:null,
      activeProfile:activeProfile?{
        apiMode:activeProfile.apiMode==="responses"?"responses":activeProfile.apiMode==="images"?"images":"",
        official:isOfficialFHL(activeProfile),
        poolSlot:Number.isInteger(activeProfile.fhlImagesPoolSlot)&&activeProfile.fhlImagesPoolSlot>=1&&activeProfile.fhlImagesPoolSlot<=10
          ?activeProfile.fhlImagesPoolSlot:null
      }:null
    };
  }).sort((a,b)=>{
    const aScore=a.slots.filter(slot=>slot.enabled&&slot.hasKeyHint).length;
    const bScore=b.slots.filter(slot=>slot.enabled&&slot.hasKeyHint).length;
    return bScore-aScore||b.slots.length-a.slots.length;
  });
  const topScore=candidates.length?candidates[0].score:0;
  const topScoreTieCount=candidates.filter(candidate=>candidate.score===topScore).length;
  const selected=candidates[0]||{prefix:"",namespace:"",slots:[],cursor:1,cursorStored:false,transportPreference:"",workspaceId:""};
  const credentialInputs=[...document.querySelectorAll('input[type="password"],input[autocomplete="new-password"]')];
  const images=document.querySelector('[data-audit-id="fhl-transport-images"]');
  const responses=document.querySelector('[data-audit-id="fhl-transport-responses"]');
  const imagesPressed=images&&images.getAttribute("aria-pressed")==="true";
  const responsesPressed=responses&&responses.getAttribute("aria-pressed")==="true";
  return {
    locationHost:String(location.hostname||"").toLowerCase(),
    storageNamespace:selected.namespace,
    candidateNamespaceCount:candidates.length,
    topScoreTieCount,
    workspaceId:selected.workspaceId,
    cursor:selected.cursor,
    cursorStored:selected.cursorStored,
    transportPreference:selected.transportPreference==="responses"?"responses":selected.transportPreference==="images"?"images":"",
    transportMode:responsesPressed&&!imagesPressed?"responses":imagesPressed&&!responsesPressed?"images":"invalid",
    imagesPressed:Boolean(imagesPressed),
    responsesPressed:Boolean(responsesPressed),
    continuousGenerateTest:selected.continuousGenerateTest,
    activeProfile:selected.activeProfile,
    poolSlots:selected.slots,
    credentialInputCount:credentialInputs.length,
    filledCredentialInputCount:credentialInputs.filter(input=>String(input.value||"").trim().length>0).length
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression
}

function Get-MatrixStartupState {
    $expression = @'
(()=>{
  const keys=Object.keys(localStorage);
  const profilesSuffix="gptcodex.profiles";
  const cursorSuffix="gptcodex.androidFHLImagesPoolCursor.v1";
  const sessionSuffix="gptcodex.workspaceSession.v1";
  const transportSuffix="gptcodex.fhlTransportMode.v1";
  const activeProfileSuffix="gptcodex.activeProfileId";
  const profileKeys=keys.filter(key=>key.endsWith(profilesSuffix));
  const sessionKeys=keys.filter(key=>key.endsWith(sessionSuffix));
  const prefixes=[...new Set([
    ...profileKeys.map(key=>key.slice(0,-profilesSuffix.length)),
    ...sessionKeys.map(key=>key.slice(0,-sessionSuffix.length))
  ])];
  const isOfficialFHL=profile=>{
    try{
      const url=new URL(String(profile&&profile.baseURL||""));
      return url.protocol==="https:"&&url.hostname.toLowerCase()==="www.fhl.mom"&&
        (url.port===""||url.port==="443")&&!url.username&&!url.password&&!url.search&&!url.hash&&
        ["","/","/v1","/v1/"].includes(url.pathname);
    }catch{return false;}
  };
  const candidates=prefixes.map(prefix=>{
    let profiles=[];
    let session={};
    try{profiles=JSON.parse(localStorage.getItem(prefix+profilesSuffix)||"[]");}catch{}
    try{session=JSON.parse(localStorage.getItem(prefix+sessionSuffix)||"{}");}catch{}
    if(!Array.isArray(profiles))profiles=[];
    const slots=profiles
      .filter(profile=>profile&&(profile.apiMode==="images"||profile.apiMode==="responses")&&
        isOfficialFHL(profile)&&Number.isInteger(profile.fhlImagesPoolSlot))
      .map(profile=>({
        slot:profile.fhlImagesPoolSlot,
        enabled:profile.continuousPoolEnabled!==false,
        hasKeyHint:typeof profile.fhlImagesPoolKeyHint==="string"&&profile.fhlImagesPoolKeyHint.trim().length>0
      }))
      .filter(profile=>profile.slot>=1&&profile.slot<=10)
      .sort((a,b)=>a.slot-b.slot);
    const rawCursor=Number(localStorage.getItem(prefix+cursorSuffix));
    const activeProfileId=String(localStorage.getItem(prefix+activeProfileSuffix)||"");
    const activeProfile=profiles.find(profile=>profile&&profile.id===activeProfileId)||null;
    const workspaceId=session&&typeof session.activeWorkspaceId==="string"?session.activeWorkspaceId:"";
    const namespace=prefix.startsWith("image-studio.")?prefix.slice("image-studio.".length).replace(/\.$/,""):"";
    return {
      prefix,namespace,profiles,slots,workspaceId,
      cursor:Number.isInteger(rawCursor)&&rawCursor>=1&&rawCursor<=10?rawCursor:1,
      cursorStored:localStorage.getItem(prefix+cursorSuffix)!==null,
      transportPreference:String(localStorage.getItem(prefix+transportSuffix)||""),
      activeProfile:activeProfile?{
        apiMode:activeProfile.apiMode==="responses"?"responses":activeProfile.apiMode==="images"?"images":"",
        official:isOfficialFHL(activeProfile),
        poolSlot:Number.isInteger(activeProfile.fhlImagesPoolSlot)&&activeProfile.fhlImagesPoolSlot>=1&&activeProfile.fhlImagesPoolSlot<=10
          ?activeProfile.fhlImagesPoolSlot:null
      }:null,
      score:slots.filter(slot=>slot.enabled&&slot.hasKeyHint).length
    };
  }).sort((a,b)=>b.score-a.score||Number(b.workspaceId.length>0)-Number(a.workspaceId.length>0)||b.slots.length-a.slots.length);
  const selected=candidates[0]||{namespace:"",profiles:[],slots:[],workspaceId:"",cursor:1,cursorStored:false,transportPreference:"",activeProfile:null,score:0};
  const topScoreTieCount=candidates.filter(candidate=>candidate.score===selected.score).length;
  const credentialInputs=[...document.querySelectorAll('input[type="password"],input[autocomplete="new-password"]')];
  const images=document.querySelector('[data-audit-id="fhl-transport-images"]');
  const responses=document.querySelector('[data-audit-id="fhl-transport-responses"]');
  const imagesPressed=images&&images.getAttribute("aria-pressed")==="true";
  const responsesPressed=responses&&responses.getAttribute("aria-pressed")==="true";
  return {
    locationHost:String(location.hostname||"").toLowerCase(),
    storageNamespace:selected.namespace,
    candidateNamespaceCount:profileKeys.length,
    sessionNamespaceCount:sessionKeys.length,
    selectedNamespaceCount:candidates.length,
    topScoreTieCount,
    profileCount:selected.profiles.length,
    workspaceId:selected.workspaceId,
    cursor:selected.cursor,
    cursorStored:selected.cursorStored,
    transportPreference:selected.transportPreference==="responses"?"responses":selected.transportPreference==="images"?"images":"",
    transportMode:responsesPressed&&!imagesPressed?"responses":imagesPressed&&!responsesPressed?"images":"invalid",
    activeProfile:selected.activeProfile,
    poolSlots:selected.slots,
    credentialInputCount:credentialInputs.length,
    filledCredentialInputCount:credentialInputs.filter(input=>String(input.value||"").trim().length>0).length,
    targetPlatform:String(document.documentElement.getAttribute("data-target-platform")||""),
    viewport:{
      innerWidth:window.innerWidth,
      innerHeight:window.innerHeight,
      scrollWidth:document.documentElement.scrollWidth,
      scrollHeight:document.documentElement.scrollHeight
    }
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression
}

function Get-FreshInstallState {
    $expression = @'
(()=>{
  const keys=Object.keys(localStorage);
  const profilesSuffix="gptcodex.profiles";
  const activeProfileSuffix="gptcodex.activeProfileId";
  const sessionSuffix="gptcodex.workspaceSession.v1";
  const transportSuffix="gptcodex.fhlTransportMode.v1";
  const cursorSuffix="gptcodex.androidFHLImagesPoolCursor.v1";
  const sessionKeys=keys.filter(key=>key.endsWith(sessionSuffix));
  let session={};
  if(sessionKeys.length===1){
    try{session=JSON.parse(localStorage.getItem(sessionKeys[0])||"{}");}catch{}
  }
  const sessionPrefix=sessionKeys.length===1?sessionKeys[0].slice(0,-sessionSuffix.length):"";
  const namespace=sessionPrefix.startsWith("image-studio.")
    ?sessionPrefix.slice("image-studio.".length).replace(/\.$/,"")
    :"";
  const credentialInputs=[...document.querySelectorAll('input[type="password"],input[autocomplete="new-password"]')];
  return {
    locationHost:String(location.hostname||"").toLowerCase(),
    storageNamespace:namespace,
    candidateNamespaceCount:keys.filter(key=>key.endsWith(profilesSuffix)).length,
    topScoreTieCount:0,
    workspaceId:session&&typeof session.activeWorkspaceId==="string"?session.activeWorkspaceId:"",
    cursor:1,
    cursorStored:keys.some(key=>key.endsWith(cursorSuffix)),
    continuousGenerateTest:null,
    poolSlots:[],
    credentialInputCount:credentialInputs.length,
    filledCredentialInputCount:credentialInputs.filter(input=>String(input.value||"").trim().length>0).length,
    profileKeyCount:keys.filter(key=>key.endsWith(profilesSuffix)).length,
    activeProfileKeyCount:keys.filter(key=>key.endsWith(activeProfileSuffix)).length,
    sessionKeyCount:sessionKeys.length,
    transportPreferenceKeyCount:keys.filter(key=>key.endsWith(transportSuffix)).length,
    cursorKeyCount:keys.filter(key=>key.endsWith(cursorSuffix)).length
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression
}

function Assert-FreshInstallState {
    param([Parameter(Mandatory = $true)][object]$BrowserState)

    if ([string]$BrowserState.locationHost -ne "appassets.androidplatform.net") {
        throw "FreshInstall is not running from the packaged Android appassets host."
    }
    if ([int]$BrowserState.sessionKeyCount -ne 1 -or [string]::IsNullOrWhiteSpace([string]$BrowserState.workspaceId)) {
        throw "FreshInstall did not create exactly one empty workspace session."
    }
    if (
        [int]$BrowserState.profileKeyCount -ne 0 -or
        [int]$BrowserState.activeProfileKeyCount -ne 0 -or
        [int]$BrowserState.transportPreferenceKeyCount -ne 0 -or
        [int]$BrowserState.cursorKeyCount -ne 0 -or
        [int]$BrowserState.candidateNamespaceCount -ne 0 -or
        @($BrowserState.poolSlots).Count -ne 0
    ) {
        throw "FreshInstall unexpectedly restored a Profile, active Profile, transport preference, or pool cursor."
    }
    if ([int]$BrowserState.filledCredentialInputCount -ne 0) {
        throw "FreshInstall exposed a plaintext credential input value."
    }
}

function Assert-MatrixStartupState {
    param(
        [Parameter(Mandatory = $true)][object]$BrowserState,
        [Parameter(Mandatory = $true)][object]$BootstrapState,
        [Parameter(Mandatory = $true)][string]$Context
    )

    if ([string]$BrowserState.locationHost -ne "appassets.androidplatform.net") {
        throw "$Context is not running from the packaged Android appassets host."
    }
    if ([string]::IsNullOrWhiteSpace([string]$BrowserState.workspaceId)) {
        throw "$Context did not resolve one active workspace."
    }
    if ([int]$BrowserState.selectedNamespaceCount -ne 1 -or [int]$BrowserState.sessionNamespaceCount -ne 1) {
        throw "$Context found an ambiguous localStorage namespace."
    }
    if ([int]$BrowserState.filledCredentialInputCount -ne 0) {
        throw "$Context exposed a plaintext credential input value."
    }
    if ([string]$BrowserState.transportMode -ne "images" -or [string]$BrowserState.transportPreference -eq "responses") {
        throw "$Context did not preserve the default Images transport."
    }
    $configured = @(
        $BrowserState.poolSlots |
            Where-Object { $_.enabled -and $_.hasKeyHint } |
            ForEach-Object { [int]$_.slot } |
            Sort-Object -Unique
    )
    if ($configured.Count -notin @(0, 1, 10)) {
        throw "$Context supports only zero, one, or ten configured FHL slots; found $($configured.Count)."
    }
    if ([string]$BootstrapState.readyKind -eq "setup") {
        # A persisted redacted hint can outlive an emulator Keystore entry. The visible
        # setup action is authoritative for zero-paid-work matrix startup readiness.
        return @()
    }
    if ($configured.Count -eq 0) {
        throw "$Context did not expose the expected setup action for an empty configuration."
    }
    if ([string]$BootstrapState.readyKind -notin @("generate", "edit")) {
        throw "$Context did not expose a generation action for a configured Profile."
    }
    if ([string]$BrowserState.targetPlatform -ne [string]$BootstrapState.targetPlatform) {
        throw "$Context changed Android target-platform identity during bootstrap."
    }
    return $configured
}

function Assert-MatrixSingleConfiguredSlot {
    param(
        [Parameter(Mandatory = $true)][object]$BrowserState,
        [Parameter(Mandatory = $true)][object]$BootstrapState,
        [Parameter(Mandatory = $true)][string]$Context
    )

    $configured = @(Assert-MatrixStartupState -BrowserState $BrowserState -BootstrapState $BootstrapState -Context $Context)
    if ($configured.Count -ne 1) {
        throw "$Context requires exactly one configured and enabled official FHL Images slot."
    }
    Assert-OfficialFHLImagesHomeSource -BrowserState $BrowserState -Context $Context
    if ([int]$BrowserState.activeProfile.poolSlot -ne [int]$configured[0]) {
        throw "$Context active Profile does not match the sole configured FHL slot."
    }
    return $configured
}

function Get-FreshInstallHistoryState {
    $expression = @'
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const navigationButtons=[...document.querySelectorAll("button.android-nav-button")];
  if(navigationButtons.length<3)throw new Error("FreshInstall navigation is incomplete.");
  navigationButtons[navigationButtons.length-1].click();
  await delay(800);
  const studio=document.querySelector(".studio");
  const historyView=studio&&studio.getAttribute("data-android-view")||null;
  const groupCount=document.querySelectorAll("[data-android-history-job-group]").length;
  const emptyVisible=Boolean(document.querySelector(".android-history-empty"));
  const refreshed=[...document.querySelectorAll("button.android-nav-button")];
  if(refreshed[0])refreshed[0].click();
  await delay(300);
  const finalStudio=document.querySelector(".studio");
  return {
    historyView,
    groupCount,
    emptyVisible,
    finalView:finalStudio&&finalStudio.getAttribute("data-android-view")||null
  };
})()
'@
    $state = Invoke-CdpExpression -Expression $expression
    if (
        [string]$state.historyView -ne "history" -or
        [int]$state.groupCount -ne 0 -or
        -not [bool]$state.emptyVisible -or
        [string]$state.finalView -ne "compose"
    ) {
        throw "FreshInstall history is not empty or navigation did not recover to compose."
    }
    return $state
}

function Assert-TenCredentialInputsEmpty {
    $expression = @'
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const waitFor=async selector=>{
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){
      const element=document.querySelector(selector);
      if(element)return element;
      await delay(100);
    }
    throw new Error("Credential UI element was not found: "+selector);
  };
  const waitForTenToggles=async()=>{
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){
      const toggles=[...document.querySelectorAll('.android-fhl-slot-toggle')];
      if(toggles.length===10)return toggles;
      await delay(100);
    }
    throw new Error("FHL pool did not render ten slot toggles.");
  };
  const ensurePool=async()=>{
    if(document.querySelector('.android-fhl-pool')){
      await waitForTenToggles();
      return;
    }
    if(!document.querySelector('.android-upstream-panel')){
      (await waitFor('[data-audit-id="fhl-config"]')).click();
      await waitFor('.android-upstream-panel');
    }
    (await waitFor('.android-upstream-onekey-button')).click();
    await waitFor('.android-fhl-pool');
    await waitForTenToggles();
  };
  await ensurePool();
  await delay(5000);
  await ensurePool();
  const checked=[];
  for(let slot=1;slot<=10;slot+=1){
    const findToggle=()=>[...document.querySelectorAll('.android-fhl-slot-toggle')]
      .find(button=>{
        const name=button.querySelector('.android-fhl-slot-name');
        return (name&&name.textContent||'').trim()===`FHL${slot}`;
      });
    const stableDeadline=Date.now()+5000;
    let emptySamples=0;
    let filled=false;
    while(Date.now()<stableDeadline&&emptySamples<3&&!filled){
      const toggle=findToggle();
      if(!toggle){
        emptySamples=0;
        await ensurePool();
        continue;
      }
      if(toggle.disabled){
        emptySamples=0;
        await delay(100);
        continue;
      }
      if(toggle.getAttribute('aria-expanded')!=="true"){
        toggle.click();
        emptySamples=0;
        await delay(100);
        continue;
      }
      const input=document.querySelector(`input[data-fhl-pool-slot="${slot}"]`);
      if(!input){
        emptySamples=0;
        if(!document.querySelector('.android-fhl-pool'))await ensurePool();
        await delay(100);
        continue;
      }
      filled=String(input.value||"").length>0;
      if(!filled)emptySamples+=1;
      await delay(250);
    }
    if(emptySamples<3&&!filled)throw new Error("Credential input did not remain mounted for a stable check for slot "+slot);
    checked.push({slot,filled});
  }
  const closeButton=document.querySelector('.app-modal-card-phone .app-modal-header-phone button');
  if(closeButton)closeButton.click();
  return {
    checked:checked.length,
    filled:checked.filter(item=>item.filled).length,
    stableEmpty:checked.every(item=>!item.filled)
  };
})()
'@
    $state = Invoke-CdpExpression -Expression $expression
    if ([int]$state.checked -ne 10 -or [int]$state.filled -ne 0 -or -not [bool]$state.stableEmpty) {
        throw "The ten-slot credential UI did not keep all saved Key inputs empty."
    }
    return $state
}

function Get-UpgradeBrowserSnapshot {
    $expression = @'
(async()=>{
  const keys=Object.keys(localStorage);
  const profilesSuffix="gptcodex.profiles";
  const activeProfileSuffix="gptcodex.activeProfileId";
  const cursorSuffix="gptcodex.androidFHLImagesPoolCursor.v1";
  const sessionSuffix="gptcodex.workspaceSession.v1";
  const transportSuffix="gptcodex.fhlTransportMode.v1";
  const digest=async value=>{
    if(!globalThis.crypto||!crypto.subtle)throw new Error("Upgrade audit requires Web Crypto SHA-256.");
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||"")));
    return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  };
  const candidates=keys.filter(key=>key.endsWith(profilesSuffix)).map(profileKey=>{
    const prefix=profileKey.slice(0,-profilesSuffix.length);
    let profiles=[];
    let session={};
    try{profiles=JSON.parse(localStorage.getItem(profileKey)||"[]");}catch{}
    try{session=JSON.parse(localStorage.getItem(prefix+sessionSuffix)||"{}");}catch{}
    const slots=(Array.isArray(profiles)?profiles:[])
      .filter(profile=>profile&&typeof profile.id==="string"&&Number.isInteger(profile.fhlImagesPoolSlot))
      .map(profile=>({
        id:profile.id,
        slot:profile.fhlImagesPoolSlot,
        enabled:profile.continuousPoolEnabled!==false,
        hasKeyHint:typeof profile.fhlImagesPoolKeyHint==="string"&&profile.fhlImagesPoolKeyHint.trim().length>0
      }))
      .filter(profile=>profile.slot>=1&&profile.slot<=10)
      .sort((a,b)=>a.slot-b.slot);
    const rawCursor=Number(localStorage.getItem(prefix+cursorSuffix));
    const namespace=prefix.startsWith("image-studio.")
      ?prefix.slice("image-studio.".length).replace(/\.$/,"")
      :"";
    return {
      prefix,
      namespace,
      profiles,
      slots,
      score:slots.filter(slot=>slot.enabled&&slot.hasKeyHint).length,
      cursor:Number.isInteger(rawCursor)&&rawCursor>=1&&rawCursor<=10?rawCursor:1,
      cursorStored:localStorage.getItem(prefix+cursorSuffix)!==null,
      workspaceId:session&&typeof session.activeWorkspaceId==="string"?session.activeWorkspaceId:"",
      activeProfileId:String(localStorage.getItem(prefix+activeProfileSuffix)||""),
      transportPreferenceStored:localStorage.getItem(prefix+transportSuffix)!==null,
      transportPreference:String(localStorage.getItem(prefix+transportSuffix)||"")
    };
  }).sort((a,b)=>b.score-a.score||b.slots.length-a.slots.length);
  if(candidates.length!==1)throw new Error("Upgrade audit requires exactly one configured storage namespace.");
  const selected=candidates[0];
  if(selected.slots.length!==10)throw new Error("Upgrade audit requires ten persisted FHL slots.");
  if(!window.AndroidImageStudio||typeof window.AndroidImageStudio.invoke!=="function"){
    throw new Error("Upgrade audit requires the Android credential Bridge.");
  }
  const invokeNative=(method,args)=>new Promise((resolve,reject)=>{
    const requestId="upgrade-audit-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    const previousResolve=window.__imageStudioNativeResolve;
    const previousReject=window.__imageStudioNativeReject;
    const timer=setTimeout(()=>{restore();reject(new Error(method+" timed out."));},10000);
    const restore=()=>{
      clearTimeout(timer);
      window.__imageStudioNativeResolve=previousResolve;
      window.__imageStudioNativeReject=previousReject;
    };
    window.__imageStudioNativeResolve=(id,payload)=>{
      if(id!==requestId){if(previousResolve)previousResolve(id,payload);return;}
      restore();
      resolve(payload);
    };
    window.__imageStudioNativeReject=(id,message)=>{
      if(id!==requestId){if(previousReject)previousReject(id,message);return;}
      restore();
      reject(new Error(String(message)));
    };
    try{window.AndroidImageStudio.invoke(requestId,method,JSON.stringify(args));}
    catch(error){restore();reject(error);}
  });
  const slotSnapshots=[];
  for(const slot of selected.slots){
    let readable=false;
    let present=false;
    try{
      const value=await invokeNative("GetStoredAPIKey",[`profile:${selected.namespace}:${slot.id}`]);
      readable=true;
      present=typeof value==="string"&&value.trim().length>0;
    }catch{}
    slotSnapshots.push({
      slot:slot.slot,
      enabled:slot.enabled,
      hasKeyHint:slot.hasKeyHint,
      profileIdSha256:await digest(slot.id),
      credentialReadable:readable,
      credentialPresent:present
    });
  }
  const historyCount=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(`image-studio-${selected.namespace}`);
    request.onerror=()=>reject(request.error||new Error("History database could not be opened."));
    request.onsuccess=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains("history")){db.close();resolve(0);return;}
      const tx=db.transaction("history","readonly");
      const count=tx.objectStore("history").count();
      count.onerror=()=>{db.close();reject(count.error||new Error("History count failed."));};
      count.onsuccess=()=>{const value=Number(count.result)||0;db.close();resolve(value);};
    };
  });
  const credentialInputs=[...document.querySelectorAll('input[type="password"],input[autocomplete="new-password"]')];
  return {
    locationHost:String(location.hostname||"").toLowerCase(),
    storageNamespace:selected.namespace,
    workspacePresent:selected.workspaceId.length>0,
    workspaceIdSha256:await digest(selected.workspaceId),
    activeProfilePresent:selected.activeProfileId.length>0,
    activeProfileIdSha256:await digest(selected.activeProfileId),
    cursor:selected.cursor,
    cursorStored:selected.cursorStored,
    transportPreferenceStored:selected.transportPreferenceStored,
    transportPreference:selected.transportPreference==="responses"?"responses":selected.transportPreference==="images"?"images":"",
    historyCount,
    slots:slotSnapshots,
    filledCredentialInputCount:credentialInputs.filter(input=>String(input.value||"").trim().length>0).length
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression -TimeoutSeconds 60
}

function Get-UpgradeTransportState {
    $expression = @'
(()=>{
  const images=document.querySelector('[data-audit-id="fhl-transport-images"]');
  const responses=document.querySelector('[data-audit-id="fhl-transport-responses"]');
  return {
    imagesPressed:images&&images.getAttribute("aria-pressed")==="true",
    responsesPressed:responses&&responses.getAttribute("aria-pressed")==="true"
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression
}

function Set-FHLTransportModeForVerification {
    param([Parameter(Mandatory = $true)][ValidateSet("images", "responses")][string]$Mode)

    $auditId = if ($Mode -eq "responses") { "fhl-transport-responses" } else { "fhl-transport-images" }
    $expression = @"
(async()=>{
  const mode="$Mode";
  const target=document.querySelector('[data-audit-id="$auditId"]');
  if(!target)throw new Error("FHL transport button is unavailable.");
  if(target.getAttribute("aria-pressed")!=="true")target.click();
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const profilesSuffix="gptcodex.profiles";
  const transportSuffix="gptcodex.fhlTransportMode.v1";
  const profileKeys=Object.keys(localStorage).filter(key=>key.endsWith(profilesSuffix));
  if(profileKeys.length!==1)throw new Error("Transport verification requires one storage namespace.");
  const prefix=profileKeys[0].slice(0,-profilesSuffix.length);
  const preferenceKey=prefix+transportSuffix;
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    const images=document.querySelector('[data-audit-id="fhl-transport-images"]');
    const responses=document.querySelector('[data-audit-id="fhl-transport-responses"]');
    const pressed=mode==="responses"
      ?responses&&responses.getAttribute("aria-pressed")==="true"&&images&&images.getAttribute("aria-pressed")==="false"
      :images&&images.getAttribute("aria-pressed")==="true"&&responses&&responses.getAttribute("aria-pressed")==="false";
    if(pressed&&localStorage.getItem(preferenceKey)===mode){
      return {mode,preferenceStored:true};
    }
    await delay(100);
  }
  throw new Error("FHL transport preference did not settle.");
})()
"@
    $state = Invoke-CdpExpression -Expression $expression -TimeoutSeconds 15
    if ([string]$state.mode -ne $Mode -or -not [bool]$state.preferenceStored) {
        throw "FHL transport switch did not persist $Mode."
    }
    # Android WebView may flush DOM storage asynchronously after setItem. Keep the
    # app alive briefly before force-stop so this verifier measures durable state.
    Start-Sleep -Seconds $transportPreferenceDurabilityWaitSeconds
$durableState = Invoke-CdpExpression -Expression @"
(()=>{
  const profilesSuffix="gptcodex.profiles";
  const suffix="gptcodex.fhlTransportMode.v1";
  const profileKeys=Object.keys(localStorage).filter(key=>key.endsWith(profilesSuffix));
  const preferenceKey=profileKeys.length===1
    ?profileKeys[0].slice(0,-profilesSuffix.length)+suffix
    :"";
  const stored=preferenceKey?String(localStorage.getItem(preferenceKey)||""):"";
  const images=document.querySelector('[data-audit-id="fhl-transport-images"]');
  const responses=document.querySelector('[data-audit-id="fhl-transport-responses"]');
  return {
    mode:"$Mode",
    preferenceStored:stored==="$Mode",
    imagesPressed:images&&images.getAttribute("aria-pressed")==="true",
    responsesPressed:responses&&responses.getAttribute("aria-pressed")==="true"
  };
})()
"@ -TimeoutSeconds 15
    $durableUISelected = if ($Mode -eq "responses") {
        [bool]$durableState.responsesPressed -and -not [bool]$durableState.imagesPressed
    }
    else {
        [bool]$durableState.imagesPressed -and -not [bool]$durableState.responsesPressed
    }
    if (-not [bool]$durableState.preferenceStored -or -not $durableUISelected) {
        throw "FHL transport preference was not durable after $transportPreferenceDurabilityWaitSeconds second(s)."
    }
    return $state
}

function Assert-UpgradeConfiguredSnapshot {
    param([Parameter(Mandatory = $true)][object]$Snapshot)

    if ([string]$Snapshot.locationHost -ne "appassets.androidplatform.net") {
        throw "Upgrade audit is not running from the packaged Android appassets host."
    }
    $slots = @($Snapshot.slots | Sort-Object slot)
    if ($slots.Count -ne 10 -or (@($slots | ForEach-Object { [int]$_.slot }) -join ',') -ne ((1..10) -join ',')) {
        throw "Upgrade audit did not find exactly FHL1-FHL10."
    }
    if (@($slots | Where-Object { -not $_.enabled -or -not $_.hasKeyHint }).Count -ne 0) {
        throw "Upgrade audit requires all ten saved FHL slots to remain enabled with a Key hint."
    }
    if (@($slots | Where-Object { -not $_.credentialReadable -or -not $_.credentialPresent }).Count -ne 0) {
        throw "Upgrade audit could not read every saved credential from Android Keystore."
    }
    if (-not [bool]$Snapshot.workspacePresent -or -not [bool]$Snapshot.activeProfilePresent) {
        throw "Upgrade audit requires a persisted workspace and active Profile."
    }
    if ([int]$Snapshot.filledCredentialInputCount -ne 0) {
        throw "Upgrade audit exposed a plaintext credential input value."
    }
}

function ConvertTo-UpgradeComparableJson {
    param([Parameter(Mandatory = $true)][object]$Snapshot)
    $comparable = [ordered]@{
        storageNamespace = [string]$Snapshot.storageNamespace
        workspacePresent = [bool]$Snapshot.workspacePresent
        workspaceIdSha256 = [string]$Snapshot.workspaceIdSha256
        activeProfilePresent = [bool]$Snapshot.activeProfilePresent
        activeProfileIdSha256 = [string]$Snapshot.activeProfileIdSha256
        cursor = [int]$Snapshot.cursor
        cursorStored = [bool]$Snapshot.cursorStored
        transportPreferenceStored = [bool]$Snapshot.transportPreferenceStored
        transportPreference = [string]$Snapshot.transportPreference
        historyCount = [int]$Snapshot.historyCount
        slots = @(
            $Snapshot.slots | Sort-Object slot | ForEach-Object {
                [ordered]@{
                    slot = [int]$_.slot
                    enabled = [bool]$_.enabled
                    hasKeyHint = [bool]$_.hasKeyHint
                    profileIdSha256 = [string]$_.profileIdSha256
                    credentialReadable = [bool]$_.credentialReadable
                    credentialPresent = [bool]$_.credentialPresent
                }
            }
        )
    }
    return ($comparable | ConvertTo-Json -Depth 8 -Compress)
}

function ConvertTo-TransportPersistenceComparableJson {
    param([Parameter(Mandatory = $true)][object]$Snapshot)
    $comparable = (ConvertTo-UpgradeComparableJson -Snapshot $Snapshot) | ConvertFrom-Json
    $comparable.PSObject.Properties.Remove("transportPreferenceStored")
    $comparable.PSObject.Properties.Remove("transportPreference")
    return ($comparable | ConvertTo-Json -Depth 8 -Compress)
}

function Initialize-UpgradeBaseline {
    param([Parameter(Mandatory = $true)][string]$ExpectedBaselineHash)

    if ($SkipInstall) { throw "Upgrade requires adb install -r and does not allow SkipInstall." }
    if (-not (Test-PackageInstalled)) { throw "Upgrade requires the baseline package to be installed before verification." }
    if ($ExpectedBaselineHash -notmatch "^[0-9A-F]{64}$") {
        throw "ExpectedBaselineApkSha256 must be a complete SHA-256 value for Upgrade."
    }
    $installedHash = Get-InstalledApkSha256
    if ($installedHash -ne $ExpectedBaselineHash) {
        throw "Upgrade refused to run because the installed APK does not match the expected baseline SHA-256."
    }
    Assert-RunAsAvailable
    $pending = Get-PendingRegistryCount
    if ($pending -ne 0) { throw "Upgrade refused to replace a baseline with $pending queued or running task(s)." }

    Grant-NotificationPermissionForVerification
    Stop-App
    Start-AppAndConnect
    $bootstrap = Wait-AndroidBootstrapReady
    $browserState = Get-BrowserState
    Assert-TenConfiguredSlots -BrowserState $browserState
    $credentialUI = Assert-TenCredentialInputsEmpty
    $snapshot = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $snapshot
    if ([bool]$snapshot.transportPreferenceStored) {
        throw "Upgrade baseline already contains an explicit FHL transport preference; default Images migration cannot be proven."
    }
    $registry = Get-NativeRegistrySummary
    if ([int]$registry.pendingCount -ne 0) { throw "Upgrade baseline native queue is not idle." }
    $attempts = @(Get-UpstreamSubmitAttempts)
    Stop-App
    Wait-AppProcessStopped

    return [pscustomobject][ordered]@{
        installedApkSha256 = $installedHash
        bootstrapReadySamples = [int]$bootstrap.stableSamples
        credentialInputsChecked = [int]$credentialUI.checked
        browser = $snapshot
        comparableJson = ConvertTo-UpgradeComparableJson -Snapshot $snapshot
        registryGroupIds = @($registry.groupIds | Sort-Object -Unique)
        registryTaskIds = @($registry.taskIds | Sort-Object -Unique)
        pendingCount = [int]$registry.pendingCount
        attempts = @($attempts)
        attemptIdentities = @($attempts | ForEach-Object { Get-AttemptIdentity $_ } | Sort-Object -Unique)
    }
}

function Get-RedactedJobSnapshot {
    param([Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId)

    $workspaceJson = $ResolvedWorkspaceId | ConvertTo-Json -Compress
    $expression = @'
(()=>new Promise((resolve,reject)=>{
  if(!window.AndroidImageStudio||typeof window.AndroidImageStudio.invoke!=="function"){
    reject(new Error("Android Job Bridge is unavailable."));
    return;
  }
  const workspaceId=__WORKSPACE_JSON__;
  const requestId="phone-base-list-"+Date.now()+"-"+Math.random().toString(36).slice(2);
  const previousResolve=window.__imageStudioNativeResolve;
  const previousReject=window.__imageStudioNativeReject;
  const restore=()=>{
    window.__imageStudioNativeResolve=previousResolve;
    window.__imageStudioNativeReject=previousReject;
  };
  window.__imageStudioNativeResolve=(id,payload)=>{
    if(id!==requestId){if(previousResolve)previousResolve(id,payload);return;}
    restore();
    const groups=(payload&&Array.isArray(payload.groups)?payload.groups:[])
      .slice()
      .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    resolve({
      workspaceId:payload&&payload.workspaceId||null,
      groups:groups.map(group=>({
        groupId:group.groupId||null,
        workspaceId:group.workspaceId||(payload&&payload.workspaceId)||null,
        clientSubmissionId:group.clientSubmissionId||null,
        requestRunId:group.requestRunId||null,
        apiMode:group.apiMode||null,
        apiProfileId:group.apiProfileId||null,
        apiLabel:group.apiLabel||null,
        fhlImagesPoolSlot:Number.isInteger(group.fhlImagesPoolSlot)?group.fhlImagesPoolSlot:null,
        createdAt:group.createdAt||null,
        slots:(Array.isArray(group.slots)?group.slots:[]).map(slot=>{
          const error=String(slot.errorMessage||"");
          const errorClass=/\b(?:401|403)\b|unauthori[sz]ed|forbidden/i.test(error)
            ?"auth"
            :/network|connect|resolve|host|timeout|timed out|socket/i.test(error)?"network":error?"other":null;
          return {
            jobId:slot.jobId||null,
            status:slot.status||null,
            stage:slot.stage||null,
            bytes:Number(slot.bytes)||0,
            errorClass,
            apiLabel:slot.apiLabel||null,
            apiMode:slot.apiMode||group.apiMode||null,
            apiProfileId:slot.apiProfileId||group.apiProfileId||null,
            fhlImagesPoolSlot:Number.isInteger(slot.fhlImagesPoolSlot)?slot.fhlImagesPoolSlot:null,
            queueSequence:Number.isFinite(Number(slot.queueSequence))?Number(slot.queueSequence):0,
            reservationActive:slot.reservationActive===true,
            reservationKind:slot.reservationKind||null,
            reservationSlot:Number.isInteger(slot.reservationSlot)?slot.reservationSlot:0,
            cancelRequested:slot.cancelRequested===true,
            settledAt:slot.settledAt||null,
            createdAt:slot.createdAt||null,
            startedAt:slot.startedAt||null,
            finishedAt:slot.finishedAt||null,
            updatedAt:slot.updatedAt||null
          };
        })
      }))
    });
  };
  window.__imageStudioNativeReject=(id,message)=>{
    if(id!==requestId){if(previousReject)previousReject(id,message);return;}
    restore();
    reject(new Error(String(message)));
  };
  window.AndroidImageStudio.invoke(requestId,"ListAndroidJobs",JSON.stringify([workspaceId,700]));
}))()
'@.Replace("__WORKSPACE_JSON__", $workspaceJson)
    return Invoke-CdpExpression -Expression $expression
}

function Get-NativeRegistrySummaryFromBridge {
    if (-not $script:ForwardEstablished -or [string]::IsNullOrWhiteSpace($script:ResolvedWorkspaceId)) {
        throw "ReleaseLogcat registry evidence requires an active WebView Bridge and resolved workspace; run-as fallback is forbidden."
    }
    $snapshot = Get-RedactedJobSnapshot -ResolvedWorkspaceId $script:ResolvedWorkspaceId
    if ([string]$snapshot.workspaceId -ne $script:ResolvedWorkspaceId) {
        throw "ReleaseLogcat Bridge returned a different workspace."
    }
    $groups = @(
        foreach ($group in @($snapshot.groups)) {
            [pscustomobject][ordered]@{
                groupId = [string]$group.groupId
                workspaceId = [string]$group.workspaceId
                clientSubmissionId = [string]$group.clientSubmissionId
                requestRunId = [string]$group.requestRunId
                createdAt = if ($null -ne $group.createdAt) { [long]$group.createdAt } else { 0L }
                apiMode = [string]$group.apiMode
                apiProfileId = [string]$group.apiProfileId
                apiLabel = [string]$group.apiLabel
                fhlImagesPoolSlot = if ($null -ne $group.fhlImagesPoolSlot) { [int]$group.fhlImagesPoolSlot } else { $null }
                slots = @(
                    foreach ($slot in @($group.slots)) {
                        [pscustomobject][ordered]@{
                            jobId = [string]$slot.jobId
                            status = [string]$slot.status
                            stage = [string]$slot.stage
                            bytes = [long]$slot.bytes
                            createdAt = if ($null -ne $slot.createdAt) { [long]$slot.createdAt } else { $null }
                            startedAt = if ($null -ne $slot.startedAt) { [long]$slot.startedAt } else { $null }
                            finishedAt = if ($null -ne $slot.finishedAt) { [long]$slot.finishedAt } else { $null }
                            updatedAt = if ($null -ne $slot.updatedAt) { [long]$slot.updatedAt } else { 0L }
                            queueSequence = [long]$slot.queueSequence
                            reservationActive = [bool]$slot.reservationActive
                            reservationKind = [string]$slot.reservationKind
                            reservationSlot = [int]$slot.reservationSlot
                            cancelRequested = [bool]$slot.cancelRequested
                            settledAt = if ($null -ne $slot.settledAt) { [long]$slot.settledAt } else { $null }
                            errorClass = [string]$slot.errorClass
                            apiMode = [string]$slot.apiMode
                            apiProfileId = [string]$slot.apiProfileId
                            apiLabel = [string]$slot.apiLabel
                            fhlImagesPoolSlot = if ($null -ne $slot.fhlImagesPoolSlot) { [int]$slot.fhlImagesPoolSlot } else { $null }
                        }
                    }
                )
            }
        }
    )
    $taskIds = @($groups | ForEach-Object { @($_.slots) } | ForEach-Object { [string]$_.jobId } | Where-Object { $_ })
    return [pscustomobject][ordered]@{
        groups = $groups
        groupIds = @($groups | ForEach-Object { [string]$_.groupId } | Where-Object { $_ })
        taskIds = $taskIds
        pendingCount = @($groups | ForEach-Object { @($_.slots) } | Where-Object { @("queued", "running") -contains [string]$_.status }).Count
    }
}

function Get-RedactedNativeAuditEventsFromRunAs {
    $includedTypes = @(
        "submit",
        "slot_claimed",
        "slot_reservation_released",
        "slot_terminal",
        "slot_error",
        "slot_cancelled",
        "upstream_submit_attempt"
    )
    for ($readAttempt = 1; $readAttempt -le 5; $readAttempt += 1) {
        $raw = Get-RunAsFileText -RelativePath "files/jobs/android-job-audit.v1.jsonl"
        if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
        $lines = @($raw -split "`r?`n")
        $lastContentIndex = -1
        for ($index = $lines.Count - 1; $index -ge 0; $index -= 1) {
            if (-not [string]::IsNullOrWhiteSpace([string]$lines[$index])) {
                $lastContentIndex = $index
                break
            }
        }
        $tailWasIncomplete = $false
        $events = @()
        $identityOccurrences = @{}
        for ($index = 0; $index -le $lastContentIndex; $index += 1) {
            $line = [string]$lines[$index]
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $record = $line | ConvertFrom-Json
            }
            catch {
                if ($index -eq $lastContentIndex) {
                    $tailWasIncomplete = $true
                    break
                }
                throw "The redacted native audit contains an invalid intermediate JSONL record at line $($index + 1)."
            }
            $type = [string]$record.type
            if ($includedTypes -notcontains $type) { continue }
            $details = $record.details
            $baseIdentity = "$([long]$record.timestamp)|$type|$([string]$details.groupId)|$([string]$details.jobId)|$([long]$details.queueSequence)"
            $identityOccurrences[$baseIdentity] = [int]($identityOccurrences[$baseIdentity]) + 1
            $events += [pscustomobject][ordered]@{
                sourceOccurrence = [int]($identityOccurrences[$baseIdentity])
                sourceProcessId = [string]$record.processId
                processSessionId = [string]$record.processSessionId
                auditSequence = if ($null -ne $record.auditSequence) { [long]$record.auditSequence } else { 0L }
                timestamp = [long]$record.timestamp
                type = $type
                groupId = [string]$details.groupId
                jobId = [string]$details.jobId
                clientSubmissionId = [string]$details.clientSubmissionId
                requestRunId = [string]$details.requestRunId
                apiMode = [string]$details.apiMode
                apiLabel = [string]$details.apiLabel
                fhlImagesPoolSlot = [int]$details.fhlImagesPoolSlot
                queueSequence = [long]$details.queueSequence
                reservationActive = [bool]$details.reservationActive
                reservationKind = [string]$details.reservationKind
                reservationSlot = [int]$details.reservationSlot
                status = [string]$details.status
                errorMessageChars = [int]$details.errorMessageChars
            }
        }
        if (-not $tailWasIncomplete) { return @($events) }
        Start-Sleep -Milliseconds 100
    }
    throw "The redacted native audit retained an incomplete final JSONL record after five reads."
}

function ConvertFrom-ReleaseLogcatAuditText {
    param(
        [AllowEmptyString()][string]$Raw,
        [AllowEmptyCollection()][string[]]$AllowedProcessIds = @()
    )

    if ([string]::IsNullOrWhiteSpace($Raw)) {
        if (@($AllowedProcessIds | Where-Object { $_ }).Count -gt 0) {
            throw "ReleaseLogcat contains no authenticated process audit sentinel."
        }
        return @()
    }
    $includedTypes = @(
        "process_started",
        "submit",
        "slot_snapshot",
        "slot_claimed",
        "slot_reservation_released",
        "slot_terminal",
        "slot_error",
        "slot_cancelled",
        "upstream_submit_attempt"
    )
    $events = @()
    $identityOccurrences = @{}
    $lastSequenceBySession = @{}
    $processBySession = @{}
    $allowedPids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($allowedPid in @($AllowedProcessIds)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$allowedPid)) { [void]$allowedPids.Add([string]$allowedPid) }
    }
    $lines = @($Raw -split "`r?`n")
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        $line = [string]$lines[$index]
        if ([string]::IsNullOrWhiteSpace($line) -or $line -notmatch "FHLImageStudioJobs") { continue }
        if ($line -notmatch "Job audit") { continue }
        $match = [Regex]::Match(
            $line,
            "^\s*\d+(?:\.\d+)?\s+(\d+)\s+\d+\s+[A-Z]\s+FHLImageStudioJobs\s*:\s*Job audit\s+(\{.*\})\s*$"
        )
        if (-not $match.Success) {
            throw "ReleaseLogcat contains a missing or truncated Job audit record at physical line $($index + 1)."
        }
        $sourceProcessId = $match.Groups[1].Value
        if ($allowedPids.Count -gt 0 -and -not $allowedPids.Contains($sourceProcessId)) { continue }
        $jsonText = $match.Groups[2].Value
        if ($jsonText -match "(?i)\bsk-[a-z0-9_-]{12,}\b" -or
            (-not [string]::IsNullOrWhiteSpace($PromptText) -and $jsonText.Contains($PromptText))) {
            throw "ReleaseLogcat contained forbidden credential or prompt text."
        }
        if ($jsonText -match '(?i)"(?:apiKey|prompt|negativePrompt|apiProfileName|keyHint)"\s*:') {
            throw "ReleaseLogcat Job audit schema exposed a forbidden credential or prompt field."
        }
        try { $record = $jsonText | ConvertFrom-Json } catch {
            throw "ReleaseLogcat contains invalid Job audit JSON at physical line $($index + 1)."
        }
        $allowedRecordFields = @("version", "timestamp", "processSessionId", "processId", "auditSequence", "type", "details")
        if (@($record.PSObject.Properties.Name | Where-Object { $allowedRecordFields -notcontains $_ }).Count -gt 0) {
            throw "ReleaseLogcat Job audit contains an unknown top-level field."
        }
        if ([int]$record.version -ne 2) { throw "ReleaseLogcat contains an unsupported Job audit version." }
        $recordProcessId = [string]$record.processId
        $recordSessionId = [string]$record.processSessionId
        $recordSequence = [long]$record.auditSequence
        if ($recordProcessId -ne $sourceProcessId -or $recordSessionId -notmatch '^android-process-[0-9a-f-]{36}$') {
            throw "ReleaseLogcat Job audit source PID or process session is invalid."
        }
        if ($processBySession.ContainsKey($recordSessionId) -and [string]$processBySession[$recordSessionId] -ne $sourceProcessId) {
            throw "ReleaseLogcat process session moved between source PIDs."
        }
        $processBySession[$recordSessionId] = $sourceProcessId
        $expectedSequence = if ($lastSequenceBySession.ContainsKey($recordSessionId)) {
            [long]$lastSequenceBySession[$recordSessionId] + 1L
        }
        else {
            1L
        }
        if ($recordSequence -ne $expectedSequence) {
            throw "ReleaseLogcat audit sequence has a gap, duplicate, or ring-buffer truncation."
        }
        $lastSequenceBySession[$recordSessionId] = $recordSequence
        $type = [string]$record.type
        if ($recordSequence -eq 1L -and $type -ne "process_started") {
            throw "ReleaseLogcat process session does not begin with process_started."
        }
        if ($includedTypes -notcontains $type) { continue }
        if ($null -eq $record.details) { throw "ReleaseLogcat Job audit record is missing details." }
        $details = $record.details
        $allowedDetailFields = @(
            "registryVersion", "groupId", "jobId", "clientSubmissionId", "workspaceId", "requestRunId",
            "mode", "apiMode", "apiLabel", "apiProfileId", "fhlImagesPoolSlot", "baseURLHost",
            "size", "quality", "outputFormat", "batchCount", "continuousGenerateTest",
            "continuousBatchIndex", "concurrencyLimit", "sourceCount", "promptChars", "negativePromptChars",
            "slotIds", "queueSequence", "reservationActive", "reservationSessionId", "reservationKind",
            "reservationSlot", "reservationLaneKey", "cancelRequested", "settledAt", "batchIndex", "status",
            "stage", "elapsedSec", "bytes", "hasRawPath", "hasSavedImage", "hasGalleryUri", "errorMessageChars"
        )
        if (@($details.PSObject.Properties.Name | Where-Object { $allowedDetailFields -notcontains $_ }).Count -gt 0) {
            throw "ReleaseLogcat Job audit contains an unknown details field."
        }
        if ($type -eq "process_started" -and ([int]$details.registryVersion -lt 1 -or $details.PSObject.Properties.Count -ne 1)) {
            throw "ReleaseLogcat process_started details are invalid."
        }
        $baseIdentity = "$([long]$record.timestamp)|$type|$([string]$details.groupId)|$([string]$details.jobId)|$([long]$details.queueSequence)"
        $identityOccurrences[$baseIdentity] = [int]($identityOccurrences[$baseIdentity]) + 1
        $events += [pscustomobject][ordered]@{
            captureOrder = $events.Count + 1
            sourceOccurrence = [int]$identityOccurrences[$baseIdentity]
            physicalLine = $index + 1
            sourceProcessId = $sourceProcessId
            processSessionId = $recordSessionId
            auditSequence = $recordSequence
            timestamp = [long]$record.timestamp
            type = $type
            groupId = [string]$details.groupId
            jobId = [string]$details.jobId
            clientSubmissionId = [string]$details.clientSubmissionId
            requestRunId = [string]$details.requestRunId
            apiMode = [string]$details.apiMode
            apiLabel = [string]$details.apiLabel
            fhlImagesPoolSlot = [int]$details.fhlImagesPoolSlot
            queueSequence = [long]$details.queueSequence
            reservationActive = [bool]$details.reservationActive
            reservationKind = [string]$details.reservationKind
            reservationSlot = [int]$details.reservationSlot
            status = [string]$details.status
            errorMessageChars = [int]$details.errorMessageChars
            registryVersion = [int]$details.registryVersion
        }
    }
    if ($allowedPids.Count -gt 0) {
        foreach ($allowedPid in $allowedPids) {
            if (@($events | Where-Object { $_.sourceProcessId -eq $allowedPid -and $_.type -eq "process_started" }).Count -lt 1) {
                throw "ReleaseLogcat is missing a process_started sentinel for an authenticated App PID."
            }
        }
        foreach ($sessionId in $processBySession.Keys) {
            if (@($events | Where-Object { $_.processSessionId -eq $sessionId -and $_.type -eq "process_started" }).Count -ne 1) {
                throw "ReleaseLogcat process session does not contain exactly one process_started sentinel."
            }
        }
    }
    return @($events)
}

function Get-ReleaseLogcatRaw {
    if (-not $script:AdbExecutable) { throw "ReleaseLogcat evidence requires adb." }
    return Invoke-AdbText -Arguments @(
        "-s", $Device, "logcat", "-d", "-v", "epoch", "-s", "FHLImageStudioJobs:I", "*:S"
    )
}

function Get-RedactedNativeAuditEventsFromReleaseLogcat {
    $raw = Get-ReleaseLogcatRaw
    if ($script:ReleaseLogcatProcessIds.Count -eq 0) {
        throw "ReleaseLogcat has no authenticated App process PID."
    }
    return @(ConvertFrom-ReleaseLogcatAuditText -Raw $raw -AllowedProcessIds @($script:ReleaseLogcatProcessIds))
}

function Write-ReleaseLogcatArtifact {
    if ($EvidenceSource -ne "ReleaseLogcat") { return "" }
    $raw = Get-ReleaseLogcatRaw
    $events = @(ConvertFrom-ReleaseLogcatAuditText -Raw $raw -AllowedProcessIds @($script:ReleaseLogcatProcessIds))
    $allowedLines = @(
        foreach ($event in $events) {
            $safeDetails = if ([string]$event.type -eq "process_started") {
                [ordered]@{ registryVersion = [int]$event.registryVersion }
            }
            else {
                [ordered]@{
                    groupId = [string]$event.groupId
                    jobId = [string]$event.jobId
                    clientSubmissionId = [string]$event.clientSubmissionId
                    requestRunId = [string]$event.requestRunId
                    apiMode = [string]$event.apiMode
                    apiLabel = [string]$event.apiLabel
                    fhlImagesPoolSlot = [int]$event.fhlImagesPoolSlot
                    queueSequence = [long]$event.queueSequence
                    reservationActive = [bool]$event.reservationActive
                    reservationKind = [string]$event.reservationKind
                    reservationSlot = [int]$event.reservationSlot
                    status = [string]$event.status
                    errorMessageChars = [int]$event.errorMessageChars
                }
            }
            $safeRecord = [ordered]@{
                version = 2
                timestamp = [long]$event.timestamp
                processSessionId = [string]$event.processSessionId
                processId = [int]$event.sourceProcessId
                auditSequence = [long]$event.auditSequence
                type = [string]$event.type
                details = $safeDetails
            }
            $epoch = ([double]$event.timestamp) / 1000.0
            "{0:F3} {1} {1} I FHLImageStudioJobs: Job audit {2}" -f $epoch, $event.sourceProcessId, ($safeRecord | ConvertTo-Json -Depth 6 -Compress)
        }
    )
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    [IO.File]::WriteAllLines($releaseLogcatPath, $allowedLines, [Text.UTF8Encoding]::new($false))
    return [IO.Path]::GetFileName($releaseLogcatPath)
}

function Get-RedactedNativeAuditEvents {
    if ($EvidenceSource -eq "DebugRunAs") {
        return @(Get-RedactedNativeAuditEventsFromRunAs)
    }
    if ($EvidenceSource -eq "ReleaseLogcat") {
        return @(Get-RedactedNativeAuditEventsFromReleaseLogcat)
    }
    throw "Unsupported evidence source: $EvidenceSource"
}

function Get-NativeAuditEventIdentity {
    param([Parameter(Mandatory = $true)][object]$Event)
    return "$($Event.processSessionId)|$($Event.auditSequence)|$($Event.timestamp)|$($Event.type)|$($Event.groupId)|$($Event.jobId)|$($Event.queueSequence)|$($Event.sourceOccurrence)"
}

function Initialize-LoadAuditCapture {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$BaselineEvents)

    $script:LoadAuditBaselineIdentities = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($event in $BaselineEvents) {
        [void]$script:LoadAuditBaselineIdentities.Add((Get-NativeAuditEventIdentity -Event $event))
    }
    $script:LoadAuditEvents = [ordered]@{}
    $script:LoadAuditCaptureOrder = 0
}

function Capture-LoadAuditEvents {
    if ($null -eq $script:LoadAuditBaselineIdentities) {
        throw "Load audit capture was not initialized."
    }
    foreach ($event in @(Get-RedactedNativeAuditEvents)) {
        $identity = Get-NativeAuditEventIdentity -Event $event
        if ($script:LoadAuditBaselineIdentities.Contains($identity) -or $script:LoadAuditEvents.Contains($identity)) {
            continue
        }
        $script:LoadAuditCaptureOrder += 1
        $script:LoadAuditEvents[$identity] = [pscustomobject][ordered]@{
            captureOrder = $script:LoadAuditCaptureOrder
            sourceOccurrence = [int]$event.sourceOccurrence
            physicalLine = if ($null -ne $event.physicalLine) { [int]$event.physicalLine } else { $null }
            sourceProcessId = [string]$event.sourceProcessId
            processSessionId = [string]$event.processSessionId
            auditSequence = if ($null -ne $event.auditSequence) { [long]$event.auditSequence } else { 0L }
            timestamp = [long]$event.timestamp
            type = [string]$event.type
            groupId = [string]$event.groupId
            jobId = [string]$event.jobId
            clientSubmissionId = [string]$event.clientSubmissionId
            requestRunId = [string]$event.requestRunId
            apiMode = [string]$event.apiMode
            apiLabel = [string]$event.apiLabel
            fhlImagesPoolSlot = [int]$event.fhlImagesPoolSlot
            queueSequence = [long]$event.queueSequence
            reservationActive = [bool]$event.reservationActive
            reservationKind = [string]$event.reservationKind
            reservationSlot = [int]$event.reservationSlot
            status = [string]$event.status
            errorMessageChars = [int]$event.errorMessageChars
        }
    }
    return @($script:LoadAuditEvents.Values)
}

function Get-CapturedLoadAttempts {
    return @(
        $script:LoadAuditEvents.Values |
            Where-Object { [string]$_.type -eq "upstream_submit_attempt" } |
            ForEach-Object {
                [pscustomobject][ordered]@{
                    timestamp = [long]$_.timestamp
                    groupId = [string]$_.groupId
                    jobId = [string]$_.jobId
                    clientSubmissionId = [string]$_.clientSubmissionId
                    requestRunId = [string]$_.requestRunId
                    apiMode = [string]$_.apiMode
                    apiLabel = [string]$_.apiLabel
                    fhlImagesPoolSlot = [int]$_.fhlImagesPoolSlot
                }
            }
    )
}

function Get-UpstreamSubmitAttempts {
    try {
        return @(
            Get-RedactedNativeAuditEvents |
                Where-Object { [string]$_.type -eq "upstream_submit_attempt" } |
                ForEach-Object {
                    [pscustomobject][ordered]@{
                        timestamp = [long]$_.timestamp
                        groupId = [string]$_.groupId
                        jobId = [string]$_.jobId
                        clientSubmissionId = [string]$_.clientSubmissionId
                        requestRunId = [string]$_.requestRunId
                        apiMode = [string]$_.apiMode
                        apiLabel = [string]$_.apiLabel
                        fhlImagesPoolSlot = [int]$_.fhlImagesPoolSlot
                    }
                }
        )
    }
    catch {
        throw "The redacted upstream-attempt audit could not be parsed safely: $(ConvertTo-RedactedText $_.Exception.Message)"
    }
}

function Get-AttemptIdentity {
    param([Parameter(Mandatory = $true)][object]$Attempt)
    return "$($Attempt.timestamp)|$($Attempt.groupId)|$($Attempt.jobId)|$($Attempt.apiMode)"
}

function Get-NewAttempts {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After
    )

    $known = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($attempt in $Before) { [void]$known.Add((Get-AttemptIdentity $attempt)) }
    return @($After | Where-Object { -not $known.Contains((Get-AttemptIdentity $_)) })
}

function Set-PromptAndReadiness {
    $promptJson = $PromptText | ConvertTo-Json -Compress
    $expression = @'
(async()=>{
  const promptText=__PROMPT_JSON__;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const parameterButton=document.querySelector("button.android-nav-button");
  if(parameterButton)parameterButton.click();
  await delay(500);
  const prompt=document.querySelector("textarea.android-phone-prompt-input");
  if(!prompt) throw new Error("Prompt textarea was not found.");
  const descriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");
  const setter=descriptor&&descriptor.set;
  if(!setter) throw new Error("Textarea value setter was not found.");
  setter.call(prompt,promptText);
  prompt.dispatchEvent(new Event("input",{bubbles:true}));
  prompt.dispatchEvent(new Event("change",{bubbles:true}));
  let stableSamples=0;
  let submit=null;
  let stableSubmit=null;
  let uniqueSubmitCount=0;
  const findExactSubmit=()=>[...document.querySelectorAll(".android-phone-compose .android-phone-sticky-cta > button.liquid-primary-button")]
    .filter(button=>{
      const label=(button.textContent||"").trim();
      const rect=button.getBoundingClientRect();
      return (label==="\u5f00\u59cb\u751f\u6210"||label==="\u5f00\u59cb\u7f16\u8f91")&&rect.width>0&&rect.height>0;
    });
  const stableDeadline=Date.now()+15000;
  while(Date.now()<stableDeadline&&stableSamples<6){
    const currentPrompt=document.querySelector("textarea.android-phone-prompt-input");
    const studio=document.querySelector(".studio");
    const currentView=studio&&studio.getAttribute("data-android-view")||null;
    const candidates=findExactSubmit();
    uniqueSubmitCount=candidates.length;
    submit=candidates[0]||null;
    if(currentView==="compose"&&currentPrompt&&currentPrompt.value===promptText&&uniqueSubmitCount===1&&submit&&!submit.disabled){
      if(submit===stableSubmit){
        stableSamples+=1;
      }else{
        stableSubmit=submit;
        stableSamples=1;
      }
    }else{
      stableSamples=0;
      stableSubmit=null;
      if(currentPrompt&&currentPrompt.value!==promptText){
        setter.call(currentPrompt,promptText);
        currentPrompt.dispatchEvent(new Event("input",{bubbles:true}));
        currentPrompt.dispatchEvent(new Event("change",{bubbles:true}));
      }
    }
    await delay(250);
  }
  const currentPrompt=document.querySelector("textarea.android-phone-prompt-input");
  const finalCandidates=findExactSubmit();
  uniqueSubmitCount=finalCandidates.length;
  submit=finalCandidates[0]||null;
  return {
    promptLength:currentPrompt?currentPrompt.value.length:0,
    submitPresent:Boolean(submit),
    submitDisabled:Boolean(submit&&submit.disabled),
    submitKind:(submit&&submit.textContent||"").trim()==="\u5f00\u59cb\u751f\u6210"?"generate":"edit",
    uniqueSubmitCount,
    submitIdentityStable:Boolean(submit&&submit===stableSubmit),
    stableSamples,
    currentView:(document.querySelector(".studio")&&document.querySelector(".studio").getAttribute("data-android-view"))||null
  };
})()
'@.Replace("__PROMPT_JSON__", $promptJson)
    return Invoke-CdpExpression -Expression $expression
}

function Wait-AndroidBootstrapReady {
    $expression = @'
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const findExactSubmit=()=>[...document.querySelectorAll(".android-phone-compose .android-phone-sticky-cta > button.liquid-primary-button")]
    .filter(button=>{
      const label=(button.textContent||"").trim();
      const rect=button.getBoundingClientRect();
      return (label==="\u5f00\u59cb\u751f\u6210"||label==="\u5f00\u59cb\u7f16\u8f91")&&rect.width>0&&rect.height>0;
    });
  let stableSamples=0;
  let stableSubmit=null;
  let submit=null;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline&&stableSamples<8){
    let studio=document.querySelector(".studio");
    let currentView=studio&&studio.getAttribute("data-android-view")||null;
    if(currentView!=="compose"){
      const firstNavigationButton=document.querySelector("button.android-nav-button");
      if(firstNavigationButton)firstNavigationButton.click();
      await delay(250);
      studio=document.querySelector(".studio");
      currentView=studio&&studio.getAttribute("data-android-view")||null;
    }
    const candidates=findExactSubmit();
    submit=candidates[0]||null;
    if(currentView==="compose"&&candidates.length===1&&submit){
      if(submit===stableSubmit){
        stableSamples+=1;
      }else{
        stableSubmit=submit;
        stableSamples=1;
      }
    }else{
      stableSamples=0;
      stableSubmit=null;
    }
    await delay(250);
  }
  const candidates=findExactSubmit();
  submit=candidates[0]||null;
  return {
    currentView:(document.querySelector(".studio")&&document.querySelector(".studio").getAttribute("data-android-view"))||null,
    stableSamples,
    uniqueSubmitCount:candidates.length,
    submitIdentityStable:Boolean(submit&&submit===stableSubmit),
    submitKind:(submit&&submit.textContent||"").trim()==="\u5f00\u59cb\u751f\u6210"?"generate":"edit"
  };
})()
'@
    $ready = Invoke-CdpExpression -Expression $expression -TimeoutSeconds 40
    if (
        [string]$ready.currentView -ne "compose" -or
        [int]$ready.stableSamples -lt 8 -or
        [int]$ready.uniqueSubmitCount -ne 1 -or
        -not [bool]$ready.submitIdentityStable -or
        @("generate", "edit") -notcontains [string]$ready.submitKind
    ) {
        throw "Android bootstrap did not expose one stable compose submit action."
    }
    return $ready
}

function Wait-AndroidFreshInstallReady {
    $expression = @'
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const setupLabel="\u914d\u7f6e\u4e0a\u6e38";
  const paidLabels=new Set(["\u5f00\u59cb\u751f\u6210","\u5f00\u59cb\u7f16\u8f91","\u8ffd\u52a0\u751f\u6210"]);
  const visible=element=>{
    if(!element)return false;
    const rect=element.getBoundingClientRect();
    return rect.width>0&&rect.height>0;
  };
  const read=()=>{
    const studio=document.querySelector(".studio");
    const sticky=document.querySelector(".android-phone-compose .android-phone-sticky-cta");
    const setupButtons=[...(sticky?sticky.querySelectorAll("button.liquid-primary-button"):[])]
      .filter(button=>(button.textContent||"").trim()===setupLabel&&visible(button));
    const paidButtons=[...document.querySelectorAll(".android-phone-compose button.liquid-primary-button")]
      .filter(button=>paidLabels.has((button.textContent||"").trim())&&visible(button));
    const images=document.querySelector('[data-audit-id="fhl-transport-images"]');
    const responses=document.querySelector('[data-audit-id="fhl-transport-responses"]');
    return {
      currentView:studio&&studio.getAttribute("data-android-view")||null,
      composePresent:Boolean(document.querySelector(".android-phone-compose")),
      stickyPresent:Boolean(sticky),
      setupCount:setupButtons.length,
      setupButton:setupButtons[0]||null,
      paidCount:paidButtons.length,
      imagesPressed:images&&images.getAttribute("aria-pressed")||null,
      responsesPressed:responses&&responses.getAttribute("aria-pressed")||null,
      imagesVisible:visible(images),
      responsesVisible:visible(responses)
    };
  };
  let stableSamples=0;
  let stableSetup=null;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline&&stableSamples<8){
    let state=read();
    if(state.currentView!=="compose"){
      const firstNavigationButton=document.querySelector("button.android-nav-button");
      if(firstNavigationButton)firstNavigationButton.click();
      await delay(250);
      state=read();
    }
    const valid=state.currentView==="compose"&&state.composePresent&&state.stickyPresent&&
      state.setupCount===1&&state.paidCount===0&&state.imagesPressed==="true"&&
      state.responsesPressed==="false"&&state.imagesVisible&&state.responsesVisible;
    if(valid){
      if(state.setupButton===stableSetup){stableSamples+=1;}
      else{stableSetup=state.setupButton;stableSamples=1;}
    }else{
      stableSamples=0;
      stableSetup=null;
    }
    await delay(250);
  }
  const state=read();
  return {
    currentView:state.currentView,
    stableSamples,
    setupCount:state.setupCount,
    paidCount:state.paidCount,
    setupIdentityStable:Boolean(state.setupButton&&state.setupButton===stableSetup),
    imagesPressed:state.imagesPressed,
    responsesPressed:state.responsesPressed,
    imagesVisible:state.imagesVisible,
    responsesVisible:state.responsesVisible,
    readyKind:"setup"
  };
})()
'@
    $ready = Invoke-CdpExpression -Expression $expression -TimeoutSeconds 40
    if (
        [string]$ready.currentView -ne "compose" -or
        [int]$ready.stableSamples -lt 8 -or
        [int]$ready.setupCount -ne 1 -or
        [int]$ready.paidCount -ne 0 -or
        -not [bool]$ready.setupIdentityStable -or
        [string]$ready.imagesPressed -ne "true" -or
        [string]$ready.responsesPressed -ne "false" -or
        -not [bool]$ready.imagesVisible -or
        -not [bool]$ready.responsesVisible -or
        [string]$ready.readyKind -ne "setup"
    ) {
        throw "Android fresh install did not keep the default Images setup state stable."
    }
    return $ready
}

function Wait-AndroidMatrixStartupReady {
    $expression = @'
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const setupLabel="\u914d\u7f6e\u4e0a\u6e38";
  const actionKinds=new Map([
    ["\u5f00\u59cb\u751f\u6210","generate"],
    ["\u5f00\u59cb\u7f16\u8f91","edit"]
  ]);
  const visible=element=>{
    if(!element)return false;
    const rect=element.getBoundingClientRect();
    return rect.width>0&&rect.height>0;
  };
  const read=()=>{
    const studio=document.querySelector(".studio");
    const roots=[...document.querySelectorAll(".android-phone-compose,.android-pad-compose")].filter(visible);
    const root=roots[0]||null;
    const actionSelector=root&&root.classList.contains("android-pad-compose")
      ?".android-pad-side-cta > button.liquid-primary-button,.android-pad-cta > button.liquid-primary-button"
      :".android-phone-sticky-cta > button.liquid-primary-button";
    const buttons=root?[...root.querySelectorAll(actionSelector)].filter(visible):[];
    const setup=buttons.filter(button=>(button.textContent||"").trim()===setupLabel);
    const paid=buttons.filter(button=>actionKinds.has((button.textContent||"").trim()));
    const action=setup.length===1&&paid.length===0?setup[0]:paid.length===1&&setup.length===0?paid[0]:null;
    const label=(action&&action.textContent||"").trim();
    const kind=label===setupLabel?"setup":actionKinds.get(label)||"invalid";
    const rect=root&&root.getBoundingClientRect();
    return {
      currentView:studio&&studio.getAttribute("data-android-view")||null,
      rootCount:roots.length,
      action,
      setupCount:setup.length,
      paidCount:paid.length,
      readyKind:kind,
      targetPlatform:String(document.documentElement.getAttribute("data-target-platform")||""),
      rootWidth:rect?Math.round(rect.width):0,
      rootHeight:rect?Math.round(rect.height):0,
      viewportWidth:window.innerWidth,
      viewportHeight:window.innerHeight,
      scrollWidth:document.documentElement.scrollWidth,
      scrollHeight:document.documentElement.scrollHeight
    };
  };
  let stableSamples=0;
  let stableAction=null;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline&&stableSamples<8){
    let state=read();
    if(state.currentView!=="compose"){
      const navigation=[...document.querySelectorAll("button")].find(button=>{
        const label=(button.textContent||"").trim();
        return (label==="\u53c2\u6570"||label==="\u521b\u4f5c")&&visible(button);
      });
      if(navigation)navigation.click();
      await delay(250);
      state=read();
    }
    const valid=state.currentView==="compose"&&state.rootCount===1&&state.action&&
      ["setup","generate","edit"].includes(state.readyKind);
    if(valid){
      if(state.action===stableAction)stableSamples+=1;
      else{stableAction=state.action;stableSamples=1;}
    }else{
      stableSamples=0;
      stableAction=null;
    }
    await delay(250);
  }
  const state=read();
  return {
    currentView:state.currentView,
    stableSamples,
    rootCount:state.rootCount,
    setupCount:state.setupCount,
    paidCount:state.paidCount,
    readyKind:state.readyKind,
    actionIdentityStable:Boolean(state.action&&state.action===stableAction),
    targetPlatform:state.targetPlatform,
    rootWidth:state.rootWidth,
    rootHeight:state.rootHeight,
    viewportWidth:state.viewportWidth,
    viewportHeight:state.viewportHeight,
    scrollWidth:state.scrollWidth,
    scrollHeight:state.scrollHeight
  };
})()
'@
    $ready = Invoke-CdpExpression -Expression $expression -TimeoutSeconds 40
    if (
        [string]$ready.currentView -ne "compose" -or
        [int]$ready.stableSamples -lt 8 -or
        [int]$ready.rootCount -ne 1 -or
        -not [bool]$ready.actionIdentityStable -or
        @("setup", "generate", "edit") -notcontains [string]$ready.readyKind -or
        [int]$ready.rootWidth -lt 1 -or
        [int]$ready.rootHeight -lt 1
    ) {
        throw "Android matrix startup did not expose one stable setup or compose action."
    }
    return $ready
}

function Set-MatrixPromptAndReadiness {
    $promptJson = $PromptText | ConvertTo-Json -Compress
    $expression = @'
(async()=>{
  const promptText=__PROMPT_JSON__;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const paidLabels=new Map([
    ["\u5f00\u59cb\u751f\u6210","generate"],
    ["\u5f00\u59cb\u7f16\u8f91","edit"]
  ]);
  const visible=element=>{
    if(!element)return false;
    const rect=element.getBoundingClientRect();
    return rect.width>0&&rect.height>0;
  };
  const read=()=>{
    const roots=[...document.querySelectorAll(".android-phone-compose,.android-pad-compose")].filter(visible);
    const root=roots[0]||null;
    const prompt=root&&root.querySelector("textarea.android-phone-prompt-input,textarea.android-pad-prompt-textarea");
    const submits=root?[...root.querySelectorAll("button.liquid-primary-button")].filter(button=>{
      const label=(button.textContent||"").trim();
      return paidLabels.has(label)&&visible(button);
    }):[];
    const submit=submits[0]||null;
    return {
      roots,root,prompt,submits,submit,
      submitKind:paidLabels.get((submit&&submit.textContent||"").trim())||"invalid",
      targetPlatform:String(document.documentElement.getAttribute("data-target-platform")||""),
      currentView:(document.querySelector(".studio")&&document.querySelector(".studio").getAttribute("data-android-view"))||null
    };
  };
  let state=read();
  if(!state.prompt&&state.root){
    const collapsed=state.root.querySelector(".android-prompt-collapsed-preview");
    if(visible(collapsed))collapsed.click();
    await delay(300);
    state=read();
  }
  if(state.roots.length!==1||!state.prompt)throw new Error("Exactly one visible phone or tablet prompt textarea was not found.");
  const descriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");
  const setter=descriptor&&descriptor.set;
  if(!setter)throw new Error("Textarea value setter was not found.");
  setter.call(state.prompt,promptText);
  state.prompt.dispatchEvent(new Event("input",{bubbles:true}));
  state.prompt.dispatchEvent(new Event("change",{bubbles:true}));
  let stableSamples=0;
  let stableSubmit=null;
  const deadline=Date.now()+15000;
  while(Date.now()<deadline&&stableSamples<6){
    state=read();
    const ready=state.currentView==="compose"&&state.roots.length===1&&state.prompt&&
      state.prompt.value===promptText&&state.submits.length===1&&state.submit&&!state.submit.disabled&&
      ["generate","edit"].includes(state.submitKind)&&["android","android-pad"].includes(state.targetPlatform);
    if(ready){
      if(state.submit===stableSubmit)stableSamples+=1;
      else{stableSubmit=state.submit;stableSamples=1;}
    }else{
      stableSamples=0;
      stableSubmit=null;
      if(state.prompt&&state.prompt.value!==promptText){
        setter.call(state.prompt,promptText);
        state.prompt.dispatchEvent(new Event("input",{bubbles:true}));
        state.prompt.dispatchEvent(new Event("change",{bubbles:true}));
      }
    }
    await delay(250);
  }
  state=read();
  return {
    promptLength:state.prompt?state.prompt.value.length:0,
    submitPresent:Boolean(state.submit),
    submitDisabled:Boolean(state.submit&&state.submit.disabled),
    submitKind:state.submitKind,
    uniqueSubmitCount:state.submits.length,
    submitIdentityStable:Boolean(state.submit&&state.submit===stableSubmit),
    stableSamples,
    currentView:state.currentView,
    targetPlatform:state.targetPlatform,
    composeKind:state.root&&state.root.classList.contains("android-pad-compose")?"tablet":"phone"
  };
})()
'@.Replace("__PROMPT_JSON__", $promptJson)
    $ready = Invoke-CdpExpression -Expression $expression
    Assert-SubmitReadiness -Readiness $ready -Context "MatrixSingle"
    if ([string]$ready.targetPlatform -notin @("android", "android-pad") -or [string]$ready.composeKind -notin @("phone", "tablet")) {
        throw "MatrixSingle did not resolve a supported phone or tablet compose surface."
    }
    if (
        ([string]$ready.targetPlatform -eq "android" -and [string]$ready.composeKind -ne "phone") -or
        ([string]$ready.targetPlatform -eq "android-pad" -and [string]$ready.composeKind -ne "tablet")
    ) {
        throw "MatrixSingle target-platform and compose surface do not match."
    }
    return $ready
}

function Click-MatrixGenerateOnce {
    $promptJson = $PromptText | ConvertTo-Json -Compress
    $expression = @'
(()=>{
  const promptText=__PROMPT_JSON__;
  const paidLabels=new Map([
    ["\u5f00\u59cb\u751f\u6210","generate"],
    ["\u5f00\u59cb\u7f16\u8f91","edit"]
  ]);
  const visible=element=>{
    if(!element)return false;
    const rect=element.getBoundingClientRect();
    return rect.width>0&&rect.height>0;
  };
  const roots=[...document.querySelectorAll(".android-phone-compose,.android-pad-compose")].filter(visible);
  if(roots.length!==1)throw new Error("Exactly one visible phone or tablet compose surface was not found.");
  const root=roots[0];
  const prompt=root.querySelector("textarea.android-phone-prompt-input,textarea.android-pad-prompt-textarea");
  if(!prompt||prompt.value!==promptText)throw new Error("The matrix prompt changed before the explicit click.");
  const candidates=[...root.querySelectorAll("button.liquid-primary-button")].filter(button=>{
    const label=(button.textContent||"").trim();
    return paidLabels.has(label)&&visible(button);
  });
  if(candidates.length!==1)throw new Error("Exactly one visible phone or tablet submit action was not found.");
  const submit=candidates[0];
  if(submit.disabled)throw new Error("Matrix submit button was disabled.");
  const submitKind=paidLabels.get((submit.textContent||"").trim());
  const targetPlatform=String(document.documentElement.getAttribute("data-target-platform")||"");
  if(!["android","android-pad"].includes(targetPlatform))throw new Error("Matrix submit target platform is invalid.");
  const composeKind=root.classList.contains("android-pad-compose")?"tablet":"phone";
  if((targetPlatform==="android"&&composeKind!=="phone")||(targetPlatform==="android-pad"&&composeKind!=="tablet")){
    throw new Error("Matrix submit target platform and compose surface do not match.");
  }
  const clickedAt=Date.now();
  submit.click();
  return {clicked:true,clickedAt,submitKind,targetPlatform,composeKind};
})()
'@.Replace("__PROMPT_JSON__", $promptJson)
    try {
        return Invoke-CdpExpressionOnce -Expression $expression
    }
    catch {
        throw "The explicit MatrixSingle paid click has an unknown outcome and must not be replayed: $(ConvertTo-RedactedText $_.Exception.Message)"
    }
}

function Click-GenerateOnce {
    $promptJson = $PromptText | ConvertTo-Json -Compress
    $expression = @'
(()=>{
  const promptText=__PROMPT_JSON__;
  const studio=document.querySelector(".studio");
  const currentView=studio&&studio.getAttribute("data-android-view")||null;
  if(currentView!=="compose") throw new Error("The Android compose view is not active.");
  const prompt=document.querySelector("textarea.android-phone-prompt-input");
  if(!prompt||prompt.value!==promptText) throw new Error("The prompt changed before the explicit click.");
  const candidates=[...document.querySelectorAll(".android-phone-compose .android-phone-sticky-cta > button.liquid-primary-button")]
    .filter(button=>{
      const label=(button.textContent||"").trim();
      const rect=button.getBoundingClientRect();
      return (label==="\u5f00\u59cb\u751f\u6210"||label==="\u5f00\u59cb\u7f16\u8f91")&&rect.width>0&&rect.height>0;
    });
  if(candidates.length!==1) throw new Error("Exactly one explicit generate button was not found.");
  const submit=candidates[0];
  if(submit.disabled) throw new Error("Submit button was disabled.");
  const clickedAt=Date.now();
  submit.click();
  const submitKind=(submit.textContent||"").trim()==="\u5f00\u59cb\u751f\u6210"?"generate":"edit";
  return {clicked:true,clickedAt,submitKind,currentView};
})()
'@.Replace("__PROMPT_JSON__", $promptJson)
    try {
        return Invoke-CdpExpressionOnce -Expression $expression
    }
    catch {
        throw "The explicit paid click has an unknown outcome and must not be replayed: $(ConvertTo-RedactedText $_.Exception.Message)"
    }
}

function Invoke-LoadClickBlock {
    param(
        [Parameter(Mandatory = $true)][int]$BlockNumber,
        [Parameter(Mandatory = $true)][int]$ExpectedStartCursor,
        [int]$Count = 10
    )

    if ($Count -ne 10) { throw "A load click block must contain exactly ten explicit clicks." }
    if ($ExpectedStartCursor -lt 1 -or $ExpectedStartCursor -gt 10) { throw "Load click block cursor is invalid." }
    $promptJson = $PromptText | ConvertTo-Json -Compress
    $expression = @'
(async()=>{
  const promptText=__PROMPT_JSON__;
  const expectedStartCursor=__EXPECTED_CURSOR__;
  const count=__COUNT__;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const profileKeys=Object.keys(localStorage).filter(key=>key.endsWith("gptcodex.profiles"));
  if(profileKeys.length!==1) throw new Error("The load block requires one storage namespace.");
  const prefix=profileKeys[0].slice(0,-"gptcodex.profiles".length);
  const cursorKey=prefix+"gptcodex.androidFHLImagesPoolCursor.v1";
  const readCursor=()=>{
    const value=Number(localStorage.getItem(cursorKey));
    return Number.isInteger(value)&&value>=1&&value<=10?value:1;
  };
  if(readCursor()!==expectedStartCursor) throw new Error("The pool cursor changed before the load block.");
  const acceptedLabels=new Set([
    "\u5f00\u59cb\u751f\u6210",
    "\u5f00\u59cb\u7f16\u8f91",
    "\u8ffd\u52a0\u751f\u6210"
  ]);
  const clicks=[];
  for(let index=0;index<count;index+=1){
    const expectedSlot=((expectedStartCursor-1+index)%10)+1;
    if(readCursor()!==expectedSlot) throw new Error("The pool cursor did not reach the next explicit click.");
    const buttonDeadline=Date.now()+8000;
    let submit=null;
    while(Date.now()<buttonDeadline){
      const studio=document.querySelector(".studio");
      const prompt=document.querySelector("textarea.android-phone-prompt-input");
      if(studio&&studio.getAttribute("data-android-view")==="compose"&&prompt&&prompt.value===promptText){
        const candidates=[...document.querySelectorAll(".android-phone-compose .android-phone-sticky-cta button.liquid-primary-button")]
          .filter(button=>{
            const label=(button.textContent||"").trim();
            const rect=button.getBoundingClientRect();
            return acceptedLabels.has(label)&&rect.width>0&&rect.height>0;
          });
        if(candidates.length>1) throw new Error("More than one load submit action is visible.");
        if(candidates.length===1&&!candidates[0].disabled){submit=candidates[0];break;}
      }
      await delay(10);
    }
    if(!submit) throw new Error("The explicit load submit action did not become ready.");
    const clickedAt=Date.now();
    const submitLabel=(submit.textContent||"").trim();
    submit.click();
    const expectedNext=(expectedSlot%10)+1;
    const cursorDeadline=Date.now()+10000;
    while(Date.now()<cursorDeadline&&readCursor()!==expectedNext){
      const observed=readCursor();
      if(observed!==expectedSlot) throw new Error("The pool cursor skipped after an explicit click.");
      await delay(10);
    }
    if(readCursor()!==expectedNext) throw new Error("The native-confirmed pool cursor did not advance after an explicit click.");
    clicks.push({sequence:index+1,expectedSlot,clickedAt,submitLabel});
  }
  return {blockNumber:__BLOCK_NUMBER__,startedCursor:expectedStartCursor,finishedCursor:readCursor(),finishedAt:Date.now(),clicks};
})()
'@
    $expression = $expression.Replace("__PROMPT_JSON__", $promptJson)
    $expression = $expression.Replace("__EXPECTED_CURSOR__", [string]$ExpectedStartCursor)
    $expression = $expression.Replace("__COUNT__", [string]$Count)
    $expression = $expression.Replace("__BLOCK_NUMBER__", [string]$BlockNumber)
    try {
        # This expression performs paid side effects. It must never use the
        # reconnecting wrapper because an unknown outcome cannot be replayed.
        $result = Invoke-CdpExpressionOnce -Expression $expression -TimeoutSeconds 120
    }
    catch {
        throw "Load click block $BlockNumber has an unknown paid outcome and must not be replayed: $(ConvertTo-RedactedText $_.Exception.Message)"
    }
    if ([int]$result.blockNumber -ne $BlockNumber -or @($result.clicks).Count -ne 10) {
        throw "Load click block $BlockNumber did not return ten explicit click receipts."
    }
    return $result
}

function Assert-SubmitReadiness {
    param(
        [Parameter(Mandatory = $true)][object]$Readiness,
        [Parameter(Mandatory = $true)][string]$Context
    )

    if (
        -not $Readiness.submitPresent -or
        $Readiness.submitDisabled -or
        [int]$Readiness.stableSamples -lt 6 -or
        [int]$Readiness.uniqueSubmitCount -ne 1 -or
        -not [bool]$Readiness.submitIdentityStable -or
        [string]$Readiness.currentView -ne "compose" -or
        @("generate", "edit") -notcontains [string]$Readiness.submitKind
    ) {
        throw "$Context submit UI did not keep one exact compose action stable."
    }
    if ([int]$Readiness.promptLength -ne $PromptText.Length) {
        throw "$Context prompt length did not match the supplied test prompt."
    }
}

function Read-HistorySourceLabel {
    $expression = @'
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const navigationButtons=[...document.querySelectorAll("button.android-nav-button")];
  const historyButton=navigationButtons[navigationButtons.length-1];
  if(!historyButton) throw new Error("History navigation was not found.");
  historyButton.click();
  await delay(900);
  const groups=[...document.querySelectorAll("[data-android-history-job-group]")];
  const newestGroup=groups[0]||null;
  const newestSlot=newestGroup&&newestGroup.querySelector(".android-history-job-slot")||null;
  const groupLabelElement=newestGroup&&newestGroup.querySelector(".android-history-job-title > span");
  const slotLabelElement=newestSlot&&newestSlot.querySelector(".android-history-job-source-label, .android-history-job-slot-title em");
  const groupLabel=(groupLabelElement&&groupLabelElement.textContent||"").trim();
  const slotLabel=(slotLabelElement&&slotLabelElement.textContent||"").trim();
  const statuses=["queued","running","failed","cancelled","interrupted"];
  const slotStatus=newestSlot&&newestSlot.classList.contains("success")
    ?"succeeded"
    :statuses.find(status=>newestSlot&&newestSlot.classList.contains(status))||null;
  return {
    currentView:(document.querySelector(".studio")&&document.querySelector(".studio").getAttribute("data-android-view"))||null,
    newestSourceLabel:groupLabel||null,
    newestSlotSourceLabel:slotLabel||null,
    newestSlotStatus:slotStatus,
    groupCount:groups.length
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression
}

function Assert-TenConfiguredSlots {
    param([Parameter(Mandatory = $true)][object]$BrowserState)

    $allSlots = @($BrowserState.poolSlots)
    $configured = @($BrowserState.poolSlots | Where-Object { $_.enabled -and $_.hasKeyHint } | ForEach-Object { [int]$_.slot } | Sort-Object -Unique)
    $expected = @(1..10)
    if ($allSlots.Count -ne 10 -or ($configured -join ",") -ne ($expected -join ",")) {
        throw "The current storage namespace does not contain ten enabled, configured FHL Images slots."
    }
    if ([int]$BrowserState.candidateNamespaceCount -ne 1) {
        throw "localStorage namespace is not unique; verification was blocked before any submitting scenario."
    }
    if ([int]$BrowserState.filledCredentialInputCount -ne 0) {
        throw "A visible credential input was refilled; plaintext credential UI state is not accepted."
    }
    if ([string]$BrowserState.locationHost -ne "appassets.androidplatform.net") {
        throw "The app is not running from the packaged Android appassets host."
    }
}

function Assert-ExpectedFHLTransportMode {
    param(
        [Parameter(Mandatory = $true)][object]$BrowserState,
        [Parameter(Mandatory = $true)][string]$Context
    )

    if ([string]$BrowserState.transportMode -ne $ExpectedFHLTransportMode) {
        throw "$Context expected FHL transport $ExpectedFHLTransportMode but the Android header reported $($BrowserState.transportMode)."
    }
    if ($ExpectedFHLTransportMode -eq "responses" -and [string]$BrowserState.transportPreference -ne "responses") {
        throw "$Context expected the explicit Responses preference to be persisted before any paid click."
    }
    if ($ExpectedFHLTransportMode -eq "images" -and [string]$BrowserState.transportPreference -eq "responses") {
        throw "$Context found a persisted Responses preference while Images was required."
    }
}

function Assert-OfficialFHLImagesHomeSource {
    param([Parameter(Mandatory = $true)][object]$BrowserState, [Parameter(Mandatory = $true)][string]$Context)

    Assert-ExpectedFHLTransportMode -BrowserState $BrowserState -Context $Context
    $active = $BrowserState.activeProfile
    if (
        $null -eq $active -or
        -not [bool]$active.official -or
        [int]$active.poolSlot -lt 1 -or
        [int]$active.poolSlot -gt 10
    ) {
        throw "$Context requires the active Profile to be an official FHL pool member; no third-party API may be submitted."
    }
}

function Get-ExpectedHistorySourceLabel {
    param([Parameter(Mandatory = $true)][int]$PoolSlot)
    $modeLabel = if ($ExpectedFHLTransportMode -eq "responses") { "Responses API" } else { "Images API" }
    return "FHL$PoolSlot · $modeLabel"
}

function Assert-CompatibilitySingleConfiguredSlot {
    param([Parameter(Mandatory = $true)][object]$BrowserState)

    $configured = @(
        $BrowserState.poolSlots |
            Where-Object { $_.enabled -and $_.hasKeyHint } |
            ForEach-Object { [int]$_.slot } |
            Sort-Object -Unique
    )
    if (($configured -join ",") -ne "1") {
        throw "CompatibilitySingle requires the configured and enabled FHL Images slot set to be exactly FHL1."
    }
    if ([int]$BrowserState.candidateNamespaceCount -ne 1) {
        throw "localStorage namespace is not unique; compatibility submission was blocked before clicking."
    }
    if ([int]$BrowserState.filledCredentialInputCount -ne 0) {
        throw "A visible credential input was refilled; plaintext credential UI state is not accepted."
    }
    if ([string]$BrowserState.locationHost -ne "appassets.androidplatform.net") {
        throw "The app is not running from the packaged Android appassets host."
    }
    return $configured
}

function Get-CompatibilityCtaNavGeometry {
    $expression = @'
(()=>{
  const root=document.documentElement;
  const nav=document.querySelector(".android-bottom-nav");
  const cta=document.querySelector(".android-phone-compose .android-phone-sticky-cta");
  const button=cta&&cta.querySelector("button.liquid-primary-button");
  if(!nav||!cta||!button) throw new Error("Android phone CTA or bottom navigation was not found.");
  const navStyle=getComputedStyle(nav);
  const ctaStyle=getComputedStyle(cta);
  const navRect=nav.getBoundingClientRect();
  const ctaRect=cta.getBoundingClientRect();
  const buttonRect=button.getBoundingClientRect();
  const viewport=window.visualViewport;
  const viewportHeight=viewport?viewport.height:window.innerHeight;
  const buttonCenterX=buttonRect.left+(buttonRect.width/2);
  const buttonCenterY=buttonRect.top+(buttonRect.height/2);
  const hit=document.elementFromPoint(buttonCenterX,buttonCenterY);
  return {
    targetPlatform:root.getAttribute("data-target-platform")||"",
    navBoxSizing:navStyle.boxSizing,
    navTop:navRect.top,
    navBottom:navRect.bottom,
    navHeight:navRect.height,
    navBorderTop:parseFloat(navStyle.borderTopWidth)||0,
    ctaTop:ctaRect.top,
    ctaBottom:ctaRect.bottom,
    ctaHeight:ctaRect.height,
    ctaBottomCss:parseFloat(ctaStyle.bottom)||0,
    boundaryGap:navRect.top-ctaRect.bottom,
    navViewportGap:viewportHeight-navRect.bottom,
    viewportHeight,
    buttonWidth:buttonRect.width,
    buttonHeight:buttonRect.height,
    buttonCenterHit:Boolean(hit&&button.contains(hit))
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression
}

function Assert-CompatibilityCtaNavGeometry {
    param([Parameter(Mandatory = $true)][object]$Geometry)

    if ([string]$Geometry.targetPlatform -ne "android") {
        throw "CompatibilitySingle requires the Android phone layout, not $($Geometry.targetPlatform)."
    }
    if ([string]$Geometry.navBoxSizing -ne "border-box") {
        throw "Android bottom navigation did not use border-box sizing."
    }
    if ([double]$Geometry.navHeight -le 0 -or [double]$Geometry.ctaHeight -le 0 -or
        [double]$Geometry.buttonWidth -le 0 -or [double]$Geometry.buttonHeight -le 0) {
        throw "Android CTA or bottom navigation did not have a visible geometry box."
    }
    if ([math]::Abs([double]$Geometry.boundaryGap) -gt 1.0) {
        throw "Android CTA and bottom navigation do not share an exact boundary."
    }
    if ([math]::Abs([double]$Geometry.navViewportGap) -gt 1.0) {
        throw "Android bottom navigation is not aligned with the visible viewport bottom."
    }
    if ([math]::Abs(([double]$Geometry.navHeight) - ([double]$Geometry.ctaBottomCss)) -gt 1.0) {
        throw "Android CTA bottom offset does not reserve the measured bottom navigation height."
    }
    if (-not [bool]$Geometry.buttonCenterHit) {
        throw "Android CTA center is not clickable because another surface covers it."
    }
}

function Invoke-CompatibilityWorkflowUI {
    $expression = @'
(async()=>{
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const textOf=element=>String(element&&element.textContent||"").replace(/\s+/g," ").trim();
  const waitFor=async(test,label,timeoutMs)=>{
    const deadline=Date.now()+(timeoutMs||15000);
    let value=null;
    while(Date.now()<deadline){
      value=test();
      if(value)return value;
      await delay(100);
    }
    throw new Error("CompatibilityWorkflow timed out: "+label);
  };
  const geometries=[];
  let uiActions=0;
  const geometryFor=(element,label)=>{
    if(!element)throw new Error("CompatibilityWorkflow element missing: "+label);
    try{element.scrollIntoView({block:"center",inline:"center"});}catch(_error){element.scrollIntoView();}
    const rect=element.getBoundingClientRect();
    if(rect.width<8||rect.height<8||rect.bottom<=0||rect.right<=0||rect.top>=window.innerHeight||rect.left>=window.innerWidth){
      throw new Error("CompatibilityWorkflow element is not visible: "+label);
    }
    const x=Math.max(rect.left+1,Math.min(rect.right-1,rect.left+rect.width/2));
    const y=Math.max(rect.top+1,Math.min(rect.bottom-1,rect.top+rect.height/2));
    const hit=document.elementFromPoint(x,y);
    if(!hit||!element.contains(hit))throw new Error("CompatibilityWorkflow center hit failed: "+label);
    const record={label,width:Math.round(rect.width),height:Math.round(rect.height),centerHit:true};
    geometries.push(record);
    return record;
  };
  const clickElement=async(element,label)=>{
    geometryFor(element,label);
    element.click();
    uiActions+=1;
    await delay(120);
  };
  const buttonWithText=(selector,label)=>[...document.querySelectorAll(selector)].find(button=>textOf(button)===label)||null;
  const navButton=label=>[...document.querySelectorAll("button.android-nav-button")]
    .find(button=>textOf(button.querySelector(".android-nav-label"))===label)||null;
  const goTo=async(label,view)=>{
    const button=await waitFor(()=>navButton(label),"navigation "+label,8000);
    await clickElement(button,"nav-"+label);
    await waitFor(()=>{
      const studio=document.querySelector(".studio");
      return studio&&studio.getAttribute("data-android-view")===view?studio:null;
    },"view "+view,8000);
  };
  const setInputValue=(input,value)=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
    if(!descriptor||typeof descriptor.set!=="function")throw new Error("Native input setter is unavailable.");
    descriptor.set.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
  };
  const prepareHistory=async()=>{
    await goTo("历史","history");
    const allMode=await waitFor(()=>[...document.querySelectorAll(".android-history-stat")]
      .find(button=>textOf(button.querySelector("span"))==="全部")||null,"history all mode",8000);
    if(!allMode.classList.contains("active"))await clickElement(allMode,"history-all-mode");
    const allDate=await waitFor(()=>buttonWithText(".android-history-filter-row button","全部日期"),"history all date",8000);
    if(!allDate.classList.contains("active"))await clickElement(allDate,"history-all-date");
    const search=document.querySelector(".android-history-search input");
    if(search&&String(search.value||"")!==""){
      setInputValue(search,"");
      await delay(150);
    }
    const feature=await waitFor(()=>document.querySelector(".android-history-feature-card .android-history-feature-tile"),"latest successful history tile",12000);
    const image=await waitFor(()=>{
      const candidate=feature.querySelector("img");
      return candidate&&candidate.complete&&candidate.naturalWidth>0&&candidate.naturalHeight>0?candidate:null;
    },"latest history image",15000);
    const firstGrid=document.querySelector(".android-history-results-card .android-history-grid .android-history-tile");
    if(!firstGrid||String(firstGrid.getAttribute("title")||"")!==String(feature.getAttribute("title")||"")){
      throw new Error("Latest history feature does not match the first successful result.");
    }
    return {feature,image};
  };
  const reuseLatestHistory=async()=>{
    const latest=await prepareHistory();
    const menu=await waitFor(()=>latest.feature.querySelector("button.android-history-tile-menu"),"latest history menu",8000);
    await clickElement(menu,"latest-history-menu");
    const sheet=await waitFor(()=>document.querySelector('section.android-history-action-sheet[role="dialog"][aria-label="历史结果操作"]'),"history action sheet",8000);
    const reuse=await waitFor(()=>[...sheet.querySelectorAll(".android-history-sheet-actions > button")]
      .find(button=>textOf(button)==="设为源图")||null,"set history as source",8000);
    if(reuse.disabled)throw new Error("Latest successful history image cannot be reused as a source.");
    await clickElement(reuse,"set-history-as-source");
    await waitFor(()=>!document.querySelector(".android-history-action-sheet"),"history action sheet close",8000);
    return {width:latest.image.naturalWidth,height:latest.image.naturalHeight};
  };
  const composeSourceState=()=>{
    const card=document.querySelector(".android-phone-source-card");
    const cta=[...document.querySelectorAll(".android-phone-compose .android-phone-sticky-cta > button.liquid-primary-button")]
      .find(button=>textOf(button)==="开始编辑")||null;
    return card&&cta?{
      card,
      cta,
      count:card.querySelectorAll(".android-source-list-item").length,
      title:textOf(card.querySelector(".android-source-summary-title"))
    }:null;
  };
  const waitForSourceCount=async expected=>waitFor(()=>{
    const state=composeSourceState();
    return state&&state.count===expected&&state.title.indexOf(expected+" 张")>=0?state:null;
  },"compose source count "+expected,20000);
  const canvasMetrics=()=>{
    const canvases=[...document.querySelectorAll(".stage-canvas-wrap .konvajs-content canvas")];
    if(canvases.length===0)return null;
    const digests=[];
    let baseBounds=null;
    for(let canvasIndex=0;canvasIndex<canvases.length;canvasIndex+=1){
      const canvas=canvases[canvasIndex];
      const context=canvas.getContext("2d",{willReadFrequently:true});
      if(!context)throw new Error("Canvas 2D context is unavailable.");
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      let hash=2166136261>>>0;
      let opaque=0;
      let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
      for(let index=0,pixel=0;index<pixels.length;index+=4,pixel+=1){
        const alpha=pixels[index+3];
        if(alpha>0){
          opaque+=1;
          if(canvasIndex===0){
            const x=pixel%canvas.width;
            const y=Math.floor(pixel/canvas.width);
            if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
          }
        }
        hash=Math.imul(hash^(pixels[index]|(pixels[index+1]<<8)|(pixels[index+2]<<16)|(alpha<<24)),16777619)>>>0;
      }
      digests.push(String(hash)+":"+String(opaque));
      if(canvasIndex===0&&opaque>0){
        baseBounds={minX,minY,maxX,maxY,width:maxX-minX+1,height:maxY-minY+1,opaque};
      }
    }
    const base=canvases[0];
    const rect=base.getBoundingClientRect();
    return {
      canvasCount:canvases.length,
      digest:digests.join("|"),
      layerDigests:digests,
      baseBounds,
      canvasWidth:base.width,
      canvasHeight:base.height,
      clientLeft:rect.left,
      clientTop:rect.top,
      clientWidth:rect.width,
      clientHeight:rect.height
    };
  };
  const waitForCanvas=async()=>waitFor(()=>{
    const workspace=document.querySelector('.android-canvas-workspace[data-device="phone"][data-has-source-strip="true"]');
    const metrics=canvasMetrics();
    return workspace&&metrics&&metrics.baseBounds&&metrics.baseBounds.opaque>1000?{workspace,metrics}:null;
  },"nonblank Android canvas",20000);
  const imagePoint=(metrics,xRatio,yRatio)=>{
    const bounds=metrics.baseBounds;
    const pixelX=bounds.minX+bounds.width*xRatio;
    const pixelY=bounds.minY+bounds.height*yRatio;
    return {
      x:metrics.clientLeft+(pixelX/metrics.canvasWidth)*metrics.clientWidth,
      y:metrics.clientTop+(pixelY/metrics.canvasHeight)*metrics.clientHeight
    };
  };
  const emitPointer=(type,point,buttons)=>{
    const content=document.querySelector(".stage-canvas-wrap .konvajs-content");
    if(!content)throw new Error("Konva content was not found.");
    const EventType=window.PointerEvent||window.MouseEvent;
    content.dispatchEvent(new EventType(type,{
      bubbles:true,cancelable:true,view:window,clientX:point.x,clientY:point.y,
      button:0,buttons:buttons,pointerId:1,pointerType:"mouse",isPrimary:true
    }));
  };
  const emitClick=point=>{
    const content=document.querySelector(".stage-canvas-wrap .konvajs-content");
    content.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:point.x,clientY:point.y,button:0}));
  };
  const clickCanvasControl=async(title,selector)=>{
    const control=await waitFor(()=>document.querySelector(selector||('button[aria-label="'+title+'"]')),"canvas control "+title,8000);
    if(control.disabled)throw new Error("Canvas control is disabled: "+title);
    await clickElement(control,"canvas-"+title);
    return control;
  };
  const drawAnnotation=async(title,points,textValue)=>{
    const selector='button.android-canvas-icon-button[aria-label="'+title+'"]';
    const control=await clickCanvasControl(title,selector);
    await waitFor(()=>control.classList.contains("active")?control:null,"active annotation "+title,5000);
    const before=canvasMetrics();
    const previousPrompt=window.prompt;
    if(textValue)window.prompt=()=>textValue;
    try{
      emitPointer("pointerdown",points[0],1);
      await delay(80);
      for(let index=1;index<points.length;index+=1){
        emitPointer("pointermove",points[index],1);
        await delay(60);
      }
      emitPointer("pointerup",points[points.length-1],0);
    }finally{
      if(textValue)window.prompt=previousPrompt;
    }
    uiActions+=1;
    const after=await waitFor(()=>{
      const metrics=canvasMetrics();
      return metrics&&metrics.canvasCount>=2&&metrics.digest!==before.digest?metrics:null;
    },"render annotation "+title,8000);
    const undo=document.querySelector('button.android-canvas-icon-button[aria-label="撤销"]');
    if(!undo||undo.disabled)throw new Error("Annotation did not enter the undo history: "+title);
    return {title,canvasCount:after.canvasCount,digest:after.digest};
  };
  const toastWithPrefix=prefix=>[...document.querySelectorAll(".app-root span.flex-1.text-xs")]
    .map(span=>textOf(span)).find(text=>text.indexOf(prefix)===0)||"";
  const sourceTitle=()=>{
    const tile=document.querySelector(".android-canvas-source-tile");
    return tile?String(tile.getAttribute("title")||""):"";
  };
  const runTransform=async(title,toastPrefix)=>{
    const beforeTitle=sourceTitle();
    const before=canvasMetrics();
    await clickCanvasControl(title);
    const toast=await waitFor(()=>toastWithPrefix(toastPrefix),"toast "+toastPrefix,30000);
    await waitFor(()=>{
      const metrics=canvasMetrics();
      return sourceTitle()&&sourceTitle()!==beforeTitle&&metrics&&metrics.baseBounds&&metrics.baseBounds.opaque>1000?metrics:null;
    },"transformed image "+title,30000);
    const after=canvasMetrics();
    return {
      title,
      toast,
      sourceChanged:true,
      beforeAspect:Number((before.baseBounds.width/before.baseBounds.height).toFixed(4)),
      afterAspect:Number((after.baseBounds.width/after.baseBounds.height).toFixed(4)),
      canvasCount:after.canvasCount
    };
  };

  const latest=await reuseLatestHistory();
  await goTo("参数","compose");
  let sourceState=await waitFor(()=>{
    const state=composeSourceState();
    return state&&state.count>0?state:null;
  },"first history source reuse",20000);
  let normalizedExistingSources=false;
  if(sourceState.count!==1){
    const clear=sourceState.card.querySelector("button.android-source-clear-action");
    if(!clear)throw new Error("Existing source images could not be cleared safely.");
    await clickElement(clear,"clear-existing-sources");
    await waitFor(()=>!document.querySelector(".android-phone-source-card .android-source-list-item"),"clear existing sources",8000);
    normalizedExistingSources=true;
    await reuseLatestHistory();
    await goTo("参数","compose");
  }
  sourceState=await waitForSourceCount(1);
  geometryFor(sourceState.cta,"edit-cta-not-clicked");

  await goTo("画布","canvas");
  const initialCanvas=await waitForCanvas();
  const sourceTiles=document.querySelectorAll(".android-canvas-source-strip .android-canvas-source-tile");
  if(sourceTiles.length!==1)throw new Error("Canvas did not expose exactly one reused source image.");
  const annotate=await clickCanvasControl("标注",'.android-canvas-tool-segment button[title="标注"]');
  await waitFor(()=>annotate.classList.contains("active")&&document.querySelector('.android-canvas-workspace[data-dock-mode="annotate"]'),"annotation tool active",5000);

  const metrics=initialCanvas.metrics;
  const annotationResults=[];
  annotationResults.push(await drawAnnotation("文字",[imagePoint(metrics,0.18,0.16)],"API28 文本"));
  annotationResults.push(await drawAnnotation("自由画",[
    imagePoint(metrics,0.14,0.72),imagePoint(metrics,0.25,0.62),imagePoint(metrics,0.36,0.76),imagePoint(metrics,0.46,0.66)
  ]));
  annotationResults.push(await drawAnnotation("箭头",[imagePoint(metrics,0.56,0.16),imagePoint(metrics,0.82,0.36)]));
  const rectStart=imagePoint(metrics,0.18,0.30);
  const rectEnd=imagePoint(metrics,0.82,0.70);
  annotationResults.push(await drawAnnotation("矩形",[rectStart,rectEnd]));

  const rectSelectionPoints=[
    {x:(rectStart.x+rectEnd.x)/2,y:rectStart.y},
    {x:(rectStart.x+rectEnd.x)/2,y:rectEnd.y},
    {x:rectStart.x,y:(rectStart.y+rectEnd.y)/2},
    {x:rectEnd.x,y:(rectStart.y+rectEnd.y)/2}
  ];
  for(let index=0;index<rectSelectionPoints.length;index+=1){
    const point=rectSelectionPoints[index];
    emitPointer("pointerdown",point,1);
    await delay(80);
    emitPointer("pointerup",point,0);
    emitClick(point);
    uiActions+=1;
    await delay(120);
    const selected=document.querySelector('button.android-canvas-icon-button[aria-label="裁出选中矩形"]');
    if(selected&&!selected.disabled)break;
  }
  let selectedCropButton=document.querySelector('button.android-canvas-icon-button[aria-label="裁出选中矩形"]');
  if(!selectedCropButton||selectedCropButton.disabled){
    const rectNodes=[];
    const stages=window.Konva&&Array.isArray(window.Konva.stages)?window.Konva.stages:[];
    for(let stageIndex=0;stageIndex<stages.length;stageIndex+=1){
      const nodes=stages[stageIndex].find("Rect");
      for(let nodeIndex=0;nodeIndex<nodes.length;nodeIndex+=1){
        if(nodes[nodeIndex].listening())rectNodes.push(nodes[nodeIndex]);
      }
    }
    if(rectNodes.length!==1)throw new Error("Canvas did not expose exactly one selectable rectangle annotation.");
    rectNodes[0].fire("click",{evt:new MouseEvent("click")},true);
    uiActions+=1;
    await delay(160);
    selectedCropButton=document.querySelector('button.android-canvas-icon-button[aria-label="裁出选中矩形"]');
  }
  const cropButton=await waitFor(()=>{
    const button=document.querySelector('button.android-canvas-icon-button[aria-label="裁出选中矩形"]');
    return button&&!button.disabled?button:null;
  },"selected crop rectangle",8000);
  geometryFor(cropButton,"canvas-裁出选中矩形");

  const transforms=[];
  transforms.push(await runTransform("裁出选中矩形","已裁出 "));
  const cropDisabled=document.querySelector('button.android-canvas-icon-button[aria-label="裁出选中矩形"]');
  if(!cropDisabled||!cropDisabled.disabled)throw new Error("Crop selection was not cleared after transforming the image.");
  transforms.push(await runTransform("左转 90°","已旋转 -90°"));
  transforms.push(await runTransform("右转 90°","已旋转 90°"));
  transforms.push(await runTransform("水平翻转","已水平翻转"));
  transforms.push(await runTransform("竖直翻转","已竖直翻转"));

  await clickCanvasControl("保存原图");
  const saveToast=await waitFor(()=>toastWithPrefix("已保存"),"save success toast",30000);

  await reuseLatestHistory();
  await goTo("参数","compose");
  const finalSourceState=await waitForSourceCount(2);
  geometryFor(finalSourceState.cta,"final-edit-cta-not-clicked");

  return {
    status:"passed",
    uiActions,
    normalizedExistingSources,
    latestHistoryImage:{width:latest.width,height:latest.height},
    initialSourceCount:1,
    finalSourceCount:2,
    annotations:annotationResults,
    transforms,
    saveToast,
    finalView:"compose",
    geometry:geometries
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression -TimeoutSeconds 180
}

function Assert-NoPendingSlots {
    param([Parameter(Mandatory = $true)][object]$Snapshot)

    $pending = @(
        foreach ($group in @($Snapshot.groups)) {
            foreach ($slot in @($group.slots)) {
                if (@("queued", "running") -contains [string]$slot.status) { $slot }
            }
        }
    )
    if ($pending.Count -ne 0) {
        throw "The scenario requires an idle queue, but $($pending.Count) task(s) are queued or running."
    }
}

function Wait-NewNativeGroup {
    param(
        [Parameter(Mandatory = $true)][object]$BeforeRegistry,
        [Parameter(Mandatory = $true)][long]$ClickedAt,
        [Parameter(Mandatory = $true)][string]$ExpectedWorkspaceId,
        [int]$TimeoutSeconds = 30
    )

    $known = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($group in @($BeforeRegistry.groups)) { [void]$known.Add([string]$group.groupId) }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        $registry = Get-NativeRegistrySummary
        $created = @($registry.groups | Where-Object { -not $known.Contains([string]$_.groupId) })
        if ($created.Count -gt 1) { throw "One click created $($created.Count) native groups." }
        if ($created.Count -eq 1) {
            $registryGroup = $created[0]
            for ($confirmation = 0; $confirmation -lt 3; $confirmation += 1) {
                Start-Sleep -Milliseconds 250
                $registry = Get-NativeRegistrySummary
                $confirmedCreated = @($registry.groups | Where-Object { -not $known.Contains([string]$_.groupId) })
                if ($confirmedCreated.Count -ne 1 -or [string]$confirmedCreated[0].groupId -ne [string]$registryGroup.groupId) {
                    throw "The post-click native group delta did not remain exactly one group."
                }
                if (@($confirmedCreated[0].slots).Count -ne 1) {
                    throw "The post-click native task delta did not remain exactly one task."
                }
                $registryGroup = $confirmedCreated[0]
            }
            $workspaceId = [string]$registryGroup.workspaceId
            if ([string]::IsNullOrWhiteSpace($workspaceId) -or $workspaceId -ne $ExpectedWorkspaceId) {
                throw "The new native group did not persist the click-time workspace ID."
            }
            if ([string]::IsNullOrWhiteSpace([string]$registryGroup.clientSubmissionId)) {
                throw "The new native group did not persist a client submission ID."
            }
            if (@($registryGroup.slots).Count -ne 1) {
                throw "One click did not create exactly one native task."
            }
            $createdAt = [long]$registryGroup.createdAt
            $latestAcceptedCreatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 1000
            if ($createdAt -lt $ClickedAt -or $createdAt -gt $latestAcceptedCreatedAt) {
                throw "The new native group was not created inside this click window."
            }
            $snapshot = Get-RedactedJobSnapshot -ResolvedWorkspaceId $workspaceId
            if ([string]$snapshot.workspaceId -ne $workspaceId) {
                throw "The redacted job response workspace did not match the native registry."
            }
            $group = @($snapshot.groups | Where-Object { [string]$_.groupId -eq [string]$registryGroup.groupId })[0]
            if ($group) {
                if (
                    [string]$group.workspaceId -ne $workspaceId -or
                    [string]$group.clientSubmissionId -ne [string]$registryGroup.clientSubmissionId -or
                    [long]$group.createdAt -ne $createdAt
                ) {
                    throw "The redacted job group did not match its native registry identity."
                }
                return [pscustomobject]@{
                    snapshot = $snapshot
                    registry = $registry
                    group = $group
                    workspaceId = $workspaceId
                    clickedAt = $ClickedAt
                    createdAt = $createdAt
                }
            }
        }
    } while ((Get-Date) -lt $deadline)
    throw "One click did not create a native group within $TimeoutSeconds seconds."
}

function Wait-OneUpstreamAttempt {
    param(
        [Parameter(Mandatory = $true)][string]$GroupId,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 250
        $attempts = @(Get-UpstreamSubmitAttempts | Where-Object { $_.groupId -eq $GroupId })
        if ($attempts.Count -gt 1) { throw "Native group $GroupId produced more than one upstream POST attempt." }
        if ($attempts.Count -eq 1) { return $attempts[0] }
    } while ((Get-Date) -lt $deadline)
    throw "Native group $GroupId did not record an upstream POST attempt within $TimeoutSeconds seconds."
}

function Wait-TerminalGroup {
    param(
        [Parameter(Mandatory = $true)][string]$GroupId,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId
    )

    $deadline = (Get-Date).AddSeconds($TerminalTimeoutSeconds)
    do {
        Start-Sleep -Seconds 2
        $snapshot = Get-RedactedJobSnapshot -ResolvedWorkspaceId $ResolvedWorkspaceId
        $group = @($snapshot.groups | Where-Object { $_.groupId -eq $GroupId })[0]
        if (-not $group) { throw "Native group $GroupId disappeared before reaching terminal state." }
        $slot = @($group.slots)[0]
        if ($terminalStatuses -contains [string]$slot.status) {
            return [pscustomobject]@{ snapshot = $snapshot; group = $group; slot = $slot }
        }
    } while ((Get-Date) -lt $deadline)
    throw "Native group $GroupId did not reach terminal state within $TerminalTimeoutSeconds seconds."
}

function Wait-NativeTaskTerminal {
    param(
        [Parameter(Mandatory = $true)][string]$GroupId,
        [Parameter(Mandatory = $true)][string]$JobId
    )

    $deadline = (Get-Date).AddSeconds($TerminalTimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        $registry = Get-NativeRegistrySummary
        $group = @($registry.groups | Where-Object { [string]$_.groupId -eq $GroupId })[0]
        if (-not $group) { throw "Native group $GroupId disappeared while the Activity was backgrounded." }
        $slot = @($group.slots | Where-Object { [string]$_.jobId -eq $JobId })[0]
        if (-not $slot) { throw "Native task $JobId disappeared while the Activity was backgrounded." }
        if ($terminalStatuses -contains [string]$slot.status) { return [string]$slot.status }
    } while ((Get-Date) -lt $deadline)
    throw "Native task $JobId did not reach terminal state while the Activity was backgrounded."
}

function Get-NativeTaskState {
    param(
        [Parameter(Mandatory = $true)][string]$GroupId,
        [Parameter(Mandatory = $true)][string]$JobId
    )

    $registry = Get-NativeRegistrySummary
    $group = @($registry.groups | Where-Object { [string]$_.groupId -eq $GroupId })[0]
    if (-not $group) { throw "Native group $GroupId disappeared." }
    $slot = @($group.slots | Where-Object { [string]$_.jobId -eq $JobId })[0]
    if (-not $slot) { throw "Native task $JobId disappeared." }
    return [pscustomobject]@{ group = $group; slot = $slot }
}

function Wait-NativeTaskTerminalWhileBackgrounded {
    param(
        [Parameter(Mandatory = $true)][string]$GroupId,
        [Parameter(Mandatory = $true)][string]$JobId,
        [Parameter(Mandatory = $true)][string]$ExpectedProcessId
    )

    $deadline = (Get-Date).AddSeconds($TerminalTimeoutSeconds)
    do {
        $currentProcessId = Get-AppProcessId
        if ([string]::IsNullOrWhiteSpace($currentProcessId) -or $currentProcessId -ne $ExpectedProcessId) {
            throw "The App process changed while the task was running in the background."
        }
        Assert-AppActivityBackgrounded
        $task = Get-NativeTaskState -GroupId $GroupId -JobId $JobId
        if ($terminalStatuses -contains [string]$task.slot.status) {
            return [pscustomobject]@{ status = [string]$task.slot.status; processId = $currentProcessId }
        }
        $service = Get-AndroidJobServiceState
        $foregroundNotification = Get-CompletionNotificationFingerprint -NotificationId 207550870
        if (-not $service.exists -or -not $service.foreground -or -not $service.notificationIdCorrect -or
            -not $foregroundNotification.exists -or -not $foregroundNotification.correctChannel) {
            throw "The Android foreground job service was not continuously active while the background task was non-terminal."
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Native task $JobId did not reach terminal state while the Activity was backgrounded."
}

function Wait-UpstreamResponseStarted {
    param(
        [Parameter(Mandatory = $true)][string]$GroupId,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 250
        $snapshot = Get-NativeRegistrySummary
        $group = @($snapshot.groups | Where-Object { [string]$_.groupId -eq $GroupId })[0]
        if (-not $group) { throw "Cold-start group disappeared before upstream confirmation." }
        $slot = @($group.slots)[0]
        # Wait-OneUpstreamAttempt has already confirmed the single explicit POST.
        # The native registry may keep response bytes at zero for the entire HTTP
        # request, so a running slot is the reliable stop window for force-stop.
        if ([string]$slot.status -eq "running") {
            return [pscustomobject]@{ snapshot = $snapshot; group = $group; slot = $slot }
        }
        if ($terminalStatuses -contains [string]$slot.status) {
            throw "Cold-start task reached $($slot.status) before the force-stop window was observed."
        }
    } while ((Get-Date) -lt $deadline)
    throw "Cold-start task did not expose a running slot within $TimeoutSeconds seconds."
}

function Assert-GroupContract {
    param(
        [Parameter(Mandatory = $true)][object]$Group,
        [Parameter(Mandatory = $true)][int]$ExpectedSlot
    )

    $expectedLabel = "FHL$ExpectedSlot"
    $slots = @($Group.slots)
    if ($slots.Count -ne 1) { throw "$expectedLabel did not create exactly one native task." }
    if ([string]::IsNullOrWhiteSpace([string]$Group.clientSubmissionId)) {
        throw "$expectedLabel group is missing clientSubmissionId."
    }
    if ([int]$Group.fhlImagesPoolSlot -ne $ExpectedSlot -or [string]$Group.apiLabel -ne $expectedLabel) {
        throw "$expectedLabel frozen group source does not match its assigned slot."
    }
    if ([string]$Group.apiMode -ne $ExpectedFHLTransportMode -or [string]$slots[0].apiMode -ne $ExpectedFHLTransportMode) {
        throw "$expectedLabel did not freeze the expected $ExpectedFHLTransportMode transport on both group and task."
    }
    if ([int]$slots[0].fhlImagesPoolSlot -ne $ExpectedSlot -or [string]$slots[0].apiLabel -ne $expectedLabel) {
        throw "$expectedLabel frozen task source does not match its assigned slot."
    }
}

function Assert-AttemptMatchesGroup {
    param(
        [Parameter(Mandatory = $true)][object]$Attempt,
        [Parameter(Mandatory = $true)][object]$Group,
        [Parameter(Mandatory = $true)][int]$ExpectedSlot,
        [Parameter(Mandatory = $true)][long]$ClickedAt,
        [Parameter(Mandatory = $true)][string]$Context
    )

    $expectedLabel = "FHL$ExpectedSlot"
    $slot = @($Group.slots)[0]
    if (
        [string]$Attempt.apiMode -ne $ExpectedFHLTransportMode -or
        [string]$Attempt.groupId -ne [string]$Group.groupId -or
        [string]$Attempt.jobId -ne [string]$slot.jobId -or
        [string]$Attempt.clientSubmissionId -ne [string]$Group.clientSubmissionId -or
        [string]::IsNullOrWhiteSpace([string]$Attempt.requestRunId) -or
        [string]$Attempt.requestRunId -ne [string]$Group.requestRunId -or
        [string]$Attempt.apiLabel -ne $expectedLabel -or
        [int]$Attempt.fhlImagesPoolSlot -ne $ExpectedSlot -or
        [long]$Attempt.timestamp -lt $ClickedAt
    ) {
        throw "$Context upstream POST audit did not match the explicit native task identity."
    }
}

function Get-LoadBlockResults {
    param(
        [Parameter(Mandatory = $true)][object]$BeforeRegistry,
        [Parameter(Mandatory = $true)][object]$AfterRegistry,
        [Parameter(Mandatory = $true)][object]$ClickBlock,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][int]$SequenceOffset
    )

    $knownGroups = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($group in @($BeforeRegistry.groups)) { [void]$knownGroups.Add([string]$group.groupId) }
    $created = @($AfterRegistry.groups | Where-Object { -not $knownGroups.Contains([string]$_.groupId) })
    if ($created.Count -ne 10) { throw "Load block created $($created.Count) groups instead of exactly ten." }
    if (@($created | ForEach-Object { @($_.slots) }).Count -ne 10) {
        throw "Load block did not create exactly one native task per click."
    }
    $results = @()
    $clicks = @($ClickBlock.clicks)
    for ($index = 0; $index -lt $clicks.Count; $index += 1) {
        $click = $clicks[$index]
        $expectedSlot = [int]$click.expectedSlot
        $expectedLabel = "FHL$expectedSlot"
        $matches = @($created | Where-Object { [int]$_.fhlImagesPoolSlot -eq $expectedSlot })
        if ($matches.Count -ne 1) { throw "$expectedLabel load click did not freeze exactly one native group." }
        $group = $matches[0]
        Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
        if ([string]$group.workspaceId -ne $ResolvedWorkspaceId) {
            throw "$expectedLabel load click changed workspace identity."
        }
        if ([string]::IsNullOrWhiteSpace([string]$group.requestRunId)) {
            throw "$expectedLabel load group is missing requestRunId."
        }
        $upperBound = if ($index + 1 -lt $clicks.Count) {
            [long]$clicks[$index + 1].clickedAt
        } else {
            [long]$ClickBlock.finishedAt + 1000L
        }
        if ([long]$group.createdAt -lt [long]$click.clickedAt -or [long]$group.createdAt -gt $upperBound) {
            throw "$expectedLabel native group was not created inside its explicit click window."
        }
        $slot = @($group.slots)[0]
        if ([long]$slot.queueSequence -le 0) { throw "$expectedLabel task is missing a positive queueSequence." }
        $results += [ordered]@{
            sequence = $SequenceOffset + $index + 1
            block = [int]$ClickBlock.blockNumber
            workspaceId = [string]$group.workspaceId
            clickedAt = [long]$click.clickedAt
            createdAt = [long]$group.createdAt
            expectedSlot = $expectedSlot
            expectedLabel = $expectedLabel
            groupId = [string]$group.groupId
            jobId = [string]$slot.jobId
            clientSubmissionId = [string]$group.clientSubmissionId
            requestRunId = [string]$group.requestRunId
            queueSequence = [long]$slot.queueSequence
            status = [string]$slot.status
            groupCount = 1
            taskCount = 1
            postCount = 0
            historyLabel = "not-evaluated"
        }
    }
    return @($results)
}

function Assert-LoadGlobalIdentity {
    param(
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][object]$CurrentRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Results,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId
    )

    $expectedCount = $Results.Count
    $groupIds = @($Results | ForEach-Object { [string]$_.groupId })
    $jobIds = @($Results | ForEach-Object { [string]$_.jobId })
    $submissionIds = @($Results | ForEach-Object { [string]$_.clientSubmissionId })
    if (@($groupIds | Where-Object { [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique).Count -gt 0 -or
        @($jobIds | Where-Object { [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique).Count -gt 0 -or
        @($submissionIds | Where-Object { [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique).Count -gt 0) {
        throw "Load evidence contains an empty native identity."
    }
    if (@($groupIds | Sort-Object -Unique).Count -ne $expectedCount -or
        @($jobIds | Sort-Object -Unique).Count -ne $expectedCount -or
        @($submissionIds | Sort-Object -Unique).Count -ne $expectedCount) {
        throw "Load evidence detected duplicate group, task, or clientSubmissionId values."
    }
    if (@($Results | Where-Object { [string]$_.workspaceId -ne $ResolvedWorkspaceId }).Count -ne 0) {
        throw "Load evidence contains a task from another workspace."
    }
    $sequences = @($Results | ForEach-Object { [long]$_.queueSequence })
    if (@($sequences | Where-Object { $_ -le 0 }).Count -ne 0 -or @($sequences | Sort-Object -Unique).Count -ne $expectedCount) {
        throw "Load evidence contains a missing or duplicate queueSequence."
    }
    $clickOrdered = @($Results | Sort-Object { [int]$_.sequence })
    for ($index = 0; $index -lt $clickOrdered.Count; $index += 1) {
        if ([int]$clickOrdered[$index].sequence -ne ($index + 1)) {
            throw "Load evidence contains a missing or duplicate explicit click sequence."
        }
        if ($index -gt 0 -and [long]$clickOrdered[$index].queueSequence -le [long]$clickOrdered[$index - 1].queueSequence) {
            throw "Load queueSequence values are not strictly monotonic in explicit click order."
        }
    }
    $delta = Get-RegistryDelta -Before $InitialRegistry -After $CurrentRegistry
    if (@($delta.groupIds).Count -ne $expectedCount -or @($delta.taskIds).Count -ne $expectedCount) {
        throw "Load registry delta is not exactly $expectedCount groups and $expectedCount tasks."
    }
    if (@($delta.groupIds | Where-Object { $groupIds -notcontains [string]$_ }).Count -ne 0 -or
        @($delta.taskIds | Where-Object { $jobIds -notcontains [string]$_ }).Count -ne 0) {
        throw "Load registry contains a group or task outside the explicit UI clicks."
    }
}

function Add-LoadHostSample {
    param(
        [Parameter(Mandatory = $true)][object]$Registry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Results,
        [Parameter(Mandatory = $true)][string]$Phase
    )

    $trackedSlots = @()
    foreach ($result in $Results) {
        $group = @($Registry.groups | Where-Object { [string]$_.groupId -eq [string]$result.groupId })[0]
        if (-not $group) { throw "Tracked load group disappeared from the native registry." }
        $slot = @($group.slots | Where-Object { [string]$_.jobId -eq [string]$result.jobId })[0]
        if (-not $slot) { throw "Tracked load task disappeared from the native registry." }
        if ([int]$slot.fhlImagesPoolSlot -ne [int]$result.expectedSlot -or
            [string]$slot.apiLabel -ne [string]$result.expectedLabel -or
            [long]$slot.queueSequence -ne [long]$result.queueSequence) {
            throw "Tracked load task changed its frozen FHL source or queueSequence."
        }
        $trackedSlots += $slot
    }
    $perSlot = @(
        foreach ($poolSlot in 1..10) {
            $items = @($trackedSlots | Where-Object { [int]$_.fhlImagesPoolSlot -eq $poolSlot })
            [ordered]@{
                slot = $poolSlot
                running = @($items | Where-Object { [string]$_.status -eq "running" }).Count
                queued = @($items | Where-Object { [string]$_.status -eq "queued" }).Count
                activeReservations = @($items | Where-Object { [bool]$_.reservationActive }).Count
                terminal = @($items | Where-Object { $terminalStatuses -contains [string]$_.status }).Count
            }
        }
    )
    $sample = [pscustomobject][ordered]@{
        sample = $script:LoadHostSamples.Count + 1
        sampledAt = (Get-Date).ToString("o")
        phase = $Phase
        acceptedTasks = $Results.Count
        running = @($trackedSlots | Where-Object { [string]$_.status -eq "running" }).Count
        queued = @($trackedSlots | Where-Object { [string]$_.status -eq "queued" }).Count
        succeeded = @($trackedSlots | Where-Object { [string]$_.status -eq "succeeded" }).Count
        failed = @($trackedSlots | Where-Object { [string]$_.status -eq "failed" }).Count
        cancelled = @($trackedSlots | Where-Object { [string]$_.status -eq "cancelled" }).Count
        interrupted = @($trackedSlots | Where-Object { [string]$_.status -eq "interrupted" }).Count
        activeReservations = @($trackedSlots | Where-Object { [bool]$_.reservationActive }).Count
        queuedSequences = @($trackedSlots | Where-Object { [string]$_.status -eq "queued" } | ForEach-Object { [long]$_.queueSequence } | Sort-Object)
        perSlot = $perSlot
    }
    $script:LoadHostSamples += $sample
    return $sample
}

function Assert-LoadHostSafety {
    param(
        [Parameter(Mandatory = $true)][object]$Registry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Results,
        [Parameter(Mandatory = $true)][string]$Phase
    )

    $sample = Add-LoadHostSample -Registry $Registry -Results $Results -Phase $Phase
    if ([int]$sample.activeReservations -gt 40 -or [int]$sample.running -gt 40) {
        throw "Load host sample exceeded the total pool limit of 40."
    }
    foreach ($slot in @($sample.perSlot)) {
        if ([int]$slot.activeReservations -gt 4 -or [int]$slot.running -gt 4) {
            throw "Load host sample exceeded the per-slot limit of four for FHL$($slot.slot)."
        }
    }
    $tracked = @()
    foreach ($result in $Results) {
        $group = @($Registry.groups | Where-Object { [string]$_.groupId -eq [string]$result.groupId })[0]
        if ($group) { $tracked += @($group.slots | Where-Object { [string]$_.jobId -eq [string]$result.jobId }) }
    }
    if (@($tracked | Where-Object { [string]$_.errorClass -eq "auth" }).Count -gt 0) {
        throw "Load run stopped on an authentication failure."
    }
    $failureClasses = @(
        $tracked |
            Where-Object { [string]$_.status -eq "failed" } |
            ForEach-Object { if ([string]::IsNullOrWhiteSpace([string]$_.errorClass)) { "other" } else { [string]$_.errorClass } } |
            Group-Object
    )
    $repeatedFailure = @($failureClasses | Where-Object { $_.Count -ge 3 })[0]
    if ($repeatedFailure) {
        throw "Load run stopped after three failures in error class $($repeatedFailure.Name)."
    }
    return $sample
}

function Get-LoadAuditMetrics {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Results,
        [switch]$RequireComplete
    )

    $groupsById = @{}
    $jobsById = @{}
    $queued = @{}
    foreach ($result in $Results) {
        $groupsById[[string]$result.groupId] = $result
        $jobsById[[string]$result.jobId] = $result
        # Queue sequences are allocated monotonically before a group becomes
        # claimable. Preloading the accepted set avoids relying on the submit
        # audit line winning a race with an already-running service worker;
        # future (higher) sequences can never displace the oldest candidate.
        $queued[[string]$result.jobId] = $result
    }
    $submitted = @{}
    $active = @{}
    $claimCounts = @{}
    $releaseCounts = @{}
    $postCounts = @{}
    $terminalCounts = @{}
    $activePerSlot = @{}
    $perSlotPeak = @{}
    foreach ($poolSlot in 1..10) {
        $activePerSlot[$poolSlot] = 0
        $perSlotPeak[$poolSlot] = 0
    }
    $totalPeak = 0
    $claimOrder = @()
    $events = @($script:LoadAuditEvents.Values | Sort-Object { [int]$_.captureOrder })
    foreach ($event in $events) {
        $type = [string]$event.type
        if ($type -eq "submit") {
            $result = $groupsById[[string]$event.groupId]
            if (-not $result) { continue }
            $jobId = [string]$result.jobId
            if ($submitted.ContainsKey($jobId)) { throw "Load audit contains duplicate submit events for one explicit click." }
            if ([string]$event.clientSubmissionId -ne [string]$result.clientSubmissionId -or
                [int]$event.fhlImagesPoolSlot -ne [int]$result.expectedSlot -or
                [string]$event.apiMode -ne "images" -or
                [string]$event.apiLabel -ne [string]$result.expectedLabel) {
                throw "Load submit audit does not match its frozen native identity."
            }
            $submitted[$jobId] = $true
            continue
        }
        $result = $jobsById[[string]$event.jobId]
        if (-not $result) { continue }
        $jobId = [string]$result.jobId
        $slot = [int]$result.expectedSlot
        if ($type -in @("slot_terminal", "slot_error", "slot_cancelled")) {
            $terminalCounts[$jobId] = [int]($terminalCounts[$jobId]) + 1
            if ([int]($terminalCounts[$jobId]) -ne 1 -or
                [long]$event.queueSequence -ne [long]$result.queueSequence -or
                [int]$event.fhlImagesPoolSlot -ne $slot -or
                [string]$event.status -ne "succeeded") {
                throw "Load terminal audit is missing, duplicated, unsuccessful, or changed its frozen task identity."
            }
            continue
        }
        if ($type -eq "slot_claimed") {
            $claimCounts[$jobId] = [int]($claimCounts[$jobId]) + 1
            if ([int]($claimCounts[$jobId]) -ne 1) { throw "Load audit contains a duplicate reservation claim." }
            if (-not $submitted.ContainsKey($jobId)) {
                throw "Load audit claimed a task before its native submit event."
            }
            if (-not $queued.ContainsKey($jobId) -or $active.ContainsKey($jobId)) {
                throw "Load audit claimed a task that was not queued exactly once."
            }
            if ([long]$event.queueSequence -ne [long]$result.queueSequence -or
                [int]$event.fhlImagesPoolSlot -ne $slot -or
                -not [bool]$event.reservationActive -or
                [string]$event.reservationKind -ne "fhl_images_pool" -or
                [int]$event.reservationSlot -ne $slot) {
                throw "Load reservation claim changed its queueSequence or frozen FHL slot."
            }
            $eligible = @(
                $queued.Values |
                    Where-Object { [int]($activePerSlot[[int]$_.expectedSlot]) -lt 4 } |
                    Sort-Object @{ Expression = { [long]$_.queueSequence } }, @{ Expression = { [string]$_.jobId } }
            )
            if ($eligible.Count -eq 0 -or [string]$eligible[0].jobId -ne $jobId) {
                throw "Load audit violated global oldest-runnable FIFO queueSequence ordering."
            }
            $queued.Remove($jobId)
            $active[$jobId] = $result
            $activePerSlot[$slot] = [int]($activePerSlot[$slot]) + 1
            if ([int]($activePerSlot[$slot]) -gt 4 -or $active.Count -gt 40) {
                throw "Load audit exceeded the 4/40 reservation limit."
            }
            $perSlotPeak[$slot] = [Math]::Max([int]($perSlotPeak[$slot]), [int]($activePerSlot[$slot]))
            $totalPeak = [Math]::Max($totalPeak, $active.Count)
            $claimOrder += [long]$result.queueSequence
            continue
        }
        if ($type -eq "slot_reservation_released") {
            $releaseCounts[$jobId] = [int]($releaseCounts[$jobId]) + 1
            if ([int]($releaseCounts[$jobId]) -ne 1 -or -not $active.ContainsKey($jobId)) {
                throw "Load audit released a reservation that was not active exactly once."
            }
            if ([long]$event.queueSequence -ne [long]$result.queueSequence -or
                [int]$event.fhlImagesPoolSlot -ne $slot -or
                [bool]$event.reservationActive -or
                [int]$event.reservationSlot -ne $slot) {
                throw "Load reservation release changed its queueSequence or frozen FHL slot."
            }
            $active.Remove($jobId)
            $activePerSlot[$slot] = [int]($activePerSlot[$slot]) - 1
            if ([int]($activePerSlot[$slot]) -lt 0) { throw "Load audit reconstructed a negative slot reservation count." }
            continue
        }
        if ($type -eq "upstream_submit_attempt") {
            if (-not $active.ContainsKey($jobId) -or [int]($claimCounts[$jobId]) -ne 1 -or
                [int]($releaseCounts[$jobId]) -ne 0) {
                throw "Load audit recorded an upstream POST outside its active reservation window."
            }
            $postCounts[$jobId] = [int]($postCounts[$jobId]) + 1
            if ([int]($postCounts[$jobId]) -gt 1) { throw "Load audit recorded more than one upstream POST for a task." }
            if ([string]$event.groupId -ne [string]$result.groupId -or
                [string]$event.clientSubmissionId -ne [string]$result.clientSubmissionId -or
                [string]$event.requestRunId -ne [string]$result.requestRunId -or
                [string]$event.apiMode -ne "images" -or
                [string]$event.apiLabel -ne [string]$result.expectedLabel -or
                [int]$event.fhlImagesPoolSlot -ne $slot) {
                throw "Load upstream POST audit does not match its explicit native task."
            }
        }
    }
    if ($RequireComplete) {
        foreach ($result in $Results) {
            $jobId = [string]$result.jobId
            if ([int]($submitted[$jobId]) -ne 1 -or [int]($claimCounts[$jobId]) -ne 1 -or
                [int]($releaseCounts[$jobId]) -ne 1 -or [int]($postCounts[$jobId]) -ne 1 -or
                [int]($terminalCounts[$jobId]) -ne 1) {
                throw "Load audit does not contain exactly one submit, claim, POST, terminal event, and release per task."
            }
        }
        if ($queued.Count -ne 0 -or $active.Count -ne 0) {
            throw "Load audit did not settle every queued and active reservation."
        }
    }
    return [pscustomobject][ordered]@{
        eventCount = $events.Count
        submits = $submitted.Count
        claims = @($claimCounts.Keys).Count
        releases = @($releaseCounts.Keys).Count
        upstreamPosts = @($postCounts.Keys).Count
        terminals = @($terminalCounts.Keys).Count
        totalPeak = $totalPeak
        perSlotPeak = @(foreach ($poolSlot in 1..10) { [ordered]@{ slot = $poolSlot; peak = [int]($perSlotPeak[$poolSlot]) } })
        fifoQueueSequence = $true
        claimOrder = $claimOrder
        queuedAtEnd = $queued.Count
        activeAtEnd = $active.Count
    }
}

function New-InternalLoadAuditEvent {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][string]$Type,
        [Parameter(Mandatory = $true)][int]$CaptureOrder
    )

    $claimed = $Type -in @("slot_claimed", "slot_terminal")
    return [pscustomobject][ordered]@{
        captureOrder = $CaptureOrder
        sourceOccurrence = 1
        timestamp = 100000L + $CaptureOrder
        type = $Type
        groupId = [string]$Result.groupId
        jobId = [string]$Result.jobId
        clientSubmissionId = [string]$Result.clientSubmissionId
        requestRunId = [string]$Result.requestRunId
        apiMode = "images"
        apiLabel = [string]$Result.expectedLabel
        fhlImagesPoolSlot = [int]$Result.expectedSlot
        queueSequence = [long]$Result.queueSequence
        reservationActive = $claimed
        reservationKind = if ($claimed) { "fhl_images_pool" } else { "" }
        reservationSlot = if ($Type -in @("slot_claimed", "slot_terminal", "slot_reservation_released")) { [int]$Result.expectedSlot } else { 0 }
        status = if ($Type -eq "slot_claimed") { "running" } elseif ($Type -in @("slot_terminal", "slot_reservation_released")) { "succeeded" } else { "" }
        errorMessageChars = 0
    }
}

function New-InternalLoadAuditFixture {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 200)][int]$TaskCount,
        [switch]$SingleSlot
    )

    $results = @(
        for ($index = 0; $index -lt $TaskCount; $index += 1) {
            $poolSlot = if ($SingleSlot) { 1 } else { ($index % 10) + 1 }
            [pscustomobject][ordered]@{
                sequence = $index + 1
                workspaceId = "internal-workspace"
                expectedSlot = $poolSlot
                expectedLabel = "FHL$poolSlot"
                groupId = "group-$($index + 1)"
                jobId = "job-$($index + 1)"
                clientSubmissionId = "submission-$($index + 1)"
                requestRunId = "run-$($index + 1)"
                queueSequence = [long]($index + 1)
            }
        }
    )
    $events = [Collections.Generic.List[object]]::new()
    $captureOrder = 0
    foreach ($result in $results) {
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $result -Type "submit" -CaptureOrder $captureOrder))
    }
    $active = [Collections.Generic.List[object]]::new()
    $initialClaims = [Math]::Min(40, $TaskCount)
    for ($index = 0; $index -lt $initialClaims; $index += 1) {
        $result = $results[$index]
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $result -Type "slot_claimed" -CaptureOrder $captureOrder))
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $result -Type "upstream_submit_attempt" -CaptureOrder $captureOrder))
        $active.Add($result)
    }
    for ($index = $initialClaims; $index -lt $TaskCount; $index += 1) {
        $released = $active[0]
        $active.RemoveAt(0)
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $released -Type "slot_terminal" -CaptureOrder $captureOrder))
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $released -Type "slot_reservation_released" -CaptureOrder $captureOrder))
        $result = $results[$index]
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $result -Type "slot_claimed" -CaptureOrder $captureOrder))
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $result -Type "upstream_submit_attempt" -CaptureOrder $captureOrder))
        $active.Add($result)
    }
    foreach ($result in @($active)) {
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $result -Type "slot_terminal" -CaptureOrder $captureOrder))
        $captureOrder += 1
        $events.Add((New-InternalLoadAuditEvent -Result $result -Type "slot_reservation_released" -CaptureOrder $captureOrder))
    }
    return [pscustomobject]@{ results = $results; events = @($events) }
}

function Invoke-InternalLoadMetrics {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Results,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Events
    )

    $script:LoadAuditEvents = [ordered]@{}
    $captureOrder = 0
    foreach ($event in $Events) {
        $captureOrder += 1
        $event.captureOrder = $captureOrder
        $script:LoadAuditEvents["internal-$captureOrder"] = $event
    }
    return Get-LoadAuditMetrics -Results $Results -RequireComplete
}

function Assert-InternalLoadAuditFailure {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$ExpectedMessage
    )

    try {
        & $Action | Out-Null
    }
    catch {
        if ([string]$_.Exception.Message -notmatch $ExpectedMessage) {
            throw "Internal load audit failed for the wrong reason: $($_.Exception.Message)"
        }
        return
    }
    throw "Internal load audit unexpectedly accepted an invalid event fixture."
}

function Invoke-InternalLoadAuditSelfTest {
    $originalEvidenceSource = $EvidenceSource
    $pool40 = New-InternalLoadAuditFixture -TaskCount 40
    $pool40Metrics = Invoke-InternalLoadMetrics -Results $pool40.results -Events $pool40.events
    if ([int]$pool40Metrics.totalPeak -ne 40 -or [int]$pool40Metrics.upstreamPosts -ne 40 -or
        @($pool40Metrics.perSlotPeak | Where-Object { [int]$_.peak -ne 4 }).Count -ne 0) {
        throw "Internal Pool40 fixture did not prove the expected 4/40 metrics."
    }

    $queue60 = New-InternalLoadAuditFixture -TaskCount 60
    $queue60Metrics = Invoke-InternalLoadMetrics -Results $queue60.results -Events $queue60.events
    if ([int]$queue60Metrics.totalPeak -ne 40 -or [int]$queue60Metrics.upstreamPosts -ne 60 -or
        @($queue60Metrics.perSlotPeak | Where-Object { [int]$_.peak -ne 4 }).Count -ne 0) {
        throw "Internal Queue60 fixture did not prove the expected 4/40 metrics."
    }

    $submitEvents = @($pool40.events | Where-Object { [string]$_.type -eq "submit" })
    $nonSubmitEvents = @($pool40.events | Where-Object { [string]$_.type -ne "submit" })
    $firstPost = @($nonSubmitEvents | Where-Object { [string]$_.type -eq "upstream_submit_attempt" })[0]
    $earlyPostEvents = @($submitEvents) + @($firstPost) + @($nonSubmitEvents | Where-Object { $_ -ne $firstPost })
    Assert-InternalLoadAuditFailure -ExpectedMessage "outside its active reservation window" -Action {
        Invoke-InternalLoadMetrics -Results $pool40.results -Events $earlyPostEvents
    }

    $duplicatePostEvents = [Collections.Generic.List[object]]::new()
    $postDuplicated = $false
    foreach ($event in $pool40.events) {
        $duplicatePostEvents.Add($event)
        if (-not $postDuplicated -and [string]$event.type -eq "upstream_submit_attempt") {
            $duplicatePostEvents.Add($event)
            $postDuplicated = $true
        }
    }
    Assert-InternalLoadAuditFailure -ExpectedMessage "more than one upstream POST" -Action {
        Invoke-InternalLoadMetrics -Results $pool40.results -Events @($duplicatePostEvents)
    }

    $firstResult = $pool40.results[0]
    $secondResult = $pool40.results[1]
    $fifoEvents = @($submitEvents)
    $fifoEvents += @($nonSubmitEvents | Where-Object {
        [string]$_.jobId -eq [string]$secondResult.jobId -and [string]$_.type -in @("slot_claimed", "upstream_submit_attempt")
    })
    $fifoEvents += @($nonSubmitEvents | Where-Object {
        [string]$_.jobId -eq [string]$firstResult.jobId -and [string]$_.type -in @("slot_claimed", "upstream_submit_attempt")
    })
    $fifoEvents += @($nonSubmitEvents | Where-Object {
        -not ([string]$_.jobId -in @([string]$firstResult.jobId, [string]$secondResult.jobId) -and
            [string]$_.type -in @("slot_claimed", "upstream_submit_attempt"))
    })
    Assert-InternalLoadAuditFailure -ExpectedMessage "oldest-runnable FIFO" -Action {
        Invoke-InternalLoadMetrics -Results $pool40.results -Events $fifoEvents
    }

    $missingClaimEvents = @($pool40.events | Where-Object {
        -not ([string]$_.type -eq "slot_claimed" -and [string]$_.jobId -eq [string]$firstResult.jobId)
    })
    Assert-InternalLoadAuditFailure -ExpectedMessage "outside its active reservation window" -Action {
        Invoke-InternalLoadMetrics -Results $pool40.results -Events $missingClaimEvents
    }

    $lastRelease = @($pool40.events | Where-Object { [string]$_.type -eq "slot_reservation_released" })[-1]
    $missingReleaseEvents = @($pool40.events | Where-Object { $_ -ne $lastRelease })
    Assert-InternalLoadAuditFailure -ExpectedMessage "exactly one submit, claim, POST, terminal event, and release" -Action {
        Invoke-InternalLoadMetrics -Results $pool40.results -Events $missingReleaseEvents
    }

    $overCapacity = New-InternalLoadAuditFixture -TaskCount 5 -SingleSlot
    Assert-InternalLoadAuditFailure -ExpectedMessage "oldest-runnable FIFO|4/40 reservation limit" -Action {
        Invoke-InternalLoadMetrics -Results $overCapacity.results -Events $overCapacity.events
    }

    $badClickOrder = @($pool40.results | ForEach-Object { $_ | Select-Object * })
    $badClickOrder[0].queueSequence = 2L
    $badClickOrder[1].queueSequence = 1L
    $emptyRegistry = [pscustomobject]@{ groupIds = @(); taskIds = @(); groups = @() }
    $currentRegistry = [pscustomobject]@{
        groupIds = @($badClickOrder | ForEach-Object { [string]$_.groupId })
        taskIds = @($badClickOrder | ForEach-Object { [string]$_.jobId })
        groups = @()
    }
    Assert-InternalLoadAuditFailure -ExpectedMessage "strictly monotonic in explicit click order" -Action {
        Assert-LoadGlobalIdentity `
            -InitialRegistry $emptyRegistry `
            -CurrentRegistry $currentRegistry `
            -Results $badClickOrder `
            -ResolvedWorkspaceId "internal-workspace"
    }

    Assert-SanitizedLoadArtifact -Value @()
    $emptyArtifactPath = Join-Path ([IO.Path]::GetTempPath()) "android-load-audit-empty-$([Guid]::NewGuid().ToString('N')).json"
    try {
        Write-AtomicJsonArtifact -Path $emptyArtifactPath -Value @()
        $emptyArtifactText = [IO.File]::ReadAllText($emptyArtifactPath, [Text.Encoding]::UTF8).Trim()
        $emptyArtifactValue = $emptyArtifactText | ConvertFrom-Json
        if (-not $emptyArtifactText.StartsWith("[") -or @($emptyArtifactValue).Count -ne 0) {
            throw "Internal empty audit artifact was not serialized as a JSON array."
        }
    }
    finally {
        if (Test-Path -LiteralPath $emptyArtifactPath) { Remove-Item -LiteralPath $emptyArtifactPath -Force }
    }

    $artifactPrefix = Join-Path ([IO.Path]::GetTempPath()) "android-load-artifacts-$([Guid]::NewGuid().ToString('N'))"
    $originalLoadPaths = @($loadAuditPath, $loadSamplesPath, $loadMetricsPath, $loadCheckpointPath)
    try {
        $loadAuditPath = "$artifactPrefix-audit.json"
        $loadSamplesPath = "$artifactPrefix-samples.json"
        $loadMetricsPath = "$artifactPrefix-metrics.json"
        $loadCheckpointPath = "$artifactPrefix-checkpoint.json"
        $script:LoadAuditEvents = [ordered]@{}
        $script:LoadHostSamples = @()
        $script:LoadCheckpoint = $null
        $emptyLoadReport = [ordered]@{
            scenario = "Pool40"
            scheduler = $null
            artifacts = [ordered]@{}
        }
        Write-LoadArtifacts -Report $emptyLoadReport
        foreach ($emptyArrayPath in @($loadAuditPath, $loadSamplesPath)) {
            $artifactText = [IO.File]::ReadAllText($emptyArrayPath, [Text.Encoding]::UTF8).Trim()
            $artifactValue = $artifactText | ConvertFrom-Json
            if (-not $artifactText.StartsWith("[") -or @($artifactValue).Count -ne 0) {
                throw "Internal empty load evidence was not serialized as a JSON array."
            }
        }
    }
    finally {
        foreach ($generatedPath in @($loadAuditPath, $loadSamplesPath, $loadMetricsPath, $loadCheckpointPath)) {
            if (Test-Path -LiteralPath $generatedPath) { Remove-Item -LiteralPath $generatedPath -Force }
        }
        $loadAuditPath = $originalLoadPaths[0]
        $loadSamplesPath = $originalLoadPaths[1]
        $loadMetricsPath = $originalLoadPaths[2]
        $loadCheckpointPath = $originalLoadPaths[3]
    }

    $fixtureAuditSequence = 0
    $releaseLogcatFixture = @(
        $fixtureAuditSequence += 1
        $processStarted = [ordered]@{
            version = 2
            timestamp = 100000L
            processSessionId = "android-process-00000000-0000-0000-0000-000000000001"
            processId = 1000
            auditSequence = $fixtureAuditSequence
            type = "process_started"
            details = [ordered]@{ registryVersion = 3 }
        }
        "1786291682.$('{0:D3}' -f $fixtureAuditSequence) 1000 1000 I FHLImageStudioJobs: Job audit $($processStarted | ConvertTo-Json -Depth 6 -Compress)"
        foreach ($event in $pool40.events) {
            $fixtureAuditSequence += 1
            $details = [ordered]@{
                groupId = [string]$event.groupId
                jobId = [string]$event.jobId
                clientSubmissionId = [string]$event.clientSubmissionId
                requestRunId = [string]$event.requestRunId
                apiMode = [string]$event.apiMode
                apiLabel = [string]$event.apiLabel
                fhlImagesPoolSlot = [int]$event.fhlImagesPoolSlot
                queueSequence = [long]$event.queueSequence
                reservationActive = [bool]$event.reservationActive
                reservationKind = [string]$event.reservationKind
                reservationSlot = [int]$event.reservationSlot
                status = [string]$event.status
                errorMessageChars = [int]$event.errorMessageChars
            }
            $record = [ordered]@{
                version = 2
                timestamp = [long]$event.timestamp
                processSessionId = "android-process-00000000-0000-0000-0000-000000000001"
                processId = 1000
                auditSequence = $fixtureAuditSequence
                type = [string]$event.type
                details = $details
            }
            "1786291682.$('{0:D3}' -f $fixtureAuditSequence) 1000 1000 I FHLImageStudioJobs: Job audit $($record | ConvertTo-Json -Depth 6 -Compress)"
        }
    ) -join "`n"
    $releaseEvents = @(ConvertFrom-ReleaseLogcatAuditText -Raw $releaseLogcatFixture)
    $releaseMetrics = Invoke-InternalLoadMetrics -Results $pool40.results -Events $releaseEvents
    if ([int]$releaseMetrics.totalPeak -ne 40 -or [int]$releaseMetrics.upstreamPosts -ne 40) {
        throw "Internal ReleaseLogcat physical-order fixture did not prove 4/40."
    }
    Assert-InternalLoadAuditFailure -ExpectedMessage "missing or truncated" -Action {
        $truncatedLogcat = $releaseLogcatFixture + "`n1786291683.000 1000 1000 I FHLImageStudioJobs: Job audit " + '{"version":2'
        ConvertFrom-ReleaseLogcatAuditText -Raw $truncatedLogcat | Out-Null
    }
    Assert-InternalLoadAuditFailure -ExpectedMessage "forbidden credential or prompt" -Action {
        $syntheticSecret = "s" + "k-" + ("a" * 24)
        $secretRecord = [ordered]@{
            version = 2
            timestamp = 1
            processSessionId = "android-process-00000000-0000-0000-0000-000000000002"
            processId = 1000
            auditSequence = 1
            type = "submit"
            details = [ordered]@{ note = $syntheticSecret }
        } | ConvertTo-Json -Depth 4 -Compress
        ConvertFrom-ReleaseLogcatAuditText -Raw ("1786291683.001 1000 1000 I FHLImageStudioJobs: Job audit $secretRecord") | Out-Null
    }
    Assert-InternalLoadAuditFailure -ExpectedMessage "forbidden credential or prompt field" -Action {
        $forbiddenFieldRecord = '{"version":2,"timestamp":1,"processSessionId":"android-process-00000000-0000-0000-0000-000000000003","processId":1000,"auditSequence":1,"type":"submit","details":{"apiKey":"secret"}}'
        ConvertFrom-ReleaseLogcatAuditText -Raw ("1786291683.002 1000 1000 I FHLImageStudioJobs: Job audit $forbiddenFieldRecord") | Out-Null
    }
    Assert-InternalLoadAuditFailure -ExpectedMessage "audit sequence has a gap" -Action {
        $fixtureLines = @($releaseLogcatFixture -split "`n")
        $gapLines = @($fixtureLines[0]) + @($fixtureLines[2..($fixtureLines.Count - 1)])
        ConvertFrom-ReleaseLogcatAuditText -Raw ($gapLines -join "`n") | Out-Null
    }
    if ($originalEvidenceSource -ne $EvidenceSource) {
        throw "Internal ReleaseLogcat self-test changed the selected evidence source."
    }

    Write-Output "Android load audit internal self-test: PASS"
}

function Assert-LoadDistribution {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Results,
        [Parameter(Mandatory = $true)][int]$ExpectedPerSlot
    )

    foreach ($poolSlot in 1..10) {
        $items = @($Results | Where-Object { [int]$_.expectedSlot -eq $poolSlot })
        if ($items.Count -ne $ExpectedPerSlot -or
            @($items | Where-Object { [string]$_.expectedLabel -ne "FHL$poolSlot" }).Count -ne 0) {
            throw "Load result distribution for FHL$poolSlot is not exactly $ExpectedPerSlot."
        }
    }
}

function Assert-SanitizedLoadArtifact {
    param([Parameter(Mandatory = $true)][AllowNull()][AllowEmptyCollection()][object]$Value)

    $json = ConvertTo-Json -InputObject $Value -Depth 16 -Compress
    if ($null -eq $json) { $json = "null" }
    if ((-not [string]::IsNullOrWhiteSpace($PromptText) -and $json.Contains($PromptText)) -or
        $json -match "(?i)\bsk-[a-z0-9_-]{12,}\b" -or
        $json -match '(?i)"(?:apiKey|prompt|negativePrompt)"\s*:') {
        throw "A load evidence artifact contained forbidden Key or prompt content."
    }
}

function Write-LoadArtifacts {
    param([Parameter(Mandatory = $true)][object]$Report)

    if ([string]$Report.scenario -notin @("Pool40", "Queue60")) { return }
    $audit = @($script:LoadAuditEvents.Values)
    $samples = @($script:LoadHostSamples)
    $metrics = if ($null -ne $Report.scheduler) { $Report.scheduler } else { [ordered]@{} }
    Assert-SanitizedLoadArtifact -Value $audit
    Assert-SanitizedLoadArtifact -Value $samples
    Assert-SanitizedLoadArtifact -Value $metrics
    Write-AtomicJsonArtifact -Path $loadAuditPath -Value $audit
    Write-AtomicJsonArtifact -Path $loadSamplesPath -Value $samples
    Write-AtomicJsonArtifact -Path $loadMetricsPath -Value $metrics
    if ($null -ne $script:LoadCheckpoint) {
        Assert-SanitizedLoadArtifact -Value $script:LoadCheckpoint
        Write-AtomicJsonArtifact -Path $loadCheckpointPath -Value $script:LoadCheckpoint
    }
    $Report.artifacts["nativeSchedulerAudit"] = [IO.Path]::GetFileName($loadAuditPath)
    $Report.artifacts["hostQueueSamples"] = [IO.Path]::GetFileName($loadSamplesPath)
    $Report.artifacts["schedulerMetrics"] = [IO.Path]::GetFileName($loadMetricsPath)
    $Report.artifacts["loadCheckpoint"] = if ($null -ne $script:LoadCheckpoint) { [IO.Path]::GetFileName($loadCheckpointPath) } else { "" }
}

function Resolve-EvidenceArtifactPath {
    param([Parameter(Mandatory = $true)][string]$FileName)

    if ([string]::IsNullOrWhiteSpace($FileName) -or
        [IO.Path]::IsPathRooted($FileName) -or
        [IO.Path]::GetFileName($FileName) -ne $FileName -or
        $FileName -in @(".", "..")) {
        throw "Evidence artifact names must be plain relative file names."
    }
    $path = Join-Path $OutputDirectory $FileName
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Evidence artifact is missing: $FileName" }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Evidence artifacts cannot be symbolic links or reparse points."
    }
    return $item
}

function Write-EvidenceManifest {
    param([Parameter(Mandatory = $true)][object]$Report)

    if ([string]$Report.status -eq "running") {
        if (Test-Path -LiteralPath $evidenceManifestPath) { Remove-Item -LiteralPath $evidenceManifestPath -Force }
        return
    }
    $entries = [Collections.Generic.List[object]]::new()
    $knownPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $addArtifact = {
        param([string]$Role, [string]$FileName)
        if ([string]::IsNullOrWhiteSpace($FileName)) { return }
        if (-not $knownPaths.Add($FileName)) { return }
        $item = Resolve-EvidenceArtifactPath -FileName $FileName
        $entries.Add([ordered]@{
            role = $Role
            path = $FileName
            sizeBytes = [long]$item.Length
            sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
        })
    }
    & $addArtifact "report" ([IO.Path]::GetFileName($reportPath))
    & $addArtifact "upstreamSubmitAttempts" ([IO.Path]::GetFileName($attemptsPath))
    $artifactProperties = if ($Report.artifacts -is [System.Collections.IDictionary]) {
        @($Report.artifacts.GetEnumerator() | ForEach-Object { [pscustomobject]@{ Name = $_.Key; Value = $_.Value } })
    }
    else {
        @($Report.artifacts.PSObject.Properties)
    }
    foreach ($property in $artifactProperties) {
        if ([string]$property.Name -eq "evidenceManifest") { continue }
        & $addArtifact ([string]$property.Name) ([string]$property.Value)
    }
    if ([string]$Report.status -eq "passed") {
        $requiredRoles = [Collections.Generic.List[string]]::new()
        foreach ($role in @("report", "upstreamSubmitAttempts")) { $requiredRoles.Add($role) }
        if ([string]$Report.evidenceSource -eq "ReleaseLogcat") { $requiredRoles.Add("releaseLogcat") }
        if ([string]$Report.evidenceSource -eq "ReleaseLogcat" -and -not [string]::IsNullOrWhiteSpace([string]$Report.acceptanceRole)) {
            $requiredRoles.Add("deviceRuntimeMetrics")
            $requiredRoles.Add("crashAnrLogcat")
        }
        if ([string]$Report.scenario -in @("Pool40", "Queue60")) {
            foreach ($role in @("nativeSchedulerAudit", "hostQueueSamples", "schedulerMetrics", "loadCheckpoint")) {
                $requiredRoles.Add($role)
            }
        }
        foreach ($role in $requiredRoles) {
            if (@($entries | Where-Object { [string]$_.role -eq $role }).Count -ne 1) {
                throw "Passed evidence is missing exactly one required manifest role: $role"
            }
        }
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToString("o")
        generator = "verify-android-phone-debug-base.ps1"
        terminalStatus = [string]$Report.status
        scenario = [string]$Report.scenario
        acceptanceRole = [string]$Report.acceptanceRole
        evidenceSource = [string]$Report.evidenceSource
        binding = [ordered]@{
            apkSha256 = [string]$Report.apkSha256
            installedApkSha256 = [string]$Report.installedApkSha256
            baselineApkSha256 = [string]$Report.baselineApkSha256
            candidateGitCommit = [string]$Report.candidateGitCommit
            productGitCommit = [string]$Report.productGitCommit
            verifierGitCommit = [string]$Report.verifierGitCommit
            verifierScriptSha256 = [string]$Report.verifierScriptSha256
            apkServiceIdentity = [string]$Report.apkServiceIdentity
            apkBuildId = [string]$Report.apkBuildId
            package = [string]$Report.package
            apkCertificateSha256 = [string]$Report.apkCertificateSha256
            apkDebuggable = $Report.apkDebuggable
            apkSignatureV2 = $Report.apkSignatureV2
        }
        files = @($entries)
    }
    Write-AtomicJsonArtifact -Path $evidenceManifestPath -Value $manifest
}

function Write-Evidence {
    param(
        [Parameter(Mandatory = $true)][object]$Report,
        [object[]]$Attempts = @()
    )

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $Report.artifacts["evidenceManifest"] = if ([string]$Report.status -eq "running") { "" } else { [IO.Path]::GetFileName($evidenceManifestPath) }
    if ($EvidenceSource -eq "ReleaseLogcat") {
        $Report.artifacts["releaseLogcat"] = Write-ReleaseLogcatArtifact
    }
    Write-LoadArtifacts -Report $Report
    $safeAttempts = @($Attempts | ForEach-Object {
        [ordered]@{
            timestamp = $_.timestamp
            groupId = $_.groupId
            jobId = $_.jobId
            clientSubmissionId = $_.clientSubmissionId
            requestRunId = $_.requestRunId
            apiMode = $_.apiMode
            apiLabel = $_.apiLabel
            fhlImagesPoolSlot = $_.fhlImagesPoolSlot
        }
    })
    [IO.File]::WriteAllText(
        $reportPath,
        ($Report | ConvertTo-Json -Depth 12) + "`n",
        [Text.UTF8Encoding]::new($false)
    )
    [IO.File]::WriteAllText(
        $attemptsPath,
        (ConvertTo-Json -InputObject @($safeAttempts) -Depth 6) + "`n",
        [Text.UTF8Encoding]::new($false)
    )

    $lines = @(
        "# Android V2.0.3 Emulator Acceptance Verification",
        "",
        "- Scenario: ``$($Report.scenario)``",
        "- Evidence source: ``$($Report.evidenceSource)``",
        "- Status: ``$($Report.status)``",
        "- APK: ``$($Report.apkFile)``",
        "- APK SHA-256: ``$($Report.apkSha256)``",
        "- Installed APK SHA-256: ``$($Report.installedApkSha256)``",
        "- Upgrade baseline APK SHA-256: ``$($Report.baselineApkSha256)``",
        "- Candidate Git commit: ``$($Report.candidateGitCommit)``",
        "- Product Git commit: ``$($Report.productGitCommit)``",
        "- Verifier Git commit: ``$($Report.verifierGitCommit)``",
        "- Verifier script SHA-256: ``$($Report.verifierScriptSha256)``",
        "- APK service identity: ``$($Report.apkServiceIdentity)``",
        "- APK Build ID: ``$($Report.apkBuildId)``",
        "- APK certificate SHA-256: ``$($Report.apkCertificateSha256)``",
        "- APK debuggable: ``$($Report.apkDebuggable)``",
        "- APK Signature Scheme v2: ``$($Report.apkSignatureV2)``",
        "- Device: ``$($Report.device)``",
        "- Package: ``$($Report.package)``",
        "- Workspace: ``$($Report.workspaceId)``",
        "- Cursor before: ``$($Report.cursorBefore)``",
        "- Cursor after: ``$($Report.cursorAfter)``",
        "- Expected slots: ``$(@($Report.expectedSlots) -join ', ')``",
        "- Compatibility-only: ``$($Report.compatibilityOnly)``",
        "- Formal ten-slot gate: ``$($Report.formalTenSlotGate)``",
        "- Clicks / groups / tasks / image-generation POSTs: ``$($Report.metrics.clicks) / $($Report.metrics.groups) / $($Report.metrics.tasks) / $($Report.metrics.upstreamPosts)``",
        "- Startup/cold-start POST delta: ``$($Report.metrics.observationPostDelta)``",
        "- Observation seconds: ``$($Report.observationSeconds)``",
        "- Prompt length only: ``$($Report.promptLength)``",
        "- Finished: ``$($Report.finishedAt)``"
    )
    if (-not [string]::IsNullOrWhiteSpace([string]$Report.failure)) {
        $lines += "- Failure: ``$($Report.failure)``"
    }
    if ($null -ne $Report.geometry) {
        $lines += "- CTA/nav geometry: nav ``$($Report.geometry.navHeight)``px; CTA offset ``$($Report.geometry.ctaBottomCss)``px; boundary gap ``$($Report.geometry.boundaryGap)``px; viewport gap ``$($Report.geometry.navViewportGap)``px; center hit ``$($Report.geometry.buttonCenterHit)``"
    }
    if ($null -ne $Report.workflow) {
        if ([string]$Report.workflow.auditKind -eq "responses_text_capability") {
            $lines += @(
                "- Image-generation POST count: ``$($Report.workflow.imageGenerationPostCount)``",
                "- Responses text capability POST count: ``$($Report.workflow.capabilityTextPostCount)``",
                "- Responses text capability POST range: ``$($Report.workflow.capabilityTextPostCountLowerBound)-$($Report.workflow.capabilityTextPostCountUpperBound)`` (exact: ``$($Report.workflow.capabilityTextPostCountExact)``)",
                "- Responses indeterminate slot: ``$($Report.workflow.indeterminateSlot)``",
                "- Responses available slots: ``$(@($Report.workflow.availableSlots) -join ', ')``",
                "- Responses capability stop reason: ``$($Report.workflow.stoppedReason)``"
            )
        }
        elseif ([string]$Report.scenario -eq "CompatibilityWorkflow") {
            $lines += @(
                "- Compatibility workflow UI actions: ``$($Report.workflow.uiActions)`` (generation clicks remain ``0``)",
                "- Compatibility workflow sources: ``$($Report.workflow.initialSourceCount) -> $($Report.workflow.finalSourceCount)``",
                "- Compatibility workflow annotations / transforms: ``$(@($Report.workflow.annotations).Count) / $(@($Report.workflow.transforms).Count)``",
                "- Compatibility workflow final view: ``$($Report.workflow.finalView)``"
            )
        }
    }
    if ($null -ne $Report.scheduler) {
        $lines += @(
            "- Scheduler peak / queue peak: ``$($Report.scheduler.totalPeak) / $($Report.scheduler.queuePeak)``",
            "- Scheduler FIFO: ``$($Report.scheduler.fifoQueueSequence)``",
            "- Exact 4/40 host checkpoint: ``$($Report.scheduler.hostCheckpointPassed)``"
        )
    }
    if ($null -ne $Report.artifacts) {
        if (-not [string]::IsNullOrWhiteSpace([string]$Report.artifacts.screenshot)) {
            $lines += "- Screenshot: ``$($Report.artifacts.screenshot)``"
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$Report.artifacts.redactedLogcat)) {
            $lines += "- Redacted logcat: ``$($Report.artifacts.redactedLogcat)``"
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$Report.artifacts.releaseLogcat)) {
            $lines += "- Release audit logcat: ``$($Report.artifacts.releaseLogcat)``"
        }
    }
    if (@($Report.results).Count -gt 0) {
        $lines += @("", "| # | Expected | Status | Groups | Tasks | POSTs | History |", "|---:|---|---|---:|---:|---:|---|")
        foreach ($result in @($Report.results)) {
            $lines += "| $($result.sequence) | $($result.expectedLabel) | $($result.status) | $($result.groupCount) | $($result.taskCount) | $($result.postCount) | $($result.historyLabel) |"
        }
    }
    [IO.File]::WriteAllLines($markdownPath, $lines, [Text.UTF8Encoding]::new($false))
    Write-EvidenceManifest -Report $Report
}

function Complete-ExistingSequentialEvidence {
    if ($Scenario -ne "Sequential") {
        throw "FinalizeExistingSequential is only valid with Scenario Sequential."
    }
    if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $attemptsPath -PathType Leaf)) {
        throw "Existing sequential evidence files were not found in OutputDirectory."
    }
    if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) { throw "APK was not found: $ApkPath" }
    $expectedHash = ($ExpectedApkSha256 -replace "\s", "").ToUpperInvariant()
    $actualHash = (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($expectedHash -notmatch "^[0-9A-F]{64}$" -or $actualHash -ne $expectedHash) {
        throw "APK SHA-256 mismatch; evidence finalization was blocked."
    }

    $existingReport = Get-Content -Raw -Encoding UTF8 -LiteralPath $reportPath | ConvertFrom-Json
    $results = @($existingReport.results)
    $attempts = Get-Content -Raw -Encoding UTF8 -LiteralPath $attemptsPath | ConvertFrom-Json
    $attempts = @($attempts)
    $knownFixtureFailure = 'Property "groupId" cannot be found.'
    $priorStatus = [string]$existingReport.status
    $priorFailure = [string]$existingReport.failure
    $priorFinishedAt = [string]$existingReport.finishedAt
    if ($priorStatus -eq "failed") {
        if ($priorFailure -ne $knownFixtureFailure) {
            throw "Existing sequential evidence failed for a reason that is not eligible for fixture recovery."
        }
    } elseif ($priorStatus -eq "passed" -and
        [string]$existingReport.fixtureRecovery.reason -eq "PowerShell OrderedDictionary Select-Object finalization defect") {
        $priorStatus = [string]$existingReport.fixtureRecovery.priorStatus
        $priorFailure = [string]$existingReport.fixtureRecovery.priorFailure
        $priorFinishedAt = [string]$existingReport.fixtureRecovery.priorFinishedAt
        if ($priorStatus -ne "failed" -or $priorFailure -ne $knownFixtureFailure) {
            throw "Recovered sequential evidence does not retain the known fixture failure."
        }
    } else {
        throw "Existing sequential evidence is not the known recoverable fixture failure."
    }
    $parsedPriorFinishedAt = [DateTimeOffset]::MinValue
    if ([string]::IsNullOrWhiteSpace($priorFinishedAt) -or
        -not [DateTimeOffset]::TryParse($priorFinishedAt, [ref]$parsedPriorFinishedAt)) {
        throw "Existing sequential evidence does not retain a valid prior failure timestamp."
    }
    if ([string]$existingReport.scenario -ne "Sequential" -or $results.Count -ne 10 -or $attempts.Count -ne 10) {
        throw "Existing sequential evidence does not contain ten results and ten attempts."
    }
    if ([string]$existingReport.apkSha256 -ne $actualHash -or [string]$existingReport.installedApkSha256 -ne $actualHash) {
        throw "Existing sequential evidence does not reference the frozen and installed APK hash."
    }
    if ([int]$existingReport.metrics.clicks -ne 10 -or [int]$existingReport.metrics.groups -ne 10 -or
        [int]$existingReport.metrics.tasks -ne 10 -or [int]$existingReport.metrics.upstreamPosts -ne 10) {
        throw "Existing sequential evidence metrics are not exactly 10/10/10/10."
    }
    $expectedSlots = @($existingReport.expectedSlots | ForEach-Object { [int]$_ })
    $cursorBefore = [int]$existingReport.cursorBefore
    $expectedCycle = @(for ($offset = 0; $offset -lt 10; $offset += 1) { (($cursorBefore - 1 + $offset) % 10) + 1 })
    if ($cursorBefore -lt 1 -or $cursorBefore -gt 10 -or ($expectedSlots -join ',') -ne ($expectedCycle -join ',') -or
        (@($expectedSlots | Sort-Object -Unique) -join ',') -ne ((1..10) -join ',') -or
        [int]$existingReport.cursorAfter -ne $cursorBefore) {
        throw "Existing sequential evidence does not contain one complete cursor-preserving ten-slot cycle."
    }
    if (@($results | ForEach-Object { $_.groupId } | Sort-Object -Unique).Count -ne 10 -or
        @($results | ForEach-Object { $_.jobId } | Sort-Object -Unique).Count -ne 10 -or
        @($results | ForEach-Object { $_.clientSubmissionId } | Sort-Object -Unique).Count -ne 10) {
        throw "Existing sequential evidence contains duplicate native identities."
    }
    for ($index = 0; $index -lt 10; $index += 1) {
        $result = $results[$index]
        $expectedSlot = $expectedSlots[$index]
        $expectedLabel = "FHL$expectedSlot"
        if (@(@($result.groupId, $result.jobId, $result.clientSubmissionId, $result.requestRunId) |
            Where-Object { [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) {
            throw "Existing sequential result $($index + 1) has an empty native identity."
        }
        if ([int]$result.sequence -ne ($index + 1) -or [int]$result.expectedSlot -ne $expectedSlot -or
            [string]$result.expectedLabel -ne $expectedLabel -or
            [string]$result.status -ne "succeeded" -or [string]$result.historyLabel -ne $expectedLabel -or
            [int]$result.groupCount -ne 1 -or [int]$result.taskCount -ne 1 -or [int]$result.postCount -ne 1) {
            throw "Existing sequential result $($index + 1) failed its frozen source contract."
        }
        $matchingAttempts = @($attempts | Where-Object {
            [string]$_.groupId -eq [string]$result.groupId -and
            [string]$_.jobId -eq [string]$result.jobId -and
            [string]$_.clientSubmissionId -eq [string]$result.clientSubmissionId -and
            [string]$_.requestRunId -eq [string]$result.requestRunId -and
            [string]$_.apiMode -eq "images" -and
            [string]$_.apiLabel -eq $expectedLabel -and
            [int]$_.fhlImagesPoolSlot -eq $expectedSlot
        })
        if ($matchingAttempts.Count -ne 1) { throw "$expectedLabel does not have exactly one matching submit attempt." }
        $localAttempt = $matchingAttempts[0]
        if ([long]$localAttempt.timestamp -le 0) { throw "$expectedLabel submit attempt has an invalid timestamp." }
    }

    $script:AdbExecutable = Resolve-AdbExecutable
    if (-not (Test-DeviceConnected) -or -not (Test-PackageInstalled)) {
        throw "The verified Android package is not available on $Device."
    }
    $installedHash = Get-InstalledApkSha256
    if ($installedHash -ne $actualHash) { throw "Installed base APK does not match the frozen candidate." }
    $native = Get-NativeRegistrySummary
    $globalAttempts = @(Get-UpstreamSubmitAttempts)
    foreach ($result in $results) {
        $localAttempt = @($attempts | Where-Object {
            [string]$_.groupId -eq [string]$result.groupId -and
            [string]$_.jobId -eq [string]$result.jobId -and
            [string]$_.clientSubmissionId -eq [string]$result.clientSubmissionId -and
            [string]$_.requestRunId -eq [string]$result.requestRunId
        })[0]
        $nativeGroup = @($native.groups | Where-Object { [string]$_.groupId -eq [string]$result.groupId })[0]
        $nativeSlot = if ($nativeGroup) { @($nativeGroup.slots | Where-Object { [string]$_.jobId -eq [string]$result.jobId })[0] } else { $null }
        if (-not $nativeGroup -or -not $nativeSlot -or [string]$nativeSlot.status -ne "succeeded") {
            throw "A sequential native task is missing or no longer succeeded."
        }
        $globalMatch = @($globalAttempts | Where-Object {
            [string]$_.groupId -eq [string]$result.groupId -and
            [string]$_.jobId -eq [string]$result.jobId -and
            [string]$_.clientSubmissionId -eq [string]$result.clientSubmissionId -and
            [string]$_.requestRunId -eq [string]$result.requestRunId -and
            [string]$_.apiMode -eq "images" -and
            [string]$_.apiLabel -eq [string]$result.expectedLabel -and
            [int]$_.fhlImagesPoolSlot -eq [int]$result.expectedSlot -and
            [long]$_.timestamp -eq [long]$localAttempt.timestamp
        })
        if ($globalMatch.Count -ne 1) { throw "A sequential task does not retain exactly one global submit attempt." }
    }

    $existingReport.status = "passed"
    $existingReport.failure = $null
    $existingReport.finishedAt = (Get-Date).ToString("o")
    $existingReport | Add-Member -NotePropertyName fixtureRecovery -NotePropertyValue ([ordered]@{
        reason = "PowerShell OrderedDictionary Select-Object finalization defect"
        priorStatus = $priorStatus
        priorFailure = $priorFailure
        priorFinishedAt = if ([string]::IsNullOrWhiteSpace($priorFinishedAt)) { $null } else { $priorFinishedAt }
        verifiedAt = (Get-Date).ToString("o")
        installedApkSha256 = $installedHash
        sourceResultCount = $results.Count
        sourceAttemptCount = $attempts.Count
    }) -Force
    Write-Evidence -Report $existingReport -Attempts $attempts
    Write-Host "Existing sequential evidence finalized without creating a new task: $OutputDirectory"
}

function Get-SequentialResumeBatch {
    param([Parameter(Mandatory = $true)][long]$NativeBatchStart)

    $registry = Get-NativeRegistrySummary
    $groups = @($registry.groups | Where-Object { [long]$_.createdAt -ge $NativeBatchStart } | Sort-Object createdAt)
    $allAttempts = @(Get-UpstreamSubmitAttempts)
    $attempts = @($allAttempts | Where-Object { [long]$_.timestamp -ge $NativeBatchStart } | Sort-Object timestamp)
    return [pscustomobject]@{
        registry = $registry
        groups = $groups
        attempts = $attempts
        allAttempts = $allAttempts
    }
}

function Assert-SequentialResumeIdentitySet {
    param(
        [Parameter(Mandatory = $true)][object[]]$Groups,
        [Parameter(Mandatory = $true)][object[]]$Attempts,
        [Parameter(Mandatory = $true)][int[]]$ExpectedSlots,
        [Parameter(Mandatory = $true)][string]$ExpectedWorkspaceId,
        [Parameter(Mandatory = $true)][string]$Context
    )

    if ($Groups.Count -ne $ExpectedSlots.Count -or $Attempts.Count -ne $ExpectedSlots.Count) {
        throw "$Context does not contain the expected group/task/POST count."
    }
    foreach ($property in @("groupId", "jobId", "clientSubmissionId", "requestRunId")) {
        $values = @()
        foreach ($group in $Groups) {
            $slot = @($group.slots)[0]
            $value = if ($property -eq "jobId") { [string]$slot.jobId } else { [string]$group.$property }
            if ([string]::IsNullOrWhiteSpace($value)) { throw "$Context has an empty $property." }
            $values += $value
        }
        if (@($values | Sort-Object -Unique).Count -ne $values.Count) {
            throw "$Context contains a duplicate $property."
        }
    }

    for ($index = 0; $index -lt $ExpectedSlots.Count; $index += 1) {
        $group = $Groups[$index]
        $slot = @($group.slots)[0]
        $expectedSlot = [int]$ExpectedSlots[$index]
        $expectedLabel = "FHL$expectedSlot"
        if ([string]$group.workspaceId -ne $ExpectedWorkspaceId -or @($group.slots).Count -ne 1) {
            throw "$Context $expectedLabel does not retain one task in the expected workspace."
        }
        Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
        if ([string]$group.apiMode -ne "images" -or [string]$slot.apiMode -ne "images" -or
            [string]$slot.status -ne "succeeded") {
            throw "$Context $expectedLabel is not one succeeded Images task."
        }
        $matchingAttempts = @($Attempts | Where-Object {
            [string]$_.groupId -eq [string]$group.groupId -and
            [string]$_.jobId -eq [string]$slot.jobId -and
            [string]$_.clientSubmissionId -eq [string]$group.clientSubmissionId -and
            [string]$_.requestRunId -eq [string]$group.requestRunId -and
            [string]$_.apiMode -eq "images" -and
            [string]$_.apiLabel -eq $expectedLabel -and
            [int]$_.fhlImagesPoolSlot -eq $expectedSlot
        })
        if ($matchingAttempts.Count -ne 1 -or [long]$matchingAttempts[0].timestamp -lt [long]$group.createdAt) {
            throw "$Context $expectedLabel does not retain exactly one ordered POST audit."
        }
        if ($index -gt 0) {
            $previous = $Groups[$index - 1]
            $previousAttempt = @($Attempts | Where-Object { [string]$_.groupId -eq [string]$previous.groupId })[0]
            if ([long]$group.createdAt -le [long]$previousAttempt.timestamp) {
                throw "$Context native task order is not strictly sequential."
            }
        }
    }
}

function Get-ValidatedSequentialResumeState {
    if ($Scenario -ne "Sequential") { throw "ResumeExistingSequential is only valid with Scenario Sequential." }
    if (-not $SkipInstall) { throw "ResumeExistingSequential requires SkipInstall and never reinstalls the APK." }
    foreach ($requiredPath in @($reportPath, $attemptsPath, $resumeSnapshotPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Sequential resume evidence is missing: $([IO.Path]::GetFileName($requiredPath))"
        }
    }
    if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) { throw "APK was not found: $ApkPath" }

    $expectedHash = ($ExpectedApkSha256 -replace "\s", "").ToUpperInvariant()
    $resolvedApkPath = (Resolve-Path -LiteralPath $ApkPath).Path
    $actualHash = (Get-FileHash -LiteralPath $resolvedApkPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($expectedHash -notmatch "^[0-9A-F]{64}$" -or $actualHash -ne $expectedHash) {
        throw "Sequential resume APK SHA-256 mismatch."
    }

    $report = Get-Content -Raw -Encoding UTF8 -LiteralPath $reportPath | ConvertFrom-Json
    $localAttempts = Get-Content -Raw -Encoding UTF8 -LiteralPath $attemptsPath | ConvertFrom-Json
    $localAttempts = @($localAttempts)
    $snapshot = Get-Content -Raw -Encoding UTF8 -LiteralPath $resumeSnapshotPath | ConvertFrom-Json
    $results = @($report.results)
    $expectedSlots = @($report.expectedSlots | ForEach-Object { [int]$_ })
    $expectedCycle = @(for ($offset = 0; $offset -lt 10; $offset += 1) { (([int]$report.cursorBefore - 1 + $offset) % 10) + 1 })
    if ([string]$report.scenario -ne "Sequential" -or [string]$report.status -ne "running" -or
        $null -ne $report.finishedAt -or $null -ne $report.failure) {
        throw "Sequential resume requires one unfinished running report."
    }
    if ([string]$report.apkSha256 -ne $actualHash -or [string]$report.installedApkSha256 -ne $actualHash -or
        [string]$report.device -ne $Device -or [string]$report.package -ne $Package) {
        throw "Sequential running report does not match the frozen APK, device or package."
    }
    if ($results.Count -ne 8 -or $localAttempts.Count -ne 8 -or
        [int]$report.metrics.clicks -ne 8 -or [int]$report.metrics.groups -ne 8 -or
        [int]$report.metrics.tasks -ne 8 -or [int]$report.metrics.upstreamPosts -ne 8 -or
        [int]$report.cursorAfter -ne 3 -or ($expectedSlots -join ',') -ne ($expectedCycle -join ',')) {
        throw "Sequential running report is not the exact 8-of-10 checkpoint."
    }
    if (($expectedSlots -join ',') -ne '5,6,7,8,9,10,1,2,3,4') {
        throw "Sequential running report does not retain the expected FHL5-to-FHL4 cycle."
    }

    $snapshotGroups = @($snapshot.groups)
    $snapshotAttempts = @($snapshot.attempts)
    $partialSlots = @($snapshot.expectedPartialSlots | ForEach-Object { [int]$_ })
    if ([int]$snapshot.schemaVersion -ne 1 -or [string]$snapshot.status -ne "verified_partial" -or
        [string]$snapshot.apkSha256 -ne $actualHash -or [string]$snapshot.device -ne $Device -or
        [string]$snapshot.reportStartedAt -ne [string]$report.startedAt -or
        [int]$snapshot.checkpointedResults -ne 8 -or [int]$snapshot.recoveredResults -ne 9 -or
        [int]$snapshot.pendingCount -ne 0 -or [int]$snapshot.resumeNextSlot -ne 4 -or
        ($partialSlots -join ',') -ne '5,6,7,8,9,10,1,2,3' -or
        $snapshotGroups.Count -ne 9 -or $snapshotAttempts.Count -ne 9) {
        throw "Sequential recovery snapshot is not the exact verified 9-of-10 checkpoint."
    }

    foreach ($property in @("groupId", "jobId", "clientSubmissionId", "requestRunId")) {
        $values = @($snapshotGroups | ForEach-Object { [string]$_.$property })
        if (@($values | Where-Object { [string]::IsNullOrWhiteSpace([string]$_) }).Count -ne 0 -or
            @($values | Sort-Object -Unique).Count -ne 9) {
            throw "Sequential recovery snapshot contains an invalid $property set."
        }
    }
    for ($index = 0; $index -lt 9; $index += 1) {
        $record = $snapshotGroups[$index]
        $attempt = @($snapshotAttempts | Where-Object { [string]$_.groupId -eq [string]$record.groupId })
        $expectedSlot = [int]$partialSlots[$index]
        $expectedLabel = "FHL$expectedSlot"
        if ([int]$record.sequence -ne ($index + 1) -or [int]$record.fhlImagesPoolSlot -ne $expectedSlot -or
            [string]$record.apiLabel -ne $expectedLabel -or [string]$record.status -ne "succeeded" -or
            $attempt.Count -ne 1 -or [string]$attempt[0].jobId -ne [string]$record.jobId -or
            [string]$attempt[0].clientSubmissionId -ne [string]$record.clientSubmissionId -or
            [string]$attempt[0].requestRunId -ne [string]$record.requestRunId -or
            [string]$attempt[0].apiMode -ne "images" -or [string]$attempt[0].apiLabel -ne $expectedLabel -or
            [int]$attempt[0].fhlImagesPoolSlot -ne $expectedSlot -or
            [long]$attempt[0].timestamp -lt [long]$record.createdAt) {
            throw "Sequential recovery snapshot $expectedLabel identity or POST audit is invalid."
        }
        if ($index -lt 8) {
            $result = $results[$index]
            $localAttempt = @($localAttempts | Where-Object { [string]$_.groupId -eq [string]$result.groupId })
            if ([int]$result.sequence -ne ($index + 1) -or [int]$result.expectedSlot -ne $expectedSlot -or
                [string]$result.expectedLabel -ne $expectedLabel -or [string]$result.status -ne "succeeded" -or
                [string]$result.historyLabel -ne $expectedLabel -or [int]$result.groupCount -ne 1 -or
                [int]$result.taskCount -ne 1 -or [int]$result.postCount -ne 1 -or
                [string]$result.workspaceId -ne [string]$report.workspaceId -or
                [string]$result.groupId -ne [string]$record.groupId -or [string]$result.jobId -ne [string]$record.jobId -or
                [string]$result.clientSubmissionId -ne [string]$record.clientSubmissionId -or
                [string]$result.requestRunId -ne [string]$record.requestRunId -or
                [long]$result.clickedAt -le 0 -or [long]$result.createdAt -lt [long]$result.clickedAt -or
                [long]$result.createdAt -ne [long]$record.createdAt -or $localAttempt.Count -ne 1 -or
                [long]$localAttempt[0].timestamp -ne [long]$attempt[0].timestamp) {
                throw "Sequential running report $expectedLabel does not match the recovery snapshot."
            }
        }
    }
    $fhl2Attempt = @($snapshotAttempts | Where-Object { [string]$_.apiLabel -eq "FHL2" })[0]
    $fhl3Record = $snapshotGroups[8]
    if ([long]$fhl3Record.createdAt -le [long]$fhl2Attempt.timestamp) {
        throw "Recovered FHL3 was not created after the checkpointed FHL2 attempt."
    }

    $batch = Get-SequentialResumeBatch -NativeBatchStart ([long]$snapshot.nativeBatchStart)
    Assert-SequentialResumeIdentitySet `
        -Groups @($batch.groups) `
        -Attempts @($batch.attempts) `
        -ExpectedSlots $partialSlots `
        -ExpectedWorkspaceId ([string]$report.workspaceId) `
        -Context "Live sequential recovery"
    if ([int]$batch.registry.pendingCount -ne 0) { throw "Sequential recovery requires an idle native queue." }
    for ($index = 0; $index -lt 9; $index += 1) {
        $liveGroup = $batch.groups[$index]
        $record = $snapshotGroups[$index]
        if ([string]$liveGroup.groupId -ne [string]$record.groupId -or
            [string]@($liveGroup.slots)[0].jobId -ne [string]$record.jobId -or
            [string]$liveGroup.clientSubmissionId -ne [string]$record.clientSubmissionId -or
            [string]$liveGroup.requestRunId -ne [string]$record.requestRunId -or
            [long]$liveGroup.createdAt -ne [long]$record.createdAt) {
            throw "Live sequential recovery identity differs from the saved checkpoint."
        }
    }

    return [pscustomobject]@{
        apkPath = $resolvedApkPath
        apkSha256 = $actualHash
        report = $report
        results = $results
        localAttempts = $localAttempts
        snapshot = $snapshot
        snapshotGroups = $snapshotGroups
        snapshotAttempts = $snapshotAttempts
        expectedSlots = $expectedSlots
        partialSlots = $partialSlots
        batch = $batch
    }
}

function Resume-RunningSequentialEvidence {
    $failure = $null
    try {
        if ($ResumeAuditOnly -and -not $ResumeExistingSequential) {
            throw "ResumeAuditOnly requires ResumeExistingSequential."
        }
        if ($ObservationSeconds -lt 30 -or $TerminalTimeoutSeconds -lt 30) {
            throw "Sequential resume timeouts are below the safe minimum."
        }
        $script:AdbExecutable = Resolve-AdbExecutable
        if (-not (Test-DeviceConnected) -or -not (Test-PackageInstalled)) {
            throw "The frozen Android package is not available on $Device."
        }
        Assert-RunAsAvailable
        $stateBeforeStart = Get-ValidatedSequentialResumeState
        $installedHash = Get-InstalledApkSha256
        if ($installedHash -ne [string]$stateBeforeStart.apkSha256) {
            throw "Installed APK does not match the frozen sequential candidate."
        }
        $groupIdsBeforeStart = @($stateBeforeStart.batch.groups | ForEach-Object { [string]$_.groupId })
        $attemptIdsBeforeStart = @($stateBeforeStart.batch.attempts | ForEach-Object { Get-AttemptIdentity $_ })

        Start-AppAndConnect
        $bootstrap = Wait-AndroidBootstrapReady
        $browser = Get-BrowserState
        Assert-TenConfiguredSlots -BrowserState $browser
        if ([string]$browser.workspaceId -ne [string]$stateBeforeStart.report.workspaceId -or
            [string]$browser.storageNamespace -ne [string]$stateBeforeStart.report.storageNamespace -or
            [int]$browser.cursor -ne 4) {
            throw "Sequential recovery browser workspace, storage namespace or cursor changed."
        }
        $stateAfterStart = Get-ValidatedSequentialResumeState
        $groupIdsAfterStart = @($stateAfterStart.batch.groups | ForEach-Object { [string]$_.groupId })
        $attemptIdsAfterStart = @($stateAfterStart.batch.attempts | ForEach-Object { Get-AttemptIdentity $_ })
        if (($groupIdsBeforeStart -join ',') -ne ($groupIdsAfterStart -join ',') -or
            ($attemptIdsBeforeStart -join ',') -ne ($attemptIdsAfterStart -join ',')) {
            throw "Starting the App changed the sequential registry or POST audit."
        }
        $historyBeforeResume = Read-HistorySourceLabel
        if ([string]$historyBeforeResume.newestSourceLabel -ne "FHL3" -or
            [string]$historyBeforeResume.newestSlotSourceLabel -ne "FHL3" -or
            [string]$historyBeforeResume.newestSlotStatus -ne "succeeded") {
            throw "Recovered FHL3 is not the newest succeeded history item."
        }

        $audit = [ordered]@{
            schemaVersion = 1
            status = "passed"
            mode = "running-checkpoint-audit"
            auditedAt = (Get-Date).ToString("o")
            apkSha256 = [string]$stateAfterStart.apkSha256
            installedApkSha256 = $installedHash
            device = $Device
            workspaceId = [string]$stateAfterStart.report.workspaceId
            storageNamespace = [string]$stateAfterStart.report.storageNamespace
            checkpointedResults = 8
            recoveredResults = 9
            recoveredClickedAt = $null
            recoveredClickedAtEvidence = "not-retained"
            slots = @($stateAfterStart.partialSlots)
            groupIds = @($stateAfterStart.batch.groups | ForEach-Object { [string]$_.groupId })
            attemptCount = @($stateAfterStart.batch.attempts).Count
            pendingCount = [int]$stateAfterStart.batch.registry.pendingCount
            nextSlot = 4
            startupGroupDelta = 0
            startupPostDelta = 0
        }
        Write-AtomicJsonArtifact -Path $resumeAuditPath -Value $audit
        if ($ResumeAuditOnly) {
            Write-Host "Sequential running-checkpoint audit passed without clicking: $resumeAuditPath"
            return
        }

        foreach ($source in @($reportPath, $attemptsPath, $resumeSnapshotPath)) {
            $backup = "$source.pre-resume"
            if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $source -Destination $backup }
        }
        $journal = [ordered]@{
            schemaVersion = 1
            status = "recovered-9"
            createdAt = (Get-Date).ToString("o")
            apkSha256 = [string]$stateAfterStart.apkSha256
            installedApkSha256 = $installedHash
            sourceReportSha256 = (Get-FileHash -LiteralPath "$reportPath.pre-resume" -Algorithm SHA256).Hash
            sourceAttemptsSha256 = (Get-FileHash -LiteralPath "$attemptsPath.pre-resume" -Algorithm SHA256).Hash
            sourceSnapshotSha256 = (Get-FileHash -LiteralPath "$resumeSnapshotPath.pre-resume" -Algorithm SHA256).Hash
            checkpointedResults = 8
            nativeRecoveredResults = 1
            recoveredSequence = 9
            recoveredSlot = 3
            recoveredClickedAt = $null
            recoveredClickedAtEvidence = "not-retained"
            resumeNextSlot = 4
            groupIds = @($stateAfterStart.batch.groups | ForEach-Object { [string]$_.groupId })
            attemptIdentities = @($stateAfterStart.batch.attempts | ForEach-Object { Get-AttemptIdentity $_ })
        }
        Write-AtomicJsonArtifact -Path $resumeJournalPath -Value $journal

        $clickCheckpoint = $null
        $batchBeforeFhl4 = Get-SequentialResumeBatch -NativeBatchStart ([long]$stateAfterStart.snapshot.nativeBatchStart)
        if (Test-Path -LiteralPath $resumeClickPath) {
            $clickCheckpoint = Get-Content -Raw -Encoding UTF8 -LiteralPath $resumeClickPath | ConvertFrom-Json
            if ([string]$clickCheckpoint.apkSha256 -ne [string]$stateAfterStart.apkSha256 -or
                [int]$clickCheckpoint.expectedSlot -ne 4 -or [long]$clickCheckpoint.clickedAt -le 0) {
                throw "Existing FHL4 click checkpoint is invalid."
            }
            if (@($batchBeforeFhl4.groups).Count -eq 9) {
                throw "FHL4 click was issued but no native group is confirmed; unknown paid outcome will not be retried."
            }
            if (@($batchBeforeFhl4.groups).Count -ne 10) {
                throw "FHL4 click checkpoint does not have exactly one recoverable native group."
            }
        }
        else {
            if (@($batchBeforeFhl4.groups).Count -ne 9 -or @($batchBeforeFhl4.attempts).Count -ne 9 -or
                [int]$batchBeforeFhl4.registry.pendingCount -ne 0) {
                throw "FHL4 cannot be clicked because the verified 9-of-10 baseline changed."
            }
            $readiness = Set-PromptAndReadiness
            Assert-SubmitReadiness -Readiness $readiness -Context "Sequential resume FHL4"
            $clickState = Get-BrowserState
            if ([string]$clickState.workspaceId -ne [string]$stateAfterStart.report.workspaceId -or [int]$clickState.cursor -ne 4) {
                throw "FHL4 click-time browser state changed after readiness."
            }
            $freshRegistry = Get-NativeRegistrySummary
            if ([int]$freshRegistry.pendingCount -ne 0) { throw "FHL4 pre-click native queue is not idle." }
            $click = Click-GenerateOnce
            $clickCheckpoint = [ordered]@{
                schemaVersion = 1
                status = "fhl4-click-issued"
                recordedAt = (Get-Date).ToString("o")
                apkSha256 = [string]$stateAfterStart.apkSha256
                device = $Device
                workspaceId = [string]$stateAfterStart.report.workspaceId
                expectedSlot = 4
                expectedLabel = "FHL4"
                clickedAt = [long]$click.clickedAt
                baselineGroupIds = @($batchBeforeFhl4.groups | ForEach-Object { [string]$_.groupId })
                baselineAttemptIdentities = @($batchBeforeFhl4.attempts | ForEach-Object { Get-AttemptIdentity $_ })
            }
            Write-AtomicJsonArtifact -Path $resumeClickPath -Value $clickCheckpoint
            $created = Wait-NewNativeGroup `
                -BeforeRegistry $freshRegistry `
                -ClickedAt ([long]$clickCheckpoint.clickedAt) `
                -ExpectedWorkspaceId ([string]$stateAfterStart.report.workspaceId)
            Assert-GroupContract -Group $created.group -ExpectedSlot 4
        }

        $batchWithFhl4 = Get-SequentialResumeBatch -NativeBatchStart ([long]$stateAfterStart.snapshot.nativeBatchStart)
        if (@($batchWithFhl4.groups).Count -ne 10) { throw "Sequential resume did not create exactly one FHL4 group." }
        $fhl4Group = $batchWithFhl4.groups[9]
        Assert-GroupContract -Group $fhl4Group -ExpectedSlot 4
        if ([long]$fhl4Group.createdAt -lt [long]$clickCheckpoint.clickedAt) {
            throw "FHL4 native group predates its persisted click checkpoint."
        }
        $fhl4Attempt = Wait-OneUpstreamAttempt -GroupId ([string]$fhl4Group.groupId)
        Assert-AttemptMatchesGroup `
            -Attempt $fhl4Attempt `
            -Group $fhl4Group `
            -ExpectedSlot 4 `
            -ClickedAt ([long]$clickCheckpoint.clickedAt) `
            -Context "Sequential resume FHL4"
        $terminal = Wait-TerminalGroup `
            -GroupId ([string]$fhl4Group.groupId) `
            -ResolvedWorkspaceId ([string]$stateAfterStart.report.workspaceId)
        if ([string]$terminal.slot.status -ne "succeeded") { throw "Sequential resume FHL4 did not succeed." }
        $historyAfterFhl4 = Read-HistorySourceLabel
        if ([string]$historyAfterFhl4.newestSourceLabel -ne "FHL4" -or
            [string]$historyAfterFhl4.newestSlotSourceLabel -ne "FHL4" -or
            [string]$historyAfterFhl4.newestSlotStatus -ne "succeeded") {
            throw "Sequential resume FHL4 history source label is incorrect."
        }

        $finalBatch = Get-SequentialResumeBatch -NativeBatchStart ([long]$stateAfterStart.snapshot.nativeBatchStart)
        Assert-SequentialResumeIdentitySet `
            -Groups @($finalBatch.groups) `
            -Attempts @($finalBatch.attempts) `
            -ExpectedSlots @($stateAfterStart.expectedSlots) `
            -ExpectedWorkspaceId ([string]$stateAfterStart.report.workspaceId) `
            -Context "Final sequential recovery"
        if ([int]$finalBatch.registry.pendingCount -ne 0) { throw "Final sequential recovery still has an active task." }
        $finalBrowser = Get-BrowserState
        if ([string]$finalBrowser.workspaceId -ne [string]$stateAfterStart.report.workspaceId -or
            [string]$finalBrowser.storageNamespace -ne [string]$stateAfterStart.report.storageNamespace -or
            [int]$finalBrowser.cursor -ne 5) {
            throw "Final sequential recovery did not return to its original cursor and workspace."
        }

        $fhl3Record = $stateAfterStart.snapshotGroups[8]
        $fhl3Group = $finalBatch.groups[8]
        $recoveredResult = [ordered]@{
            sequence = 9
            workspaceId = [string]$stateAfterStart.report.workspaceId
            clickedAt = $null
            createdAt = [long]$fhl3Record.createdAt
            expectedSlot = 3
            expectedLabel = "FHL3"
            groupId = [string]$fhl3Record.groupId
            jobId = [string]$fhl3Record.jobId
            clientSubmissionId = [string]$fhl3Record.clientSubmissionId
            requestRunId = [string]$fhl3Record.requestRunId
            status = "succeeded"
            groupCount = 1
            taskCount = 1
            postCount = 1
            historyLabel = "FHL3"
            evidenceOrigin = "native-registry+audit"
            clickedAtEvidence = "not-retained-after-host-timeout"
        }
        $fhl4Result = [ordered]@{
            sequence = 10
            workspaceId = [string]$stateAfterStart.report.workspaceId
            clickedAt = [long]$clickCheckpoint.clickedAt
            createdAt = [long]$fhl4Group.createdAt
            expectedSlot = 4
            expectedLabel = "FHL4"
            groupId = [string]$fhl4Group.groupId
            jobId = [string]@($fhl4Group.slots)[0].jobId
            clientSubmissionId = [string]$fhl4Group.clientSubmissionId
            requestRunId = [string]$fhl4Group.requestRunId
            status = "succeeded"
            groupCount = 1
            taskCount = 1
            postCount = 1
            historyLabel = "FHL4"
            evidenceOrigin = "live-resume-click"
            clickedAtEvidence = "persisted-before-native-wait"
        }
        $finalResults = @($stateAfterStart.results) + @($recoveredResult, $fhl4Result)
        $finalReport = $stateAfterStart.report
        $finalReport.results = $finalResults
        $finalReport.cursorAfter = 5
        $finalReport.metrics.clicks = 10
        $finalReport.metrics.groups = 10
        $finalReport.metrics.tasks = 10
        $finalReport.metrics.upstreamPosts = 10
        $finalReport.status = "passed"
        $finalReport.failure = $null
        $finalReport.finishedAt = (Get-Date).ToString("o")
        $finalReport | Add-Member -NotePropertyName checkpointRecovery -NotePropertyValue ([ordered]@{
            mode = "running-checkpoint"
            checkpointedResults = 8
            nativeRecoveredResults = 1
            resumedResults = 1
            observedClickedAt = 9
            recoveredClicksWithoutTimestamp = 1
            missingClickedAtSequences = @(9)
            recoveryJournal = [IO.Path]::GetFileName($resumeJournalPath)
            clickCheckpoint = [IO.Path]::GetFileName($resumeClickPath)
            audit = [IO.Path]::GetFileName($resumeAuditPath)
            verifiedAt = (Get-Date).ToString("o")
        }) -Force
        Write-Evidence -Report $finalReport -Attempts @($finalBatch.attempts)
        Write-Host "Sequential running checkpoint resumed with one FHL4 click: $OutputDirectory"
    }
    catch {
        $failure = ConvertTo-RedactedText $_.Exception.Message
        Write-AtomicJsonArtifact -Path $resumeFailurePath -Value ([ordered]@{
            schemaVersion = 1
            status = "failed"
            failedAt = (Get-Date).ToString("o")
            apkSha256 = ($ExpectedApkSha256 -replace "\s", "").ToUpperInvariant()
            device = $Device
            clickCheckpointPresent = (Test-Path -LiteralPath $resumeClickPath)
            failure = $failure
        })
        throw $failure
    }
    finally {
        if ($script:ForwardPrepared -and $script:AdbExecutable) {
            try {
                Invoke-AdbText -Arguments @("-s", $Device, "forward", "--remove", "tcp:$CdpPort") -AllowFailure | Out-Null
                if (-not [string]::IsNullOrWhiteSpace($script:PreviousForwardRemote)) {
                    Invoke-AdbText -Arguments @("-s", $Device, "forward", "tcp:$CdpPort", $script:PreviousForwardRemote) | Out-Null
                }
            }
            catch { }
        }
    }
}

function Update-ReportMeasurements {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report)

    if (-not $script:MeasurementBaselineReady) { return @() }
    if ([string]$Report.scenario -in @("Pool40", "Queue60") -and $null -ne $script:LoadAuditBaselineIdentities) {
        if ($script:AdbExecutable) {
            Capture-LoadAuditEvents | Out-Null
            $currentRegistry = Get-NativeRegistrySummary
            $registryDelta = Get-RegistryDelta -Before $script:BaselineRegistry -After $currentRegistry
            $Report.metrics.groups = @($registryDelta.groupIds).Count
            $Report.metrics.tasks = @($registryDelta.taskIds).Count
            $capturedAttempts = @(Get-CapturedLoadAttempts)
            $Report.metrics.upstreamPosts = $capturedAttempts.Count
        } else {
            $capturedAttempts = @()
        }
        if ($script:ForwardEstablished) {
            try { $Report.cursorAfter = [int](Get-BrowserState).cursor } catch { }
        }
        return $capturedAttempts
    }
    if ($null -ne $script:BaselineRegistry -and $script:AdbExecutable) {
        $currentRegistry = Get-NativeRegistrySummary
        $registryDelta = Get-RegistryDelta -Before $script:BaselineRegistry -After $currentRegistry
        $Report.metrics.groups = @($registryDelta.groupIds).Count
        $Report.metrics.tasks = @($registryDelta.taskIds).Count
    }
    $currentAttempts = @()
    if ($script:AdbExecutable) {
        $currentAttempts = @(Get-UpstreamSubmitAttempts)
        $newAttempts = @(Get-NewAttempts -Before @($script:BaselineAttempts) -After $currentAttempts)
        $Report.metrics.upstreamPosts = $newAttempts.Count
    }
    if ($script:ForwardEstablished) {
        try {
            $currentState = Get-BrowserState
            $Report.cursorAfter = [int]$currentState.cursor
        }
        catch {
            # Preserve measured registry and POST counts if the UI is unavailable.
        }
    }
    return @(Get-NewAttempts -Before @($script:BaselineAttempts) -After $currentAttempts)
}

function Assert-MatrixSingleFinalMeasurements {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Attempts
    )

    if ([string]$Report.scenario -ne "MatrixSingle") { return }
    $results = @($Report.results)
    if (
        [int]$Report.metrics.groups -ne 1 -or
        [int]$Report.metrics.tasks -ne 1 -or
        [int]$Report.metrics.upstreamPosts -ne 1 -or
        $Attempts.Count -ne 1 -or
        $results.Count -ne 1
    ) {
        throw "MatrixSingle final measurement is not exactly one group, one task, one submission, and one upstream POST."
    }

    $result = $results[0]
    foreach ($field in @("groupId", "jobId", "clientSubmissionId", "requestRunId")) {
        if ([string]::IsNullOrWhiteSpace([string]$result.$field)) {
            throw "MatrixSingle final result is missing $field."
        }
    }

    $registry = Get-NativeRegistrySummary
    $delta = Get-RegistryDelta -Before $script:BaselineRegistry -After $registry
    if (
        @($delta.groupIds).Count -ne 1 -or
        @($delta.taskIds).Count -ne 1 -or
        [string]$delta.groupIds[0] -ne [string]$result.groupId -or
        [string]$delta.taskIds[0] -ne [string]$result.jobId
    ) {
        throw "MatrixSingle final registry identity changed after the scenario completed."
    }
    $group = @($registry.groups | Where-Object { [string]$_.groupId -eq [string]$result.groupId })[0]
    $slot = if ($group) { @($group.slots | Where-Object { [string]$_.jobId -eq [string]$result.jobId })[0] } else { $null }
    if (
        $null -eq $group -or
        $null -eq $slot -or
        [string]$group.clientSubmissionId -ne [string]$result.clientSubmissionId -or
        [string]$group.requestRunId -ne [string]$result.requestRunId -or
        [string]$slot.status -ne "succeeded"
    ) {
        throw "MatrixSingle final native group, task, submission, or run identity no longer matches the accepted result."
    }

    $attempt = $Attempts[0]
    if (
        [string]$attempt.groupId -ne [string]$result.groupId -or
        [string]$attempt.jobId -ne [string]$result.jobId -or
        [string]$attempt.clientSubmissionId -ne [string]$result.clientSubmissionId -or
        [string]$attempt.requestRunId -ne [string]$result.requestRunId
    ) {
        throw "MatrixSingle final upstream POST identity no longer matches the accepted result."
    }
}

function Invoke-CompatibilityWorkflowScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    $preflightRegistry = Get-NativeRegistrySummary
    Assert-RegistryDeltaMatches `
        -Before $InitialRegistry `
        -After $preflightRegistry `
        -ExpectedGroupIds @() `
        -ExpectedTaskIds @() `
        -Context "CompatibilityWorkflow before UI actions" | Out-Null
    $preflightAttempts = @(Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
    if ($preflightAttempts.Count -ne 0) {
        throw "CompatibilityWorkflow observed an upstream POST before its first UI action."
    }
    $diagnosticCountBefore = Get-UpstreamRequestDiagnosticCount

    try {
        $outputDirectory = Get-CompatibilityOutputDirectory
        $outputFilesBefore = @(Get-CompatibilityOutputFiles -Directory $outputDirectory)
    }
    catch {
        throw "CompatibilityWorkflow output snapshot failed: $(ConvertTo-RedactedText $_.Exception.Message)"
    }
    try {
        $workflow = Invoke-CompatibilityWorkflowUI
    }
    catch {
        throw "CompatibilityWorkflow UI failed: $(ConvertTo-RedactedText $_.Exception.Message)"
    }
    $outputFilesAfter = @(Get-CompatibilityOutputFiles -Directory $outputDirectory)
    $knownOutputFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($path in $outputFilesBefore) { [void]$knownOutputFiles.Add([string]$path) }
    $newOutputFiles = @($outputFilesAfter | Where-Object { -not $knownOutputFiles.Contains([string]$_) })
    if ($newOutputFiles.Count -ne 1) {
        throw "Compatibility workflow save produced $($newOutputFiles.Count) new files instead of exactly one."
    }
    $savedOutputBytes = Get-CompatibilityOutputFileSize -Path ([string]$newOutputFiles[0])
    $workflow | Add-Member -NotePropertyName savedOutput -NotePropertyValue ([ordered]@{
        newFileCount = 1
        bytes = $savedOutputBytes
        pathSha256 = Get-RedactedPathFingerprint -Path ([string]$newOutputFiles[0])
    }) -Force

    $finalRegistry = Get-NativeRegistrySummary
    Assert-RegistryDeltaMatches `
        -Before $InitialRegistry `
        -After $finalRegistry `
        -ExpectedGroupIds @() `
        -ExpectedTaskIds @() `
        -Context "CompatibilityWorkflow after UI actions" | Out-Null
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
    $diagnosticCountAfter = Get-UpstreamRequestDiagnosticCount
    if ($newAttempts.Count -ne 0 -or $diagnosticCountAfter -ne $diagnosticCountBefore) {
        throw "CompatibilityWorkflow violated the zero-POST gate: audit=$($newAttempts.Count), diagnosticDelta=$($diagnosticCountAfter - $diagnosticCountBefore)."
    }
    $afterState = Get-BrowserState
    if ([string]$afterState.workspaceId -ne $ResolvedWorkspaceId) {
        throw "CompatibilityWorkflow changed the active UI workspace."
    }
    if ([int]$afterState.cursor -ne [int]$InitialState.cursor) {
        throw "CompatibilityWorkflow changed the FHL pool cursor without submitting."
    }
    if ([int]$workflow.initialSourceCount -ne 1 -or [int]$workflow.finalSourceCount -ne 2) {
        throw "CompatibilityWorkflow source reuse contract was not satisfied."
    }
    if (@($workflow.annotations).Count -ne 4 -or @($workflow.transforms).Count -ne 5) {
        throw "CompatibilityWorkflow did not complete all annotation and transform actions."
    }

    $Report.metrics.clicks = 0
    $Report.metrics.groups = 0
    $Report.metrics.tasks = 0
    $Report.metrics.upstreamPosts = 0
    $Report.metrics.observationPostDelta = 0
    $Report.cursorAfter = [int]$afterState.cursor
    $Report.workflow = $workflow
    $Report.results += [ordered]@{
        sequence = 1
        expectedLabel = "CompatibilityWorkflow"
        status = "succeeded"
        groupCount = 0
        taskCount = 0
        postCount = 0
        historyLabel = "source 1 -> 2"
    }
    return $newAttempts
}

function Invoke-FreshInstallScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Start-Sleep -Seconds $ObservationSeconds
    $afterAttempts = @(Get-UpstreamSubmitAttempts)
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $afterAttempts)
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    $Report.metrics.groups = @($registryDelta.groupIds).Count
    $Report.metrics.tasks = @($registryDelta.taskIds).Count
    $Report.metrics.upstreamPosts = $newAttempts.Count
    $Report.metrics.observationPostDelta = $newAttempts.Count
    if ($Report.metrics.groups -ne 0 -or $Report.metrics.tasks -ne 0 -or $newAttempts.Count -ne 0) {
        throw "FreshInstall observed automatic work: groups=$($Report.metrics.groups), tasks=$($Report.metrics.tasks), POSTs=$($newAttempts.Count)."
    }
    $afterState = Get-FreshInstallState
    Assert-FreshInstallState -BrowserState $afterState
    if ([string]$afterState.workspaceId -ne $ResolvedWorkspaceId) {
        throw "FreshInstall changed the active empty workspace."
    }
    $historyState = Get-FreshInstallHistoryState
    $Report.cursorAfter = 1
    $Report.workflow = [ordered]@{
        setupState = "default-images"
        profileCount = 0
        historyGroupCount = [int]$historyState.groupCount
        automaticPostCount = $newAttempts.Count
    }
    return $newAttempts
}

function Invoke-UpgradeScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    $baseline = $script:UpgradeBeforeSnapshot
    if ($null -eq $baseline) { throw "Upgrade baseline snapshot is unavailable." }
    $initialUpgradeState = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $initialUpgradeState
    if ((ConvertTo-UpgradeComparableJson -Snapshot $initialUpgradeState) -ne [string]$baseline.comparableJson) {
        throw "Upgrade changed the persisted Profile, slot, credential, workspace, cursor, preference, or history snapshot."
    }
    $transport = Get-UpgradeTransportState
    if (-not [bool]$transport.imagesPressed -or [bool]$transport.responsesPressed) {
        throw "Upgrade without an explicit preference did not default to Images API."
    }
    if ([string]$InitialState.workspaceId -ne $ResolvedWorkspaceId) {
        throw "Upgrade changed the active workspace before observation."
    }

    Start-Sleep -Seconds $ObservationSeconds
    $afterUpgradeState = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $afterUpgradeState
    if ((ConvertTo-UpgradeComparableJson -Snapshot $afterUpgradeState) -ne [string]$baseline.comparableJson) {
        throw "Upgrade state changed during the zero-POST observation window."
    }
    $afterRegistry = Get-NativeRegistrySummary
    $afterAttempts = @(Get-UpstreamSubmitAttempts)
    $newAttempts = @(Get-NewAttempts -Before @($baseline.attempts) -After $afterAttempts)
    $baselineGroups = @($baseline.registryGroupIds | Sort-Object -Unique)
    $baselineTasks = @($baseline.registryTaskIds | Sort-Object -Unique)
    $afterGroups = @($afterRegistry.groupIds | Sort-Object -Unique)
    $afterTasks = @($afterRegistry.taskIds | Sort-Object -Unique)
    if (@(Compare-Object -ReferenceObject $baselineGroups -DifferenceObject $afterGroups).Count -ne 0 -or
        @(Compare-Object -ReferenceObject $baselineTasks -DifferenceObject $afterTasks).Count -ne 0) {
        throw "Upgrade changed native group or task identities."
    }
    if ([int]$afterRegistry.pendingCount -ne 0) { throw "Upgrade left a queued or running native task." }
    if ($newAttempts.Count -ne 0) { throw "Upgrade produced $($newAttempts.Count) unexpected upstream POST attempt(s)." }

    $Report.metrics.groups = 0
    $Report.metrics.tasks = 0
    $Report.metrics.upstreamPosts = 0
    $Report.metrics.observationPostDelta = 0
    $Report.cursorAfter = [int]$afterUpgradeState.cursor
    $Report.workflow = [ordered]@{
        baselineApkSha256 = [string]$baseline.installedApkSha256
        profileCount = @($afterUpgradeState.slots).Count
        profileFingerprints = @(
            $afterUpgradeState.slots | Sort-Object slot | ForEach-Object {
                [ordered]@{
                    slot = [int]$_.slot
                    profileIdSha256 = [string]$_.profileIdSha256
                    credentialReadable = [bool]$_.credentialReadable
                    credentialPresent = [bool]$_.credentialPresent
                }
            }
        )
        activeProfileIdSha256 = [string]$afterUpgradeState.activeProfileIdSha256
        workspaceIdSha256 = [string]$afterUpgradeState.workspaceIdSha256
        cursor = [int]$afterUpgradeState.cursor
        readableCredentialCount = @($afterUpgradeState.slots | Where-Object { $_.credentialReadable -and $_.credentialPresent }).Count
        historyCount = [int]$afterUpgradeState.historyCount
        transportDefault = "images"
        persistedStatePreserved = $true
        automaticPostCount = 0
    }
    return $newAttempts
}

function Invoke-TransportPersistenceScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "TransportPersistence initial state"
    $baseline = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $baseline
    $baselineComparable = ConvertTo-TransportPersistenceComparableJson -Snapshot $baseline
    $baselineRegistry = Get-NativeRegistrySummary
    $baselineAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged `
        -Before $InitialRegistry `
        -After $baselineRegistry `
        -Context "TransportPersistence initial launch"
    Assert-UpstreamAttemptStateUnchanged `
        -Before $InitialAttempts `
        -After $baselineAttempts `
        -Context "TransportPersistence initial launch"

    Set-FHLTransportModeForVerification -Mode responses | Out-Null
    $responsesBeforeRestart = Get-BrowserState
    if ([string]$responsesBeforeRestart.transportMode -ne "responses" -or [string]$responsesBeforeRestart.transportPreference -ne "responses") {
        throw "Responses API did not become the explicit persisted mode before restart."
    }
    Stop-App
    Wait-AppProcessStopped
    Start-AppAndConnect
    Wait-AndroidBootstrapReady | Out-Null
    Start-Sleep -Seconds $ObservationSeconds
    $responsesAfterRestart = Get-BrowserState
    if ([string]$responsesAfterRestart.transportMode -ne "responses" -or [string]$responsesAfterRestart.transportPreference -ne "responses") {
        throw "Responses API preference did not survive force-stop and restart."
    }
    $responsesSnapshot = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $responsesSnapshot
    if ((ConvertTo-TransportPersistenceComparableJson -Snapshot $responsesSnapshot) -ne $baselineComparable) {
        throw "Responses restart changed Profile, Keystore, workspace, cursor, history, or slot state."
    }
    $responsesRegistry = Get-NativeRegistrySummary
    $responsesAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged `
        -Before $baselineRegistry `
        -After $responsesRegistry `
        -Context "Responses restart observation"
    Assert-UpstreamAttemptStateUnchanged `
        -Before $baselineAttempts `
        -After $responsesAttempts `
        -Context "Responses restart observation"

    Set-FHLTransportModeForVerification -Mode images | Out-Null
    $imagesBeforeRestart = Get-BrowserState
    if ([string]$imagesBeforeRestart.transportMode -ne "images" -or [string]$imagesBeforeRestart.transportPreference -ne "images") {
        throw "Images API did not become the explicit persisted mode before restart."
    }
    Stop-App
    Wait-AppProcessStopped
    Start-AppAndConnect
    Wait-AndroidBootstrapReady | Out-Null
    Start-Sleep -Seconds $ObservationSeconds
    $imagesAfterRestart = Get-BrowserState
    if ([string]$imagesAfterRestart.transportMode -ne "images" -or [string]$imagesAfterRestart.transportPreference -ne "images") {
        throw "Images API preference did not survive force-stop and restart."
    }
    $imagesSnapshot = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $imagesSnapshot
    if ((ConvertTo-TransportPersistenceComparableJson -Snapshot $imagesSnapshot) -ne $baselineComparable) {
        throw "Images restart changed Profile, Keystore, workspace, cursor, history, or slot state."
    }

    $finalRegistry = Get-NativeRegistrySummary
    $finalAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged `
        -Before $baselineRegistry `
        -After $finalRegistry `
        -Context "Images restart observation"
    Assert-UpstreamAttemptStateUnchanged `
        -Before $baselineAttempts `
        -After $finalAttempts `
        -Context "Images restart observation"
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After $finalRegistry
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $finalAttempts)
    if (@($registryDelta.groupIds).Count -ne 0 -or @($registryDelta.taskIds).Count -ne 0 -or $newAttempts.Count -ne 0 -or [int]$finalRegistry.pendingCount -ne 0) {
        throw "Transport persistence emitted unexpected native work or upstream POST."
    }

    $Report.metrics.clicks = 0
    $Report.metrics.groups = 0
    $Report.metrics.tasks = 0
    $Report.metrics.upstreamPosts = 0
    $Report.metrics.observationPostDelta = 0
    $Report.cursorAfter = [int]$imagesAfterRestart.cursor
    $Report.workflow = [ordered]@{
        initialMode = $ExpectedFHLTransportMode
        responsesPersistedAfterRestart = $true
        imagesPersistedAfterRestart = $true
        observationSecondsPerRestart = $ObservationSeconds
        transportPreferenceDurabilityWaitSeconds = $transportPreferenceDurabilityWaitSeconds
        profileAndCredentialStatePreserved = $true
        nativeIdentityStatePreserved = $true
        upstreamAttemptIdentityStatePreserved = $true
        automaticPostCount = 0
    }
    return $newAttempts
}

function Invoke-TransportToResponsesScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "TransportToResponses initial state"
    $baseline = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $baseline
    $baselineComparable = ConvertTo-TransportPersistenceComparableJson -Snapshot $baseline
    $baselineRegistry = Get-NativeRegistrySummary
    $baselineAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged `
        -Before $InitialRegistry `
        -After $baselineRegistry `
        -Context "TransportToResponses initial launch"
    Assert-UpstreamAttemptStateUnchanged `
        -Before $InitialAttempts `
        -After $baselineAttempts `
        -Context "TransportToResponses initial launch"

    Set-FHLTransportModeForVerification -Mode responses | Out-Null
    $responsesBeforeRestart = Get-BrowserState
    if ([string]$responsesBeforeRestart.transportMode -ne "responses" -or [string]$responsesBeforeRestart.transportPreference -ne "responses") {
        throw "Responses API did not become the explicit persisted mode before restart."
    }

    Stop-App
    Wait-AppProcessStopped
    Start-AppAndConnect
    Wait-AndroidBootstrapReady | Out-Null
    Start-Sleep -Seconds $ObservationSeconds

    $responsesAfterRestart = Get-BrowserState
    if ([string]$responsesAfterRestart.transportMode -ne "responses" -or [string]$responsesAfterRestart.transportPreference -ne "responses") {
        throw "Responses API preference did not survive the one-way force-stop and restart."
    }
    $responsesTransport = Get-UpgradeTransportState
    if ([bool]$responsesTransport.imagesPressed -or -not [bool]$responsesTransport.responsesPressed) {
        throw "Responses API selector state is inconsistent after the one-way restart."
    }

    $responsesSnapshot = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $responsesSnapshot
    if ((ConvertTo-TransportPersistenceComparableJson -Snapshot $responsesSnapshot) -ne $baselineComparable) {
        throw "One-way Responses restart changed Profile, Keystore, workspace, cursor, history, or slot state."
    }
    $finalRegistry = Get-NativeRegistrySummary
    $finalAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged `
        -Before $baselineRegistry `
        -After $finalRegistry `
        -Context "TransportToResponses restart observation"
    Assert-UpstreamAttemptStateUnchanged `
        -Before $baselineAttempts `
        -After $finalAttempts `
        -Context "TransportToResponses restart observation"

    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After $finalRegistry
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $finalAttempts)
    if (@($registryDelta.groupIds).Count -ne 0 -or @($registryDelta.taskIds).Count -ne 0 -or $newAttempts.Count -ne 0 -or [int]$finalRegistry.pendingCount -ne 0) {
        throw "One-way Responses switch emitted unexpected native work or upstream POST."
    }

    $Report.metrics.clicks = 0
    $Report.metrics.groups = 0
    $Report.metrics.tasks = 0
    $Report.metrics.upstreamPosts = 0
    $Report.metrics.observationPostDelta = 0
    $Report.cursorAfter = [int]$responsesAfterRestart.cursor
    $Report.workflow = [ordered]@{
        initialMode = "images"
        finalMode = "responses"
        responsesPersistedAfterRestart = $true
        observationSeconds = $ObservationSeconds
        transportPreferenceDurabilityWaitSeconds = $transportPreferenceDurabilityWaitSeconds
        profileAndCredentialStatePreserved = $true
        nativeIdentityStatePreserved = $true
        upstreamAttemptIdentityStatePreserved = $true
        automaticPostCount = 0
    }
    return $newAttempts
}

function Get-FHLResponsesCapabilityPlan {
    $expression = @'
(()=>{
  const profileSuffix="gptcodex.profiles";
  const cursorSuffix="gptcodex.androidFHLImagesPoolCursor.v1";
  const profileKeys=Object.keys(localStorage).filter(key=>key.endsWith(profileSuffix));
  if(profileKeys.length!==1)throw new Error("Responses capability audit requires one storage namespace.");
  const profileKey=profileKeys[0];
  const prefix=profileKey.slice(0,-profileSuffix.length);
  const namespace=prefix.startsWith("image-studio.")?prefix.slice("image-studio.".length).replace(/\.$/,""):"";
  let profiles=[];
  try{profiles=JSON.parse(localStorage.getItem(profileKey)||"[]");}catch{}
  const isOfficialURL=raw=>{
    try{
      const parsed=new URL(String(raw||""));
      return parsed.protocol==="https:"&&parsed.hostname.toLowerCase()==="www.fhl.mom"&&
        !parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&
        (!parsed.port||parsed.port==="443")&&["","/","/v1","/v1/"].includes(parsed.pathname);
    }catch{return false;}
  };
  const slots=(Array.isArray(profiles)?profiles:[])
    .filter(profile=>profile&&typeof profile.id==="string"&&Number.isInteger(profile.fhlImagesPoolSlot))
    .map(profile=>({
      slot:Number(profile.fhlImagesPoolSlot),
      enabled:profile.continuousPoolEnabled!==false,
      official:isOfficialURL(profile.baseURL)
    }))
    .filter(profile=>profile.slot>=1&&profile.slot<=10&&profile.enabled)
    .sort((a,b)=>a.slot-b.slot);
  if(slots.length!==10||slots.map(item=>item.slot).join(",")!=="1,2,3,4,5,6,7,8,9,10"){
    throw new Error("Responses capability audit requires enabled FHL1-FHL10.");
  }
  if(slots.some(item=>!item.official)){
    throw new Error("Responses capability audit rejected a non-official FHL slot.");
  }
  if(!namespace||!window.AndroidImageStudio||typeof window.AndroidImageStudio.invoke!=="function"){
    throw new Error("Responses capability audit requires the Android credential and HTTP Bridge.");
  }
  const rawCursor=Number(localStorage.getItem(prefix+cursorSuffix));
  const cursor=Number.isInteger(rawCursor)&&rawCursor>=1&&rawCursor<=10?rawCursor:1;
  return {
    requestMethod:"POST",
    endpointPath:"/v1/responses",
    model:"gpt-5.5",
    imageToolIncluded:false,
    cursor,
    plannedSlots:Array.from({length:10},(_,index)=>((cursor-1+index)%10)+1)
  };
})()
'@
    return Invoke-CdpExpression -Expression $expression -TimeoutSeconds 30
}

function Invoke-FHLResponsesCapabilitySlotAudit {
    param([Parameter(Mandatory = $true)][ValidateRange(1, 10)][int]$Slot)

    $expression = @'
(async()=>{
  const targetSlot=__SLOT__;
  const profileSuffix="gptcodex.profiles";
  const profileKeys=Object.keys(localStorage).filter(key=>key.endsWith(profileSuffix));
  if(profileKeys.length!==1)throw new Error("Responses capability slot audit requires one storage namespace.");
  const profileKey=profileKeys[0];
  const prefix=profileKey.slice(0,-profileSuffix.length);
  const namespace=prefix.startsWith("image-studio.")?prefix.slice("image-studio.".length).replace(/\.$/,""):"";
  let profiles=[];
  try{profiles=JSON.parse(localStorage.getItem(profileKey)||"[]");}catch{}
  const matches=(Array.isArray(profiles)?profiles:[]).filter(profile=>
    profile&&typeof profile.id==="string"&&profile.continuousPoolEnabled!==false&&
    Number(profile.fhlImagesPoolSlot)===targetSlot
  );
  if(matches.length!==1)throw new Error("Responses capability slot audit requires one enabled target Profile.");
  const profile=matches[0];
  const parsedURL=new URL(String(profile.baseURL||""));
  if(parsedURL.protocol!=="https:"||parsedURL.hostname.toLowerCase()!=="www.fhl.mom"||
    parsedURL.username||parsedURL.password||parsedURL.search||parsedURL.hash||
    (parsedURL.port&&parsedURL.port!=="443")||
    !["","/","/v1","/v1/"].includes(parsedURL.pathname)){
    throw new Error("Responses capability slot audit rejected a non-official FHL slot.");
  }
  if(!namespace||!window.AndroidImageStudio||typeof window.AndroidImageStudio.invoke!=="function"){
    throw new Error("Responses capability slot audit requires the Android credential and HTTP Bridge.");
  }
  const invokeNative=(method,args,timeoutMs=10000)=>new Promise((resolve,reject)=>{
    const requestId="responses-capability-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    const previousResolve=window.__imageStudioNativeResolve;
    const previousReject=window.__imageStudioNativeReject;
    let settled=false;
    const restore=()=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      window.__imageStudioNativeResolve=previousResolve;
      window.__imageStudioNativeReject=previousReject;
    };
    const timer=setTimeout(()=>{restore();reject(new Error(method+" timed out."));},timeoutMs);
    window.__imageStudioNativeResolve=(id,payload)=>{
      if(id!==requestId){if(previousResolve)previousResolve(id,payload);return;}
      restore();resolve(payload);
    };
    window.__imageStudioNativeReject=(id,message)=>{
      if(id!==requestId){if(previousReject)previousReject(id,message);return;}
      restore();reject(new Error(String(message)));
    };
    try{window.AndroidImageStudio.invoke(requestId,method,JSON.stringify(args));}
    catch(error){restore();reject(error);}
  });
  const encodeBody=value=>{
    const bytes=new TextEncoder().encode(value);
    let binary="";
    for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary);
  };
  let credential=await invokeNative("GetStoredAPIKey",["profile:"+namespace+":"+profile.id],15000);
  if(typeof credential!=="string"||credential.trim().length===0){
    return {slot:targetSlot,status:0,available:false,errorClass:"credential_unavailable",postAttempted:false};
  }
  const authorization="Bearer "+credential.trim();
  credential="";
  const requestKey="responses-capability-fhl"+targetSlot+"-"+Date.now();
  let status=0;
  let errorClass="bridge_or_network";
  try{
    const response=await invokeNative("HttpRequestText",[{
      requestKey,
      url:parsedURL.origin+"/v1/responses",
      method:"POST",
      headers:{Authorization:authorization,Accept:"application/json"},
      bodyBase64:encodeBody(JSON.stringify({
        model:"gpt-5.5",
        input:"Return exactly OK.",
        max_output_tokens:8,
        stream:false
      })),
      contentType:"application/json",
      streamLines:false,
      responseBase64:false,
      proxyMode:"system",
      proxyURL:""
    }],95000);
    status=Number(response&&response.status)||0;
    errorClass=status>=200&&status<300?"":
      status===401||status===403?"auth":
      status===429?"rate_limit":
      status>=300&&status<400?"redirect":
      status>=500&&status<=599?"upstream_5xx":
      status>=400&&status<500?"client_4xx":"invalid_response";
  }catch{
    try{await invokeNative("CancelHttpRequest",[requestKey],5000);}catch{}
  }
  return {
    slot:targetSlot,
    status,
    available:status>=200&&status<300,
    errorClass,
    postAttempted:true
  };
})()
'@.Replace("__SLOT__", [string]$Slot)

    # This expression may emit one external POST. Never use the reconnecting
    # CDP wrapper because a transient failure has an unknown paid outcome.
    return Invoke-CdpExpressionOnce -Expression $expression -TimeoutSeconds $responsesCapabilitySlotTimeoutSeconds
}

function Assert-FHLResponsesCapabilitySlotResult {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][ValidateRange(1, 10)][int]$ExpectedSlot
    )

    $properties = @($Result.PSObject.Properties.Name)
    foreach ($required in @("slot", "status", "available", "errorClass", "postAttempted")) {
        if ($required -notin $properties) {
            throw "Responses capability slot $ExpectedSlot returned an incomplete result."
        }
    }
    $slot = [int]$Result.slot
    $status = [int]$Result.status
    $available = [bool]$Result.available
    $errorClass = [string]$Result.errorClass
    $postAttempted = [bool]$Result.postAttempted
    $allowedErrorClasses = @("", "credential_unavailable", "auth", "rate_limit", "redirect", "upstream_5xx", "client_4xx", "invalid_response", "bridge_or_network")
    if ($slot -ne $ExpectedSlot -or $status -lt 0 -or $status -gt 599 -or $errorClass -notin $allowedErrorClasses) {
        throw "Responses capability slot $ExpectedSlot returned an invalid result."
    }
    if (-not $postAttempted) {
        if ($status -ne 0 -or $available -or $errorClass -ne "credential_unavailable") {
            throw "Responses capability slot $ExpectedSlot returned an invalid no-POST result."
        }
        return
    }
    if ($available -ne ($status -ge 200 -and $status -lt 300)) {
        throw "Responses capability slot $ExpectedSlot returned an inconsistent availability result."
    }
    if ($available -and -not [string]::IsNullOrEmpty($errorClass)) {
        throw "Responses capability slot $ExpectedSlot returned an error for a successful response."
    }
    if (-not $available -and [string]::IsNullOrEmpty($errorClass)) {
        throw "Responses capability slot $ExpectedSlot omitted its failure class."
    }
}

function Get-ResponsesCapabilityStopDecision {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][ValidateRange(0, 10)][int]$ConsecutiveUpstream5xx
    )

    if ([bool]$Result.available) {
        return [pscustomobject]@{ stop = $false; reason = ""; consecutiveUpstream5xx = 0 }
    }
    if ([string]$Result.errorClass -eq "upstream_5xx") {
        $nextCount = $ConsecutiveUpstream5xx + 1
        return [pscustomobject]@{
            stop = ($nextCount -ge 3)
            reason = if ($nextCount -ge 3) { "three_consecutive_upstream_5xx" } else { "" }
            consecutiveUpstream5xx = $nextCount
        }
    }
    return [pscustomobject]@{
        stop = $true
        reason = [string]$Result.errorClass
        consecutiveUpstream5xx = 0
    }
}

function Invoke-InternalResponsesCapabilityAuditSelfTest {
    $successDecision = Get-ResponsesCapabilityStopDecision -Result ([pscustomobject]@{ available = $true; errorClass = "" }) -ConsecutiveUpstream5xx 2
    if ([bool]$successDecision.stop -or [int]$successDecision.consecutiveUpstream5xx -ne 0) {
        throw "Responses capability stop policy did not reset after success."
    }

    $consecutive = 0
    for ($index = 1; $index -le 3; $index += 1) {
        $decision = Get-ResponsesCapabilityStopDecision -Result ([pscustomobject]@{ available = $false; errorClass = "upstream_5xx" }) -ConsecutiveUpstream5xx $consecutive
        $consecutive = [int]$decision.consecutiveUpstream5xx
        if (($index -lt 3 -and [bool]$decision.stop) -or
            ($index -eq 3 -and (-not [bool]$decision.stop -or [string]$decision.reason -ne "three_consecutive_upstream_5xx"))) {
            throw "Responses capability stop policy did not stop on the third consecutive upstream 5xx."
        }
    }

    foreach ($errorClass in @("credential_unavailable", "auth", "rate_limit", "redirect", "client_4xx", "invalid_response", "bridge_or_network")) {
        $decision = Get-ResponsesCapabilityStopDecision -Result ([pscustomobject]@{ available = $false; errorClass = $errorClass }) -ConsecutiveUpstream5xx 2
        if (-not [bool]$decision.stop -or [string]$decision.reason -ne $errorClass -or
            [int]$decision.consecutiveUpstream5xx -ne 0) {
            throw "Responses capability stop policy did not stop immediately for $errorClass."
        }
    }
    Write-Output "Android Responses capability audit internal self-test: PASS"
}

function Get-FHLResponsesCapabilityAudit {
    $plan = Get-FHLResponsesCapabilityPlan
    $results = [Collections.Generic.List[object]]::new()
    $completedSlots = [Collections.Generic.List[int]]::new()
    $capabilityTextPostCountLowerBound = 0
    $capabilityTextPostCountUpperBound = 0
    $capabilityTextPostCountExact = $true
    $indeterminateSlot = $null
    $stoppedReason = ""
    $consecutiveUpstream5xx = 0
    $lastCompletedPostAt = $null
    $appStopConfirmed = $null
    $appStopFailure = ""

    foreach ($rawSlot in @($plan.plannedSlots)) {
        $slot = [int]$rawSlot
        if ($null -ne $lastCompletedPostAt) {
            $elapsedMilliseconds = ((Get-Date) - $lastCompletedPostAt).TotalMilliseconds
            $remainingDelay = $responsesCapabilityMinimumIntervalMilliseconds - $elapsedMilliseconds
            if ($remainingDelay -gt 0) {
                Start-Sleep -Milliseconds ([int][Math]::Ceiling($remainingDelay))
            }
        }

        try {
            $result = Invoke-FHLResponsesCapabilitySlotAudit -Slot $slot
            Assert-FHLResponsesCapabilitySlotResult -Result $result -ExpectedSlot $slot
        }
        catch {
            $capabilityTextPostCountExact = $false
            $capabilityTextPostCountUpperBound = $capabilityTextPostCountLowerBound + 1
            $indeterminateSlot = $slot
            $stoppedReason = "cdp_indeterminate"
            $results.Add([pscustomobject]@{
                slot = $slot
                status = 0
                available = $false
                errorClass = "cdp_indeterminate"
                postAttempted = $null
            })
            try {
                Stop-App
                Wait-AppProcessStopped
                $appStopConfirmed = $true
            }
            catch {
                $appStopConfirmed = $false
                $appStopFailure = ConvertTo-RedactedText $_.Exception.Message
            }
            break
        }

        $results.Add([pscustomobject]@{
            slot = [int]$result.slot
            status = [int]$result.status
            available = [bool]$result.available
            errorClass = [string]$result.errorClass
            postAttempted = [bool]$result.postAttempted
        })
        $completedSlots.Add($slot)
        if ([bool]$result.postAttempted) {
            $capabilityTextPostCountLowerBound += 1
            $capabilityTextPostCountUpperBound += 1
            $lastCompletedPostAt = Get-Date
        }
        $decision = Get-ResponsesCapabilityStopDecision -Result $result -ConsecutiveUpstream5xx $consecutiveUpstream5xx
        $consecutiveUpstream5xx = [int]$decision.consecutiveUpstream5xx
        if ([bool]$decision.stop) {
            $stoppedReason = [string]$decision.reason
            break
        }
    }

    if ([string]::IsNullOrWhiteSpace($stoppedReason)) {
        $stoppedReason = "completed"
    }
    $auditedSlots = @($results | ForEach-Object { [int]$_.slot })
    $remainingSlots = @($plan.plannedSlots | Where-Object { [int]$_ -notin $auditedSlots } | ForEach-Object { [int]$_ })
    return [pscustomobject]@{
        requestMethod = [string]$plan.requestMethod
        endpointPath = [string]$plan.endpointPath
        model = [string]$plan.model
        imageToolIncluded = [bool]$plan.imageToolIncluded
        cursor = [int]$plan.cursor
        plannedSlots = @($plan.plannedSlots | ForEach-Object { [int]$_ })
        auditedSlots = $auditedSlots
        completedSlots = @($completedSlots)
        remainingSlots = $remainingSlots
        capabilityTextPostCount = $capabilityTextPostCountLowerBound
        capabilityTextPostCountLowerBound = $capabilityTextPostCountLowerBound
        capabilityTextPostCountUpperBound = $capabilityTextPostCountUpperBound
        capabilityTextPostCountExact = $capabilityTextPostCountExact
        indeterminateSlot = $indeterminateSlot
        availableSlots = @($results | Where-Object { [bool]$_.available } | ForEach-Object { [int]$_.slot })
        stoppedReason = $stoppedReason
        appStopConfirmed = $appStopConfirmed
        appStopFailure = $appStopFailure
        results = @($results)
    }
}

function Invoke-ResponsesCapabilityScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "ResponsesCapability preflight"
    $baseline = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $baseline
    $baselineComparable = ConvertTo-UpgradeComparableJson -Snapshot $baseline
    $baselineRegistry = Get-NativeRegistrySummary
    $baselineAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged -Before $InitialRegistry -After $baselineRegistry -Context "ResponsesCapability initial launch"
    Assert-UpstreamAttemptStateUnchanged -Before $InitialAttempts -After $baselineAttempts -Context "ResponsesCapability initial launch"

    $capability = Get-FHLResponsesCapabilityAudit
    $Report.metrics.clicks = 0
    $Report.metrics.groups = 0
    $Report.metrics.tasks = 0
    $Report.metrics.upstreamPosts = 0
    $Report.metrics.observationPostDelta = 0
    $Report.cursorAfter = [int]$baseline.cursor
    $Report.metrics.imageGenerationPostCount = 0
    $Report.metrics.capabilityTextPostCount = [int]$capability.capabilityTextPostCount
    $Report.metrics.capabilityTextPostCountLowerBound = [int]$capability.capabilityTextPostCountLowerBound
    $Report.metrics.capabilityTextPostCountUpperBound = [int]$capability.capabilityTextPostCountUpperBound
    $Report.metrics.capabilityTextPostCountExact = [bool]$capability.capabilityTextPostCountExact
    $Report.workflow = [ordered]@{
        auditKind = "responses_text_capability"
        requestMethod = [string]$capability.requestMethod
        endpointPath = [string]$capability.endpointPath
        model = [string]$capability.model
        imageToolIncluded = [bool]$capability.imageToolIncluded
        cursor = [int]$capability.cursor
        plannedSlots = @($capability.plannedSlots | ForEach-Object { [int]$_ })
        auditedSlots = @($capability.auditedSlots | ForEach-Object { [int]$_ })
        completedSlots = @($capability.completedSlots | ForEach-Object { [int]$_ })
        remainingSlots = @($capability.remainingSlots | ForEach-Object { [int]$_ })
        capabilityTextPostCount = [int]$capability.capabilityTextPostCount
        capabilityTextPostCountLowerBound = [int]$capability.capabilityTextPostCountLowerBound
        capabilityTextPostCountUpperBound = [int]$capability.capabilityTextPostCountUpperBound
        capabilityTextPostCountExact = [bool]$capability.capabilityTextPostCountExact
        capabilityPostsAreTextOnly = $true
        availableSlots = @($capability.availableSlots | ForEach-Object { [int]$_ })
        stoppedReason = [string]$capability.stoppedReason
        indeterminateSlot = if ($null -eq $capability.indeterminateSlot) { $null } else { [int]$capability.indeterminateSlot }
        appStopConfirmed = $capability.appStopConfirmed
        appStopFailure = [string]$capability.appStopFailure
        results = @(
            $capability.results | ForEach-Object {
                [ordered]@{
                    slot = [int]$_.slot
                    status = [int]$_.status
                    available = [bool]$_.available
                    errorClass = [string]$_.errorClass
                    postAttempted = if ($null -eq $_.postAttempted) { $null } else { [bool]$_.postAttempted }
                }
            }
        )
        imageJobStatePreserved = $false
        imageGenerationPostCount = 0
        profileStatePostAuditVerified = $false
    }

    if (-not [bool]$capability.capabilityTextPostCountExact) {
        $finalRegistry = Get-NativeRegistrySummary
        $finalAttempts = @(Get-UpstreamSubmitAttempts)
        Assert-NativeRegistryStateUnchanged -Before $baselineRegistry -After $finalRegistry -Context "ResponsesCapability indeterminate stop"
        Assert-UpstreamAttemptStateUnchanged -Before $baselineAttempts -After $finalAttempts -Context "ResponsesCapability indeterminate stop"
        $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After $finalRegistry
        $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $finalAttempts)
        if (@($registryDelta.groupIds).Count -ne 0 -or @($registryDelta.taskIds).Count -ne 0 -or $newAttempts.Count -ne 0 -or [int]$finalRegistry.pendingCount -ne 0) {
            throw "Responses capability audit created an image job or image-generation POST before its indeterminate stop."
        }
        $Report.workflow.imageJobStatePreserved = $true
        if ($capability.appStopConfirmed -ne $true) {
            throw "Responses capability audit had an indeterminate CDP outcome and could not confirm that the app process stopped."
        }
        throw "Responses capability audit stopped after one indeterminate slot; the recorded text POST range must not be replayed."
    }

    $afterSnapshot = Get-UpgradeBrowserSnapshot
    Assert-UpgradeConfiguredSnapshot -Snapshot $afterSnapshot
    if ((ConvertTo-UpgradeComparableJson -Snapshot $afterSnapshot) -ne $baselineComparable) {
        throw "Responses capability audit changed Profile, Keystore, workspace, cursor, history, transport, or slot state."
    }
    $finalRegistry = Get-NativeRegistrySummary
    $finalAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged -Before $baselineRegistry -After $finalRegistry -Context "ResponsesCapability completion"
    Assert-UpstreamAttemptStateUnchanged -Before $baselineAttempts -After $finalAttempts -Context "ResponsesCapability completion"
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After $finalRegistry
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $finalAttempts)
    if (@($registryDelta.groupIds).Count -ne 0 -or @($registryDelta.taskIds).Count -ne 0 -or $newAttempts.Count -ne 0 -or [int]$finalRegistry.pendingCount -ne 0) {
        throw "Responses capability audit created an image job or image-generation POST."
    }

    $Report.cursorAfter = [int]$afterSnapshot.cursor
    $Report.workflow.imageJobStatePreserved = $true
    $Report.workflow.profileStatePostAuditVerified = $true
    return $newAttempts
}

function Invoke-PreflightScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    if ($ExpectedFHLTransportMode -eq "images") {
        Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Preflight"
    }
    $readiness = Set-PromptAndReadiness
    Assert-SubmitReadiness -Readiness $readiness -Context "Preflight"
    Start-Sleep -Seconds $ObservationSeconds
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    $afterAttempts = @(Get-UpstreamSubmitAttempts)
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $afterAttempts)
    $Report.metrics.groups = @($registryDelta.groupIds).Count
    $Report.metrics.tasks = @($registryDelta.taskIds).Count
    $Report.metrics.upstreamPosts = $newAttempts.Count
    $Report.metrics.observationPostDelta = $newAttempts.Count
    if ($Report.metrics.groups -ne 0 -or $Report.metrics.tasks -ne 0 -or $newAttempts.Count -ne 0) {
        throw "Preflight observed unexpected automatic work: groups=$($Report.metrics.groups), tasks=$($Report.metrics.tasks), POSTs=$($newAttempts.Count)."
    }
    $afterState = Get-BrowserState
    Assert-TenConfiguredSlots -BrowserState $afterState
    if ([int]$afterState.cursor -ne [int]$InitialState.cursor) { throw "Preflight changed the FHL pool cursor." }
    if ([string]$afterState.workspaceId -ne $ResolvedWorkspaceId) { throw "Preflight changed the active UI workspace." }
    $Report.cursorAfter = [int]$afterState.cursor
    return $newAttempts
}

function Invoke-SingleScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    $expectedSlot = [int]$InitialState.cursor
    $expectedLabel = "FHL$expectedSlot"
    $expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot $expectedSlot
    $Report.expectedSlots = @($expectedSlot)
    Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "Single preflight"
    $readiness = Set-PromptAndReadiness
    Assert-SubmitReadiness -Readiness $readiness -Context "Single $expectedLabel"
    $clickState = Get-BrowserState
    if ([string]$clickState.workspaceId -ne $ResolvedWorkspaceId -or [int]$clickState.cursor -ne $expectedSlot) {
        throw "Single click-time browser state changed after readiness."
    }
    $freshRegistry = Get-NativeRegistrySummary
    Assert-RegistryDeltaMatches -Before $InitialRegistry -After $freshRegistry -ExpectedGroupIds @() -ExpectedTaskIds @() -Context "Single pre-click" | Out-Null
    if ([int]$freshRegistry.pendingCount -ne 0) { throw "Single pre-click registry was not idle." }

    $click = Click-GenerateOnce
    $Report.metrics.clicks = 1
    $created = Wait-NewNativeGroup -BeforeRegistry $freshRegistry -ClickedAt ([long]$click.clickedAt) -ExpectedWorkspaceId $ResolvedWorkspaceId
    $group = $created.group
    $Report.workspaceId = [string]$created.workspaceId
    Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
    $attempt = Wait-OneUpstreamAttempt -GroupId $group.groupId
    Assert-AttemptMatchesGroup -Attempt $attempt -Group $group -ExpectedSlot $expectedSlot -ClickedAt ([long]$created.clickedAt) -Context "Single $expectedLabel"
    $terminal = Wait-TerminalGroup -GroupId $group.groupId -ResolvedWorkspaceId ([string]$created.workspaceId)
    if ([string]$terminal.slot.status -ne "succeeded") { throw "Single $expectedLabel finished with status $($terminal.slot.status)." }
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    if ($newAttempts.Count -ne 1 -or @($registryDelta.groupIds).Count -ne 1 -or @($registryDelta.taskIds).Count -ne 1) {
        throw "Single did not create exactly one group, one task, and one upstream POST."
    }
    $history = Read-HistorySourceLabel
    if ([string]$history.currentView -ne "history" -or [string]$history.newestSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel -or [string]$history.newestSlotStatus -ne "succeeded") {
        throw "Single history source label is incorrect."
    }
    $Report.metrics.groups = 1
    $Report.metrics.tasks = 1
    $Report.metrics.upstreamPosts = 1
    $Report.cursorAfter = [int](Get-BrowserState).cursor
    $Report.results += [ordered]@{
        sequence = 1
        workspaceId = [string]$created.workspaceId
        clickedAt = [long]$created.clickedAt
        createdAt = [long]$created.createdAt
        expectedSlot = $expectedSlot
        expectedLabel = $expectedLabel
        expectedAPIMode = $ExpectedFHLTransportMode
        expectedHistoryLabel = $expectedHistoryLabel
        groupId = [string]$group.groupId
        jobId = [string]@($group.slots)[0].jobId
        clientSubmissionId = [string]$group.clientSubmissionId
        requestRunId = [string]$group.requestRunId
        status = [string]$terminal.slot.status
        groupCount = 1
        taskCount = 1
        postCount = 1
        historyLabel = [string]$history.newestSourceLabel
    }
    return $newAttempts
}

function Invoke-CompatibilitySingleScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialSnapshot,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    $expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot 1
    Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "CompatibilitySingle preflight"
    if ([int]$InitialState.activeProfile.poolSlot -ne 1) {
        throw "CompatibilitySingle requires the active official FHL Images Profile to be FHL1."
    }
    # This compatibility-only path must observe first launch before it is allowed
    # to click. It intentionally never relaxes the formal ten-slot scenarios.
    Start-Sleep -Seconds $ObservationSeconds
    $afterObservationRegistry = Get-NativeRegistrySummary
    $observationDelta = Get-RegistryDelta -Before $InitialRegistry -After $afterObservationRegistry
    $afterObservationAttempts = @(Get-UpstreamSubmitAttempts)
    $observationAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $afterObservationAttempts)
    $Report.metrics.groups = @($observationDelta.groupIds).Count
    $Report.metrics.tasks = @($observationDelta.taskIds).Count
    $Report.metrics.upstreamPosts = $observationAttempts.Count
    $Report.metrics.observationPostDelta = $observationAttempts.Count
    if ($Report.metrics.groups -ne 0 -or $Report.metrics.tasks -ne 0 -or $observationAttempts.Count -ne 0) {
        throw "CompatibilitySingle observed unexpected automatic work: groups=$($Report.metrics.groups), tasks=$($Report.metrics.tasks), POSTs=$($observationAttempts.Count)."
    }

    $geometry = Get-CompatibilityCtaNavGeometry
    $Report.geometry = $geometry
    Assert-CompatibilityCtaNavGeometry -Geometry $geometry

    $readiness = Set-PromptAndReadiness
    Assert-SubmitReadiness -Readiness $readiness -Context "CompatibilitySingle FHL1"
    $expectedSubmitKind = [string]$readiness.submitKind
    $beforeClickState = Get-BrowserState
    Assert-CompatibilitySingleConfiguredSlot -BrowserState $beforeClickState | Out-Null
    Assert-OfficialFHLImagesHomeSource -BrowserState $beforeClickState -Context "CompatibilitySingle click-time"
    if ([int]$beforeClickState.activeProfile.poolSlot -ne 1) {
        throw "CompatibilitySingle click-time active Profile is not FHL1."
    }
    if ([string]$beforeClickState.workspaceId -ne $ResolvedWorkspaceId) {
        throw "CompatibilitySingle click-time workspace changed after readiness."
    }

    $freshRegistry = Get-NativeRegistrySummary
    Assert-RegistryDeltaMatches `
        -Before $InitialRegistry `
        -After $freshRegistry `
        -ExpectedGroupIds @() `
        -ExpectedTaskIds @() `
        -Context "CompatibilitySingle pre-click" | Out-Null
    if ([int]$freshRegistry.pendingCount -ne 0) {
        throw "CompatibilitySingle pre-click registry was not idle."
    }

    $click = Click-GenerateOnce
    if ([string]$click.submitKind -ne $expectedSubmitKind) {
        throw "CompatibilitySingle submit kind changed between readiness and the explicit click."
    }
    $Report.metrics.clicks += 1
    $created = Wait-NewNativeGroup `
        -BeforeRegistry $freshRegistry `
        -ClickedAt ([long]$click.clickedAt) `
        -ExpectedWorkspaceId $ResolvedWorkspaceId
    $group = $created.group
    $Report.workspaceId = [string]$created.workspaceId
    Assert-GroupContract -Group $group -ExpectedSlot 1

    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    if (@($registryDelta.groupIds).Count -ne 1 -or @($registryDelta.taskIds).Count -ne 1 -or
        [string]$registryDelta.groupIds[0] -ne [string]$group.groupId -or
        [string]$registryDelta.taskIds[0] -ne [string]@($group.slots)[0].jobId) {
        throw "CompatibilitySingle click did not create exactly the expected native group and task."
    }

    $attempt = Wait-OneUpstreamAttempt -GroupId $group.groupId
    Assert-AttemptMatchesGroup `
        -Attempt $attempt `
        -Group $group `
        -ExpectedSlot 1 `
        -ClickedAt ([long]$created.clickedAt) `
        -Context "CompatibilitySingle FHL1"
    $terminal = Wait-TerminalGroup -GroupId $group.groupId -ResolvedWorkspaceId ([string]$created.workspaceId)
    if ([string]$terminal.slot.status -ne "succeeded") {
        throw "CompatibilitySingle FHL1 finished with status $($terminal.slot.status)."
    }
    $groupAttempts = @(Get-UpstreamSubmitAttempts | Where-Object { $_.groupId -eq $group.groupId })
    if ($groupAttempts.Count -ne 1) {
        throw "CompatibilitySingle FHL1 did not keep the strict one-POST contract."
    }
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
    if ($newAttempts.Count -ne 1) {
        throw "CompatibilitySingle recorded $($newAttempts.Count) new POST attempts instead of one."
    }
    $history = Read-HistorySourceLabel
    if (
        [string]$history.currentView -ne "history" -or
        [string]$history.newestSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotStatus -ne "succeeded"
    ) {
        throw "CompatibilitySingle FHL1 history source label is incorrect."
    }

    $Report.metrics.groups = 1
    $Report.metrics.tasks = 1
    $Report.metrics.upstreamPosts = 1
    $Report.cursorAfter = [int](Get-BrowserState).cursor
    $Report.results += [ordered]@{
        sequence = 1
        workspaceId = [string]$created.workspaceId
        clickedAt = [long]$created.clickedAt
        createdAt = [long]$created.createdAt
        expectedSlot = 1
        expectedLabel = "FHL1"
        expectedHistoryLabel = $expectedHistoryLabel
        submitKind = $expectedSubmitKind
        groupId = $group.groupId
        jobId = @($group.slots)[0].jobId
        clientSubmissionId = $group.clientSubmissionId
        requestRunId = $group.requestRunId
        status = $terminal.slot.status
        groupCount = 1
        taskCount = 1
        postCount = 1
        historyLabel = $history.newestSourceLabel
    }
    return $newAttempts
}

function Invoke-PoolLoadScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry
    )

    $expectedTasks = if ([string]$Report.scenario -eq "Pool40") { 40 } else { 60 }
    $expectedPerSlot = [int]($expectedTasks / 10)
    $expectedQueuedAtCheckpoint = $expectedTasks - 40
    $startCursor = [int]$InitialState.cursor
    if ($InitialState.continuousGenerateTest -ne $true) {
        throw "$($Report.scenario) requires continuous generation to be enabled before any paid click."
    }
    $Report.expectedSlots = @(
        for ($offset = 0; $offset -lt $expectedTasks; $offset += 1) {
            (($startCursor - 1 + $offset) % 10) + 1
        }
    )
    $readiness = Set-PromptAndReadiness
    Assert-SubmitReadiness -Readiness $readiness -Context ([string]$Report.scenario)
    $readyState = Get-BrowserState
    if ([string]$readyState.workspaceId -ne $ResolvedWorkspaceId -or [int]$readyState.cursor -ne $startCursor) {
        throw "Load click-time browser state changed after readiness."
    }
    Initialize-LoadAuditCapture -BaselineEvents @(Get-RedactedNativeAuditEvents)
    $script:LoadHostSamples = @()
    $blockCount = [int]($expectedTasks / 10)
    for ($block = 1; $block -le $blockCount; $block += 1) {
        $acceptedBefore = @($Report.results).Count
        $expectedCursor = (($startCursor - 1 + $acceptedBefore) % 10) + 1
        $beforeState = Get-BrowserState
        if ([string]$beforeState.workspaceId -ne $ResolvedWorkspaceId -or [int]$beforeState.cursor -ne $expectedCursor) {
            throw "Load block $block did not start from its expected workspace and cursor."
        }
        $beforeRegistry = Get-NativeRegistrySummary
        Assert-LoadGlobalIdentity -InitialRegistry $InitialRegistry -CurrentRegistry $beforeRegistry -Results @($Report.results) -ResolvedWorkspaceId $ResolvedWorkspaceId
        $script:LoadCheckpoint = [ordered]@{
            schemaVersion = 1
            scenario = [string]$Report.scenario
            status = "ready-before-paid-block"
            block = $block
            acceptedClicks = $acceptedBefore
            expectedBlockClicks = 10
            mustNotReplayUnknownOutcome = $true
            candidateGitCommit = [string]$Report.candidateGitCommit
            apkSha256 = [string]$Report.apkSha256
            device = [string]$Report.device
            package = [string]$Report.package
            cursor = $expectedCursor
            savedAt = (Get-Date).ToString("o")
        }
        Write-Evidence -Report $Report -Attempts @(Get-CapturedLoadAttempts)
        try {
            $clickBlock = Invoke-LoadClickBlock -BlockNumber $block -ExpectedStartCursor $expectedCursor
        }
        catch {
            $paidFailure = ConvertTo-RedactedText $_.Exception.Message
            try {
                Capture-LoadAuditEvents | Out-Null
                $unknownRegistry = Get-NativeRegistrySummary
                $unknownDelta = Get-RegistryDelta -Before $InitialRegistry -After $unknownRegistry
                $unknownAttempts = @(Get-CapturedLoadAttempts)
                $script:LoadCheckpoint.status = "paid-block-outcome-unknown"
                $script:LoadCheckpoint["observedGroups"] = @($unknownDelta.groupIds).Count
                $script:LoadCheckpoint["observedTasks"] = @($unknownDelta.taskIds).Count
                $script:LoadCheckpoint["observedUpstreamPosts"] = $unknownAttempts.Count
                $script:LoadCheckpoint["failedAt"] = (Get-Date).ToString("o")
                $script:LoadCheckpoint["failure"] = $paidFailure
                Write-Evidence -Report $Report -Attempts $unknownAttempts
            }
            catch {
                $evidenceFailure = ConvertTo-RedactedText $_.Exception.Message
                throw "$paidFailure Evidence capture also failed: $evidenceFailure"
            }
            throw $paidFailure
        }
        $afterRegistry = Get-NativeRegistrySummary
        $newResults = @(Get-LoadBlockResults `
            -BeforeRegistry $beforeRegistry `
            -AfterRegistry $afterRegistry `
            -ClickBlock $clickBlock `
            -ResolvedWorkspaceId $ResolvedWorkspaceId `
            -SequenceOffset $acceptedBefore)
        $Report.results += $newResults
        $acceptedNow = @($Report.results).Count
        $Report.metrics.clicks = $acceptedNow
        $Report.metrics.groups = $acceptedNow
        $Report.metrics.tasks = $acceptedNow
        $Report.cursorAfter = [int]$clickBlock.finishedCursor
        Assert-LoadGlobalIdentity -InitialRegistry $InitialRegistry -CurrentRegistry $afterRegistry -Results @($Report.results) -ResolvedWorkspaceId $ResolvedWorkspaceId
        Assert-LoadDistribution -Results @($Report.results) -ExpectedPerSlot $block
        Capture-LoadAuditEvents | Out-Null
        $hostSample = Assert-LoadHostSafety -Registry $afterRegistry -Results @($Report.results) -Phase "block-$block"
        $partialMetrics = Get-LoadAuditMetrics -Results @($Report.results)
        $partialAttempts = @(Get-CapturedLoadAttempts)
        if ($partialAttempts.Count -gt $acceptedNow) { throw "Load run recorded more POST attempts than explicit clicks." }
        if (@($partialAttempts | ForEach-Object { [string]$_.jobId } | Sort-Object -Unique).Count -ne $partialAttempts.Count) {
            throw "Load run recorded duplicate upstream POST task identities."
        }
        $hostCheckpointPassed = $false
        if ($acceptedNow -eq $expectedTasks) {
            $checkpointDeadline = (Get-Date).AddSeconds(10)
            do {
                $hostCheckpointPassed = (
                    [int]$hostSample.running -eq 40 -and
                    [int]$hostSample.activeReservations -eq 40 -and
                    [int]$hostSample.queued -eq $expectedQueuedAtCheckpoint -and
                    [int]$hostSample.succeeded -eq 0 -and
                    [int]$hostSample.failed -eq 0 -and
                    [int]$hostSample.cancelled -eq 0 -and
                    [int]$hostSample.interrupted -eq 0
                )
                foreach ($slotSample in @($hostSample.perSlot)) {
                    if ([int]$slotSample.running -ne 4 -or [int]$slotSample.activeReservations -ne 4 -or
                        [int]$slotSample.queued -ne ($expectedPerSlot - 4)) {
                        $hostCheckpointPassed = $false
                    }
                }
                if ($hostCheckpointPassed) { break }
                $observedTerminal = [int]$hostSample.succeeded + [int]$hostSample.failed + [int]$hostSample.cancelled + [int]$hostSample.interrupted
                if ($observedTerminal -gt 0) { break }
                Start-Sleep -Milliseconds 100
                Capture-LoadAuditEvents | Out-Null
                $checkpointRegistry = Get-NativeRegistrySummary
                Assert-LoadGlobalIdentity -InitialRegistry $InitialRegistry -CurrentRegistry $checkpointRegistry -Results @($Report.results) -ResolvedWorkspaceId $ResolvedWorkspaceId
                $hostSample = Assert-LoadHostSafety -Registry $checkpointRegistry -Results @($Report.results) -Phase "capacity-checkpoint"
                $partialMetrics = Get-LoadAuditMetrics -Results @($Report.results)
                $partialAttempts = @(Get-CapturedLoadAttempts)
            } while ((Get-Date) -lt $checkpointDeadline)
            if (-not $hostCheckpointPassed) {
                throw "$($Report.scenario) did not expose the exact host state of 40 active/running and $expectedQueuedAtCheckpoint queued tasks."
            }
        }
        $Report.scheduler = [ordered]@{
            expectedTasks = $expectedTasks
            expectedPerSlot = $expectedPerSlot
            totalPeak = [int]$partialMetrics.totalPeak
            perSlotPeak = @($partialMetrics.perSlotPeak)
            sampledQueuePeak = [int](($script:LoadHostSamples | ForEach-Object { [int]$_.queued } | Measure-Object -Maximum).Maximum)
            capacityCheckpointQueued = if ($hostCheckpointPassed) { $expectedQueuedAtCheckpoint } else { $null }
            fifoQueueSequence = [bool]$partialMetrics.fifoQueueSequence
            hostCheckpointPassed = $hostCheckpointPassed
            auditEvents = [int]$partialMetrics.eventCount
            upstreamPosts = $partialAttempts.Count
        }
        $script:LoadCheckpoint = [ordered]@{
            schemaVersion = 1
            scenario = [string]$Report.scenario
            status = "block-accepted"
            block = $block
            acceptedClicks = $acceptedNow
            candidateGitCommit = [string]$Report.candidateGitCommit
            apkSha256 = [string]$Report.apkSha256
            device = [string]$Report.device
            package = [string]$Report.package
            cursor = [int]$Report.cursorAfter
            uniqueGroups = @($Report.results | ForEach-Object { [string]$_.groupId } | Sort-Object -Unique).Count
            uniqueTasks = @($Report.results | ForEach-Object { [string]$_.jobId } | Sort-Object -Unique).Count
            uniqueSubmissionIds = @($Report.results | ForEach-Object { [string]$_.clientSubmissionId } | Sort-Object -Unique).Count
            auditEventCount = [int]$partialMetrics.eventCount
            hostSample = $hostSample
            savedAt = (Get-Date).ToString("o")
        }
        Write-Evidence -Report $Report -Attempts $partialAttempts
    }

    $deadline = (Get-Date).AddSeconds($TerminalTimeoutSeconds)
    $finalRegistry = $null
    do {
        Start-Sleep -Seconds 1
        Capture-LoadAuditEvents | Out-Null
        $finalRegistry = Get-NativeRegistrySummary
        Assert-LoadGlobalIdentity -InitialRegistry $InitialRegistry -CurrentRegistry $finalRegistry -Results @($Report.results) -ResolvedWorkspaceId $ResolvedWorkspaceId
        $sample = Assert-LoadHostSafety -Registry $finalRegistry -Results @($Report.results) -Phase "terminal-wait"
        $partialMetrics = Get-LoadAuditMetrics -Results @($Report.results)
        $terminalCount = [int]$sample.succeeded + [int]$sample.failed + [int]$sample.cancelled + [int]$sample.interrupted
        if ($terminalCount -eq $expectedTasks -and [int]$sample.activeReservations -eq 0) { break }
    } while ((Get-Date) -lt $deadline)
    if ($null -eq $finalRegistry) { throw "Load terminal registry was not observed." }
    $lastSample = @($script:LoadHostSamples)[-1]
    $lastTerminalCount = [int]$lastSample.succeeded + [int]$lastSample.failed + [int]$lastSample.cancelled + [int]$lastSample.interrupted
    if ($lastTerminalCount -ne $expectedTasks -or [int]$lastSample.activeReservations -ne 0) {
        throw "$($Report.scenario) did not settle all tasks within $TerminalTimeoutSeconds seconds."
    }
    if ([int]$lastSample.succeeded -ne $expectedTasks -or [int]$lastSample.failed -ne 0 -or
        [int]$lastSample.cancelled -ne 0 -or [int]$lastSample.interrupted -ne 0) {
        throw "$($Report.scenario) requires every real API task to succeed."
    }
    $auditDeadline = (Get-Date).AddSeconds(10)
    do {
        Capture-LoadAuditEvents | Out-Null
        $auditCatchUp = Get-LoadAuditMetrics -Results @($Report.results)
        if ([int]$auditCatchUp.submits -eq $expectedTasks -and [int]$auditCatchUp.claims -eq $expectedTasks -and
            [int]$auditCatchUp.releases -eq $expectedTasks -and [int]$auditCatchUp.upstreamPosts -eq $expectedTasks -and
            [int]$auditCatchUp.terminals -eq $expectedTasks) {
            break
        }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $auditDeadline)
    $finalMetrics = Get-LoadAuditMetrics -Results @($Report.results) -RequireComplete
    if ([int]$finalMetrics.totalPeak -ne 40 -or
        @($finalMetrics.perSlotPeak | Where-Object { [int]$_.peak -ne 4 }).Count -ne 0) {
        throw "$($Report.scenario) audit did not prove an exact total peak of 40 and per-slot peak of four."
    }
    Assert-LoadDistribution -Results @($Report.results) -ExpectedPerSlot $expectedPerSlot
    $finalAttempts = @(Get-CapturedLoadAttempts)
    if ($finalAttempts.Count -ne $expectedTasks) { throw "$($Report.scenario) did not record exactly one POST per task." }
    foreach ($poolSlot in 1..10) {
        if (@($finalAttempts | Where-Object { [int]$_.fhlImagesPoolSlot -eq $poolSlot -and [string]$_.apiLabel -eq "FHL$poolSlot" }).Count -ne $expectedPerSlot) {
            throw "$($Report.scenario) POST distribution for FHL$poolSlot is not exactly $expectedPerSlot."
        }
    }
    $finalState = Get-BrowserState
    if ([int]$finalState.cursor -ne $startCursor) { throw "$($Report.scenario) did not finish on its original pool cursor." }
    foreach ($result in @($Report.results)) {
        $group = @($finalRegistry.groups | Where-Object { [string]$_.groupId -eq [string]$result.groupId })[0]
        $slot = @($group.slots | Where-Object { [string]$_.jobId -eq [string]$result.jobId })[0]
        $result.status = [string]$slot.status
        $result.postCount = 1
    }
    $Report.metrics.clicks = $expectedTasks
    $Report.metrics.groups = $expectedTasks
    $Report.metrics.tasks = $expectedTasks
    $Report.metrics.upstreamPosts = $expectedTasks
    $Report.cursorAfter = [int]$finalState.cursor
    $Report.scheduler = [ordered]@{
        expectedTasks = $expectedTasks
        expectedPerSlot = $expectedPerSlot
        totalPeak = [int]$finalMetrics.totalPeak
        perSlotPeak = @($finalMetrics.perSlotPeak)
        sampledQueuePeak = [int](($script:LoadHostSamples | ForEach-Object { [int]$_.queued } | Measure-Object -Maximum).Maximum)
        capacityCheckpointQueued = $expectedQueuedAtCheckpoint
        fifoQueueSequence = [bool]$finalMetrics.fifoQueueSequence
        hostCheckpointPassed = $true
        auditEvents = [int]$finalMetrics.eventCount
        submits = [int]$finalMetrics.submits
        claims = [int]$finalMetrics.claims
        releases = [int]$finalMetrics.releases
        upstreamPosts = [int]$finalMetrics.upstreamPosts
        terminals = [int]$finalMetrics.terminals
        uniqueSubmissionIds = @($Report.results | ForEach-Object { [string]$_.clientSubmissionId } | Sort-Object -Unique).Count
    }
    $script:LoadCheckpoint.status = "completed"
    $script:LoadCheckpoint["finishedAt"] = (Get-Date).ToString("o")
    $script:LoadCheckpoint["scheduler"] = $Report.scheduler
    Write-Evidence -Report $Report -Attempts $finalAttempts
    return $finalAttempts
}

function Invoke-SequentialScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialSnapshot,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    $startCursor = [int]$InitialState.cursor
    Assert-ExpectedFHLTransportMode -BrowserState $InitialState -Context "Sequential preflight"
    $expectedSlots = @(for ($offset = 0; $offset -lt 10; $offset += 1) { (($startCursor - 1 + $offset) % 10) + 1 })
    $Report.expectedSlots = $expectedSlots
    for ($index = 0; $index -lt $expectedSlots.Count; $index += 1) {
        if ($index -gt 0) {
            $previousClick = [long]$Report.results[$index - 1].clickedAt
            $remainingDelay = $sequentialMinimumIntervalMilliseconds - ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $previousClick)
            if ($remainingDelay -gt 0) {
                Start-Sleep -Milliseconds ([int]$remainingDelay)
            }
        }
        $expectedSlot = [int]$expectedSlots[$index]
        $expectedLabel = "FHL$expectedSlot"
        $expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot $expectedSlot
        $beforeState = Get-BrowserState
        Assert-ExpectedFHLTransportMode -BrowserState $beforeState -Context "$expectedLabel pre-click"
        if ([int]$beforeState.cursor -ne $expectedSlot) {
            throw "Pool cursor changed unexpectedly before sequence $($index + 1)."
        }
        $readiness = Set-PromptAndReadiness
        Assert-SubmitReadiness -Readiness $readiness -Context $expectedLabel
        $clickState = Get-BrowserState
        Assert-ExpectedFHLTransportMode -BrowserState $clickState -Context "$expectedLabel click-time"
        if ([string]$clickState.workspaceId -ne $ResolvedWorkspaceId -or [int]$clickState.cursor -ne $expectedSlot) {
            throw "$expectedLabel click-time browser state changed after readiness."
        }

        $acceptedGroupIds = @($Report.results | ForEach-Object { [string]$_.groupId })
        $acceptedTaskIds = @($Report.results | ForEach-Object { [string]$_.jobId })
        $freshRegistry = Get-NativeRegistrySummary
        Assert-RegistryDeltaMatches `
            -Before $InitialRegistry `
            -After $freshRegistry `
            -ExpectedGroupIds $acceptedGroupIds `
            -ExpectedTaskIds $acceptedTaskIds `
            -Context "$expectedLabel pre-click" | Out-Null
        if ([int]$freshRegistry.pendingCount -ne 0) {
            throw "$expectedLabel pre-click registry was not idle."
        }

        $click = Click-GenerateOnce
        $Report.metrics.clicks += 1
        $created = Wait-NewNativeGroup `
            -BeforeRegistry $freshRegistry `
            -ClickedAt ([long]$click.clickedAt) `
            -ExpectedWorkspaceId $ResolvedWorkspaceId
        $group = $created.group
        $Report.workspaceId = [string]$created.workspaceId
        Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
        $Report.metrics.groups += 1
        $Report.metrics.tasks += @($group.slots).Count
        $Report.cursorAfter = [int](Get-BrowserState).cursor
        $expectedCreatedCount = $index + 1
        $partialRegistryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
        if (@($partialRegistryDelta.groupIds).Count -ne $expectedCreatedCount -or @($partialRegistryDelta.taskIds).Count -ne $expectedCreatedCount) {
            throw "Sequential step $expectedCreatedCount detected an unexpected global group or task."
        }
        $attempt = Wait-OneUpstreamAttempt -GroupId $group.groupId
        $Report.metrics.upstreamPosts += 1
        Assert-AttemptMatchesGroup -Attempt $attempt -Group $group -ExpectedSlot $expectedSlot -ClickedAt ([long]$created.clickedAt) -Context $expectedLabel

        $terminal = Wait-TerminalGroup -GroupId $group.groupId -ResolvedWorkspaceId ([string]$created.workspaceId)
        if ([string]$terminal.slot.status -ne "succeeded") {
            throw "$expectedLabel finished with status $($terminal.slot.status)."
        }
        $groupAttempts = @(Get-UpstreamSubmitAttempts | Where-Object { $_.groupId -eq $group.groupId })
        if ($groupAttempts.Count -ne 1) { throw "$expectedLabel did not keep the strict one-POST contract." }
        $partialNewAttempts = @(Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
        if ($partialNewAttempts.Count -ne $expectedCreatedCount) {
            throw "Sequential step $expectedCreatedCount detected an unexpected global POST attempt."
        }
        $history = Read-HistorySourceLabel
        if (
            [string]$history.currentView -ne "history" -or
            [string]$history.newestSourceLabel -ne $expectedHistoryLabel -or
            [string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel -or
            [string]$history.newestSlotStatus -ne "succeeded"
        ) {
            throw "$expectedLabel history source label is incorrect."
        }

        $Report.results += [ordered]@{
            sequence = $index + 1
            workspaceId = [string]$created.workspaceId
            clickedAt = [long]$created.clickedAt
            createdAt = [long]$created.createdAt
            expectedSlot = $expectedSlot
            expectedLabel = $expectedLabel
            expectedAPIMode = $ExpectedFHLTransportMode
            expectedHistoryLabel = $expectedHistoryLabel
            groupId = $group.groupId
            jobId = @($group.slots)[0].jobId
            clientSubmissionId = $group.clientSubmissionId
            requestRunId = $group.requestRunId
            status = $terminal.slot.status
            groupCount = 1
            taskCount = 1
            postCount = 1
            historyLabel = $history.newestSourceLabel
        }
        Write-Evidence -Report $Report -Attempts (Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
    }

    $finalAttempts = @(Get-UpstreamSubmitAttempts)
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $finalAttempts)
    if ($newAttempts.Count -ne 10) { throw "Sequential scenario recorded $($newAttempts.Count) new POST attempts instead of 10." }
    if ((@($Report.results | ForEach-Object { $_.groupId } | Sort-Object -Unique)).Count -ne 10) { throw "Sequential scenario did not create 10 unique groups." }
    if ((@($Report.results | ForEach-Object { $_.jobId } | Sort-Object -Unique)).Count -ne 10) { throw "Sequential scenario did not create 10 unique tasks." }
    if ((@($Report.results | ForEach-Object { $_.clientSubmissionId } | Sort-Object -Unique)).Count -ne 10) { throw "Sequential scenario did not create 10 unique submission IDs." }
    $resultWorkspaces = @($Report.results | ForEach-Object { [string]$_.workspaceId } | Sort-Object -Unique)
    if ($resultWorkspaces.Count -ne 1 -or [string]$resultWorkspaces[0] -ne $ResolvedWorkspaceId) {
        throw "Sequential scenario did not keep all ten clicks in the same expected workspace."
    }
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    if (@($registryDelta.groupIds).Count -ne 10 -or @($registryDelta.taskIds).Count -ne 10) {
        throw "Sequential scenario global registry delta is not exactly 10 groups and 10 tasks."
    }
    $resultGroupIds = @($Report.results | ForEach-Object { $_.groupId })
    $resultTaskIds = @($Report.results | ForEach-Object { $_.jobId })
    if (@($registryDelta.groupIds | Where-Object { $resultGroupIds -notcontains $_ }).Count -ne 0 -or
        @($registryDelta.taskIds | Where-Object { $resultTaskIds -notcontains $_ }).Count -ne 0) {
        throw "Sequential scenario detected a group or task outside the ten explicit clicks."
    }
    $finalState = Get-BrowserState
    Assert-ExpectedFHLTransportMode -BrowserState $finalState -Context "Sequential completion"
    if ([int]$finalState.cursor -ne $startCursor) { throw "Ten-slot cycle did not return to its original cursor." }
    $Report.cursorAfter = [int]$finalState.cursor
    return $newAttempts
}

function Invoke-StartupScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    # InitialAttempts was captured before the common launch, so this observes
    # the first candidate startup instead of hiding an early automatic POST.
    Start-Sleep -Seconds $ObservationSeconds
    $afterAttempts = @(Get-UpstreamSubmitAttempts)
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $afterAttempts)
    $Report.metrics.observationPostDelta = $newAttempts.Count
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    $Report.metrics.groups = @($registryDelta.groupIds).Count
    $Report.metrics.tasks = @($registryDelta.taskIds).Count
    $Report.metrics.upstreamPosts = $newAttempts.Count
    if ($Report.metrics.groups -ne 0 -or $Report.metrics.tasks -ne 0) {
        throw "Startup created $($Report.metrics.groups) group(s) and $($Report.metrics.tasks) task(s)."
    }
    if ($newAttempts.Count -ne 0) { throw "Startup produced $($newAttempts.Count) unexpected upstream POST attempt(s)." }
    $afterState = Get-BrowserState
    Assert-TenConfiguredSlots -BrowserState $afterState
    if ([int]$afterState.cursor -ne [int]$InitialState.cursor) { throw "Startup changed the FHL pool cursor." }
    if ([string]$afterState.workspaceId -ne $ResolvedWorkspaceId) {
        throw "Startup changed the active workspace."
    }
    $Report.cursorAfter = [int]$afterState.cursor
    return $newAttempts
}

function ConvertTo-MatrixStartupComparableJson {
    param([Parameter(Mandatory = $true)][object]$State)

    return ([ordered]@{
        storageNamespace = [string]$State.storageNamespace
        candidateNamespaceCount = [int]$State.candidateNamespaceCount
        sessionNamespaceCount = [int]$State.sessionNamespaceCount
        selectedNamespaceCount = [int]$State.selectedNamespaceCount
        profileCount = [int]$State.profileCount
        workspaceId = [string]$State.workspaceId
        cursor = [int]$State.cursor
        cursorStored = [bool]$State.cursorStored
        transportMode = [string]$State.transportMode
        transportPreference = [string]$State.transportPreference
        targetPlatform = [string]$State.targetPlatform
        configuredSlots = @(
            $State.poolSlots |
                Where-Object { $_.enabled -and $_.hasKeyHint } |
                ForEach-Object { [int]$_.slot } |
                Sort-Object -Unique
        )
    } | ConvertTo-Json -Compress -Depth 6)
}

function Invoke-MatrixStartupScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialBootstrap,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Start-Sleep -Seconds $ObservationSeconds
    $afterAttempts = @(Get-UpstreamSubmitAttempts)
    $afterRegistry = Get-NativeRegistrySummary
    Assert-UpstreamAttemptStateUnchanged -Before $InitialAttempts -After $afterAttempts -Context "MatrixStartup observation"
    Assert-NativeRegistryStateUnchanged -Before $InitialRegistry -After $afterRegistry -Context "MatrixStartup observation"
    $afterBootstrap = Wait-AndroidMatrixStartupReady
    $afterState = Get-MatrixStartupState
    $configured = @(Assert-MatrixStartupState -BrowserState $afterState -BootstrapState $afterBootstrap -Context "MatrixStartup completion")
    if ((ConvertTo-MatrixStartupComparableJson -State $InitialState) -ne (ConvertTo-MatrixStartupComparableJson -State $afterState)) {
        throw "MatrixStartup changed Profile, slot, workspace, cursor, transport, or platform state."
    }
    if ([string]$afterState.workspaceId -ne $ResolvedWorkspaceId) {
        throw "MatrixStartup changed the active workspace."
    }
    $Report.metrics.groups = 0
    $Report.metrics.tasks = 0
    $Report.metrics.upstreamPosts = 0
    $Report.metrics.observationPostDelta = 0
    $Report.cursorAfter = [int]$afterState.cursor
    $Report.workflow = [ordered]@{
        readyKind = [string]$afterBootstrap.readyKind
        targetPlatform = [string]$afterState.targetPlatform
        configuredSlotCount = $configured.Count
        configuredSlots = $configured
        profileCount = [int]$afterState.profileCount
        candidateNamespaceCount = [int]$afterState.candidateNamespaceCount
        sessionNamespaceCount = [int]$afterState.sessionNamespaceCount
        viewportWidth = [int]$afterBootstrap.viewportWidth
        viewportHeight = [int]$afterBootstrap.viewportHeight
        rootWidth = [int]$afterBootstrap.rootWidth
        rootHeight = [int]$afterBootstrap.rootHeight
        horizontalOverflowPx = [Math]::Max(0, [int]$afterBootstrap.scrollWidth - [int]$afterBootstrap.viewportWidth)
        initialReadyKind = [string]$InitialBootstrap.readyKind
        automaticPostCount = 0
    }
    return @()
}

function Invoke-MatrixSingleScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialBootstrap,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    $configured = @(
        Assert-MatrixSingleConfiguredSlot `
            -BrowserState $InitialState `
            -BootstrapState $InitialBootstrap `
            -Context "MatrixSingle preflight"
    )
    $expectedSlot = [int]$configured[0]
    $expectedLabel = "FHL$expectedSlot"
    $expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot $expectedSlot
    $Report.expectedSlots = @($expectedSlot)

    Start-Sleep -Seconds $ObservationSeconds
    $afterObservationAttempts = @(Get-UpstreamSubmitAttempts)
    $afterObservationRegistry = Get-NativeRegistrySummary
    Assert-UpstreamAttemptStateUnchanged `
        -Before $InitialAttempts `
        -After $afterObservationAttempts `
        -Context "MatrixSingle startup observation"
    Assert-NativeRegistryStateUnchanged `
        -Before $InitialRegistry `
        -After $afterObservationRegistry `
        -Context "MatrixSingle startup observation"
    $afterObservationBootstrap = Wait-AndroidMatrixStartupReady
    $afterObservationState = Get-MatrixStartupState
    $afterObservationConfigured = @(
        Assert-MatrixSingleConfiguredSlot `
            -BrowserState $afterObservationState `
            -BootstrapState $afterObservationBootstrap `
            -Context "MatrixSingle post-observation"
    )
    if (
        [int]$afterObservationConfigured[0] -ne $expectedSlot -or
        (ConvertTo-MatrixStartupComparableJson -State $InitialState) -ne
            (ConvertTo-MatrixStartupComparableJson -State $afterObservationState)
    ) {
        throw "MatrixSingle changed Profile, slot, workspace, cursor, transport, or platform state during startup observation."
    }
    if ([string]$afterObservationState.workspaceId -ne $ResolvedWorkspaceId) {
        throw "MatrixSingle changed the active workspace during startup observation."
    }

    $readiness = Set-MatrixPromptAndReadiness
    $expectedSubmitKind = [string]$readiness.submitKind
    $clickBootstrap = Wait-AndroidMatrixStartupReady
    $clickState = Get-MatrixStartupState
    $clickConfigured = @(
        Assert-MatrixSingleConfiguredSlot `
            -BrowserState $clickState `
            -BootstrapState $clickBootstrap `
            -Context "MatrixSingle click-time"
    )
    if (
        [int]$clickConfigured[0] -ne $expectedSlot -or
        [string]$clickState.workspaceId -ne $ResolvedWorkspaceId -or
        [string]$clickState.targetPlatform -ne [string]$readiness.targetPlatform
    ) {
        throw "MatrixSingle click-time workspace, slot, or platform changed after readiness."
    }

    $freshRegistry = Get-NativeRegistrySummary
    $freshAttempts = @(Get-UpstreamSubmitAttempts)
    Assert-NativeRegistryStateUnchanged -Before $InitialRegistry -After $freshRegistry -Context "MatrixSingle pre-click"
    Assert-UpstreamAttemptStateUnchanged -Before $InitialAttempts -After $freshAttempts -Context "MatrixSingle pre-click"
    if ([int]$freshRegistry.pendingCount -ne 0) {
        throw "MatrixSingle pre-click registry was not idle."
    }

    $click = Click-MatrixGenerateOnce
    if (
        [string]$click.submitKind -ne $expectedSubmitKind -or
        [string]$click.targetPlatform -ne [string]$readiness.targetPlatform -or
        [string]$click.composeKind -ne [string]$readiness.composeKind
    ) {
        throw "MatrixSingle submit kind or platform changed at the explicit click."
    }
    $Report.metrics.clicks = 1
    $created = Wait-NewNativeGroup `
        -BeforeRegistry $freshRegistry `
        -ClickedAt ([long]$click.clickedAt) `
        -ExpectedWorkspaceId $ResolvedWorkspaceId
    $group = $created.group
    $Report.workspaceId = [string]$created.workspaceId
    Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
    if (@($freshRegistry.groups | Where-Object {
        [string]$_.clientSubmissionId -eq [string]$group.clientSubmissionId
    }).Count -ne 0) {
        throw "MatrixSingle reused an existing clientSubmissionId."
    }

    $attempt = Wait-OneUpstreamAttempt -GroupId $group.groupId
    Assert-AttemptMatchesGroup `
        -Attempt $attempt `
        -Group $group `
        -ExpectedSlot $expectedSlot `
        -ClickedAt ([long]$created.clickedAt) `
        -Context "MatrixSingle $expectedLabel"
    $terminal = Wait-TerminalGroup -GroupId $group.groupId -ResolvedWorkspaceId ([string]$created.workspaceId)
    if ([string]$terminal.slot.status -ne "succeeded") {
        throw "MatrixSingle $expectedLabel finished with status $($terminal.slot.status)."
    }

    $finalAttempts = @(Get-UpstreamSubmitAttempts)
    $newAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $finalAttempts)
    $finalRegistry = Get-NativeRegistrySummary
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After $finalRegistry
    if (
        $newAttempts.Count -ne 1 -or
        @($registryDelta.groupIds).Count -ne 1 -or
        @($registryDelta.taskIds).Count -ne 1 -or
        [string]$registryDelta.groupIds[0] -ne [string]$group.groupId -or
        [string]$registryDelta.taskIds[0] -ne [string]@($group.slots)[0].jobId
    ) {
        throw "MatrixSingle did not create exactly one group, one task, one unique submission, and one upstream POST."
    }
    $afterState = Get-MatrixStartupState
    $history = Read-HistorySourceLabel
    if (
        [string]$history.currentView -ne "history" -or
        [string]$history.newestSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotStatus -ne "succeeded"
    ) {
        throw "MatrixSingle $expectedLabel history source label is incorrect."
    }

    $Report.metrics.groups = 1
    $Report.metrics.tasks = 1
    $Report.metrics.upstreamPosts = 1
    $Report.metrics.observationPostDelta = 0
    $Report.cursorAfter = [int]$afterState.cursor
    $Report.workflow = [ordered]@{
        readyKind = [string]$InitialBootstrap.readyKind
        submitKind = $expectedSubmitKind
        targetPlatform = [string]$readiness.targetPlatform
        composeKind = [string]$readiness.composeKind
        configuredSlotCount = 1
        configuredSlots = @($expectedSlot)
        automaticGroupCount = 0
        automaticTaskCount = 0
        automaticSubmissionCount = 0
        automaticPostCount = 0
    }
    $Report.results += [ordered]@{
        sequence = 1
        workspaceId = [string]$created.workspaceId
        clickedAt = [long]$created.clickedAt
        createdAt = [long]$created.createdAt
        expectedSlot = $expectedSlot
        expectedLabel = $expectedLabel
        expectedAPIMode = $ExpectedFHLTransportMode
        expectedHistoryLabel = $expectedHistoryLabel
        submitKind = $expectedSubmitKind
        targetPlatform = [string]$readiness.targetPlatform
        groupId = [string]$group.groupId
        jobId = [string]@($group.slots)[0].jobId
        clientSubmissionId = [string]$group.clientSubmissionId
        requestRunId = [string]$group.requestRunId
        status = [string]$terminal.slot.status
        groupCount = 1
        taskCount = 1
        postCount = 1
        historyLabel = [string]$history.newestSourceLabel
        historySlotLabel = [string]$history.newestSlotSourceLabel
    }
    return $newAttempts
}

function Invoke-OfflineScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialSnapshot,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Offline preflight"
    if (Get-AirplaneModeEnabled) { throw "Offline verification requires the device to start online." }
    $onlineState = Wait-DefaultNetworkValidation -ExpectedValidated $true
    $Report | Add-Member -NotePropertyName networkPrecondition -NotePropertyValue ([ordered]@{
        onlineSource = [string]$onlineState.source
        androidValidated = [bool]$onlineState.validated
        fhlTcp443Reachable = [bool]$onlineState.targetReachable
        offlineSource = ""
        restoreSource = ""
    }) -Force
    $expectedSlot = [int]$InitialState.cursor
    $expectedLabel = "FHL$expectedSlot"
    $expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot $expectedSlot
    $Report.expectedSlots = @($expectedSlot)
    $requestDiagnosticsBeforeRestore = 0
    $readiness = Set-PromptAndReadiness
    Assert-SubmitReadiness -Readiness $readiness -Context "Offline"
    $clickState = Get-BrowserState
    Assert-OfficialFHLImagesHomeSource -BrowserState $clickState -Context "Offline click-time"
    if ([string]$clickState.workspaceId -ne $ResolvedWorkspaceId -or [int]$clickState.cursor -ne $expectedSlot) {
        throw "Offline click-time browser state changed after readiness."
    }

    $offlineState = Set-AirplaneModeEnabled -Enabled $true
    $Report.networkPrecondition.offlineSource = [string]$offlineState.source
    try {
        $freshRegistry = Get-NativeRegistrySummary
        Assert-RegistryDeltaMatches -Before $InitialRegistry -After $freshRegistry -ExpectedGroupIds @() -ExpectedTaskIds @() -Context "Offline pre-click" | Out-Null
        if ([int]$freshRegistry.pendingCount -ne 0) { throw "Offline pre-click registry was not idle." }
        $click = Click-GenerateOnce
        $Report.metrics.clicks = 1
        $created = Wait-NewNativeGroup `
            -BeforeRegistry $freshRegistry `
            -ClickedAt ([long]$click.clickedAt) `
            -ExpectedWorkspaceId $ResolvedWorkspaceId
        $group = $created.group
        $Report.workspaceId = [string]$created.workspaceId
        Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
        $attempt = Wait-OneUpstreamAttempt -GroupId $group.groupId
        Assert-AttemptMatchesGroup -Attempt $attempt -Group $group -ExpectedSlot $expectedSlot -ClickedAt ([long]$created.clickedAt) -Context "Offline"
        $terminal = Wait-TerminalGroup -GroupId $group.groupId -ResolvedWorkspaceId ([string]$created.workspaceId)
        if ($EvidenceSource -eq "DebugRunAs") {
            Clear-DeviceLogcat
        }
        else {
            $requestDiagnosticsBeforeRestore = Get-UpstreamRequestDiagnosticCount
        }
    }
    finally {
        if ($script:AirplaneModeChanged) {
            $restoredState = Set-AirplaneModeEnabled -Enabled $false
            $Report.networkPrecondition.restoreSource = [string]$restoredState.source
        }
    }

    $slot = $terminal.slot
    if ([string]$slot.status -ne "failed") { throw "Offline task finished with status $($slot.status), expected failed." }
    if ([string]$slot.errorClass -ne "network") { throw "Offline task was not classified as a network failure." }
    $groupAttempts = @(Get-UpstreamSubmitAttempts | Where-Object { [string]$_.groupId -eq [string]$group.groupId })
    if ($groupAttempts.Count -ne 1) { throw "Offline task did not keep the strict one-attempt contract." }
    Start-Sleep -Seconds 30
    $delayedAttempts = @(Get-UpstreamSubmitAttempts | Where-Object { [string]$_.groupId -eq [string]$group.groupId })
    $postRestoreAttempts = @(Get-NewAttempts -Before $groupAttempts -After $delayedAttempts)
    $delayedNative = Get-NativeRegistrySummary
    $delayedGroup = @($delayedNative.groups | Where-Object { [string]$_.groupId -eq [string]$group.groupId })[0]
    $delayedSlot = if ($delayedGroup) { @($delayedGroup.slots)[0] } else { $null }
    $diagnosticDelta = (Get-UpstreamRequestDiagnosticCount) - $requestDiagnosticsBeforeRestore
    if ($delayedAttempts.Count -ne 1 -or -not $delayedSlot -or [string]$delayedSlot.status -ne "failed" -or
        $diagnosticDelta -ne 0) {
        throw "Offline task changed or retried after network restoration."
    }
    $Report.metrics.observationPostDelta = $postRestoreAttempts.Count
    $allNewAttempts = @(Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    if ($allNewAttempts.Count -ne 1 -or @($registryDelta.groupIds).Count -ne 1 -or @($registryDelta.taskIds).Count -ne 1) {
        throw "Offline scenario did not produce exactly one group, one task and one submit attempt."
    }
    $history = Read-HistorySourceLabel
    if (
        [string]$history.newestSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotStatus -ne "failed"
    ) { throw "Offline history source label is incorrect." }
    $afterState = Get-BrowserState
    $expectedNextCursor = ($expectedSlot % 10) + 1
    if ([int]$afterState.cursor -ne $expectedNextCursor) { throw "Offline submit did not advance the pool cursor exactly once." }

    $Report.metrics.groups = 1
    $Report.metrics.tasks = 1
    $Report.metrics.upstreamPosts = 1
    $Report.cursorAfter = [int]$afterState.cursor
    $Report.results += [ordered]@{
        sequence = 1
        workspaceId = [string]$created.workspaceId
        clickedAt = [long]$created.clickedAt
        createdAt = [long]$created.createdAt
        expectedSlot = $expectedSlot
        expectedLabel = $expectedLabel
        expectedHistoryLabel = $expectedHistoryLabel
        groupId = $group.groupId
        jobId = @($group.slots)[0].jobId
        clientSubmissionId = $group.clientSubmissionId
        requestRunId = $group.requestRunId
        status = $slot.status
        groupCount = 1
        taskCount = 1
        postCount = 1
        historyLabel = $history.newestSourceLabel
        historySlotLabel = $history.newestSlotSourceLabel
        historySlotStatus = $history.newestSlotStatus
        failureClass = $slot.errorClass
    }
    return $allNewAttempts
}

function Invoke-HomeScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialSnapshot,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Assert-NotificationPermissionGranted
    $expectedSlot = [int]$InitialState.cursor
    $expectedLabel = "FHL$expectedSlot"
    $expectedHistoryLabel = Get-ExpectedHistorySourceLabel -PoolSlot $expectedSlot
    $Report.expectedSlots = @($expectedSlot)
    Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Home preflight"
    $readiness = Set-PromptAndReadiness
    Assert-SubmitReadiness -Readiness $readiness -Context "Home"
    $clickState = Get-BrowserState
    Assert-OfficialFHLImagesHomeSource -BrowserState $clickState -Context "Home click-time"
    if ([string]$clickState.workspaceId -ne $ResolvedWorkspaceId -or [int]$clickState.cursor -ne $expectedSlot) {
        throw "Home click-time browser state changed after readiness."
    }
    $pidBeforeHome = Get-AppProcessId
    if ([string]::IsNullOrWhiteSpace($pidBeforeHome)) { throw "Home source process was not running before submission." }
    $foregroundBefore = Get-CompletionNotificationFingerprint -NotificationId 207550870
    if ($foregroundBefore.exists) { throw "A foreground generation notification already existed before the Home scenario." }
    $serviceBefore = Get-AndroidJobServiceState
    if ($serviceBefore.exists) { throw "AndroidJobService was already active before the Home scenario." }

    $freshRegistry = Get-NativeRegistrySummary
    Assert-RegistryDeltaMatches -Before $InitialRegistry -After $freshRegistry -ExpectedGroupIds @() -ExpectedTaskIds @() -Context "Home pre-click" | Out-Null
    if ([int]$freshRegistry.pendingCount -ne 0) { throw "Home pre-click registry was not idle." }
    $click = Click-GenerateOnce
    $Report.metrics.clicks = 1
    $created = Wait-NewNativeGroup `
        -BeforeRegistry $freshRegistry `
        -ClickedAt ([long]$click.clickedAt) `
        -ExpectedWorkspaceId $ResolvedWorkspaceId
    $group = $created.group
    $Report.workspaceId = [string]$created.workspaceId
    Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
    $jobId = [string](@($group.slots)[0].jobId)
    $expectedNotificationId = Get-ExpectedCompletionNotificationId -JobId $jobId
    $notificationBefore = Get-CompletionNotificationFingerprint -NotificationId $expectedNotificationId
    $attempt = Wait-OneUpstreamAttempt -GroupId $group.groupId
    Assert-AttemptMatchesGroup -Attempt $attempt -Group $group -ExpectedSlot $expectedSlot -ClickedAt ([long]$created.clickedAt) -Context "Home"
    $preHomeTask = Get-NativeTaskState -GroupId $group.groupId -JobId $jobId
    if ($terminalStatuses -contains [string]$preHomeTask.slot.status) {
        throw "Home task reached terminal state before the Activity was backgrounded."
    }
    Send-Home
    $pidAfterHome = Get-AppProcessId
    if ([string]::IsNullOrWhiteSpace($pidAfterHome) -or $pidAfterHome -ne $pidBeforeHome) {
        throw "The App process did not remain stable after KEYCODE_HOME."
    }
    $taskAfterHome = Get-NativeTaskState -GroupId $group.groupId -JobId $jobId
    if ($terminalStatuses -contains [string]$taskAfterHome.slot.status) {
        throw "Home task reached terminal state before background execution was observed."
    }
    $foregroundDeadline = (Get-Date).AddSeconds(10)
    do {
        $serviceAfterHome = Get-AndroidJobServiceState
        $foregroundNotification = Get-CompletionNotificationFingerprint -NotificationId 207550870
        if ($serviceAfterHome.exists -and $serviceAfterHome.foreground -and $serviceAfterHome.notificationIdCorrect -and
            $foregroundNotification.exists -and $foregroundNotification.correctChannel) { break }
        $waitingTask = Get-NativeTaskState -GroupId $group.groupId -JobId $jobId
        if ($terminalStatuses -contains [string]$waitingTask.slot.status) {
            throw "Home task completed before the foreground job service was observed."
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $foregroundDeadline)
    if (-not $serviceAfterHome.exists -or -not $serviceAfterHome.foreground -or -not $serviceAfterHome.notificationIdCorrect -or
        -not $foregroundNotification.exists -or -not $foregroundNotification.correctChannel) {
        throw "The foreground generation service notification was not active after Home."
    }
    $backgroundResult = Wait-NativeTaskTerminalWhileBackgrounded -GroupId $group.groupId -JobId $jobId -ExpectedProcessId $pidBeforeHome
    if ([string]$backgroundResult.status -ne "succeeded") { throw "Home task finished with status $($backgroundResult.status)." }
    Assert-AppActivityBackgrounded

    $notificationAfter = $null
    $notificationDeadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $notificationAfter = Get-CompletionNotificationFingerprint -NotificationId $expectedNotificationId
        $notificationUpdated = $notificationAfter.exists -and $notificationAfter.correctChannel -and
            (-not $notificationBefore.exists -or $notificationAfter.fingerprint -ne $notificationBefore.fingerprint)
    } while (-not $notificationUpdated -and (Get-Date) -lt $notificationDeadline)
    if (-not $notificationUpdated) { throw "Home completion did not produce the exact notification for its job ID." }
    $foregroundDeadline = (Get-Date).AddSeconds(20)
    do {
        $foregroundNotificationAfter = Get-CompletionNotificationFingerprint -NotificationId 207550870
        if (-not $foregroundNotificationAfter.exists) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $foregroundDeadline)
    if ($foregroundNotificationAfter.exists) { throw "The foreground generation notification remained after the queue became idle." }

    Start-AppAndConnect
    $afterSnapshot = Get-RedactedJobSnapshot -ResolvedWorkspaceId ([string]$created.workspaceId)
    $afterGroup = @($afterSnapshot.groups | Where-Object { [string]$_.groupId -eq [string]$group.groupId })[0]
    $afterSlot = if ($afterGroup) { @($afterGroup.slots)[0] } else { $null }
    if (-not $afterSlot -or [string]$afterSlot.status -ne "succeeded") { throw "Home task was not succeeded after returning to the App." }
    $groupAttempts = @(Get-UpstreamSubmitAttempts | Where-Object { [string]$_.groupId -eq [string]$group.groupId })
    if ($groupAttempts.Count -ne 1) { throw "Home task did not keep the strict one-POST contract." }
    $allNewAttempts = @(Get-NewAttempts -Before $InitialAttempts -After (Get-UpstreamSubmitAttempts))
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    if ($allNewAttempts.Count -ne 1 -or @($registryDelta.groupIds).Count -ne 1 -or @($registryDelta.taskIds).Count -ne 1) {
        throw "Home scenario did not produce exactly one group, one task and one POST attempt."
    }
    $history = Read-HistorySourceLabel
    if (
        [string]$history.newestSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotSourceLabel -ne $expectedHistoryLabel -or
        [string]$history.newestSlotStatus -ne "succeeded"
    ) { throw "Home history source label is incorrect." }
    $afterState = Get-BrowserState
    $expectedNextCursor = ($expectedSlot % 10) + 1
    if ([int]$afterState.cursor -ne $expectedNextCursor) { throw "Home submit did not advance the pool cursor exactly once." }

    $Report.metrics.groups = 1
    $Report.metrics.tasks = 1
    $Report.metrics.upstreamPosts = 1
    $Report.cursorAfter = [int]$afterState.cursor
    $Report.results += [ordered]@{
        sequence = 1
        workspaceId = [string]$created.workspaceId
        clickedAt = [long]$created.clickedAt
        createdAt = [long]$created.createdAt
        expectedSlot = $expectedSlot
        expectedLabel = $expectedLabel
        expectedHistoryLabel = $expectedHistoryLabel
        groupId = $group.groupId
        jobId = $jobId
        clientSubmissionId = $group.clientSubmissionId
        requestRunId = $group.requestRunId
        status = $afterSlot.status
        groupCount = 1
        taskCount = 1
        postCount = 1
        historyLabel = $history.newestSourceLabel
        historySlotLabel = $history.newestSlotSourceLabel
        historySlotStatus = $history.newestSlotStatus
        notificationCount = 1
        notificationId = $expectedNotificationId
        processIdBeforeHome = $pidBeforeHome
        processIdAfterHome = $pidAfterHome
        processStayedStable = $true
        foregroundServiceObserved = $true
    }
    return $allNewAttempts
}

function Invoke-ColdStartScenario {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Report,
        [Parameter(Mandatory = $true)][string]$ResolvedWorkspaceId,
        [Parameter(Mandatory = $true)][object]$InitialState,
        [Parameter(Mandatory = $true)][object]$InitialSnapshot,
        [Parameter(Mandatory = $true)][object]$InitialRegistry,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InitialAttempts
    )

    Assert-OfficialFHLImagesHomeSource -BrowserState $InitialState -Context "Cold-start preflight"
    $expectedSlot = [int]$InitialState.cursor
    $expectedLabel = "FHL$expectedSlot"
    $Report.expectedSlots = @($expectedSlot)
    $readiness = Set-PromptAndReadiness
    Assert-SubmitReadiness -Readiness $readiness -Context "Cold-start"
    $clickState = Get-BrowserState
    Assert-OfficialFHLImagesHomeSource -BrowserState $clickState -Context "Cold-start click-time"
    if ([string]$clickState.workspaceId -ne $ResolvedWorkspaceId -or [int]$clickState.cursor -ne $expectedSlot) {
        throw "Cold-start click-time browser state changed after readiness."
    }

    $freshRegistry = Get-NativeRegistrySummary
    Assert-RegistryDeltaMatches -Before $InitialRegistry -After $freshRegistry -ExpectedGroupIds @() -ExpectedTaskIds @() -Context "Cold-start pre-click" | Out-Null
    if ([int]$freshRegistry.pendingCount -ne 0) { throw "Cold-start pre-click registry was not idle." }
    $click = Click-GenerateOnce
    $Report.metrics.clicks = 1
    $created = Wait-NewNativeGroup `
        -BeforeRegistry $freshRegistry `
        -ClickedAt ([long]$click.clickedAt) `
        -ExpectedWorkspaceId $ResolvedWorkspaceId
    $group = $created.group
    $Report.workspaceId = [string]$created.workspaceId
    Assert-GroupContract -Group $group -ExpectedSlot $expectedSlot
    $Report.metrics.groups = 1
    $Report.metrics.tasks = @($group.slots).Count
    $Report.cursorAfter = [int](Get-BrowserState).cursor
    $firstAttempt = Wait-OneUpstreamAttempt -GroupId $group.groupId
    $Report.metrics.upstreamPosts = 1
    Assert-AttemptMatchesGroup -Attempt $firstAttempt -Group $group -ExpectedSlot $expectedSlot -ClickedAt ([long]$created.clickedAt) -Context "Cold-start"
    $pidBeforeStop = Get-AppProcessId
    if ([string]::IsNullOrWhiteSpace($pidBeforeStop)) { throw "Cold-start source process was not running." }
    $responseStarted = Wait-UpstreamResponseStarted -GroupId $group.groupId
    $preStopStatus = [string]$responseStarted.slot.status
    $proofStage = [string]$responseStarted.slot.stage
    $proofBytes = [long]$responseStarted.slot.bytes
    $proofUpdatedAt = [long]$responseStarted.slot.updatedAt
    $attemptsBeforeRestart = @(Get-UpstreamSubmitAttempts)
    $preRestartNewAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $attemptsBeforeRestart)
    if ($preRestartNewAttempts.Count -ne 1 -or [string]$preRestartNewAttempts[0].groupId -ne [string]$group.groupId) {
        throw "Cold-start pre-stop POST delta is not exactly the one explicit task."
    }
    $preRestartRegistryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    if (@($preRestartRegistryDelta.groupIds).Count -ne 1 -or @($preRestartRegistryDelta.taskIds).Count -ne 1) {
        throw "Cold-start pre-stop registry delta is not exactly one group and one task."
    }
    $requestDiagnosticsBeforeRestart = Get-UpstreamRequestDiagnosticCount
    Stop-App
    Wait-AppProcessStopped
    if ($EvidenceSource -eq "DebugRunAs") { Clear-DeviceLogcat }
    Start-AppAndConnect
    $pidAfterRestart = Get-AppProcessId
    if ([string]::IsNullOrWhiteSpace($pidAfterRestart) -or $pidAfterRestart -eq $pidBeforeStop) {
        throw "Cold-start verification did not start a distinct app process."
    }
    Start-Sleep -Seconds $ObservationSeconds
    $afterSnapshot = Get-RedactedJobSnapshot -ResolvedWorkspaceId ([string]$created.workspaceId)
    $afterGroup = @($afterSnapshot.groups | Where-Object { $_.groupId -eq $group.groupId })[0]
    if (-not $afterGroup) { throw "Cold-start task disappeared after process restart." }
    $afterSlot = @($afterGroup.slots)[0]
    if ([string]$afterSlot.status -ne "interrupted") {
        throw "Cold-start task status is $($afterSlot.status), expected interrupted."
    }
    $afterAttempts = @(Get-UpstreamSubmitAttempts)
    $restartAttempts = @(Get-NewAttempts -Before $attemptsBeforeRestart -After $afterAttempts)
    $Report.metrics.observationPostDelta = $restartAttempts.Count
    if ($restartAttempts.Count -ne 0) { throw "Cold start produced $($restartAttempts.Count) unexpected upstream POST attempt(s)." }
    $requestDiagnosticDelta = if ($EvidenceSource -eq "DebugRunAs") {
        Get-UpstreamRequestDiagnosticCount
    }
    else {
        (Get-UpstreamRequestDiagnosticCount) - $requestDiagnosticsBeforeRestart
    }
    if ($requestDiagnosticDelta -ne 0) {
        throw "Cold start emitted a new upstream request diagnostic after restart."
    }
    $groupAttempts = @($afterAttempts | Where-Object { $_.groupId -eq $group.groupId })
    if ($groupAttempts.Count -ne 1) { throw "Cold-start task did not retain exactly one total POST attempt." }
    $allNewAttempts = @(Get-NewAttempts -Before $InitialAttempts -After $afterAttempts)
    $Report.metrics.upstreamPosts = $allNewAttempts.Count
    if ($allNewAttempts.Count -ne 1 -or [string]$allNewAttempts[0].groupId -ne [string]$group.groupId) {
        throw "Cold-start scenario global POST delta is not exactly the one explicit task."
    }
    $registryDelta = Get-RegistryDelta -Before $InitialRegistry -After (Get-NativeRegistrySummary)
    $Report.metrics.groups = @($registryDelta.groupIds).Count
    $Report.metrics.tasks = @($registryDelta.taskIds).Count
    if ($Report.metrics.groups -ne 1 -or $Report.metrics.tasks -ne 1 -or
        @($registryDelta.groupIds)[0] -ne $group.groupId -or @($registryDelta.taskIds)[0] -ne @($group.slots)[0].jobId) {
        throw "Cold-start scenario global registry delta is not exactly the one explicit group and task."
    }

    $Report.results += [ordered]@{
        sequence = 1
        workspaceId = [string]$created.workspaceId
        clickedAt = [long]$created.clickedAt
        createdAt = [long]$created.createdAt
        expectedSlot = $expectedSlot
        expectedLabel = $expectedLabel
        groupId = $group.groupId
        jobId = @($group.slots)[0].jobId
        clientSubmissionId = $group.clientSubmissionId
        requestRunId = $group.requestRunId
        status = $afterSlot.status
        groupCount = 1
        taskCount = 1
        postCount = 1
        historyLabel = "not-applicable"
        responseProofStage = $proofStage
        responseProofBytes = $proofBytes
        responseProofUpdatedAt = $proofUpdatedAt
        processChanged = $true
    }
    $afterState = Get-BrowserState
    $expectedNextCursor = ($expectedSlot % 10) + 1
    if ([int]$afterState.cursor -ne $expectedNextCursor) { throw "Cold-start submit did not advance the pool cursor exactly once." }
    $Report.cursorAfter = [int]$afterState.cursor
    return $allNewAttempts
}

if ($RunInternalLoadAuditSelfTest) {
    Invoke-InternalLoadAuditSelfTest
    if (Test-Path -LiteralPath $ApkPath -PathType Leaf) {
        $selfTestHash = ($ExpectedApkSha256 -replace "\s", "").ToUpperInvariant()
        $actualSelfTestHash = (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($selfTestHash -notmatch "^[0-9A-F]{64}$" -or $actualSelfTestHash -ne $selfTestHash) {
            throw "Internal APK binding self-test found an APK SHA-256 mismatch."
        }
        $selfTestIdentity = Get-ApkBuildIdentity -Path $ApkPath -GitCommit $ExpectedGitCommit
        Write-Output "Android APK commit binding self-test: PASS ($($selfTestIdentity.buildId))"
    }
    exit 0
}
if ($RunInternalResponsesCapabilityAuditSelfTest) {
    Invoke-InternalResponsesCapabilityAuditSelfTest
    if (Test-Path -LiteralPath $ApkPath -PathType Leaf) {
        $selfTestHash = ($ExpectedApkSha256 -replace "\s", "").ToUpperInvariant()
        $actualSelfTestHash = (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($selfTestHash -notmatch "^[0-9A-F]{64}$" -or $actualSelfTestHash -ne $selfTestHash) {
            throw "Responses capability internal self-test found an APK SHA-256 mismatch."
        }
    }
    exit 0
}
if ($FinalizeExistingSequential -and $ResumeExistingSequential) {
    throw "FinalizeExistingSequential and ResumeExistingSequential are mutually exclusive."
}
if ($EvidenceSource -eq "ReleaseLogcat" -and ($FinalizeExistingSequential -or $ResumeExistingSequential -or $ResumeAuditOnly)) {
    throw "ReleaseLogcat does not support Debug run-as checkpoint recovery; no fallback is permitted."
}
if ($ResumeAuditOnly -and -not $ResumeExistingSequential) {
    throw "ResumeAuditOnly requires ResumeExistingSequential."
}
if ($ExpectedFHLTransportMode -eq "responses" -and ($FinalizeExistingSequential -or $ResumeExistingSequential)) {
    throw "Responses transport evidence cannot reuse the legacy Images-only Sequential recovery path."
}
if ($FinalizeExistingSequential) {
    Complete-ExistingSequentialEvidence
    exit 0
}
if ($ResumeExistingSequential) {
    Resume-RunningSequentialEvidence
    exit 0
}

$report = [ordered]@{
    schemaVersion = 2
    scenario = $Scenario
    acceptanceRole = $AcceptanceRole
    evidenceSource = $EvidenceSource
    status = "running"
    startedAt = (Get-Date).ToString("o")
    finishedAt = $null
    apkFile = [IO.Path]::GetFileName($ApkPath)
    apkSha256 = ""
    installedApkSha256 = ""
    baselineApkSha256 = ""
    candidateGitCommit = ""
    productGitCommit = ""
    verifierGitCommit = ""
    verifierScriptSha256 = ""
    apkServiceIdentity = ""
    apkBuildId = ""
    apkCertificateSha256 = ""
    apkDebuggable = $null
    apkSignatureV2 = $null
    apkMetadata = $null
    device = $Device
    deviceMetadata = $null
    runtimeMetrics = $null
    stabilityFinalRun = [bool]$StabilityFinalRun
    stabilityCooldownSeconds = 0
    package = $Package
    workspaceId = ""
    storageNamespace = ""
    cursorBefore = $null
    cursorAfter = $null
    expectedSlots = @()
    expectedFHLTransportMode = $ExpectedFHLTransportMode
    sequentialMinimumIntervalMilliseconds = $sequentialMinimumIntervalMilliseconds
    compatibilityOnly = ($Scenario -in @("MatrixSingle", "CompatibilitySingle", "CompatibilityWorkflow"))
    formalTenSlotGate = if ($Scenario -in @("FreshInstall", "MatrixStartup", "MatrixSingle", "CompatibilitySingle", "CompatibilityWorkflow")) { "not_evaluated" } else { "required" }
    configuredEnabledSlots = @()
    browserState = $null
    geometry = $null
    observationSeconds = if ($Scenario -in @("FreshInstall", "Upgrade", "TransportPersistence", "TransportToResponses", "Preflight", "Startup", "MatrixStartup", "MatrixSingle", "Offline", "ColdStart", "CompatibilitySingle")) { $ObservationSeconds } else { 0 }
    promptLength = $PromptText.Length
    credentialInputsChecked = 0
    bootstrapReadySamples = 0
    bootstrapSubmitKind = ""
    metrics = [ordered]@{
        clicks = 0
        groups = 0
        tasks = 0
        upstreamPosts = 0
        imageGenerationPostCount = 0
        capabilityTextPostCount = 0
        capabilityTextPostCountLowerBound = 0
        capabilityTextPostCountUpperBound = 0
        capabilityTextPostCountExact = $true
        observationPostDelta = $null
    }
    results = @()
    workflow = $null
    scheduler = $null
    artifacts = [ordered]@{
        screenshot = ""
        redactedLogcat = ""
        nativeSchedulerAudit = ""
        hostQueueSamples = ""
        schedulerMetrics = ""
        loadCheckpoint = ""
        releaseLogcat = ""
        evidenceManifest = ""
        deviceRuntimeMetrics = ""
        crashAnrLogcat = ""
    }
    failure = $null
}

$evidenceAttempts = @()
try {
    if ($ObservationSeconds -lt 30) { throw "ObservationSeconds must be at least 30." }
    if ($TerminalTimeoutSeconds -lt 30) { throw "TerminalTimeoutSeconds must be at least 30." }
    if ($ExpectedFHLTransportMode -eq "responses" -and $Scenario -notin @("TransportPersistence", "Single", "Sequential", "ResponsesCapability")) {
        throw "Responses transport evidence is currently supported only by TransportPersistence, Single, Sequential, and ResponsesCapability; no image-generation click was attempted."
    }
    if ($Scenario -eq "MatrixSingle" -and $EvidenceSource -ne "DebugRunAs") {
        throw "MatrixSingle is a DebugRunAs-only emulator compatibility scenario and cannot submit through ReleaseLogcat."
    }
    if ($Scenario -in @("Single", "Sequential", "Pool40", "Queue60", "MatrixSingle", "Offline", "Home", "ColdStart", "CompatibilitySingle") -and $PromptText.Trim().Length -lt 4) {
        throw "Prompt content must contain at least four characters for a submitting scenario."
    }
    if ($StabilityFinalRun -and $AcceptanceRole -ne "api36Stability") {
        throw "StabilityFinalRun is only valid for the api36Stability acceptance role."
    }
    $normalizedGitCommit = $ExpectedGitCommit.Trim().ToLowerInvariant()
    if ($EvidenceSource -eq "ReleaseLogcat") {
        if ($Package -ne "top.fangtangyuan.fhlstudio.android") {
            throw "ReleaseLogcat requires the formal package top.fangtangyuan.fhlstudio.android."
        }
        if ($normalizedGitCommit -notmatch "^[0-9a-f]{40}$") {
            throw "ReleaseLogcat requires the complete 40-character product commit."
        }
        $roleScenarioMap = [ordered]@{
            singleClick = "Single"
            tenSlotRoundRobin = "Sequential"
            pool40 = "Pool40"
            queue60 = "Queue60"
            homeBackground = "Home"
            coldStartInterrupt = "ColdStart"
            api36Stability = "Sequential"
            api28 = "Single"
            api34Phone = "Single"
            api34Tablet = "Single"
            api36 = "Single"
            offlineFailureAttribution = "Offline"
        }
        if ($Scenario -in @("Single", "Sequential", "Pool40", "Queue60", "Offline", "Home", "ColdStart")) {
            if ([string]::IsNullOrWhiteSpace($AcceptanceRole) -or [string]$roleScenarioMap[$AcceptanceRole] -ne $Scenario) {
                throw "ReleaseLogcat submitting scenarios require an AcceptanceRole matching the scenario."
            }
        }
    }
    $verifierCommitCheck = Invoke-NativeProcessCapture `
        -FileName "git" `
        -Arguments @("-C", $repoRoot, "rev-parse", "HEAD") `
        -TimeoutSeconds 30
    $verifierGitCommit = ([string]$verifierCommitCheck.stdout).Trim().ToLowerInvariant()
    if ([int]$verifierCommitCheck.exitCode -ne 0 -or $verifierGitCommit -notmatch "^[0-9a-f]{40}$") {
        throw "Verifier Git commit could not be resolved."
    }
    $report.verifierGitCommit = $verifierGitCommit
    $report.verifierScriptSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($EvidenceSource -eq "ReleaseLogcat" -and $verifierGitCommit -ne $normalizedGitCommit) {
        throw "ReleaseLogcat requires the verifier HEAD to match the frozen product commit."
    }
    if ($Scenario -in @("Pool40", "Queue60") -or $EvidenceSource -eq "ReleaseLogcat") {
        if ($normalizedGitCommit -notmatch "^[0-9a-f]{40}$") {
            throw "ExpectedGitCommit must be the complete 40-character candidate commit for formal evidence."
        }
        $commitCheck = Invoke-NativeProcessCapture `
            -FileName "git" `
            -Arguments @("-C", $repoRoot, "rev-parse", "--verify", "$normalizedGitCommit^{commit}") `
            -TimeoutSeconds 30
        $resolvedGitCommit = ([string]$commitCheck.stdout).Trim().ToLowerInvariant()
        if ([int]$commitCheck.exitCode -ne 0 -or $resolvedGitCommit -ne $normalizedGitCommit) {
            throw "ExpectedGitCommit is not an available full candidate commit in this repository."
        }
        $worktreeVerifierDiff = Invoke-NativeProcessCapture `
            -FileName "git" `
            -Arguments @("-C", $repoRoot, "diff", "--quiet", "--", "scripts/verify-android-phone-debug-base.ps1") `
            -TimeoutSeconds 30
        $indexVerifierDiff = Invoke-NativeProcessCapture `
            -FileName "git" `
            -Arguments @("-C", $repoRoot, "diff", "--cached", "--quiet", "--", "scripts/verify-android-phone-debug-base.ps1") `
            -TimeoutSeconds 30
        if ([int]$worktreeVerifierDiff.exitCode -ne 0 -or [int]$indexVerifierDiff.exitCode -ne 0) {
            throw "Formal verification requires the exact committed verifier script; commit or restore it before execution."
        }
        $report.candidateGitCommit = $normalizedGitCommit
        $report.productGitCommit = $normalizedGitCommit
    }
    elseif (-not [string]::IsNullOrWhiteSpace($normalizedGitCommit)) {
        if ($normalizedGitCommit -notmatch "^[0-9a-f]{40}$") { throw "ExpectedGitCommit must be a complete 40-character commit." }
        $report.candidateGitCommit = $normalizedGitCommit
        $report.productGitCommit = $normalizedGitCommit
    }
    if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) { throw "APK was not found: $ApkPath" }
    $resolvedApkPath = (Resolve-Path -LiteralPath $ApkPath).Path
    $expectedHash = ($ExpectedApkSha256 -replace "\s", "").ToUpperInvariant()
    if ($expectedHash -notmatch "^[0-9A-F]{64}$") { throw "ExpectedApkSha256 must be a complete SHA-256 value." }
    $actualHash = (Get-FileHash -LiteralPath $resolvedApkPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) { throw "APK SHA-256 mismatch; candidate execution was blocked." }
    $ApkPath = $resolvedApkPath
    $report.apkFile = [IO.Path]::GetFileName($resolvedApkPath)
    $report.apkSha256 = $actualHash
    if (-not [string]::IsNullOrWhiteSpace($normalizedGitCommit)) {
        $apkBuildIdentity = Get-ApkBuildIdentity -Path $resolvedApkPath -GitCommit $normalizedGitCommit
        $report.apkServiceIdentity = [string]$apkBuildIdentity.serviceIdentity
        $report.apkBuildId = [string]$apkBuildIdentity.buildId
    }

    $script:AdbExecutable = Resolve-AdbExecutable
    if ($EvidenceSource -eq "ReleaseLogcat") {
        $releaseMetadata = Get-ReleaseApkEvidenceMetadata -Path $resolvedApkPath
        if (
            [string]$releaseMetadata.applicationId -ne "top.fangtangyuan.fhlstudio.android" -or
            [string]$releaseMetadata.versionName -ne "V2.0.3" -or
            [string]$releaseMetadata.versionCode -ne "1050003" -or
            [string]$releaseMetadata.minSdk -ne "28" -or
            [string]$releaseMetadata.targetSdk -ne "34" -or
            [string]$releaseMetadata.debuggable -ne "false"
        ) {
            throw "ReleaseLogcat rejected APK metadata or debuggable state."
        }
        if ([string]$releaseMetadata.certificateSha256 -ne $officialReleaseCertificateSha256) {
            throw "ReleaseLogcat rejected the APK signing certificate."
        }
        $script:ResolvedApkCertificateSha256 = [string]$releaseMetadata.certificateSha256
        $script:ResolvedApkDebuggable = $false
        $report.apkCertificateSha256 = [string]$releaseMetadata.certificateSha256
        $report.apkDebuggable = $false
        $report.apkSignatureV2 = [bool]$releaseMetadata.signatureV2
        $report.apkMetadata = [ordered]@{
            applicationId = [string]$releaseMetadata.applicationId
            versionName = [string]$releaseMetadata.versionName
            versionCode = [string]$releaseMetadata.versionCode
            minSdk = [string]$releaseMetadata.minSdk
            targetSdk = [string]$releaseMetadata.targetSdk
        }
    }
    if (-not (Test-DeviceConnected)) { throw "Android device is not connected: $Device" }
    $report.deviceMetadata = Get-DeviceEvidenceMetadata
    if ($Scenario -eq "FreshInstall") {
        if ($SkipInstall) { throw "FreshInstall requires a new install and does not allow SkipInstall." }
        if (Test-PackageInstalled) {
            throw "FreshInstall requires the package to be absent before verification."
        }
    }
    if ($Scenario -eq "Upgrade") {
        if ($SkipInstall) { throw "Upgrade requires adb install -r and does not allow SkipInstall." }
        $baselineHash = ($ExpectedBaselineApkSha256 -replace "\s", "").ToUpperInvariant()
        $script:UpgradeBeforeSnapshot = Initialize-UpgradeBaseline -ExpectedBaselineHash $baselineHash
        $report.baselineApkSha256 = [string]$script:UpgradeBeforeSnapshot.installedApkSha256
    }
    Install-CandidateApk
    if (-not (Test-PackageInstalled)) { throw "Expected package is not installed: $Package" }
    if ($Scenario -eq "FreshInstall") { Grant-NotificationPermissionForVerification }
    if ($EvidenceSource -eq "DebugRunAs") { Assert-RunAsAvailable }
    $installedHash = Get-InstalledApkSha256
    if ($installedHash -ne $actualHash) { throw "Installed base APK does not match the verified candidate SHA-256." }
    $report.installedApkSha256 = $installedHash
    if ($EvidenceSource -eq "DebugRunAs") {
        $pendingBeforeLaunch = Get-PendingRegistryCount
        if ($pendingBeforeLaunch -ne 0) {
            throw "Refusing to start $Scenario verification with $pendingBeforeLaunch queued or running task(s)."
        }
    }
    if ($EvidenceSource -eq "ReleaseLogcat") {
        Stop-App
        Wait-AppProcessStopped
        $script:ReleaseLogcatProcessIds.Clear()
    }
    elseif ($Scenario -in @("FreshInstall", "Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "Preflight", "Startup", "MatrixStartup", "MatrixSingle", "CompatibilitySingle", "CompatibilityWorkflow")) {
        Stop-App
    }
    if ($EvidenceSource -eq "DebugRunAs" -and $Scenario -in @("TransportPersistence", "TransportToResponses", "ResponsesCapability")) { Clear-DeviceLogcat }
    if ($EvidenceSource -eq "ReleaseLogcat") { Clear-DeviceLogcat }
    $registryBeforeLaunch = if ($EvidenceSource -eq "DebugRunAs") {
        Get-NativeRegistrySummary
    }
    else {
        [pscustomobject]@{ groups = @(); groupIds = @(); taskIds = @(); pendingCount = 0 }
    }
    $attemptsBeforeLaunch = if ($EvidenceSource -eq "DebugRunAs") {
        @(Get-UpstreamSubmitAttempts)
    }
    else {
        @()
    }
    if ($Scenario -in @("FreshInstall", "Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "Preflight", "Startup", "MatrixStartup", "MatrixSingle", "CompatibilitySingle", "CompatibilityWorkflow")) {
        $script:BaselineRegistry = $registryBeforeLaunch
        $script:BaselineAttempts = @($attemptsBeforeLaunch)
        $script:MeasurementBaselineReady = $true
    }
    Start-AppAndConnect

    $bootstrapUI = if ($Scenario -eq "FreshInstall") {
        Wait-AndroidFreshInstallReady
    }
    elseif ($Scenario -in @("MatrixStartup", "MatrixSingle")) {
        Wait-AndroidMatrixStartupReady
    }
    else {
        Wait-AndroidBootstrapReady
    }
    if ($EvidenceSource -eq "ReleaseLogcat" -and -not [string]::IsNullOrWhiteSpace($AcceptanceRole)) {
        Invoke-AdbText -Arguments @("-s", $Device, "shell", "dumpsys", "gfxinfo", $Package, "reset") | Out-Null
        $script:RuntimeMetricsBefore = Get-DeviceRuntimeSnapshot
    }
    $report.bootstrapReadySamples = [int]$bootstrapUI.stableSamples
    $report.bootstrapSubmitKind = if ($Scenario -in @("FreshInstall", "MatrixStartup", "MatrixSingle")) { [string]$bootstrapUI.readyKind } else { [string]$bootstrapUI.submitKind }
    $initialState = if ($Scenario -eq "FreshInstall") {
        Get-FreshInstallState
    }
    elseif ($Scenario -in @("MatrixStartup", "MatrixSingle")) {
        Get-MatrixStartupState
    }
    else {
        Get-BrowserState
    }
    $report.browserState = [ordered]@{
        locationHost = [string]$initialState.locationHost
        storageNamespace = [string]$initialState.storageNamespace
        candidateNamespaceCount = [int]$initialState.candidateNamespaceCount
        topScoreTieCount = [int]$initialState.topScoreTieCount
        workspacePresent = -not [string]::IsNullOrWhiteSpace([string]$initialState.workspaceId)
        cursor = [int]$initialState.cursor
        cursorStored = [bool]$initialState.cursorStored
        continuousGenerateTest = $initialState.continuousGenerateTest -eq $true
        poolSlots = @(
            $initialState.poolSlots | ForEach-Object {
                [ordered]@{
                    slot = [int]$_.slot
                    enabled = [bool]$_.enabled
                    hasKeyHint = [bool]$_.hasKeyHint
                }
            }
        )
        transportMode = [string]$initialState.transportMode
        transportPreference = [string]$initialState.transportPreference
        activeProfile = if ($null -ne $initialState.activeProfile) {
            [ordered]@{
                apiMode = [string]$initialState.activeProfile.apiMode
                official = [bool]$initialState.activeProfile.official
                poolSlot = [int]$initialState.activeProfile.poolSlot
            }
        } else { $null }
        credentialInputCount = [int]$initialState.credentialInputCount
        filledCredentialInputCount = [int]$initialState.filledCredentialInputCount
    }
    if ($Scenario -eq "FreshInstall") {
        $report.browserState["freshInstall"] = [ordered]@{
            profileKeyCount = [int]$initialState.profileKeyCount
            activeProfileKeyCount = [int]$initialState.activeProfileKeyCount
            sessionKeyCount = [int]$initialState.sessionKeyCount
            transportPreferenceKeyCount = [int]$initialState.transportPreferenceKeyCount
            cursorKeyCount = [int]$initialState.cursorKeyCount
        }
    }
    $report.storageNamespace = [string]$initialState.storageNamespace
    $report.cursorBefore = [int]$initialState.cursor
    $report.cursorAfter = [int]$initialState.cursor
    $report.configuredEnabledSlots = @(
        $initialState.poolSlots |
            Where-Object { $_.enabled -and $_.hasKeyHint } |
            ForEach-Object { [int]$_.slot } |
            Sort-Object -Unique
    )
    if ($Scenario -eq "FreshInstall") {
        Assert-FreshInstallState -BrowserState $initialState
    }
    elseif ($Scenario -eq "MatrixStartup") {
        $report.configuredEnabledSlots = @(Assert-MatrixStartupState -BrowserState $initialState -BootstrapState $bootstrapUI -Context "MatrixStartup preflight")
    }
    elseif ($Scenario -eq "MatrixSingle") {
        $report.configuredEnabledSlots = @(Assert-MatrixSingleConfiguredSlot -BrowserState $initialState -BootstrapState $bootstrapUI -Context "MatrixSingle preflight")
    }
    elseif ($Scenario -eq "CompatibilityWorkflow") {
        if ([string]$initialState.locationHost -ne "appassets.androidplatform.net") {
            throw "CompatibilityWorkflow is not running from the packaged Android appassets host."
        }
        if ([int]$initialState.filledCredentialInputCount -ne 0) {
            throw "CompatibilityWorkflow found a visible plaintext credential input."
        }
    }
    elseif ($Scenario -eq "CompatibilitySingle") {
        $report.configuredEnabledSlots = @(Assert-CompatibilitySingleConfiguredSlot -BrowserState $initialState)
    }
    else {
        Assert-TenConfiguredSlots -BrowserState $initialState
    }
    if ($Scenario -in @("Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "Startup")) {
        $credentialUI = Assert-TenCredentialInputsEmpty
        $report.credentialInputsChecked = [int]$credentialUI.checked
    }
    $uiWorkspaceId = [string]$initialState.workspaceId
    if ([string]::IsNullOrWhiteSpace($uiWorkspaceId)) { throw "Active UI workspace could not be resolved from localStorage." }
    if (-not [string]::IsNullOrWhiteSpace($WorkspaceId) -and $WorkspaceId.Trim() -ne $uiWorkspaceId) {
        throw "WorkspaceId does not match the active UI workspace; submission was blocked before clicking."
    }
    $resolvedWorkspaceId = $uiWorkspaceId
    $script:ResolvedWorkspaceId = $resolvedWorkspaceId
    $report.workspaceId = $resolvedWorkspaceId
    if ($EvidenceSource -eq "ReleaseLogcat") {
        $registryBeforeLaunch = Get-NativeRegistrySummary
        if ([int]$registryBeforeLaunch.pendingCount -ne 0) {
            throw "ReleaseLogcat Bridge found queued or running tasks before the scenario."
        }
        $startupAuditEvents = @(Get-RedactedNativeAuditEvents)
        $unexpectedStartupEvents = @($startupAuditEvents | Where-Object { [string]$_.type -ne "process_started" })
        if (@($startupAuditEvents | Where-Object { [string]$_.type -eq "process_started" }).Count -ne 1) {
            throw "ReleaseLogcat did not capture exactly one authenticated process_started sentinel."
        }
        if ($unexpectedStartupEvents.Count -ne 0) {
            throw "ReleaseLogcat detected native job activity during startup."
        }
    }
    if ($Scenario -eq "FreshInstall") {
        $report.expectedSlots = @()
    }
    elseif ($Scenario -in @("Upgrade", "TransportPersistence", "TransportToResponses", "ResponsesCapability", "MatrixStartup")) {
        $report.expectedSlots = @()
    }
    elseif ($Scenario -eq "MatrixSingle") {
        $report.expectedSlots = @([int]$report.configuredEnabledSlots[0])
    }
    elseif ($Scenario -eq "CompatibilityWorkflow") {
        $report.expectedSlots = @()
    }
    elseif ($Scenario -eq "CompatibilitySingle") {
        $report.expectedSlots = @(1)
    }
    elseif ($Scenario -eq "Single") {
        $report.expectedSlots = @([int]$initialState.cursor)
    }
    else {
        $report.expectedSlots = @(for ($offset = 0; $offset -lt 10; $offset += 1) { (([int]$initialState.cursor - 1 + $offset) % 10) + 1 })
    }
    $initialSnapshot = Get-RedactedJobSnapshot -ResolvedWorkspaceId $resolvedWorkspaceId
    Assert-NoPendingSlots -Snapshot $initialSnapshot
    $globalPendingAfterLaunch = Get-PendingRegistryCount
    if ($globalPendingAfterLaunch -ne 0) { throw "Global native queue is not idle after candidate launch." }
    $initialRegistry = $registryBeforeLaunch
    $initialAttempts = @($attemptsBeforeLaunch)
    $script:BaselineRegistry = $initialRegistry
    $script:BaselineAttempts = @($initialAttempts)
    $script:MeasurementBaselineReady = $true

    switch ($Scenario) {
        "FreshInstall" {
            $evidenceAttempts = @(Invoke-FreshInstallScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "Upgrade" {
            $evidenceAttempts = @(Invoke-UpgradeScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "TransportPersistence" {
            $evidenceAttempts = @(Invoke-TransportPersistenceScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "TransportToResponses" {
            $evidenceAttempts = @(Invoke-TransportToResponsesScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "ResponsesCapability" {
            $evidenceAttempts = @(Invoke-ResponsesCapabilityScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "Preflight" {
            $evidenceAttempts = @(Invoke-PreflightScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "Single" {
            $evidenceAttempts = @(Invoke-SingleScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "CompatibilitySingle" {
            $evidenceAttempts = @(Invoke-CompatibilitySingleScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialSnapshot $initialSnapshot -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "CompatibilityWorkflow" {
            $evidenceAttempts = @(Invoke-CompatibilityWorkflowScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "Sequential" {
            $evidenceAttempts = @(Invoke-SequentialScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialSnapshot $initialSnapshot -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "Pool40" {
            $evidenceAttempts = @(Invoke-PoolLoadScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry)
        }
        "Queue60" {
            $evidenceAttempts = @(Invoke-PoolLoadScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry)
        }
        "Startup" {
            $evidenceAttempts = @(Invoke-StartupScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "MatrixStartup" {
            $evidenceAttempts = @(Invoke-MatrixStartupScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialBootstrap $bootstrapUI -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "MatrixSingle" {
            $evidenceAttempts = @(Invoke-MatrixSingleScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialBootstrap $bootstrapUI -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "Offline" {
            $evidenceAttempts = @(Invoke-OfflineScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialSnapshot $initialSnapshot -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "Home" {
            $evidenceAttempts = @(Invoke-HomeScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialSnapshot $initialSnapshot -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
        "ColdStart" {
            $evidenceAttempts = @(Invoke-ColdStartScenario -Report $report -ResolvedWorkspaceId $resolvedWorkspaceId -InitialState $initialState -InitialSnapshot $initialSnapshot -InitialRegistry $initialRegistry -InitialAttempts $initialAttempts)
        }
    }

    if ($StabilityFinalRun) {
        Start-Sleep -Seconds 300
        $report.stabilityCooldownSeconds = 300
    }
    $evidenceAttempts = @(Update-ReportMeasurements -Report $report)
    Save-CompatibilityWorkflowArtifacts -Report $report
    Save-DebugTransportCrashAnrArtifact -Report $report
    Save-DeviceRuntimeArtifacts -Report $report
    if ($Scenario -eq "MatrixSingle") {
        $evidenceAttempts = @(Update-ReportMeasurements -Report $report)
        Assert-MatrixSingleFinalMeasurements -Report $report -Attempts $evidenceAttempts
    }
    $report.status = "passed"
    $report.finishedAt = (Get-Date).ToString("o")
    Write-Evidence -Report $report -Attempts $evidenceAttempts
    Write-Host "Android phone debug base $Scenario verification passed. Evidence: $OutputDirectory"
}
catch {
    $report.status = "failed"
    $report.finishedAt = (Get-Date).ToString("o")
    $safeFailure = ConvertTo-RedactedText $_.Exception.Message
    $report.failure = $safeFailure
    try { $evidenceAttempts = @(Update-ReportMeasurements -Report $report) } catch { }
    try { Save-CompatibilityWorkflowArtifacts -Report $report -AllowFailure } catch { }
    try { Save-DebugTransportCrashAnrArtifact -Report $report -AllowFailure } catch { }
    try { Save-DeviceRuntimeArtifacts -Report $report -AllowFailure } catch { }
    $evidenceWriteFailure = ""
    try { Write-Evidence -Report $report -Attempts $evidenceAttempts } catch {
        $evidenceWriteFailure = ConvertTo-RedactedText $_.Exception.Message
    }
    if (-not [string]::IsNullOrWhiteSpace($evidenceWriteFailure)) {
        throw "$safeFailure Evidence write also failed: $evidenceWriteFailure"
    }
    throw $safeFailure
}
finally {
    if ($script:AirplaneModeChanged -and $script:AdbExecutable) {
        try { Set-AirplaneModeEnabled -Enabled $false | Out-Null } catch { }
    }
    if ($script:ForwardPrepared -and $script:AdbExecutable) {
        try {
            Invoke-AdbText -Arguments @("-s", $Device, "forward", "--remove", "tcp:$CdpPort") -AllowFailure | Out-Null
            if (-not [string]::IsNullOrWhiteSpace($script:PreviousForwardRemote)) {
                Invoke-AdbText -Arguments @("-s", $Device, "forward", "tcp:$CdpPort", $script:PreviousForwardRemote) | Out-Null
            }
        }
        catch { }
    }
}
