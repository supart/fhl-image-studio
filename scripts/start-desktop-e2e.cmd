@echo off
setlocal
set "ROOT=%~dp0.."
set "EXE=%ROOT%\image-studio\build\bin\FHL Studio 方汤圆版 V2.0.3.exe"

if not exist "%EXE%" (
  echo FHL Studio desktop EXE was not found:
  echo %EXE%
  echo.
  echo Build it first from image-studio:
  echo   npm run build:windows
  echo   wails build -platform windows/amd64 -s
  exit /b 1
)

echo Starting FHL Studio desktop E2E mode...
echo Codex/browser URL: http://127.0.0.1:9230/
start "" "%EXE%" --e2e --e2e-port 9230
