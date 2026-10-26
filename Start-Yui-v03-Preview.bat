@echo off
setlocal
title Mesh Avatar Studio - Yui v03 Preview
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-yui-v03.ps1" -Preview %*
set "launch_result=%errorlevel%"
if not "%launch_result%"=="0" (
  echo.
  echo Mesh Avatar Studio could not start. See the message above.
  pause
)
exit /b %launch_result%
