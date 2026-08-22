@echo off
setlocal
cd /d "%~dp0"

set "SERVER=%~dp0run\game-server-windows-amd64.exe"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "SERVER=%~dp0run\game-server-windows-arm64.exe"
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "SERVER=%~dp0run\game-server-windows-arm64.exe"

if exist "%SERVER%" (
    "%SERVER%" -port 8137
    if not errorlevel 1 exit /b 0
    echo.
    echo The portable server could not run. Trying the Windows PowerShell fallback...
 ) else (
    echo Portable server not found. Trying the Windows PowerShell fallback...
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run\serve.ps1" -Port 8137
if errorlevel 1 (
    echo.
    echo The game server could not start.
    pause
)
