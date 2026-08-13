<#
.SYNOPSIS
Creates or verifies the only accepted Android V2.0.3 emulator acceptance aggregate.

.DESCRIPTION
Create consumes a controlled run manifest whose paths are relative to EvidenceRoot. Every run must
contain evidence-manifest.json from verify-android-phone-debug-base.ps1. Verify ignores self-reported
aggregate booleans and recomputes all 216 jobs, bindings, hashes, identities, slots, and raw audit
sequences from those run directories.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Create", "Verify")]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$EvidenceRoot,

    [string]$RunManifest = "",
    [string]$OutputDirectory = "",
    [string]$AggregateReport = "",

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Fa-f]{64}$")]
    [string]$ExpectedApkSha256,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9A-Fa-f]{40}$")]
    [string]$ExpectedGitCommit,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[A-Za-z0-9._-]+$")]
    [string]$ExpectedBuildId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$officialCertificate = "6B04A805E50CF66E37C740AD0336BBDF6445653F93802005967BABF472E8DA36"
$formalPackage = "top.fangtangyuan.fhlstudio.android"
$aggregateFileName = "android-emulator-acceptance.json"
$aggregateManifestFileName = "aggregate-evidence-manifest.json"
$expectedApkHash = $ExpectedApkSha256.ToUpperInvariant()
$expectedCommit = $ExpectedGitCommit.ToLowerInvariant()
$expectedServiceIdentity = "android-V2.0.3-$expectedCommit-$ExpectedBuildId"
$verifierScriptPath = Join-Path $PSScriptRoot "verify-android-phone-debug-base.ps1"
$verifierScriptHash = (Get-FileHash -LiteralPath $verifierScriptPath -Algorithm SHA256).Hash.ToUpperInvariant()
$aggregatorScriptHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToUpperInvariant()
$repoHead = ((& git -C $repoRoot rev-parse HEAD 2>$null) -join "").Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $repoHead -ne $expectedCommit) {
    throw "Acceptance aggregation requires the repository HEAD to match ExpectedGitCommit."
}

$roleSpecs = [ordered]@{
    singleClick = [ordered]@{ scenario = "Single"; totalJobs = 1; jobsPerRun = 1; runs = 1 }
    tenSlotRoundRobin = [ordered]@{ scenario = "Sequential"; totalJobs = 10; jobsPerRun = 10; runs = 1 }
    pool40 = [ordered]@{ scenario = "Pool40"; totalJobs = 40; jobsPerRun = 40; runs = 1 }
    queue60 = [ordered]@{ scenario = "Queue60"; totalJobs = 60; jobsPerRun = 60; runs = 1 }
    homeBackground = [ordered]@{ scenario = "Home"; totalJobs = 10; jobsPerRun = 1; runs = 10 }
    coldStartInterrupt = [ordered]@{ scenario = "ColdStart"; totalJobs = 10; jobsPerRun = 1; runs = 10 }
    api36Stability = [ordered]@{ scenario = "Sequential"; totalJobs = 80; jobsPerRun = 10; runs = 8 }
    api28 = [ordered]@{ scenario = "Single"; totalJobs = 1; jobsPerRun = 1; runs = 1 }
    api34Phone = [ordered]@{ scenario = "Single"; totalJobs = 1; jobsPerRun = 1; runs = 1 }
    api34Tablet = [ordered]@{ scenario = "Single"; totalJobs = 1; jobsPerRun = 1; runs = 1 }
    api36 = [ordered]@{ scenario = "Single"; totalJobs = 1; jobsPerRun = 1; runs = 1 }
    offlineFailureAttribution = [ordered]@{ scenario = "Offline"; totalJobs = 1; jobsPerRun = 1; runs = 1 }
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "JSON file was not found: $Path" }
    try {
        $value = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
        Write-Output $value
    }
    catch { throw "JSON file could not be parsed: $([IO.Path]::GetFileName($Path))" }
}

function Normalize-Hash {
    param([AllowNull()][object]$Value)
    return (([string]$Value) -replace "[:\s]", "").ToUpperInvariant()
}

function Assert-NoSensitiveJson {
    param([Parameter(Mandatory = $true)][object]$Value, [Parameter(Mandatory = $true)][string]$Context)
    $json = ConvertTo-Json -InputObject $Value -Depth 16 -Compress
    if ($json -match "(?i)\bsk-[a-z0-9_-]{12,}\b" -or
        $json -match '(?i)"(?:apiKey|prompt|negativePrompt|apiProfileName|keyHint)"\s*:') {
        throw "$Context contains forbidden credential or prompt data."
    }
}

function Test-PlainFileName {
    param([Parameter(Mandatory = $true)][string]$Value)
    return -not [string]::IsNullOrWhiteSpace($Value) -and
        -not [IO.Path]::IsPathRooted($Value) -and
        [IO.Path]::GetFileName($Value) -eq $Value -and
        $Value -notin @(".", "..")
}

