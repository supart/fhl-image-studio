<#
.SYNOPSIS
Installs one verified formal Android APK while the caller holds an Android MCP Lab lease.

.DESCRIPTION
This is the reviewed project installation channel, not an Android UI controller.
The caller must obtain a registered no-credentials emulator and lease through
ty-android-mcp, check readiness/package presence, then fresh-read the screen after
this script returns. This script never starts an emulator or app, controls UI,
reads application credentials, clears data, uninstalls a package, or collects logs.

Fresh requires the formal package to be absent. Upgrade requires an exact baseline
APK hash and a caller-confirmed isolated idle baseline. A non-debuggable formal
package does not permit run-as registry inspection, so this script deliberately
does not claim to have independently checked its queue or credential preservation.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedApkSha256,
    [Parameter(Mandatory = $true)][ValidatePattern('^V[0-9]+\.[0-9]+\.[0-9]+$')][string]$ExpectedVersionName,
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$ExpectedVersionCode,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedCertificateSha256,
    [Parameter(Mandatory = $true)][ValidateSet('Fresh', 'Upgrade')][string]$Scenario,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$DeviceId,
    # Use only the exact transport returned for DeviceId by MCP registry/status.
    [Parameter(Mandatory = $true)][ValidatePattern('^(?:emulator-[0-9]+|127\.0\.0\.1:[0-9]+)$')][string]$DeviceSerial,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$LeaseId,
    [Parameter(Mandatory = $true)][string]$AdbPath,
    [Parameter(Mandatory = $true)][string]$ApkSignerPath,
    [Parameter(Mandatory = $true)][string]$ApkAnalyzerPath,
    [ValidatePattern('^(?:[0-9a-fA-F]{64})?$')][string]$ExpectedBaselineApkSha256 = '',
    [switch]$ConfirmedIsolatedIdleBaseline,
    [string]$OutputJson = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageName = 'top.fangtangyuan.fhlstudio.android'
$officialCertificate = '6B04A805E50CF66E37C740AD0336BBDF6445653F93802005967BABF472E8DA36'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$safeOutputJson = ''
$report = [ordered]@{
    schemaVersion = 1
    status = 'failed'
    scenario = $Scenario
    deviceId = $DeviceId
    packageName = $packageName
    versionName = $ExpectedVersionName
    versionCode = $ExpectedVersionCode
    minSdk = 28
    targetSdk = 34
    apkSha256 = $ExpectedApkSha256.ToUpperInvariant()
    certificateSha256 = $officialCertificate
    callerLeaseRequired = $true
    baselineVerification = 'not_applicable'
    queueVerification = 'not_evaluated'
    packageInstalled = $false
    appOpened = $false
    credentialRead = $false
    installedApkSha256 = $null
    failureCategory = $null
    nextStep = 'caller_must_read_fresh_screen_and_verify_package_through_mcp'
}

function Fail([string]$Category) { throw [InvalidOperationException]::new($Category) }

function Assert-ProjectPath([string]$Path, [bool]$RequireFile) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if ($resolved.StartsWith('\\') -or
        -not $resolved.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Fail 'project_path_rejected'
    }
    if ($RequireFile -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { Fail 'project_file_missing' }
    $cursor = $resolved
    while ($cursor -and $cursor.Length -ge $projectRoot.Length) {
        if (Test-Path -LiteralPath $cursor) {
            if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                Fail 'project_reparse_path_rejected'
            }
        }
        if ($cursor.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase)) { break }
        $cursor = Split-Path -Parent $cursor
    }
    return $resolved
}

function Get-Sha256Hex([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead($Path)
        try { return ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '') }
        finally { $stream.Dispose() }
    }
    finally { $sha.Dispose() }
}

function Invoke-CheckedText([string]$Tool, [string[]]$ToolArguments) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = 0
        $captured = @(& $Tool @ToolArguments 2>&1)
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($code -ne 0) { Fail 'native_operation_failed' }
    return ($captured | Out-String).Trim()
}

