@echo off
setlocal EnableExtensions

call "%~dp0scripts\portable-windows-launcher.cmd" %*
exit /b %ERRORLEVEL%