function Resolve-EvidenceDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$RelativeDirectory
    )
    if ([IO.Path]::IsPathRooted($RelativeDirectory) -or [string]::IsNullOrWhiteSpace($RelativeDirectory)) {
        throw "Evidence directory paths must be non-empty and relative."
    }
    $segments = @($RelativeDirectory -split '[\\/]' | Where-Object { $_ })
    if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -in @(".", "..") }).Count -gt 0) {
        throw "Evidence directory paths cannot contain dot segments."
    }
    $rootPath = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\', '/')
    if (((Get-Item -LiteralPath $rootPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "EvidenceRoot cannot be a symbolic link or reparse point."
    }
    $candidate = Join-Path $rootPath ($segments -join [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { throw "Evidence directory was not found: $RelativeDirectory" }
    $resolved = (Resolve-Path -LiteralPath $candidate).Path
    if (-not $resolved.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence directory escaped EvidenceRoot."
    }
    $walk = $rootPath
    foreach ($segment in $segments) {
        $walk = Join-Path $walk $segment
        $item = Get-Item -LiteralPath $walk -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Evidence paths cannot traverse symbolic links or reparse points."
        }
    }
    return $resolved
}

function Assert-FileEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][object]$Entry
    )
    $fileName = [string]$Entry.path
    if (-not (Test-PlainFileName -Value $fileName)) { throw "Evidence manifests may only contain plain file names." }
    $path = Join-Path $Directory $fileName
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Manifest artifact is missing: $fileName" }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Manifest artifacts cannot be reparse points." }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant()
    if ([long]$Entry.sizeBytes -ne [long]$item.Length -or (Normalize-Hash $Entry.sha256) -ne $hash) {
        throw "Manifest artifact size or SHA-256 changed: $fileName"
    }
    return $path
}

function Read-ReleaseAudit {
    param([Parameter(Mandatory = $true)][string]$Path)

    $raw = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($raw)) { throw "ReleaseLogcat evidence is empty." }
    $allowedTypes = @("process_started", "submit", "slot_snapshot", "slot_claimed", "slot_reservation_released", "slot_terminal", "slot_error", "slot_cancelled", "upstream_submit_attempt")
    $lastSequence = @{}
    $pidBySession = @{}
    $events = [Collections.Generic.List[object]]::new()
    $lines = @($raw -split "`r?`n")
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        $line = [string]$lines[$index]
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $match = [Regex]::Match($line, "^\s*\d+(?:\.\d+)?\s+(\d+)\s+\d+\s+[A-Z]\s+FHLImageStudioJobs\s*:\s*Job audit\s+(\{.*\})\s*$")
        if (-not $match.Success) { throw "ReleaseLogcat contains an invalid physical line." }
        $sourcePid = $match.Groups[1].Value
        $jsonText = $match.Groups[2].Value
        if ($jsonText -match "(?i)\bsk-[a-z0-9_-]{12,}\b" -or $jsonText -match '(?i)"(?:apiKey|prompt|negativePrompt|apiProfileName|keyHint)"\s*:') {
            throw "ReleaseLogcat contains forbidden credential or prompt data."
        }
        try { $record = $jsonText | ConvertFrom-Json } catch { throw "ReleaseLogcat contains invalid JSON." }
        $session = [string]$record.processSessionId
        $sequence = [long]$record.auditSequence
        $type = [string]$record.type
        if ([int]$record.version -ne 2 -or [string]$record.processId -ne $sourcePid -or
            $session -notmatch '^android-process-[0-9a-f-]{36}$' -or $allowedTypes -notcontains $type) {
            throw "ReleaseLogcat contains an unsupported or unauthenticated audit record."
        }
        if ($pidBySession.ContainsKey($session) -and [string]$pidBySession[$session] -ne $sourcePid) { throw "Audit session changed PID." }
        $pidBySession[$session] = $sourcePid
        $expectedSequence = if ($lastSequence.ContainsKey($session)) { [long]$lastSequence[$session] + 1L } else { 1L }
        if ($sequence -ne $expectedSequence) { throw "Audit sequence has a gap, duplicate, or truncated prefix." }
        if ($sequence -eq 1L -and $type -ne "process_started") { throw "Audit session lacks a process_started prefix." }
        $lastSequence[$session] = $sequence
        $details = $record.details
        if ($type -eq "process_started") {
            $events.Add([pscustomobject][ordered]@{
                order = $events.Count + 1
                processId = $sourcePid
                processSessionId = $session
                auditSequence = $sequence
                type = $type
                groupId = ""
                jobId = ""
                clientSubmissionId = ""
                requestRunId = ""
                apiMode = ""
                apiLabel = ""
                fhlImagesPoolSlot = 0
                queueSequence = 0L
                status = ""
            })
            continue
        }
        $events.Add([pscustomobject][ordered]@{
            order = $events.Count + 1
            processId = $sourcePid
            processSessionId = $session
            auditSequence = $sequence
            type = $type
            groupId = [string]$details.groupId
            jobId = [string]$details.jobId
            clientSubmissionId = [string]$details.clientSubmissionId
            requestRunId = [string]$details.requestRunId
            apiMode = [string]$details.apiMode
            apiLabel = [string]$details.apiLabel
            fhlImagesPoolSlot = [int]$details.fhlImagesPoolSlot
            queueSequence = [long]$details.queueSequence
            status = [string]$details.status
        })
    }
    foreach ($session in $lastSequence.Keys) {
        if (@($events | Where-Object { $_.processSessionId -eq $session -and $_.type -eq "process_started" }).Count -ne 1) {
            throw "Every audit session must contain exactly one process_started sentinel."
        }
    }
    return @($events)
}

function Assert-DeviceRole {
    param([Parameter(Mandatory = $true)][string]$Role, [Parameter(Mandatory = $true)][object]$Metadata)
    $sdk = [int]$Metadata.sdkInt
    $formFactor = [string]$Metadata.formFactor
    $shortSide = [Math]::Min([int]$Metadata.widthPx, [int]$Metadata.heightPx)
    $longSide = [Math]::Max([int]$Metadata.widthPx, [int]$Metadata.heightPx)
    $density = [int]$Metadata.densityDpi
    switch ($Role) {
        "api28" { if ($sdk -ne 28 -or $formFactor -ne "phone" -or $shortSide -ne 1080 -or $longSide -ne 1920 -or $density -ne 420) { throw "api28 evidence is not the fixed API 28 phone." } }
        "api34Phone" { if ($sdk -ne 34 -or $formFactor -ne "phone" -or $shortSide -ne 1080 -or $longSide -ne 1920 -or $density -ne 420) { throw "api34Phone evidence is not the fixed API 34 phone." } }
        "api34Tablet" { if ($sdk -ne 34 -or $formFactor -ne "tablet" -or $shortSide -ne 1600 -or $longSide -ne 2560 -or $density -ne 320) { throw "api34Tablet evidence is not the fixed API 34 tablet." } }
        default { if ($sdk -lt 36 -or $formFactor -ne "phone" -or $shortSide -ne 1440 -or $longSide -ne 3200 -or $density -ne 560) { throw "$Role evidence is not the fixed API 36 large-screen phone." } }
    }
}