function Invoke-AdbText([string[]]$AdbArguments) {
    return Invoke-CheckedText $AdbPath (@('-s', $DeviceSerial) + $AdbArguments)
}

function Get-InstalledHash {
    $packagePath = Invoke-AdbText @('shell', 'pm', 'path', $packageName)
    $basePaths = @($packagePath -split '\r?\n' | Where-Object { $_ -match '^package:/data/app/[^\r\n]+/base\.apk$' })
    if ($basePaths.Count -ne 1) { Fail 'installed_base_apk_missing_or_ambiguous' }
    $remotePath = $basePaths[0].Substring(8).Trim()
    if ($remotePath -notmatch '^/data/app/[a-zA-Z0-9_~+=./-]+/base\.apk$') { Fail 'installed_apk_path_rejected' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $AdbPath
    $start.Arguments = '-s ' + $DeviceSerial + ' exec-out cat ' + $remotePath
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    $sha = [Security.Cryptography.SHA256]::Create()
    $memory = [IO.MemoryStream]::new()
    $started = $false
    try {
        if (-not $process.Start()) { Fail 'installed_apk_hash_failed' }
        $started = $true
        $stderr = $process.StandardError.ReadToEndAsync()
        $copy = $process.StandardOutput.BaseStream.CopyToAsync($memory)
        if (-not $copy.Wait(60000) -or -not $process.WaitForExit(5000)) {
            $process.Kill()
            Fail 'installed_apk_hash_timeout'
        }
        $null = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { Fail 'installed_apk_hash_failed' }
        if ($memory.Length -le 0 -or $memory.Length -gt 128MB) { Fail 'installed_apk_size_rejected' }
        $memory.Position = 0
        $digest = $sha.ComputeHash($memory)
        return ([BitConverter]::ToString($digest) -replace '-', '')
    }
    finally {
        if ($started -and -not $process.HasExited) { $process.Kill() }
        $memory.Dispose()
        $sha.Dispose()
        $process.Dispose()
    }
}

try {
    if ($DeviceSerial.StartsWith('127.0.0.1:')) {
        $transportPort = 0
        if (-not [int]::TryParse($DeviceSerial.Substring(10), [ref]$transportPort) -or $transportPort -lt 1 -or $transportPort -gt 65535) {
            Fail 'mcp_loopback_transport_port_rejected'
        }
    }
    if ($ExpectedCertificateSha256.ToUpperInvariant() -ne $officialCertificate) { Fail 'official_certificate_pin_mismatch' }
    if ($Scenario -eq 'Upgrade') {
        if (-not $ConfirmedIsolatedIdleBaseline) { Fail 'upgrade_requires_caller_confirmed_idle_baseline' }
        if (-not $ExpectedBaselineApkSha256) { Fail 'upgrade_requires_baseline_hash' }
    }
    $ApkPath = Assert-ProjectPath $ApkPath $true
    if ($OutputJson) { $safeOutputJson = Assert-ProjectPath $OutputJson $false }
    foreach ($tool in @($AdbPath, $ApkSignerPath, $ApkAnalyzerPath)) {
        if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { Fail 'required_tool_missing' }
    }
    if ((Get-Sha256Hex $ApkPath) -ne $report.apkSha256) { Fail 'candidate_apk_hash_mismatch' }
    $signature = Invoke-CheckedText $ApkSignerPath @('verify', '--verbose', '--print-certs', $ApkPath)
    $certificates = @([regex]::Matches($signature, '(?im)^Signer #[0-9]+ certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$'))
    if ($certificates.Count -ne 1 -or $certificates[0].Groups[1].Value.ToUpperInvariant() -ne $officialCertificate) {
        Fail 'apk_certificate_mismatch'
    }
    if ($signature -notmatch '(?im)^Verified using v2 scheme .*:\s*true\s*$') { Fail 'apk_v2_signature_missing' }
    $applicationId = Invoke-CheckedText $ApkAnalyzerPath @('manifest', 'application-id', $ApkPath)
    $versionName = Invoke-CheckedText $ApkAnalyzerPath @('manifest', 'version-name', $ApkPath)
    $versionCode = Invoke-CheckedText $ApkAnalyzerPath @('manifest', 'version-code', $ApkPath)
    $minSdk = Invoke-CheckedText $ApkAnalyzerPath @('manifest', 'min-sdk', $ApkPath)
    $targetSdk = Invoke-CheckedText $ApkAnalyzerPath @('manifest', 'target-sdk', $ApkPath)
    $debuggable = Invoke-CheckedText $ApkAnalyzerPath @('manifest', 'debuggable', $ApkPath)
    if ($applicationId -ne $packageName -or $versionName -ne $ExpectedVersionName -or $versionCode -ne [string]$ExpectedVersionCode) {
        Fail 'apk_identity_mismatch'
    }
    if ($minSdk -ne '28' -or $targetSdk -ne '34') { Fail 'apk_sdk_contract_mismatch' }
    if ($debuggable -cne 'false') { Fail 'apk_debuggable_or_unproven' }
    if ((Invoke-AdbText @('get-state')) -ne 'device') { Fail 'emulator_not_available' }
    $installed = ((Invoke-AdbText @('shell', 'pm', 'list', 'packages', $packageName)) -split '\r?\n') -contains ('package:' + $packageName)
    if ($Scenario -eq 'Fresh') {
        if ($installed) { Fail 'fresh_requires_package_absent' }
        $report.queueVerification = 'package_absent_before_install'
        $installArguments = @('install', $ApkPath)
    }
    else {
        if (-not $installed) { Fail 'upgrade_requires_installed_baseline' }
        if (-not $ConfirmedIsolatedIdleBaseline) { Fail 'upgrade_requires_caller_confirmed_idle_baseline' }
        if (-not $ExpectedBaselineApkSha256) { Fail 'upgrade_requires_baseline_hash' }
        if ((Get-InstalledHash) -ne $ExpectedBaselineApkSha256.ToUpperInvariant()) { Fail 'installed_baseline_hash_mismatch' }
        $report.baselineVerification = 'installed_apk_hash_matched'
        $report.queueVerification = 'caller_confirmed_isolated_idle_baseline'
        $installArguments = @('install', '-r', $ApkPath)
    }
    $installation = Invoke-AdbText $installArguments
    if ($installation -notmatch '(?m)^Success\s*$') { Fail 'apk_install_failed' }
    $report.packageInstalled = $true
    $dump = Invoke-AdbText @('shell', 'dumpsys', 'package', $packageName)
    if ($dump -notmatch ('(?m)^\s*versionCode=' + $ExpectedVersionCode + '(?:\s|$)') -or
        $dump -notmatch ('(?m)^\s*versionName=' + [regex]::Escape($ExpectedVersionName) + '\s*$')) {
        Fail 'installed_package_identity_mismatch'
    }
    $report.installedApkSha256 = Get-InstalledHash
    if ($report.installedApkSha256 -ne $report.apkSha256) { Fail 'installed_candidate_apk_hash_mismatch' }
    $report.status = 'passed'
}
catch {
    $category = [string]$_.Exception.Message
    $report.failureCategory = if ($category -match '^[a-z][a-z0-9_]+$') { $category } else { 'installation_verification_failed' }
}

$json = ($report | ConvertTo-Json -Depth 5) + "`n"
if ($safeOutputJson) {
    $parent = Split-Path -Parent $safeOutputJson
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { $null = New-Item -ItemType Directory -Path $parent -Force }
    [IO.File]::WriteAllText($safeOutputJson, $json, [Text.UTF8Encoding]::new($false))
}
Write-Output $json
if ($report.status -ne 'passed') { exit 1 }
