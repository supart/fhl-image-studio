@echo off
setlocal

set "SRC=%~dp0SKILL.md"
set "PACKAGE_ROOT=%~dp0"
set "SKILL_NAME=fhl-image-studio-v2-0-3"
set "DST=%USERPROFILE%\.codex\skills\%SKILL_NAME%"
set "OLD1=%USERPROFILE%\.codex\skills\fhl-image-studio-cli"
set "OLD2=%USERPROFILE%\.codex\skills\fhl-ty-v2"
set "OLD3=%USERPROFILE%\.codex\skills\fhl-image-studio"

if not exist "%SRC%" (
  echo Cannot find "%SRC%"
  pause
  exit /b 1
)

if not exist "%PACKAGE_ROOT%image-cli.cmd" (
  echo Cannot find "%PACKAGE_ROOT%image-cli.cmd"
  echo Please run this installer from the FHL Studio package root.
  pause
  exit /b 1
)

if not exist "%USERPROFILE%\.codex\skills" mkdir "%USERPROFILE%\.codex\skills"
if not exist "%DST%" mkdir "%DST%"

copy /Y "%SRC%" "%DST%\SKILL.md" >nul
if errorlevel 1 (
  echo Failed to install Codex skill.
  pause
  exit /b 1
)

> "%DST%\PACKAGE_ROOT.txt" echo %PACKAGE_ROOT%
if errorlevel 1 (
  echo Failed to write package root locator.
  pause
  exit /b 1
)

call :disable_old "%OLD1%" "%USERPROFILE%\.codex\skills\fhl-image-studio-cli.disabled"
call :disable_old "%OLD2%" "%USERPROFILE%\.codex\skills\fhl-ty-v2.disabled"
call :disable_old "%OLD3%" "%USERPROFILE%\.codex\skills\fhl-image-studio.disabled"

echo Installed Codex skill:
echo   %DST%\SKILL.md
echo   %DST%\PACKAGE_ROOT.txt
echo.
echo Skill name:
echo   %SKILL_NAME%
echo.
echo Package root:
echo   %PACKAGE_ROOT%
echo.
echo Package line:
echo   V2.0.3 versioned skill entry, auto-detects CLI status via image-cli.cmd --status --json
echo.
echo Restart Codex or open a new Codex thread to let it discover the updated skill.
pause
endlocal
exit /b 0

:disable_old
if exist "%~1\SKILL.md" (
  if exist "%~2" rmdir /S /Q "%~2"
  move "%~1" "%~2" >nul
  if exist "%~2\SKILL.md" ren "%~2\SKILL.md" "SKILL.md.disabled"
)
exit /b 0
