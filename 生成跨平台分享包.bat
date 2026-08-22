@echo off
setlocal
cd /d "%~dp0"

set "SERVER=%~dp0run\game-server-windows-amd64.exe"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "SERVER=%~dp0run\game-server-windows-arm64.exe"
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "SERVER=%~dp0run\game-server-windows-arm64.exe"

if not exist "%SERVER%" (
    echo Portable packaging tool not found: %SERVER%
    pause
    exit /b 1
)

set "OUTPUT=%~dp0..\Endless-Dream-Windows-macOS.zip"
echo Creating the Windows and macOS sharing package...
echo Output: %OUTPUT%
echo This can take several minutes because the game contains large 3D assets.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run\package.ps1" -Server "%SERVER%" -Output "%OUTPUT%"
if errorlevel 1 (
    echo.
    echo Packaging failed. If the ZIP already exists, move or rename it and try again.
    pause
    exit /b 1
)

echo.
echo Package complete. Send the generated ZIP without recompressing it.
pause
