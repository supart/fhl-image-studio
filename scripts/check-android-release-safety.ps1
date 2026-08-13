param(
  [string]$Root = ".",
  [string]$ZipPath = "",
  [string]$SourceZipPath = "",
  [string]$ApkPath = "",
  [string]$AttachmentsRoot = "",
  [string]$OutputJson = ""
)

$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$git = @(Get-Command git -CommandType Application -All -ErrorAction SilentlyContinue)[0]
$forbiddenNames = @(
  "cli.env.local", "fhl-api.local.json", "browser-jobs.v1.json", "PROJECT_CONTEXT.md"
)
$signingMaterialPattern = [regex]::new('(?i)\.(?:jks|keystore|p12|pfx|pem|key)$|(?:^|[\\/])(?:release-signing|signing-credentials?|keystore-password)(?:[.-]|$)')
$forbiddenPathPattern = [regex]::new('(?i)(?:^|[\\/])(?:\.local|V2\.0\.3-\S*\u9a8c\u6536\u8bb0\u5f55|artifacts?|\u53d1\u5e03\u5305|output[\\/]log|logs?|input|intermediate)(?:[\\/]|$)|(?:^|[\\/])session-.*\.(?:jsonl|md)$')
$privateLogPattern = [regex]::new('(?i)(?:^|[\\/])(?:private|personal|device|emulator|acceptance)[-_]?(?:log|trace)s?(?:[\\/]|$)|(?:^|[\\/])(?:private|personal|session)-.*\.(?:log|jsonl|trace)$')
$secretPatterns = @(
  [regex]::new('(?i)\bsk-[a-z0-9_-]{20,}\b'),
  [regex]::new('(?i)\bbearer\s+[a-z0-9._~+/=-]{20,}\b'),
  [regex]::new('(?i)\b(?:ghp_[a-z0-9]{30,}|github_pat_[a-z0-9_]{30,}|AIza[a-z0-9_-]{30,}|AKIA[0-9A-Z]{16})\b'),
  [regex]::new('(?i)["'']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|storePassword|keyPassword)["'']?\s*[:=]\s*["''](?!sk-)([a-z0-9._~+/=-]{12,})["'']'),
  [regex]::new('(?i)\bIMAGE_STUDIO_(?:KEYSTORE_PASSWORD|KEY_PASSWORD)\s*=\s*["'']?([a-z0-9._~+/=-]{8,})["'']?'),
  [regex]::new('-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
)
$syntheticSecretPattern = [regex]::new('(?i)(?:synthetic|fixture)-placeholder(?:[-_.][a-z0-9]+){1,}|not[-_]?a[-_]?real(?:[-_.][a-z0-9]+){1,}')
$windowsUsersPattern = '[a-z]:\\' + 'Users\\[^\\\r\n]+\\'
$macUsersPattern = '/' + 'Users/[^/\r\n]+/'
$workspacePathPattern = [regex]::Escape(('I:' + [IO.Path]::DirectorySeparatorChar + 'AI' + [IO.Path]::DirectorySeparatorChar))
$workspaceSlashPathPattern = [regex]::Escape(('I:' + '/' + 'AI' + '/'))
$privatePathPattern = [regex]::new("(?i)(?:$windowsUsersPattern|$macUsersPattern|$workspacePathPattern|$workspaceSlashPathPattern)")

function New-ScanSection {
  param([string]$Kind)
  return [ordered]@{
    kind = $Kind
    files = 0
    entries = 0
    bytes = 0L
    forbiddenFiles = 0
    secretPatternFiles = 0
    privatePathFiles = 0
    signingMaterialFiles = 0
    privateLogFiles = 0
    skipped = 0
    readErrors = 0
  }
}

function Test-ForbiddenPath {
  param([string]$RelativePath)
  $name = [IO.Path]::GetFileName($RelativePath)
  return $forbiddenNames -contains $name -or $forbiddenPathPattern.IsMatch($RelativePath)
}

function Test-StreamSafety {
  param([Parameter(Mandatory = $true)][IO.Stream]$Stream)

  $reader = [IO.StreamReader]::new($Stream, [Text.Encoding]::UTF8, $true, 8192, $true)
  try {
    $buffer = New-Object char[] 8192
    $tail = ""
    $secretFound = $false
    $privatePathFound = $false
    [long]$characters = 0
    while (($read = $reader.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $characters += $read
      $chunk = $tail + [string]::new($buffer, 0, $read)
      if (-not $secretFound) {
        foreach ($pattern in $secretPatterns) {
          foreach ($match in $pattern.Matches($chunk)) {
            if (-not $syntheticSecretPattern.IsMatch($match.Value)) {
              $secretFound = $true
              break
            }
          }
          if ($secretFound) { break }
        }
      }
      if (-not $privatePathFound -and $privatePathPattern.IsMatch($chunk)) { $privatePathFound = $true }
      $tail = if ($chunk.Length -gt 1024) { $chunk.Substring($chunk.Length - 1024) } else { $chunk }
    }
    return [pscustomobject]@{
      characters = $characters
      secretFound = $secretFound
      privatePathFound = $privatePathFound
    }
  }
  finally { $reader.Dispose() }
}

function ConvertTo-CommandLineArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-GitText {
  param([string[]]$Arguments)
  if (-not $git) { throw "Git is required for repository safety scanning." }
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $git.Source
  $startInfo.Arguments = (@("-C", $resolvedRoot) + $Arguments | ForEach-Object { ConvertTo-CommandLineArgument ([string]$_) }) -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Unable to start Git." }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Git failed: $stderr" }
    return $stdout
  }
  finally { $process.Dispose() }
}

