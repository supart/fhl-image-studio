$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root "FHL Studio 方汤圆版 V2.0.3.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  $exe = Get-ChildItem -LiteralPath $root -Filter "FHL Studio *.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}

$logDir = Join-Path $root "output\log"
foreach ($dir in @("input", "output", "intermediate", "config", "output\log")) {
  $path = Join-Path $root $dir
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
}

$marker = Join-Path $root ".fhl-studio-portable"
if (-not (Test-Path -LiteralPath $marker)) {
  New-Item -ItemType File -Path $marker | Out-Null
}

$startLog = Join-Path $logDir ("startup-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
@(
  "[FHL Studio] Startup time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
  "[FHL Studio] Portable root: $root",
  "[FHL Studio] EXE: $exe"
) | Set-Content -LiteralPath $startLog -Encoding UTF8

if (-not $exe -or -not (Test-Path -LiteralPath $exe)) {
  Add-Content -LiteralPath $startLog -Value "MISSING_EXE" -Encoding UTF8
  Write-Host ""
  Write-Host "[FHL Studio] Missing desktop executable beside this launcher."
  Write-Host "Expected: FHL Studio 方汤圆版 V2.0.3.exe"
  Write-Host "Folder:   $root"
  exit 1
}

$env:IMAGE_STUDIO_PUBLIC_ROOT = $root
$env:IMAGE_STUDIO_INTERNAL_ROOT = $root

Write-Host ""
Write-Host "Starting FHL Studio desktop window..."
Write-Host "Output: $root\output"
Write-Host "Log:    $logDir"
Write-Host ""

$process = Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
Add-Content -LiteralPath $startLog -Value ("[FHL Studio] process id: {0}" -f $process.Id) -Encoding UTF8
exit 0