function Read-RunEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$RelativeDirectory,
        [Parameter(Mandatory = $true)][string]$Role
    )

    if (-not $roleSpecs.Contains($Role)) { throw "Unknown acceptance role: $Role" }
    $directory = Resolve-EvidenceDirectory -Root $Root -RelativeDirectory $RelativeDirectory
    $manifestPath = Join-Path $directory "evidence-manifest.json"
    $manifest = Read-JsonFile -Path $manifestPath
    Assert-NoSensitiveJson -Value $manifest -Context "Run evidence manifest"
    if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.terminalStatus -ne "passed" -or
        [string]$manifest.evidenceSource -ne "ReleaseLogcat" -or [string]$manifest.acceptanceRole -ne $Role) {
        throw "Run evidence manifest is not a passed ReleaseLogcat manifest for $Role."
    }
    $entriesByRole = @{}
    $entriesByPath = @{}
    foreach ($entry in @($manifest.files)) {
        $entryRole = [string]$entry.role
        $entryPath = [string]$entry.path
        if ([string]::IsNullOrWhiteSpace($entryRole) -or $entriesByRole.ContainsKey($entryRole) -or $entriesByPath.ContainsKey($entryPath)) {
            throw "Run evidence manifest contains a duplicate role or path."
        }
        $entriesByRole[$entryRole] = $entry
        $entriesByPath[$entryPath] = $entry
        [void](Assert-FileEntry -Directory $directory -Entry $entry)
    }
    $allowedFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($pathName in $entriesByPath.Keys) { [void]$allowedFiles.Add([string]$pathName) }
    [void]$allowedFiles.Add("evidence-manifest.json")
    [void]$allowedFiles.Add("README.md")
    $unexpectedFiles = @(Get-ChildItem -LiteralPath $directory -File -Force | Where-Object { -not $allowedFiles.Contains($_.Name) })
    $unexpectedDirectories = @(Get-ChildItem -LiteralPath $directory -Directory -Force)
    if ($unexpectedFiles.Count -gt 0 -or $unexpectedDirectories.Count -gt 0) {
        throw "Run evidence directory contains an unmanifested file or nested directory."
    }
    foreach ($requiredRole in @("report", "upstreamSubmitAttempts", "releaseLogcat", "deviceRuntimeMetrics", "crashAnrLogcat")) {
        if (-not $entriesByRole.ContainsKey($requiredRole)) { throw "Run manifest is missing $requiredRole." }
    }
    $reportPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.report
    $attemptsPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.upstreamSubmitAttempts
    $logcatPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.releaseLogcat
    $report = Read-JsonFile -Path $reportPath
    $attempts = @(Read-JsonFile -Path $attemptsPath)
    Assert-NoSensitiveJson -Value $report -Context "Run report"
    Assert-NoSensitiveJson -Value $attempts -Context "Run attempts"
    $events = @(Read-ReleaseAudit -Path $logcatPath)
    $spec = $roleSpecs[$Role]
    if ([int]$report.schemaVersion -ne 2 -or [string]$report.status -ne "passed" -or
        [string]$report.scenario -ne [string]$spec.scenario -or [string]$report.acceptanceRole -ne $Role -or
        [string]$report.evidenceSource -ne "ReleaseLogcat") {
        throw "Run report does not match its formal role and scenario."
    }
    $reportHash = Normalize-Hash $report.apkSha256
    if ($reportHash -ne $expectedApkHash -or (Normalize-Hash $report.installedApkSha256) -ne $expectedApkHash -or
        ([string]$report.candidateGitCommit).ToLowerInvariant() -ne $expectedCommit -or
        ([string]$report.productGitCommit).ToLowerInvariant() -ne $expectedCommit -or
        ([string]$report.verifierGitCommit).ToLowerInvariant() -ne $expectedCommit -or
        (Normalize-Hash $report.verifierScriptSha256) -ne $verifierScriptHash -or
        [string]$report.apkBuildId -ne $ExpectedBuildId -or [string]$report.apkServiceIdentity -ne $expectedServiceIdentity -or
        [string]$report.package -ne $formalPackage -or (Normalize-Hash $report.apkCertificateSha256) -ne $officialCertificate -or
        [bool]$report.apkDebuggable -or -not [bool]$report.apkSignatureV2) {
        throw "Run report is not bound to the expected Release APK, commit, verifier, package, or certificate."
    }
    foreach ($bindingName in @("apkSha256", "installedApkSha256", "candidateGitCommit", "productGitCommit", "verifierGitCommit", "verifierScriptSha256", "apkServiceIdentity", "apkBuildId", "package", "apkCertificateSha256", "apkDebuggable", "apkSignatureV2")) {
        $manifestValue = $manifest.binding.PSObject.Properties[$bindingName].Value
        $reportValue = $report.PSObject.Properties[$bindingName].Value
        if ([string]$manifestValue -ne [string]$reportValue) { throw "Run manifest binding differs from its report: $bindingName" }
    }
    if ([string]$report.artifacts.evidenceManifest -ne "evidence-manifest.json") { throw "Run report does not point to its evidence manifest." }
    foreach ($artifact in $report.artifacts.PSObject.Properties) {
        $fileName = [string]$artifact.Value
        if ([string]::IsNullOrWhiteSpace($fileName) -or [string]$artifact.Name -eq "evidenceManifest") { continue }
        if (-not $entriesByRole.ContainsKey([string]$artifact.Name) -or [string]$entriesByRole[[string]$artifact.Name].path -ne $fileName) {
            throw "A report artifact is absent from the run evidence manifest."
        }
    }
    $runtimeMetricsPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.deviceRuntimeMetrics
    $crashLogPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.crashAnrLogcat
    $runtimeMetrics = Read-JsonFile -Path $runtimeMetricsPath
    if ([int]$runtimeMetrics.schemaVersion -ne 1 -or -not [bool]$runtimeMetrics.noCrashOrAnr -or
        [int]$runtimeMetrics.crashOrAnrCount -ne 0 -or (Get-Item -LiteralPath $crashLogPath).Length -ne 0 -or
        [long]$runtimeMetrics.before.totalPssKiB -le 0 -or [long]$runtimeMetrics.after.totalPssKiB -le 0 -or
        [int]$runtimeMetrics.before.thermalStatus -ge 3 -or [int]$runtimeMetrics.after.thermalStatus -ge 3 -or
        [long]$runtimeMetrics.before.frozenFrames -ne 0 -or [long]$runtimeMetrics.after.frozenFrames -ne 0 -or
        [long]$runtimeMetrics.frozenFrameDelta -ne 0) {
        throw "Run runtime evidence contains a crash, ANR, severe thermal state, frozen frame, or invalid PSS sample."
    }
    foreach ($field in @("pssDeltaKiB", "frozenFrameDelta", "crashOrAnrCount", "noCrashOrAnr")) {
        if ([string]$runtimeMetrics.PSObject.Properties[$field].Value -ne [string]$report.runtimeMetrics.PSObject.Properties[$field].Value) {
            throw "Run report runtime metrics differ from device-runtime-metrics.json."
        }
    }
    $expectedJobs = [int]$spec.jobsPerRun
    if ([int]$report.metrics.clicks -ne $expectedJobs -or [int]$report.metrics.groups -ne $expectedJobs -or
        [int]$report.metrics.tasks -ne $expectedJobs -or [int]$report.metrics.upstreamPosts -ne $expectedJobs -or
        @($report.results).Count -ne $expectedJobs -or $attempts.Count -ne $expectedJobs) {
        throw "Run report $Role does not contain the exact role task count: expected=$expectedJobs clicks=$($report.metrics.clicks) groups=$($report.metrics.groups) tasks=$($report.metrics.tasks) posts=$($report.metrics.upstreamPosts) results=$(@($report.results).Count) attempts=$($attempts.Count)."
    }
    Assert-DeviceRole -Role $Role -Metadata $report.deviceMetadata
    if ($Role -eq "api36Stability" -and ([int]$runtimeMetrics.before.thermalStatus -lt 0 -or [int]$runtimeMetrics.after.thermalStatus -lt 0)) {
        throw "API 36 stability evidence is missing thermal status samples."
    }
    $startedAt = [DateTimeOffset]::MinValue
    $finishedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$report.startedAt, [ref]$startedAt) -or
        -not [DateTimeOffset]::TryParse([string]$report.finishedAt, [ref]$finishedAt) -or $finishedAt -le $startedAt) {
        throw "Run report has invalid start or finish timestamps."
    }
    $expectedStatus = if ($Role -eq "coldStartInterrupt") { "interrupted" } elseif ($Role -eq "offlineFailureAttribution") { "failed" } else { "succeeded" }
    $identities = [Collections.Generic.List[object]]::new()
    foreach ($result in @($report.results)) {
        $slot = [int]$result.expectedSlot
        if ($slot -lt 1 -or $slot -gt 10 -or [string]$result.expectedLabel -ne "FHL$slot" -or [string]$result.status -ne $expectedStatus) {
            throw "Run result has an invalid slot, label, or terminal status."
        }
        foreach ($field in @("groupId", "jobId", "clientSubmissionId", "requestRunId")) {
            if ([string]::IsNullOrWhiteSpace([string]$result.PSObject.Properties[$field].Value)) { throw "Run result is missing $field." }
        }
        $attempt = @($attempts | Where-Object { [string]$_.jobId -eq [string]$result.jobId })
        if ($attempt.Count -ne 1 -or [string]$attempt[0].groupId -ne [string]$result.groupId -or
            [string]$attempt[0].clientSubmissionId -ne [string]$result.clientSubmissionId -or
            [string]$attempt[0].requestRunId -ne [string]$result.requestRunId -or
            [int]$attempt[0].fhlImagesPoolSlot -ne $slot -or [string]$attempt[0].apiLabel -ne "FHL$slot") {
            throw "Run POST evidence does not match its result identity."
        }
        $submits = @($events | Where-Object { $_.type -eq "submit" -and $_.groupId -eq [string]$result.groupId })
        $posts = @($events | Where-Object { $_.type -eq "upstream_submit_attempt" -and $_.jobId -eq [string]$result.jobId })
        $terminals = @($events | Where-Object { $_.type -in @("slot_terminal", "slot_error", "slot_cancelled") -and $_.jobId -eq [string]$result.jobId })
        $claims = @($events | Where-Object { $_.type -eq "slot_claimed" -and $_.jobId -eq [string]$result.jobId })
        $releases = @($events | Where-Object { $_.type -eq "slot_reservation_released" -and $_.jobId -eq [string]$result.jobId })
        if ($submits.Count -ne 1 -or $posts.Count -ne 1 -or $terminals.Count -ne 1 -or $claims.Count -ne 1 -or
            ($Role -ne "coldStartInterrupt" -and $releases.Count -ne 1) -or ($Role -eq "coldStartInterrupt" -and $releases.Count -gt 1) -or
            [string]$submits[0].clientSubmissionId -ne [string]$result.clientSubmissionId -or
            [string]$submits[0].requestRunId -ne [string]$result.requestRunId -or
            [int]$submits[0].fhlImagesPoolSlot -ne $slot -or
            [string]$claims[0].groupId -ne [string]$result.groupId -or [int]$claims[0].fhlImagesPoolSlot -ne $slot -or
            [string]$posts[0].groupId -ne [string]$result.groupId -or
            [string]$posts[0].clientSubmissionId -ne [string]$result.clientSubmissionId -or
            [string]$posts[0].requestRunId -ne [string]$result.requestRunId -or
            [int]$posts[0].fhlImagesPoolSlot -ne $slot -or
            [string]$terminals[0].groupId -ne [string]$result.groupId -or [int]$terminals[0].fhlImagesPoolSlot -ne $slot -or
            [string]$terminals[0].status -ne $expectedStatus -or
            [int]$submits[0].order -ge [int]$claims[0].order -or [int]$claims[0].order -ge [int]$posts[0].order -or
            [int]$posts[0].order -ge [int]$terminals[0].order -or
            ($releases.Count -eq 1 -and ([string]$releases[0].groupId -ne [string]$result.groupId -or
                [int]$releases[0].fhlImagesPoolSlot -ne $slot -or [int]$terminals[0].order -ge [int]$releases[0].order))) {
            throw "Raw ReleaseLogcat does not prove one submit, claim, POST, terminal event, and valid release for a result."
        }
        $identities.Add([pscustomobject][ordered]@{
            groupId = [string]$result.groupId
            jobId = [string]$result.jobId
            clientSubmissionId = [string]$result.clientSubmissionId
            requestRunId = [string]$result.requestRunId
            slot = $slot
        })
    }
    $knownGroupIds = @($identities | ForEach-Object { [string]$_.groupId })
    $knownJobIds = @($identities | ForEach-Object { [string]$_.jobId })
    foreach ($event in $events) {
        if ([string]$event.type -eq "process_started") { continue }
        if ([string]$event.type -eq "submit") {
            if ($knownGroupIds -notcontains [string]$event.groupId) { throw "ReleaseLogcat contains a submit outside the explicit run results." }
        }
        elseif ($knownJobIds -notcontains [string]$event.jobId) {
            throw "ReleaseLogcat contains a task event outside the explicit run results."
        }
    }
    if (@($events | Where-Object { $_.type -eq "upstream_submit_attempt" }).Count -ne $expectedJobs) {
        throw "ReleaseLogcat contains an upstream POST outside the explicit run results."
    }
    if ($Role -eq "coldStartInterrupt") {
        if (@($events | Where-Object { $_.type -eq "process_started" }).Count -lt 2 -or [int]$report.metrics.observationPostDelta -ne 0) {
            throw "Cold-start evidence does not prove a new process and zero restart POSTs."
        }
    }
    if ($Role -eq "offlineFailureAttribution" -and [int]$report.metrics.observationPostDelta -ne 0) {
        throw "Offline evidence retried after network restoration."
    }
    if ($Role -in @("pool40", "queue60")) {
        foreach ($artifactRole in @("nativeSchedulerAudit", "hostQueueSamples", "schedulerMetrics", "loadCheckpoint")) {
            if (-not $entriesByRole.ContainsKey($artifactRole)) { throw "$Role is missing $artifactRole." }
        }
        $expectedPerSlot = if ($Role -eq "pool40") { 4 } else { 6 }
        $expectedQueued = if ($Role -eq "pool40") { 0 } else { 20 }
        if ([int]$report.scheduler.totalPeak -ne 40 -or [int]$report.scheduler.expectedPerSlot -ne $expectedPerSlot -or
            [int]$report.scheduler.capacityCheckpointQueued -ne $expectedQueued -or -not [bool]$report.scheduler.hostCheckpointPassed -or
            -not [bool]$report.scheduler.fifoQueueSequence -or [int]$report.scheduler.submits -ne $expectedJobs -or
            [int]$report.scheduler.claims -ne $expectedJobs -or [int]$report.scheduler.upstreamPosts -ne $expectedJobs -or
            [int]$report.scheduler.terminals -ne $expectedJobs -or [int]$report.scheduler.releases -ne $expectedJobs -or
            @($report.scheduler.perSlotPeak | Where-Object { [int]$_.peak -ne 4 }).Count -ne 0) {
            throw "$Role scheduler evidence does not prove the exact 4/40 contract."
        }
        if ($Role -eq "queue60" -and [int]$report.scheduler.sampledQueuePeak -lt 20) { throw "Queue60 did not observe twenty queued jobs." }
        $schedulerMetricsPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.schedulerMetrics
        $checkpointPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.loadCheckpoint
        $hostSamplesPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.hostQueueSamples
        $nativeAuditPath = Assert-FileEntry -Directory $directory -Entry $entriesByRole.nativeSchedulerAudit
        $schedulerMetrics = Read-JsonFile -Path $schedulerMetricsPath
        $checkpoint = Read-JsonFile -Path $checkpointPath
        $hostSamples = @(Read-JsonFile -Path $hostSamplesPath)
        $nativeAudit = @(Read-JsonFile -Path $nativeAuditPath)
        foreach ($field in @("expectedTasks", "expectedPerSlot", "totalPeak", "sampledQueuePeak", "capacityCheckpointQueued", "fifoQueueSequence", "hostCheckpointPassed", "submits", "claims", "releases", "upstreamPosts", "terminals")) {
            if ([string]$schedulerMetrics.PSObject.Properties[$field].Value -ne [string]$report.scheduler.PSObject.Properties[$field].Value) {
                throw "$Role scheduler-metrics.json differs from acceptance-report.json."
            }
        }
        if ([string]$checkpoint.status -ne "completed" -or [int]$checkpoint.scheduler.totalPeak -ne 40 -or
            [int]$checkpoint.scheduler.capacityCheckpointQueued -ne $expectedQueued) {
            throw "$Role load checkpoint is not the completed exact-capacity checkpoint."
        }
        $capacitySamples = @($hostSamples | Where-Object {
            [int]$_.running -eq 40 -and [int]$_.activeReservations -eq 40 -and [int]$_.queued -eq $expectedQueued -and
            [int]$_.succeeded -eq 0 -and [int]$_.failed -eq 0 -and [int]$_.cancelled -eq 0 -and [int]$_.interrupted -eq 0
        })
        if ($capacitySamples.Count -lt 1 -or @($capacitySamples[0].perSlot | Where-Object {
            [int]$_.running -ne 4 -or [int]$_.activeReservations -ne 4 -or [int]$_.queued -ne ($expectedPerSlot - 4)
        }).Count -ne 0) {
            throw "$Role host samples do not contain the exact 40-running capacity checkpoint."
        }
        foreach ($identity in $identities) {
            foreach ($eventType in @("slot_claimed", "upstream_submit_attempt", "slot_terminal", "slot_reservation_released")) {
                if (@($nativeAudit | Where-Object { [string]$_.type -eq $eventType -and [string]$_.jobId -eq [string]$identity.jobId }).Count -ne 1) {
                    throw "$Role native scheduler audit is incomplete for a task."
                }
            }
        }
        foreach ($slot in 1..10) {
            if (@($identities | Where-Object { [int]$_.slot -eq $slot }).Count -ne $expectedPerSlot) {
                throw "$Role slot distribution is incorrect for FHL$slot."
            }
        }
    }
    if ($Role -in @("tenSlotRoundRobin", "api36Stability")) {
        foreach ($slot in 1..10) {
            if (@($identities | Where-Object { [int]$_.slot -eq $slot }).Count -ne 1) { throw "$Role run is not one complete ten-slot cycle." }
        }
    }
    return [pscustomobject][ordered]@{
        relativeDirectory = ($RelativeDirectory -replace '\\', '/').Trim('/')
        acceptanceRole = $Role
        scenario = [string]$report.scenario
        tasks = $expectedJobs
        manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToUpperInvariant()
        reportSha256 = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToUpperInvariant()
        attemptsSha256 = (Get-FileHash -LiteralPath $attemptsPath -Algorithm SHA256).Hash.ToUpperInvariant()
        releaseLogcatSha256 = (Get-FileHash -LiteralPath $logcatPath -Algorithm SHA256).Hash.ToUpperInvariant()
        device = [string]$report.device
        deviceMetadata = $report.deviceMetadata
        runtimeMetrics = $runtimeMetrics
        startedAt = $startedAt
        finishedAt = $finishedAt
        stabilityFinalRun = [bool]$report.stabilityFinalRun
        stabilityCooldownSeconds = [int]$report.stabilityCooldownSeconds
        identities = @($identities)
        apkFile = [string]$report.apkFile
    }
}

