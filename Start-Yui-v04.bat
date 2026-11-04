@echo off
setlocal
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tools\start-yui-v04.ps1" -ShowErrors %*
exit /b %errorlevel%
