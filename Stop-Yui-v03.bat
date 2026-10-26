@echo off
setlocal
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tools\start-yui-v03.ps1" -Stop -ShowErrors %*
exit /b %errorlevel%