function New-AggregateFromRuns {
    param([Parameter(Mandatory = $true)][object[]]$Runs, [Parameter(Mandatory = $true)][string]$GeneratedAt)

    $globalGroups = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $globalJobs = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $globalSubmissions = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $globalRequestRuns = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $slotDistribution = [ordered]@{}
    foreach ($slot in 1..10) { $slotDistribution["FHL$slot"] = 0 }
    $scenarioJobs = [ordered]@{}
    $scenarios = [ordered]@{}
    $inputs = [Collections.Generic.List[object]]::new()
    $totalJobs = 0
    foreach ($role in $roleSpecs.Keys) {
        $roleRuns = @($Runs | Where-Object { [string]$_.acceptanceRole -eq $role })
        $spec = $roleSpecs[$role]
        $roleJobs = ($roleRuns | Measure-Object -Property tasks -Sum).Sum
        if ($null -eq $roleJobs) { $roleJobs = 0 }
        if ($roleRuns.Count -ne [int]$spec.runs -or [int]$roleJobs -ne [int]$spec.totalJobs) {
            throw "Acceptance role $role has the wrong run or task count."
        }
        $scenarioJobs[$role] = [int]$roleJobs
        $scenarios[$role] = $true
        $totalJobs += [int]$roleJobs
    }
    foreach ($run in $Runs) {
        foreach ($identity in @($run.identities)) {
            if (-not $globalGroups.Add([string]$identity.groupId) -or -not $globalJobs.Add([string]$identity.jobId) -or
                -not $globalSubmissions.Add([string]$identity.clientSubmissionId) -or -not $globalRequestRuns.Add([string]$identity.requestRunId)) {
                throw "A task identity was reused across formal acceptance runs."
            }
            $slotDistribution["FHL$([int]$identity.slot)"] = [int]$slotDistribution["FHL$([int]$identity.slot)"] + 1
        }
        $inputs.Add([ordered]@{
            relativeDirectory = [string]$run.relativeDirectory
            acceptanceRole = [string]$run.acceptanceRole
            scenario = [string]$run.scenario
            tasks = [int]$run.tasks
            manifestSha256 = [string]$run.manifestSha256
            reportSha256 = [string]$run.reportSha256
            attemptsSha256 = [string]$run.attemptsSha256
            releaseLogcatSha256 = [string]$run.releaseLogcatSha256
            device = [string]$run.device
            sdkInt = [int]$run.deviceMetadata.sdkInt
            formFactor = [string]$run.deviceMetadata.formFactor
            pssBeforeKiB = [long]$run.runtimeMetrics.before.totalPssKiB
            pssAfterKiB = [long]$run.runtimeMetrics.after.totalPssKiB
            frozenFrameDelta = [long]$run.runtimeMetrics.frozenFrameDelta
            thermalStatusAfter = [int]$run.runtimeMetrics.after.thermalStatus
            startedAt = $run.startedAt.ToString("o")
            finishedAt = $run.finishedAt.ToString("o")
            stabilityFinalRun = [bool]$run.stabilityFinalRun
            stabilityCooldownSeconds = [int]$run.stabilityCooldownSeconds
        })
    }
    if ($totalJobs -ne 216 -or $globalGroups.Count -ne 216 -or $globalJobs.Count -ne 216 -or
        $globalSubmissions.Count -ne 216 -or $globalRequestRuns.Count -ne 216 -or
        @($slotDistribution.Values | Where-Object { [int]$_ -lt 1 }).Count -gt 0) {
        throw "Formal aggregate does not contain exactly 216 unique tasks with all ten slots represented."
    }
    $stabilityRuns = @($Runs | Where-Object { [string]$_.acceptanceRole -eq "api36Stability" } | Sort-Object startedAt)
    for ($index = 1; $index -lt $stabilityRuns.Count; $index += 1) {
        if ($stabilityRuns[$index].startedAt -lt $stabilityRuns[$index - 1].finishedAt) {
            throw "API 36 stability runs overlap or are not chronologically ordered."
        }
    }
    if (@($stabilityRuns | Where-Object { [bool]$_.stabilityFinalRun }).Count -ne 1 -or
        -not [bool]$stabilityRuns[-1].stabilityFinalRun -or [int]$stabilityRuns[-1].stabilityCooldownSeconds -lt 300) {
        throw "API 36 stability evidence lacks one final five-minute idle sample."
    }
    $stabilityBaseline = [long]$stabilityRuns[0].runtimeMetrics.before.totalPssKiB
    $stabilityFinal = [long]$stabilityRuns[-1].runtimeMetrics.after.totalPssKiB
    $stabilityGrowth = $stabilityFinal - $stabilityBaseline
    $stabilityPercent = if ($stabilityBaseline -gt 0) { [Math]::Round(($stabilityGrowth * 100.0) / $stabilityBaseline, 2) } else { 999.0 }
    $stabilityFrozenFrames = [long](($stabilityRuns | ForEach-Object { [long]$_.runtimeMetrics.frozenFrameDelta } | Measure-Object -Sum).Sum)
    if ($stabilityGrowth -gt 102400L -or $stabilityPercent -gt 20.0) {
        throw "API 36 stability PSS growth exceeds one or more formal limits."
    }
    return [ordered]@{
        schemaVersion = 1
        generatedAt = $GeneratedAt
        generator = "finalize-android-emulator-acceptance.ps1"
        status = "passed"
        executed = $true
        totalJobs = 216
        evidenceSource = "ReleaseLogcat"
        apkSha256 = $expectedApkHash
        installedApkSha256 = $expectedApkHash
        candidateGitCommit = $expectedCommit
        productGitCommit = $expectedCommit
        verifierGitCommit = $expectedCommit
        verifierScriptSha256 = $verifierScriptHash
        aggregatorGitCommit = $expectedCommit
        aggregatorScriptSha256 = $aggregatorScriptHash
        apkServiceIdentity = $expectedServiceIdentity
        apkBuildId = $ExpectedBuildId
        package = $formalPackage
        apkCertificateSha256 = $officialCertificate
        apkDebuggable = $false
        apkSignatureV2 = $true
        scenarios = $scenarios
        scenarioJobs = $scenarioJobs
        slotDistribution = $slotDistribution
        stability = [ordered]@{
            baselinePssKiB = $stabilityBaseline
            finalPssKiB = $stabilityFinal
            growthKiB = $stabilityGrowth
            growthPercent = $stabilityPercent
            frozenFrameDelta = $stabilityFrozenFrames
            maxThermalStatus = [int](($stabilityRuns | ForEach-Object { [int]$_.runtimeMetrics.after.thermalStatus } | Measure-Object -Maximum).Maximum)
        }
        emulator = [ordered]@{ verified = $true; runCount = $Runs.Count; devices = @($Runs | ForEach-Object { [string]$_.device } | Sort-Object -Unique) }
        realDevice = [ordered]@{ verified = $false }
        releaseState = "emulator-complete-pending-real-device"
        inputs = @($inputs)
        aggregateManifest = $aggregateManifestFileName
    }
}

