param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Debug", "Release")]
  [string]$Artifact,

  [Parameter(Mandatory = $true)]
  [string]$SourceRootA,

  [Parameter(Mandatory = $true)]
  [string]$SourceRootB,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedCommit,

  [ValidatePattern("^[A-Za-z0-9._-]+$")]
  [string]$BuildId = "android-v2.0.3-repro",

  [Parameter(Mandatory = $true)]
  [string]$KeystorePath,

  [System.Security.SecureString]$KeystorePassword,
  [string]$KeyAlias = "",
  [System.Security.SecureString]$KeyPassword,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedCertificateSha256,

  [Parameter(Mandatory = $true)]
  [string]$ReportRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$officialReleaseCertificateSha256 = "6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36"

$startedAt = Get-Date
$script:secretValues = New-Object System.Collections.Generic.List[string]
$script:reportErrors = New-Object System.Collections.Generic.List[string]
$script:buildResults = New-Object System.Collections.Generic.List[object]
$script:apkResults = New-Object System.Collections.Generic.List[object]
$script:zipDifferences = @()
$script:containerMetadataOnly = $false
$script:artifactCopy = $null
$script:sha256Equal = $null
$script:byteForByteEqual = $null

function ConvertFrom-SecureValue {
  param([System.Security.SecureString]$Value)

  if ($null -eq $Value) { return "" }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Add-SecretValue {
  param([string]$Value)

  if ($Value -and -not $script:secretValues.Contains($Value)) {
    [void]$script:secretValues.Add($Value)
  }
}

function Protect-Text {
  param([AllowNull()][string]$Text)

  if ($null -eq $Text) { return "" }
  $protected = $Text
  foreach ($secret in @($script:secretValues | Sort-Object Length -Descending)) {
    if ($secret) { $protected = $protected.Replace($secret, "<redacted>") }
  }
  return $protected
}

function Add-ReportError {
  param([string]$Message)

  $safeMessage = Protect-Text $Message
  if ($safeMessage -and -not $script:reportErrors.Contains($safeMessage)) {
    [void]$script:reportErrors.Add($safeMessage)
  }
}

function Write-Utf8BomFile {
  param(
    [string]$Path,
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($true)
  [IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Resolve-DirectoryPath {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Name does not exist or is not a directory."
  }
  return (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\', '/')
}

function Test-PathWithin {
  param(
    [string]$Candidate,
    [string]$Parent
  )

  $parentWithSeparator = $Parent.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  return $Candidate.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or
    $Candidate.StartsWith($parentWithSeparator, [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-GitCapture {
  param(
    [string]$GitPath,
    [string]$SourceRoot,
    [string[]]$Arguments
  )

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = 0
    $output = @(& $GitPath -C $SourceRoot @Arguments 2>&1)
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
  return [pscustomobject]@{
    exitCode = $exitCode
    lines = @($output | ForEach-Object { Protect-Text $_.ToString() })
  }
}

function Assert-CleanSourceRoot {
  param(
    [string]$Label,
    [string]$Root,
    [string]$GitPath,
    [string]$Commit
  )

  if ([regex]::IsMatch($Root, '[^\x00-\x7F]')) {
    throw "SourceRoot$Label must use an ASCII-only path."
  }

  $topLevel = Invoke-GitCapture $GitPath $Root @("rev-parse", "--show-toplevel")
  if ($topLevel.exitCode -ne 0 -or $topLevel.lines.Count -eq 0) {
    throw "SourceRoot$Label is not a readable Git worktree."
  }
  $resolvedTopLevel = (Resolve-Path -LiteralPath $topLevel.lines[-1]).Path.TrimEnd('\', '/')
  if (-not $resolvedTopLevel.Equals($Root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "SourceRoot$Label must be the Git worktree root."
  }

  $head = Invoke-GitCapture $GitPath $Root @("rev-parse", "HEAD")
  if ($head.exitCode -ne 0 -or $head.lines.Count -eq 0 -or
      -not $head.lines[-1].Equals($Commit, [StringComparison]::OrdinalIgnoreCase)) {
    throw "SourceRoot$Label HEAD does not match ExpectedCommit."
  }

  $status = Invoke-GitCapture $GitPath $Root @("status", "--porcelain", "--untracked-files=all")
  if ($status.exitCode -ne 0) {
    throw "SourceRoot$Label Git status could not be read."
  }
  if (@($status.lines | Where-Object { $_ }).Count -ne 0) {
    throw "SourceRoot$Label must be clean before verification."
  }
}

function Resolve-AndroidSdkRoot {
  param([string[]]$SourceRoots)

  foreach ($candidate in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  foreach ($sourceRoot in $SourceRoots) {
    $localProperties = Join-Path $sourceRoot "android-shell\local.properties"
    if (-not (Test-Path -LiteralPath $localProperties -PathType Leaf)) { continue }
    $sdkLine = Get-Content -LiteralPath $localProperties -Encoding UTF8 |
      Where-Object { $_ -match '^sdk\.dir=' } |
      Select-Object -First 1
    if ($sdkLine) {
      $candidate = ($sdkLine -replace '^sdk\.dir=', '').Replace('\:', ':').Replace('\\', '\')
      if (Test-Path -LiteralPath $candidate -PathType Container) {
        return (Resolve-Path -LiteralPath $candidate).Path
      }
    }
  }
  throw "Android SDK was not found. Set ANDROID_SDK_ROOT or ANDROID_HOME."
}

function Resolve-AndroidTool {
  param(
    [string]$ToolName,
    [string]$SdkRoot
  )

  $command = Get-Command "$ToolName.bat" -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($command) { return $command.Source }

  if ($ToolName -eq "apkanalyzer") {
    $latest = Join-Path $SdkRoot "cmdline-tools\latest\bin\apkanalyzer.bat"
    if (Test-Path -LiteralPath $latest -PathType Leaf) { return $latest }
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
  throw "$ToolName was not found in the Android SDK."
}

function Invoke-NativeCapture {
  param(
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments
  )

  $previousPreference = $ErrorActionPreference
  Push-Location $WorkingDirectory
  try {
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = 0
    $output = @(& $FilePath @Arguments 2>&1)
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  }
  finally {
    $ErrorActionPreference = $previousPreference
    Pop-Location
  }

  return [pscustomobject]@{
    exitCode = $exitCode
    lines = @($output | ForEach-Object { Protect-Text $_.ToString() })
  }
}

function Invoke-Build {
  param(
    [string]$Label,
    [string]$SourceRoot,
    [string]$Mode,
    [string]$ResolvedKeystorePath,
    [string]$StorePasswordValue,
    [string]$AliasValue,
    [string]$KeyPasswordValue,
    [string]$GitCommit,
    [string]$ExplicitBuildId,
    [string]$ResolvedReportRoot
  )

  $androidRoot = Join-Path $SourceRoot "android-shell"
  $gradle = Join-Path $androidRoot "gradlew.bat"
  $tempRoot = Join-Path $SourceRoot ".tmp"
  $gradleUserHome = Join-Path $tempRoot "gradle-user-home"
  $androidUserHome = Join-Path $tempRoot "android-home"
  $androidDotDirectory = Join-Path $androidUserHome ".android"
  $npmCache = Join-Path $tempRoot "npm-cache"
  $localKeystore = if ($Mode -eq "Debug") {
    Join-Path $androidDotDirectory "debug.keystore"
  }
  else {
    Join-Path $androidDotDirectory "release.keystore"
  }
  $logName = "build-$($Label.ToLowerInvariant()).log"
  $logPath = Join-Path $ResolvedReportRoot $logName
  $task = if ($Mode -eq "Debug") { ":app:assembleDebug" } else { ":app:assembleRelease" }
  $expectedApk = if ($Mode -eq "Debug") {
    Join-Path $androidRoot "app\build\outputs\apk\debug\app-debug.apk"
  }
  else {
    Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk"
  }

  $environmentNames = @(
    "GRADLE_USER_HOME",
    "ANDROID_USER_HOME",
    "ANDROID_SDK_HOME",
    "npm_config_cache",
    "IMAGE_STUDIO_GIT_COMMIT",
    "IMAGE_STUDIO_BUILD_ID",
    "IMAGE_STUDIO_KEYSTORE_PATH",
    "IMAGE_STUDIO_KEYSTORE_PASSWORD",
    "IMAGE_STUDIO_KEY_ALIAS",
    "IMAGE_STUDIO_KEY_PASSWORD"
  )
  $previousEnvironment = @{}
  foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
  }

  $buildStartedAt = Get-Date
  $exitCode = 1
  $errorMessage = ""
  try {
    if (-not (Test-Path -LiteralPath $gradle -PathType Leaf)) {
      throw "gradlew.bat was not found for source $Label."
    }
    New-Item -ItemType Directory -Force -Path $gradleUserHome, $androidDotDirectory, $npmCache | Out-Null
    Copy-Item -LiteralPath $ResolvedKeystorePath -Destination $localKeystore -Force
    Add-SecretValue $localKeystore
    Add-SecretValue $localKeystore.Replace('\', '/')
    $copiedHash = (Get-FileHash -LiteralPath $localKeystore -Algorithm SHA256).Hash
    $sourceHash = (Get-FileHash -LiteralPath $ResolvedKeystorePath -Algorithm SHA256).Hash
    if ($copiedHash -ne $sourceHash) { throw "Keystore copy verification failed for source $Label." }

    [Environment]::SetEnvironmentVariable("GRADLE_USER_HOME", $gradleUserHome, "Process")
    [Environment]::SetEnvironmentVariable("ANDROID_USER_HOME", $androidDotDirectory, "Process")
    [Environment]::SetEnvironmentVariable("ANDROID_SDK_HOME", $androidUserHome, "Process")
    [Environment]::SetEnvironmentVariable("npm_config_cache", $npmCache, "Process")
    [Environment]::SetEnvironmentVariable("IMAGE_STUDIO_GIT_COMMIT", $GitCommit, "Process")
    [Environment]::SetEnvironmentVariable("IMAGE_STUDIO_BUILD_ID", $ExplicitBuildId, "Process")
    if ($Mode -eq "Release") {
      [Environment]::SetEnvironmentVariable("IMAGE_STUDIO_KEYSTORE_PATH", $localKeystore, "Process")
      [Environment]::SetEnvironmentVariable("IMAGE_STUDIO_KEYSTORE_PASSWORD", $StorePasswordValue, "Process")
      [Environment]::SetEnvironmentVariable("IMAGE_STUDIO_KEY_ALIAS", $AliasValue, "Process")
      [Environment]::SetEnvironmentVariable("IMAGE_STUDIO_KEY_PASSWORD", $KeyPasswordValue, "Process")
    }
    else {
      foreach ($name in @(
        "IMAGE_STUDIO_KEYSTORE_PATH",
        "IMAGE_STUDIO_KEYSTORE_PASSWORD",
        "IMAGE_STUDIO_KEY_ALIAS",
        "IMAGE_STUDIO_KEY_PASSWORD"
      )) {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
      }
    }

    $capture = Invoke-NativeCapture $androidRoot $gradle @(
      "clean",
      $task,
      "--no-build-cache",
      "--rerun-tasks",
      "--no-daemon",
      "--console=plain",
      "--stacktrace"
    )
    $exitCode = $capture.exitCode
    Write-Utf8BomFile $logPath ((@($capture.lines) -join "`r`n") + "`r`n")
    if ($exitCode -ne 0) {
      $errorMessage = "Gradle build failed for source $Label with exit code $exitCode."
    }
    elseif (-not (Test-Path -LiteralPath $expectedApk -PathType Leaf)) {
      $exitCode = 1
      $errorMessage = "Gradle build for source $Label did not produce the expected APK."
    }
  }
  catch {
    $exitCode = 1
    $errorMessage = Protect-Text $_.Exception.Message
    Write-Utf8BomFile $logPath ($errorMessage + "`r`n")
  }
  finally {
    foreach ($name in $environmentNames) {
      [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
  }

  $durationMs = [math]::Round(((Get-Date) - $buildStartedAt).TotalMilliseconds, 0)
  return [pscustomobject]@{
    label = $Label
    status = if ($exitCode -eq 0) { "passed" } else { "failed" }
    exitCode = $exitCode
    durationMs = $durationMs
    command = "gradlew.bat clean $task --no-build-cache --rerun-tasks --no-daemon --console=plain --stacktrace"
    logPath = $logName
    gradleUserHome = ".tmp/gradle-user-home"
    androidUserHome = ".tmp/android-home/.android"
    androidSdkHome = ".tmp/android-home"
    npmCache = ".tmp/npm-cache"
    keystore = if ($Mode -eq "Debug") { ".tmp/android-home/.android/debug.keystore" } else { ".tmp/android-home/.android/release.keystore" }
    apkPath = if ($exitCode -eq 0) { $expectedApk } else { "" }
    error = $errorMessage
  }
}

function Read-ApkMetadata {
  param(
    [string]$Label,
    [string]$ApkPath,
    [string]$Mode,
    [string]$ApkAnalyzer,
    [string]$ApkSigner,
    [string]$WorkingDirectory,
    [string]$ExpectedCertificate
  )

  $fields = [ordered]@{
    applicationId = "application-id"
    versionName = "version-name"
    versionCode = "version-code"
    minSdk = "min-sdk"
    targetSdk = "target-sdk"
    debuggable = "debuggable"
  }
  $actual = [ordered]@{}
  foreach ($field in $fields.GetEnumerator()) {
    $capture = Invoke-NativeCapture $WorkingDirectory $ApkAnalyzer @("manifest", $field.Value, $ApkPath)
    if ($capture.exitCode -ne 0) {
      throw "apkanalyzer failed for source $Label field $($field.Key)."
    }
    $value = @($capture.lines | Where-Object { $_.Trim() } | Select-Object -Last 1)
    if ($value.Count -eq 0) { throw "apkanalyzer returned no value for source $Label field $($field.Key)." }
    $actual[$field.Key] = $value[0].Trim()
  }

  $signature = Invoke-NativeCapture $WorkingDirectory $ApkSigner @(
    "verify", "--verbose", "--print-certs", $ApkPath
  )
  if ($signature.exitCode -ne 0) { throw "apksigner verification failed for source $Label." }
  $signatureText = $signature.lines -join "`n"
  $certificateMatch = [regex]::Match(
    $signatureText,
    '(?i)certificate SHA-256 digest:\s*([0-9a-f:]{64,95})'
  )
  if (-not $certificateMatch.Success) { throw "Certificate SHA-256 was not found for source $Label." }
  $certificate = ($certificateMatch.Groups[1].Value -replace ':', '').ToLowerInvariant()
  $v2Match = [regex]::Match($signatureText, '(?im)^Verified using v2 scheme[^:]*:\s*(true|false)\s*$')
  $signatureV2 = $v2Match.Success -and $v2Match.Groups[1].Value.ToLowerInvariant() -eq "true"

  $expected = if ($Mode -eq "Debug") {
    [ordered]@{
      applicationId = "top.fangtangyuan.fhlstudio.android.debug"
      versionName = "V2.0.3-debug"
      versionCode = "1050003"
      minSdk = "28"
      targetSdk = "34"
      debuggable = "true"
    }
  }
  else {
    [ordered]@{
      applicationId = "top.fangtangyuan.fhlstudio.android"
      versionName = "V2.0.3"
      versionCode = "1050003"
      minSdk = "28"
      targetSdk = "34"
      debuggable = "false"
    }
  }

  $metadataMatches = $true
  foreach ($name in $expected.Keys) {
    if ($actual[$name] -ne $expected[$name]) { $metadataMatches = $false }
  }
  $certificateMatches = $certificate -eq $ExpectedCertificate

  return [pscustomobject]@{
    label = $Label
    sizeBytes = (Get-Item -LiteralPath $ApkPath).Length
    sha256 = (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    metadata = [pscustomobject]$actual
    expectedMetadata = [pscustomobject]$expected
    metadataMatches = $metadataMatches
    certificateSha256 = $certificate
    certificateMatches = $certificateMatches
    signatureV2 = $signatureV2
    valid = $metadataMatches -and $certificateMatches -and $signatureV2
  }
}

function Test-FilesByteEqual {
  param(
    [string]$PathA,
    [string]$PathB
  )

  $fileA = Get-Item -LiteralPath $PathA
  $fileB = Get-Item -LiteralPath $PathB
  if ($fileA.Length -ne $fileB.Length) { return $false }

  $streamA = [IO.File]::Open($PathA, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $streamB = [IO.File]::Open($PathB, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $bufferA = New-Object byte[] 1048576
    $bufferB = New-Object byte[] 1048576
    while (($readA = $streamA.Read($bufferA, 0, $bufferA.Length)) -gt 0) {
      $readB = 0
      while ($readB -lt $readA) {
        $currentRead = $streamB.Read($bufferB, $readB, $readA - $readB)
        if ($currentRead -eq 0) { return $false }
        $readB += $currentRead
      }
      for ($index = 0; $index -lt $readA; $index += 1) {
        if ($bufferA[$index] -ne $bufferB[$index]) { return $false }
      }
    }
    return $streamB.ReadByte() -eq -1
  }
  finally {
    $streamA.Dispose()
    $streamB.Dispose()
  }
}

function Get-ZipEntryMap {
  param([string]$ApkPath)

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $map = @{}
  $occurrences = @{}
  $zip = [IO.Compression.ZipFile]::OpenRead($ApkPath)
  try {
    foreach ($entry in $zip.Entries) {
      $pathBytes = [Text.Encoding]::UTF8.GetBytes($entry.FullName)
      $pathKey = [BitConverter]::ToString($pathBytes).Replace("-", "")
      $occurrence = if ($occurrences.ContainsKey($pathKey)) { [int]$occurrences[$pathKey] + 1 } else { 1 }
      $occurrences[$pathKey] = $occurrence
      $stream = $entry.Open()
      $sha = [Security.Cryptography.SHA256]::Create()
      try {
        $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
      }
      finally {
        $sha.Dispose()
        $stream.Dispose()
      }
      $map["$pathKey/$occurrence"] = [pscustomobject]@{
        path = Protect-Text $entry.FullName
        occurrence = $occurrence
        sizeBytes = [long]$entry.Length
        compressedSizeBytes = [long]$entry.CompressedLength
        sha256 = $hash
      }
    }
  }
  finally {
    $zip.Dispose()
  }
  return $map
}

function Get-ZipDifferences {
  param(
    [string]$PathA,
    [string]$PathB
  )

  $mapA = Get-ZipEntryMap $PathA
  $mapB = Get-ZipEntryMap $PathB
  $keys = @(@($mapA.Keys) + @($mapB.Keys) | Sort-Object -Unique)
  $differences = New-Object System.Collections.Generic.List[object]
  foreach ($key in $keys) {
    $entryA = if ($mapA.ContainsKey($key)) { $mapA[$key] } else { $null }
    $entryB = if ($mapB.ContainsKey($key)) { $mapB[$key] } else { $null }
    $different = $null -eq $entryA -or $null -eq $entryB
    if (-not $different) {
      $different = $entryA.sizeBytes -ne $entryB.sizeBytes -or
        $entryA.compressedSizeBytes -ne $entryB.compressedSizeBytes -or
        $entryA.sha256 -ne $entryB.sha256
    }
    if ($different) {
      [void]$differences.Add([pscustomobject]@{
        status = if ($null -eq $entryA) { "only-in-b" } elseif ($null -eq $entryB) { "only-in-a" } else { "different" }
        pathA = if ($entryA) { $entryA.path } else { $null }
        pathB = if ($entryB) { $entryB.path } else { $null }
        occurrence = if ($entryA) { $entryA.occurrence } else { $entryB.occurrence }
        sizeBytesA = if ($entryA) { $entryA.sizeBytes } else { $null }
        sizeBytesB = if ($entryB) { $entryB.sizeBytes } else { $null }
        compressedSizeBytesA = if ($entryA) { $entryA.compressedSizeBytes } else { $null }
        compressedSizeBytesB = if ($entryB) { $entryB.compressedSizeBytes } else { $null }
        sha256A = if ($entryA) { $entryA.sha256 } else { $null }
        sha256B = if ($entryB) { $entryB.sha256 } else { $null }
      })
    }
  }
  return $differences.ToArray()
}

function Escape-MarkdownCell {
  param([AllowNull()][object]$Value)

  if ($null -eq $Value) { return "" }
  return $Value.ToString().Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
}

$resolvedReportRoot = ""
$sourceA = ""
$sourceB = ""
$normalizedCommit = $ExpectedCommit.Trim().ToLowerInvariant()
$normalizedCertificate = ($ExpectedCertificateSha256.Trim() -replace ':', '').ToLowerInvariant()
$releaseStorePassword = ""
$releaseKeyAlias = ""
$releaseKeyPassword = ""

try {
  if ($normalizedCommit -notmatch '^[0-9a-f]{40}$') {
    throw "ExpectedCommit must be a full 40-character Git commit SHA."
  }
  if ($normalizedCertificate -notmatch '^[0-9a-f]{64}$') {
    throw "ExpectedCertificateSha256 must contain exactly 64 hexadecimal characters."
  }
  if ($Artifact -eq "Release" -and $normalizedCertificate -ne $officialReleaseCertificateSha256) {
    throw "Release reproducibility requires the fixed official certificate SHA-256."
  }

  $scriptRepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path.TrimEnd('\', '/')
  $sourceA = Resolve-DirectoryPath $SourceRootA "SourceRootA"
  $sourceB = Resolve-DirectoryPath $SourceRootB "SourceRootB"
  if ($sourceA.Equals($sourceB, [StringComparison]::OrdinalIgnoreCase)) {
    throw "SourceRootA and SourceRootB must be different directories."
  }
  if ((Test-PathWithin $sourceA $scriptRepositoryRoot) -or (Test-PathWithin $sourceB $scriptRepositoryRoot)) {
    throw "Both source roots must be outside the repository that contains this script."
  }
  if ([regex]::IsMatch($sourceA, '[^\x00-\x7F]') -or [regex]::IsMatch($sourceB, '[^\x00-\x7F]')) {
    throw "Both source roots must use ASCII-only paths."
  }

  $gitCommand = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $gitCommand) { throw "git.exe was not found."
  }
  Assert-CleanSourceRoot "A" $sourceA $gitCommand.Source $normalizedCommit
  Assert-CleanSourceRoot "B" $sourceB $gitCommand.Source $normalizedCommit

  if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
    throw "KeystorePath does not exist or is not a file."
  }
  $resolvedKeystore = (Resolve-Path -LiteralPath $KeystorePath).Path
  Add-SecretValue $resolvedKeystore
  Add-SecretValue $resolvedKeystore.Replace('\', '/')

  if ($Artifact -eq "Release") {
    $releaseStorePassword = ConvertFrom-SecureValue $KeystorePassword
    if (-not $releaseStorePassword) {
      $releaseStorePassword = [Environment]::GetEnvironmentVariable("IMAGE_STUDIO_KEYSTORE_PASSWORD")
    }
    $releaseKeyAlias = $KeyAlias
    if (-not $releaseKeyAlias.Trim()) {
      $releaseKeyAlias = [Environment]::GetEnvironmentVariable("IMAGE_STUDIO_KEY_ALIAS")
    }
    $releaseKeyPassword = ConvertFrom-SecureValue $KeyPassword
    if (-not $releaseKeyPassword) {
      $releaseKeyPassword = [Environment]::GetEnvironmentVariable("IMAGE_STUDIO_KEY_PASSWORD")
    }
    if (-not $releaseStorePassword -or -not $releaseKeyAlias -or -not $releaseKeyPassword) {
      throw "Release requires KeystorePassword, KeyAlias, and KeyPassword parameters or the matching IMAGE_STUDIO_* environment variables."
    }
    Add-SecretValue $releaseStorePassword
    Add-SecretValue $releaseKeyAlias
    Add-SecretValue $releaseKeyPassword
  }

  New-Item -ItemType Directory -Force -Path $ReportRoot | Out-Null
  $resolvedReportRoot = (Resolve-Path -LiteralPath $ReportRoot).Path
  $sdkRoot = Resolve-AndroidSdkRoot @($sourceA, $sourceB)
  $apkAnalyzer = Resolve-AndroidTool "apkanalyzer" $sdkRoot
  $apkSigner = Resolve-AndroidTool "apksigner" $sdkRoot

  foreach ($source in @(
    [pscustomobject]@{ label = "A"; root = $sourceA },
    [pscustomobject]@{ label = "B"; root = $sourceB }
  )) {
    $build = Invoke-Build $source.label $source.root $Artifact $resolvedKeystore `
      $releaseStorePassword $releaseKeyAlias $releaseKeyPassword $normalizedCommit $BuildId $resolvedReportRoot
    [void]$script:buildResults.Add($build)
    if ($build.exitCode -ne 0) {
      Add-ReportError $build.error
      continue
    }

    try {
      $apk = Read-ApkMetadata $source.label $build.apkPath $Artifact $apkAnalyzer $apkSigner `
        (Join-Path $source.root "android-shell") $normalizedCertificate
      [void]$script:apkResults.Add($apk)
      if (-not $apk.metadataMatches) { Add-ReportError "APK metadata mismatch for source $($source.label)." }
      if (-not $apk.certificateMatches) { Add-ReportError "APK certificate mismatch for source $($source.label)." }
      if (-not $apk.signatureV2) { Add-ReportError "APK Signature Scheme v2 is missing for source $($source.label)." }
    }
    catch {
      Add-ReportError $_.Exception.Message
    }
  }

  if ($script:apkResults.Count -eq 2) {
    $apkPathA = ($script:buildResults | Where-Object { $_.label -eq "A" }).apkPath
    $apkPathB = ($script:buildResults | Where-Object { $_.label -eq "B" }).apkPath
    $hashesEqual = $script:apkResults[0].sha256 -eq $script:apkResults[1].sha256
    $bytesEqual = Test-FilesByteEqual $apkPathA $apkPathB
    $script:sha256Equal = $hashesEqual
    $script:byteForByteEqual = $bytesEqual
    if (-not $hashesEqual -or -not $bytesEqual) {
      Add-ReportError "The two APK files are not byte-for-byte identical."
      $script:zipDifferences = @(Get-ZipDifferences $apkPathA $apkPathB)
      $script:containerMetadataOnly = $script:zipDifferences.Count -eq 0
    }

    $validApks = @($script:apkResults.ToArray() | Where-Object { $_.valid }).Count -eq 2
    if ($hashesEqual -and $bytesEqual -and $validApks -and $script:reportErrors.Count -eq 0) {
      $existingApks = @(Get-ChildItem -LiteralPath $resolvedReportRoot -Filter "*.apk" -File -ErrorAction SilentlyContinue)
      if ($existingApks.Count -ne 0) {
        Add-ReportError "ReportRoot already contains an APK; refusing to create more than one output APK."
      }
      else {
        $hashPrefix = $script:apkResults[0].sha256.Substring(0, 12)
        $artifactName = "fhl-image-studio-v2.0.3-$($Artifact.ToLowerInvariant())-reproducible-$hashPrefix.apk"
        Copy-Item -LiteralPath $apkPathA -Destination (Join-Path $resolvedReportRoot $artifactName)
        $script:artifactCopy = $artifactName
      }
    }
  }
  else {
    Add-ReportError "Both APK builds and validations must complete before reproducibility can be compared."
  }
}
catch {
  Add-ReportError $_.Exception.Message
}
finally {
  $releaseStorePassword = $null
  $releaseKeyAlias = $null
  $releaseKeyPassword = $null
}

$finishedAt = Get-Date
$passed = $script:reportErrors.Count -eq 0 -and $null -ne $script:artifactCopy
$comparison = [ordered]@{
  sha256Equal = $script:sha256Equal
  byteForByteEqual = $script:byteForByteEqual
  zipDifferenceCount = $script:zipDifferences.Count
  containerMetadataOnly = $script:containerMetadataOnly
  zipDifferences = $script:zipDifferences
}
$report = [ordered]@{
  schemaVersion = 1
  verifier = "android-reproducible-v2.0.3"
  artifact = $Artifact
  status = if ($passed) { "passed" } else { "failed" }
  expectedCommit = $normalizedCommit
  buildId = $BuildId
  expectedCertificateSha256 = $normalizedCertificate
  startedAt = $startedAt.ToString("o")
  finishedAt = $finishedAt.ToString("o")
  durationMs = [math]::Round(($finishedAt - $startedAt).TotalMilliseconds, 0)
  sources = @(
    [ordered]@{ label = "A"; root = "<source-a>" },
    [ordered]@{ label = "B"; root = "<source-b>" }
  )
  builds = @($script:buildResults.ToArray() | ForEach-Object {
    [ordered]@{
      label = $_.label
      status = $_.status
      exitCode = $_.exitCode
      durationMs = $_.durationMs
      command = $_.command
      logPath = $_.logPath
      gradleUserHome = $_.gradleUserHome
      androidUserHome = $_.androidUserHome
      androidSdkHome = $_.androidSdkHome
      npmCache = $_.npmCache
      keystore = $_.keystore
      error = $_.error
    }
  })
  apks = $script:apkResults.ToArray()
  comparison = $comparison
  artifactCopy = $script:artifactCopy
  errors = $script:reportErrors.ToArray()
}

if ($resolvedReportRoot) {
  $json = ($report | ConvertTo-Json -Depth 12) + "`r`n"
  Write-Utf8BomFile (Join-Path $resolvedReportRoot "reproducibility-report.json") $json

  $markdown = New-Object System.Collections.Generic.List[string]
  [void]$markdown.Add("# Android V2.0.3 Reproducibility Verification")
  [void]$markdown.Add("")
  [void]$markdown.Add("- Result: **$($report.status)**")
  [void]$markdown.Add("- Artifact: ``$Artifact``")
  [void]$markdown.Add("- Commit: ``$normalizedCommit``")
  [void]$markdown.Add("- Expected certificate SHA-256: ``$normalizedCertificate``")
  [void]$markdown.Add("- Duration: $($report.durationMs) ms")
  if ($script:artifactCopy) { [void]$markdown.Add("- Reproducible APK: ``$($script:artifactCopy)``") }
  [void]$markdown.Add("")
  [void]$markdown.Add("## Builds")
  [void]$markdown.Add("")
  [void]$markdown.Add("| Source | Status | Exit | Duration ms | Log |")
  [void]$markdown.Add("|---|---|---:|---:|---|")
  foreach ($build in $script:buildResults) {
    [void]$markdown.Add("| $($build.label) | $($build.status) | $($build.exitCode) | $($build.durationMs) | $($build.logPath) |")
  }
  [void]$markdown.Add("")
  [void]$markdown.Add("## APKs")
  [void]$markdown.Add("")
  [void]$markdown.Add("| Source | SHA-256 | Bytes | Metadata | Certificate |")
  [void]$markdown.Add("|---|---|---:|---|---|")
  foreach ($apk in $script:apkResults) {
    [void]$markdown.Add("| $($apk.label) | ``$($apk.sha256)`` | $($apk.sizeBytes) | $($apk.metadataMatches) | $($apk.certificateMatches) |")
  }
  [void]$markdown.Add("")
  [void]$markdown.Add("## Comparison")
  [void]$markdown.Add("")
  [void]$markdown.Add("- SHA-256 equal: $($comparison.sha256Equal)")
  [void]$markdown.Add("- Byte-for-byte equal: $($comparison.byteForByteEqual)")
  [void]$markdown.Add("- ZIP entry differences: $($comparison.zipDifferenceCount)")
  if ($comparison.containerMetadataOnly) {
    [void]$markdown.Add("- ZIP entry contents match; the raw APK container metadata, ordering, or encoding differs.")
  }
  if ($script:zipDifferences.Count -gt 0) {
    [void]$markdown.Add("")
    [void]$markdown.Add("| Status | Path A | Path B | Occurrence | Size A | Size B | SHA-256 A | SHA-256 B |")
    [void]$markdown.Add("|---|---|---|---:|---:|---:|---|---|")
    foreach ($difference in $script:zipDifferences) {
      [void]$markdown.Add("| $(Escape-MarkdownCell $difference.status) | $(Escape-MarkdownCell $difference.pathA) | $(Escape-MarkdownCell $difference.pathB) | $($difference.occurrence) | $(Escape-MarkdownCell $difference.sizeBytesA) | $(Escape-MarkdownCell $difference.sizeBytesB) | $(Escape-MarkdownCell $difference.sha256A) | $(Escape-MarkdownCell $difference.sha256B) |")
    }
  }
  if ($script:reportErrors.Count -gt 0) {
    [void]$markdown.Add("")
    [void]$markdown.Add("## Errors")
    [void]$markdown.Add("")
    foreach ($message in $script:reportErrors) { [void]$markdown.Add("- $(Escape-MarkdownCell $message)") }
  }
  Write-Utf8BomFile (Join-Path $resolvedReportRoot "reproducibility-report.md") (($markdown -join "`r`n") + "`r`n")
}

Write-Host "[Android reproducibility] Result: $($report.status)"
if ($resolvedReportRoot) { Write-Host "[Android reproducibility] Report: $resolvedReportRoot" }
if ($script:zipDifferences.Count -gt 0) {
  Write-Host "[Android reproducibility] ZIP entry differences: $($script:zipDifferences.Count)"
}
if ($script:containerMetadataOnly) {
  Write-Host "[Android reproducibility] ZIP contents match; raw container bytes differ."
}
if (-not $passed) { exit 1 }
