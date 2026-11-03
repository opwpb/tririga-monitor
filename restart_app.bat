@echo off
title Restart TRIRIGA Log Analysis Server
cd /d "%~dp0"

echo ====================================================================
echo   Restarting IBM TRIRIGA Log Analysis ^& Forensics Application
echo ====================================================================
echo.

echo 1. Stopping existing process on port 8000...
powershell -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 >nul

echo 2. Locating Python runtime...
set "PYTHON_EXE="
if exist "%~dp0python_runtime\python.exe" (
    set "PYTHON_EXE=%~dp0python_runtime\python.exe"
    goto :start_server
)

python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON_EXE=python"
    goto :start_server
)

echo [ERROR] Python was not found in python_runtime\ or system PATH.
pause
exit /b 1

:start_server
echo 3. Starting TRIRIGA Log Analyzer on http://127.0.0.1:8000...
echo.
"%PYTHON_EXE%" run.py

pause