function Add-GitBlobToSection {
  param([System.Collections.IDictionary]$Section, [string]$ObjectId)
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $git.Source
  $startInfo.Arguments = (@("-C", $resolvedRoot, "cat-file", "blob", $ObjectId) |
    ForEach-Object { ConvertTo-CommandLineArgument ([string]$_) }) -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Unable to read Git blob." }
    $memory = [IO.MemoryStream]::new()
    $copyTask = $process.StandardOutput.BaseStream.CopyToAsync($memory)
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $null = $copyTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Unable to read Git blob: $stderr" }
    $memory.Position = 0
    try { Add-StreamResult -Section $Section -Stream $memory } finally { $memory.Dispose() }
  }
  finally { $process.Dispose() }
}

function Get-WorktreeFiles {
  if ($git -and (Test-Path -LiteralPath (Join-Path $resolvedRoot ".git"))) {
    # Keep the tracked invocation stable because callers audit its UTF-8/NUL behavior.
    $tracked = Invoke-GitText -Arguments @("-c", "core.quotepath=false", "ls-files", "-z")
    $untracked = Invoke-GitText -Arguments @("-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "-z")
    $stdout = $tracked + $untracked
    return @(($stdout -split "`0") |
      Where-Object { -not [string]::IsNullOrEmpty($_) } |
      Select-Object -Unique |
      ForEach-Object { Join-Path $resolvedRoot $_ })
  }
  return @(Get-ChildItem -LiteralPath $resolvedRoot -Recurse -Force -File -ErrorAction Stop |
    Where-Object { $_.FullName -notmatch '[\\/](?:\.git|node_modules|build|dist)[\\/]' } |
    ForEach-Object FullName)
}

function Add-PathFlags {
  param([System.Collections.IDictionary]$Section, [string]$RelativePath)
  if (Test-ForbiddenPath -RelativePath $RelativePath) { $Section.forbiddenFiles += 1 }
  if ($signingMaterialPattern.IsMatch($RelativePath)) { $Section.signingMaterialFiles += 1 }
  if ($privateLogPattern.IsMatch($RelativePath)) { $Section.privateLogFiles += 1 }
}

function Add-StreamResult {
  param([System.Collections.IDictionary]$Section, [IO.Stream]$Stream)
  $scan = Test-StreamSafety -Stream $Stream
  if ($scan.secretFound) { $Section.secretPatternFiles += 1 }
  if ($scan.privatePathFound) { $Section.privatePathFiles += 1 }
}

function Add-FileToSection {
  param([System.Collections.IDictionary]$Section, [string]$Path, [string]$RelativePath)
  $Section.files += 1
  Add-PathFlags -Section $Section -RelativePath $RelativePath
  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    $Section.bytes += [long]$item.Length
    $stream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try { Add-StreamResult -Section $Section -Stream $stream } finally { $stream.Dispose() }
  }
  catch { $Section.readErrors += 1 }
}

