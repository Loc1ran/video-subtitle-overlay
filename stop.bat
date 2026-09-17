@echo off
title Stop Video Subtitle Studio
cd /d "%~dp0"

echo =======================================================
echo          STOPPING VIDEO SUBTITLE STUDIO
echo =======================================================
echo.

set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon -p tcp ^| findstr :8000 ^| findstr LISTENING') do (
    set FOUND=1
    echo Terminating PID %%a on port 8000...
    taskkill /F /PID %%a >nul 2>&1
)

if "%FOUND%"=="1" (
    echo.
    echo [SUCCESS] Video Subtitle Studio server stopped successfully.
) else (
    echo [INFO] No active process was found on port 8000.
)

echo.
pause
