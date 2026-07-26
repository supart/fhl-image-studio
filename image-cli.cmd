@echo off
setlocal

set "ROOT=%~dp0"
if "%IMAGE_STUDIO_PUBLIC_ROOT%"=="" (
  set "PUBLIC_ROOT=%ROOT%"
) else (
  for %%I in ("%IMAGE_STUDIO_PUBLIC_ROOT%") do set "PUBLIC_ROOT=%%~fI"
)
for %%I in ("%PUBLIC_ROOT%\.") do set "PUBLIC_ROOT=%%~fI\"
set "CLI_EXE=%ROOT%runtime\cli\gptcodex-image.exe"
set "CONFIG=%ROOT%config\cli.env.local"
if not exist "%CONFIG%" if exist "%ROOT%config\cli.env.example" set "CONFIG=%ROOT%config\cli.env.example"

if not exist "%CLI_EXE%" (
  echo [FHL Studio CLI] Missing runtime\cli\gptcodex-image.exe 1>&2
  echo [FHL Studio CLI] Build or copy the portable CLI runtime first. 1>&2
  exit /b 1
)

if not exist "%PUBLIC_ROOT%input" mkdir "%PUBLIC_ROOT%input"
if not exist "%PUBLIC_ROOT%output" mkdir "%PUBLIC_ROOT%output"
if not exist "%PUBLIC_ROOT%output\log" mkdir "%PUBLIC_ROOT%output\log"
if not exist "%PUBLIC_ROOT%intermediate" mkdir "%PUBLIC_ROOT%intermediate"

pushd "%PUBLIC_ROOT%" >nul
"%CLI_EXE%" ^
  --no-input ^
  --json ^
  --config "%CONFIG%" ^
  --out-dir "%PUBLIC_ROOT%output" ^
  --raw-dir "%PUBLIC_ROOT%output\log" ^
  --input-dir "%PUBLIC_ROOT%input" ^
  %*
set "STATUS=%ERRORLEVEL%"
popd >nul

exit /b %STATUS%

