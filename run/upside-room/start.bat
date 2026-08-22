@echo off
setlocal

cd /d "%~dp0"
set "PORT=8123"
set "URL=http://127.0.0.1:%PORT%/index.html"

echo Starting Upside Room Prototype...
echo Project folder: %CD%
echo URL: %URL%
echo.

start "" "%URL%"

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py -3 -m http.server %PORT% --bind 127.0.0.1
    goto :done
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python -m http.server %PORT% --bind 127.0.0.1
    goto :done
)

echo Python was not found.
echo Install Python, then double-click this file again.

:done
echo.
echo If the browser did not open, visit:
echo %URL%
pause
