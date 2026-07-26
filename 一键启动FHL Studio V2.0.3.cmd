@echo off
setlocal EnableExtensions

chcp 65001 >nul 2>nul

set "ROOT=%~dp0"
set "EXE=%ROOT%FHL Studio 方汤圆版 V2.0.3.exe"
set "LOGDIR=%ROOT%output\log"
set "STARTLOG=%LOGDIR%\startup-%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%.log"
set "STARTLOG=%STARTLOG: =0%"

if not exist "%ROOT%input" mkdir "%ROOT%input" >nul 2>nul
if not exist "%ROOT%output" mkdir "%ROOT%output" >nul 2>nul
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>nul
if not exist "%ROOT%intermediate" mkdir "%ROOT%intermediate" >nul 2>nul
if not exist "%ROOT%config" mkdir "%ROOT%config" >nul 2>nul
if not exist "%ROOT%.fhl-studio-portable" type nul > "%ROOT%.fhl-studio-portable"

(
  echo [FHL Studio] 启动时间: %DATE% %TIME%
  echo [FHL Studio] 便携包根目录: %ROOT%
  echo [FHL Studio] EXE: %EXE%
) > "%STARTLOG%"

if not exist "%EXE%" (
  echo.
  echo [错误] 找不到桌面程序文件:
  echo        %EXE%
  echo.
  echo 这个启动器用于打开独立桌面窗口，不会启动浏览器预览。
  echo 请先运行正式 Windows 便携包打包脚本，生成 FHL Studio 方汤圆版 V2.0.3.exe，
  echo 或把已构建的 EXE 放到这个启动器同一目录。
  echo.
  echo 打包命令示例:
  echo powershell -ExecutionPolicy Bypass -File .\scripts\package-windows-portable-v2.0.3.ps1
  echo.
  echo MISSING_EXE >> "%STARTLOG%"
  pause
  exit /b 1
)

set "IMAGE_STUDIO_PUBLIC_ROOT=%ROOT%"
set "IMAGE_STUDIO_INTERNAL_ROOT=%ROOT%"

echo.
echo 正在启动 FHL Studio 方汤圆版 V2.0.3 独立桌面窗口...
echo 图片会保存到: %ROOT%output
echo 日志会保存到: %LOGDIR%
echo.

start "" "%EXE%"
set "EXIT_CODE=%ERRORLEVEL%"
echo [FHL Studio] start exit code: %EXIT_CODE% >> "%STARTLOG%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [错误] 启动失败，日志位置:
  echo        %STARTLOG%
  pause
)

exit /b %EXIT_CODE%
