$ErrorActionPreference = "Stop"

function New-FhlPhotoshopIntegrationMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$LaunchPath,
    [Parameter(Mandatory = $true)][string]$DesktopVersion
  )

  [pscustomobject][ordered]@{
    productId                   = "fhl-image-studio-desktop"
    integrationFileFormatMajor = 1
    psBridgeProtocolMajor      = 1
    launchPath                  = $LaunchPath
    displayName                 = "FHL Studio 方汤圆版"
    desktopVersion              = $DesktopVersion
  }
}

function Assert-FhlPhotoshopRelativeLaunchPath {
  param(
    [Parameter(Mandatory = $true)][string]$PackageRoot,
    [Parameter(Mandatory = $true)][string]$LaunchPath,
    [switch]$RequireExistingTarget
  )

  if (-not $LaunchPath.Trim()) {
    throw "Photoshop 对接文件的 launchPath 不能为空。"
  }
  if ([System.IO.Path]::IsPathRooted($LaunchPath) -or $LaunchPath -match '^[A-Za-z]:') {
    throw "Photoshop 对接文件的 launchPath 必须是包根目录内的相对路径。"
  }

  $normalized = $LaunchPath.Replace('/', '\')
  if ($normalized -match '(^|\\)\.\.(\\|$)') {
    throw "Photoshop 对接文件的 launchPath 不得包含路径穿越。"
  }

  $rootFull = [System.IO.Path]::GetFullPath($PackageRoot).TrimEnd('\', '/')
  $targetFull = [System.IO.Path]::GetFullPath((Join-Path $rootFull $normalized))
  $rootPrefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $targetFull.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Photoshop 对接文件的 launchPath 必须解析到包根目录内。"
  }
  if ($RequireExistingTarget -and -not (Test-Path -LiteralPath $targetFull -PathType Leaf)) {
    throw "Photoshop 对接文件的 launchPath 目标不存在: $normalized"
  }
  return $targetFull
}

function Assert-FhlPhotoshopIntegrationMetadata {
  param(
    [Parameter(Mandatory = $true)]$Metadata,
    [Parameter(Mandatory = $true)][string]$PackageRoot,
    [string]$ExpectedLaunchPath = "",
    [switch]$RequireExistingTarget
  )

  if ($null -eq $Metadata) {
    throw "Photoshop 对接文件内容不能为空。"
  }

  $expectedFields = @(
    "productId",
    "integrationFileFormatMajor",
    "psBridgeProtocolMajor",
    "launchPath",
    "displayName",
    "desktopVersion"
  )
  $actualFields = @($Metadata.PSObject.Properties.Name)
  if ($actualFields.Count -ne $expectedFields.Count -or
      @($expectedFields | Where-Object { $actualFields -notcontains $_ }).Count -gt 0 -or
      @($actualFields | Where-Object { $expectedFields -notcontains $_ }).Count -gt 0) {
    throw "Photoshop 对接文件只允许固定的非敏感字段。"
  }
  if ([string]$Metadata.productId -ne "fhl-image-studio-desktop") {
    throw "Photoshop 对接文件 productId 不正确。"
  }
  if ($Metadata.integrationFileFormatMajor -is [string] -or [string]$Metadata.integrationFileFormatMajor -ne "1") {
    throw "Photoshop 对接文件格式主版本不受支持。"
  }
  if ($Metadata.psBridgeProtocolMajor -is [string] -or [string]$Metadata.psBridgeProtocolMajor -ne "1") {
    throw "Photoshop Bridge 协议主版本不受支持。"
  }
  if (-not [string]$Metadata.displayName -or -not [string]$Metadata.desktopVersion) {
    throw "Photoshop 对接文件显示名称和桌面版本不能为空。"
  }

  $resolvedLaunchPath = Assert-FhlPhotoshopRelativeLaunchPath `
    -PackageRoot $PackageRoot `
    -LaunchPath ([string]$Metadata.launchPath) `
    -RequireExistingTarget:$RequireExistingTarget
  if ($ExpectedLaunchPath.Trim() -and
      ([string]$Metadata.launchPath).Replace('/', '\') -ne $ExpectedLaunchPath.Replace('/', '\')) {
    throw "Photoshop 对接文件 launchPath 与当前 Portable 启动目标不一致。"
  }
  return $resolvedLaunchPath
}

function Write-FhlPhotoshopIntegrationMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$PackageRoot,
    [Parameter(Mandatory = $true)][string]$LaunchPath,
    [Parameter(Mandatory = $true)][string]$DesktopVersion,
    [string]$FileName = "FHL Studio Photoshop 对接文件.json"
  )

  if ($FileName -ne "FHL Studio Photoshop 对接文件.json") {
    throw "Photoshop 对接文件名固定为 FHL Studio Photoshop 对接文件.json。"
  }

  $metadata = New-FhlPhotoshopIntegrationMetadata `
    -LaunchPath $LaunchPath `
    -DesktopVersion $DesktopVersion
  Assert-FhlPhotoshopIntegrationMetadata `
    -Metadata $metadata `
    -PackageRoot $PackageRoot `
    -ExpectedLaunchPath $LaunchPath `
    -RequireExistingTarget | Out-Null

  $targetPath = Join-Path $PackageRoot $FileName
  $json = $metadata | ConvertTo-Json -Depth 3
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($targetPath, "$json`n", $utf8)
  return $targetPath
}

function Read-FhlPhotoshopIntegrationMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$PackageRoot,
    [string]$FileName = "FHL Studio Photoshop 对接文件.json"
  )

  if ($FileName -ne "FHL Studio Photoshop 对接文件.json") {
    throw "Photoshop 对接文件名固定为 FHL Studio Photoshop 对接文件.json。"
  }

  $path = Join-Path $PackageRoot $FileName
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "缺少 Photoshop 对接文件: $path"
  }
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $metadata = [System.IO.File]::ReadAllText($path, $utf8) | ConvertFrom-Json
  } catch {
    throw "Photoshop 对接文件不是有效 JSON: $path"
  }
  Assert-FhlPhotoshopIntegrationMetadata -Metadata $metadata -PackageRoot $PackageRoot | Out-Null
  return $metadata
}
