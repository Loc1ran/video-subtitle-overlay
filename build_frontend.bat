@echo off
title Build Video Subtitle Studio Frontend
cd /d "%~dp0frontend"
echo Building frontend assets with bun...
call bun run build
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)
echo.
echo =======================================================
echo Frontend build complete! Assets output to app/static/
echo =======================================================
pause