function Get-ComparableAggregateJson {
    param([Parameter(Mandatory = $true)][object]$Value)
    $comparable = [ordered]@{}
    foreach ($name in @("schemaVersion", "generator", "status", "executed", "totalJobs", "evidenceSource", "apkSha256", "installedApkSha256", "candidateGitCommit", "productGitCommit", "verifierGitCommit", "verifierScriptSha256", "aggregatorGitCommit", "aggregatorScriptSha256", "apkServiceIdentity", "apkBuildId", "package", "apkCertificateSha256", "apkDebuggable", "apkSignatureV2", "scenarios", "scenarioJobs", "slotDistribution", "stability", "emulator", "realDevice", "releaseState", "inputs", "aggregateManifest")) {
        $comparable[$name] = $Value.PSObject.Properties[$name].Value
    }
    return ConvertTo-Json -InputObject $comparable -Depth 12 -Compress
}

function Read-RunsFromEntries {
    param([Parameter(Mandatory = $true)][object[]]$Entries)
    $seenPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $runs = [Collections.Generic.List[object]]::new()
    foreach ($entry in $Entries) {
        $relativeDirectory = [string]$entry.relativeDirectory
        $role = [string]$entry.acceptanceRole
        if (-not $seenPaths.Add($relativeDirectory)) { throw "The controlled run list contains a duplicate evidence directory." }
        $runs.Add((Read-RunEvidence -Root $EvidenceRoot -RelativeDirectory $relativeDirectory -Role $role))
    }
    return @($runs)
}