function Add-ZipToSection {
  param([System.Collections.IDictionary]$Section, [string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    $Section.readErrors += 1
    return
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  try {
    $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
    try {
      foreach ($entry in $zip.Entries) {
        if ([string]::IsNullOrEmpty($entry.Name)) { continue }
        $Section.entries += 1
        $Section.bytes += [long]$entry.Length
        $relative = $entry.FullName.Replace('/', '\')
        Add-PathFlags -Section $Section -RelativePath $relative
        try {
          $stream = $entry.Open()
          try { Add-StreamResult -Section $Section -Stream $stream } finally { $stream.Dispose() }
        }
        catch { $Section.readErrors += 1 }
      }
    }
    finally { $zip.Dispose() }
  }
  catch { $Section.readErrors += 1 }
}

function Add-GitReachableBlobs {
  param([System.Collections.IDictionary]$Section)
  if (-not $git -or -not (Test-Path -LiteralPath (Join-Path $resolvedRoot ".git"))) { return }
  try {
    $commits = @((Invoke-GitText -Arguments @("rev-list", "HEAD")) -split "`r?`n" | Where-Object { $_ })
    $seen = @{}
    foreach ($commit in $commits) {
      $tree = Invoke-GitText -Arguments @("-c", "core.quotepath=false", "ls-tree", "-rlz", $commit)
      foreach ($record in @($tree -split "`0" | Where-Object { $_ })) {
        if ($record -notmatch '^[0-7]{6}\s+blob\s+([0-9a-f]{40,64})\s+([0-9-]+)\t([\s\S]+)$') { continue }
        $oid = $Matches[1]
        $size = $Matches[2]
        $relative = $Matches[3]
        $identity = "$oid`0$relative"
        if ($seen.ContainsKey($identity)) { continue }
        $seen[$identity] = $true
        $Section.files += 1
        if ($size -match '^\d+$') { $Section.bytes += [long]$size }
        Add-PathFlags -Section $Section -RelativePath $relative
        try {
          Add-GitBlobToSection -Section $Section -ObjectId $oid
        }
        catch { $Section.readErrors += 1 }
      }
    }
  }
  catch { $Section.readErrors += 1 }
}

function Get-SectionIssues {
  param([System.Collections.IDictionary]$Section)
  return [int]$Section.forbiddenFiles + [int]$Section.secretPatternFiles +
    [int]$Section.privatePathFiles + [int]$Section.signingMaterialFiles +
    [int]$Section.privateLogFiles + [int]$Section.skipped + [int]$Section.readErrors
}

$report = [ordered]@{
  schemaVersion = 3
  status = "running"
  root = New-ScanSection -Kind "worktree"
  gitReachable = New-ScanSection -Kind "git-reachable-blobs"
  archive = if ($ZipPath.Trim()) { New-ScanSection -Kind "legacy-archive" } else { $null }
  sourceZip = if ($SourceZipPath.Trim()) { New-ScanSection -Kind "source-zip" } else { $null }
  apk = if ($ApkPath.Trim()) { New-ScanSection -Kind "apk" } else { $null }
  attachments = if ($AttachmentsRoot.Trim()) { New-ScanSection -Kind "attachments" } else { $null }
}

foreach ($path in @(Get-WorktreeFiles)) {
  $relative = if ($path.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $path.Substring($resolvedRoot.Length).TrimStart('\', '/')
  } else { $path }
  Add-FileToSection -Section $report.root -Path $path -RelativePath $relative
}
Add-GitReachableBlobs -Section $report.gitReachable

if ($report.archive) { Add-ZipToSection -Section $report.archive -Path $ZipPath }
if ($report.sourceZip) { Add-ZipToSection -Section $report.sourceZip -Path $SourceZipPath }
if ($report.apk) { Add-ZipToSection -Section $report.apk -Path $ApkPath }
if ($report.attachments) {
  if (-not (Test-Path -LiteralPath $AttachmentsRoot -PathType Container)) {
    $report.attachments.readErrors += 1
  } else {
    $resolvedAttachments = (Resolve-Path -LiteralPath $AttachmentsRoot).Path
    foreach ($file in @(Get-ChildItem -LiteralPath $resolvedAttachments -Recurse -Force -File -ErrorAction SilentlyContinue)) {
      $relative = $file.FullName.Substring($resolvedAttachments.Length).TrimStart('\', '/')
      Add-FileToSection -Section $report.attachments -Path $file.FullName -RelativePath $relative
      if ($file.Extension -match '(?i)^\.(?:zip|apk)$') {
        Add-ZipToSection -Section $report.attachments -Path $file.FullName
      }
    }
  }
}

$sections = @($report.root, $report.gitReachable, $report.archive, $report.sourceZip, $report.apk, $report.attachments) |
  Where-Object { $null -ne $_ }
$issueCount = 0
foreach ($section in $sections) { $issueCount += Get-SectionIssues -Section $section }
$report.status = if ($issueCount -eq 0) { "passed" } else { "failed" }
$report.issueCount = $issueCount

if ($OutputJson.Trim()) {
  $parent = Split-Path -Parent $OutputJson
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [IO.File]::WriteAllText($OutputJson, ($report | ConvertTo-Json -Depth 6) + "`n", [Text.UTF8Encoding]::new($false))
}

Write-Host "[Android release safety] Status: $($report.status)"
Write-Host "[Android release safety] Worktree files / total issues: $($report.root.files) / $issueCount"
Write-Host "[Android release safety] Reachable Git blobs: $($report.gitReachable.files)"
if ($report.archive) { Write-Host "[Android release safety] Legacy archive entries: $($report.archive.entries)" }
if ($report.sourceZip) { Write-Host "[Android release safety] Source ZIP entries: $($report.sourceZip.entries)" }
if ($report.apk) { Write-Host "[Android release safety] APK entries: $($report.apk.entries)" }
if ($report.attachments) { Write-Host "[Android release safety] Attachment files / archive entries: $($report.attachments.files) / $($report.attachments.entries)" }
if ($issueCount -gt 0) { exit 1 }
