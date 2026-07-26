@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "PS1=%ROOT%portable-windows-launcher-v2.0.3.ps1"

if not exist "%PS1%" (
  echo [FHL Studio] Missing launcher script:
  echo   %PS1%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [FHL Studio] Launcher failed with exit code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