function Verify-AggregateReport {
    param([Parameter(Mandatory = $true)][string]$Path)
    $resolvedReport = (Resolve-Path -LiteralPath $Path).Path
    if ([IO.Path]::GetFileName($resolvedReport) -ne $aggregateFileName) { throw "Aggregate report has an unexpected file name." }
    $directory = Split-Path -Parent $resolvedReport
    $manifestPath = Join-Path $directory $aggregateManifestFileName
    $manifest = Read-JsonFile -Path $manifestPath
    if (@(Get-ChildItem -LiteralPath $directory -Directory -Force).Count -ne 0 -or
        @(Get-ChildItem -LiteralPath $directory -File -Force | Where-Object { $_.Name -notin @($aggregateFileName, $aggregateManifestFileName) }).Count -ne 0) {
        throw "Aggregate evidence directory contains an unexpected file or nested directory."
    }
    foreach ($artifactPath in @($resolvedReport, $manifestPath)) {
        if (((Get-Item -LiteralPath $artifactPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Aggregate artifacts cannot be symbolic links or reparse points."
        }
    }
    if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.generator -ne "finalize-android-emulator-acceptance.ps1" -or
        (Normalize-Hash $manifest.aggregatorScriptSha256) -ne $aggregatorScriptHash -or
        ([string]$manifest.aggregatorGitCommit).ToLowerInvariant() -ne $expectedCommit -or
        (Normalize-Hash $manifest.report.sha256) -ne (Get-FileHash -LiteralPath $resolvedReport -Algorithm SHA256).Hash.ToUpperInvariant() -or
        [long]$manifest.report.sizeBytes -ne (Get-Item -LiteralPath $resolvedReport).Length) {
        throw "Aggregate evidence manifest does not bind the aggregate report and approved aggregator."
    }
    $report = Read-JsonFile -Path $resolvedReport
    $runs = Read-RunsFromEntries -Entries @($report.inputs)
    if (@($manifest.inputManifests).Count -ne $runs.Count) { throw "Aggregate manifest input count differs from the aggregate report." }
    foreach ($run in $runs) {
        $manifestInput = @($manifest.inputManifests | Where-Object { [string]$_.relativeDirectory -eq [string]$run.relativeDirectory })
        if ($manifestInput.Count -ne 1 -or (Normalize-Hash $manifestInput[0].sha256) -ne [string]$run.manifestSha256) {
            throw "Aggregate manifest does not bind one of its run evidence manifests."
        }
    }
    $recomputed = New-AggregateFromRuns -Runs $runs -GeneratedAt ([string]$report.generatedAt)
    if ((Get-ComparableAggregateJson -Value $report) -cne (Get-ComparableAggregateJson -Value ([pscustomobject]$recomputed))) {
        throw "Aggregate report differs from values recomputed from raw run evidence."
    }
    return $report
}

$EvidenceRoot = (Resolve-Path -LiteralPath $EvidenceRoot).Path
if ($Mode -eq "Create") {
    if ([string]::IsNullOrWhiteSpace($RunManifest) -or [string]::IsNullOrWhiteSpace($OutputDirectory)) {
        throw "Create requires RunManifest and OutputDirectory."
    }
    $runManifestValue = Read-JsonFile -Path $RunManifest
    if (((Get-Item -LiteralPath (Resolve-Path -LiteralPath $RunManifest).Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Controlled run manifest cannot be a symbolic link or reparse point."
    }
    if ([int]$runManifestValue.schemaVersion -ne 1) { throw "Controlled run manifest schemaVersion must be 1." }
    if (Test-Path -LiteralPath $OutputDirectory) {
        $outputItem = Get-Item -LiteralPath $OutputDirectory -Force
        if (($outputItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or @(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -gt 0) {
            throw "Create requires a new empty non-reparse OutputDirectory."
        }
    }
    else { New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null }
    $OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
    $runs = Read-RunsFromEntries -Entries @($runManifestValue.runs)
    $aggregate = New-AggregateFromRuns -Runs $runs -GeneratedAt ((Get-Date).ToString("o"))
    $reportPath = Join-Path $OutputDirectory $aggregateFileName
    [IO.File]::WriteAllText($reportPath, (ConvertTo-Json -InputObject $aggregate -Depth 12) + "`n", [Text.UTF8Encoding]::new($false))
    $reportItem = Get-Item -LiteralPath $reportPath
    $aggregateManifest = [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToString("o")
        generator = "finalize-android-emulator-acceptance.ps1"
        aggregatorGitCommit = $expectedCommit
        aggregatorScriptSha256 = $aggregatorScriptHash
        report = [ordered]@{
            path = $aggregateFileName
            sizeBytes = [long]$reportItem.Length
            sha256 = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToUpperInvariant()
        }
        inputManifests = @($runs | ForEach-Object { [ordered]@{ relativeDirectory = $_.relativeDirectory; sha256 = $_.manifestSha256 } })
    }
    $manifestPath = Join-Path $OutputDirectory $aggregateManifestFileName
    [IO.File]::WriteAllText($manifestPath, (ConvertTo-Json -InputObject $aggregateManifest -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
    [void](Verify-AggregateReport -Path $reportPath)
    Write-Output "Android emulator acceptance aggregate created and verified: $reportPath"
}
else {
    if ([string]::IsNullOrWhiteSpace($AggregateReport)) { throw "Verify requires AggregateReport." }
    [void](Verify-AggregateReport -Path $AggregateReport)
    Write-Output "Android emulator acceptance aggregate verified: $([IO.Path]::GetFileName($AggregateReport))"
}
