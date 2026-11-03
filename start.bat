@echo off
title TRIRIGA Log Analysis ^& Forensics SPA
cd /d "%~dp0"

echo ====================================================================
echo   Starting IBM TRIRIGA Log Analysis ^& Forensics Application
echo ====================================================================
echo.

:: Check for local portable Python first, then system Python
set "PYTHON_EXE="
if exist "%~dp0python_runtime\python.exe" (
    set "PYTHON_EXE=%~dp0python_runtime\python.exe"
    echo Using local portable Python runtime...
    goto :launch
)

python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON_EXE=python"
    echo Using system Python...
    goto :launch
)

echo [ERROR] Python is not found.
echo Portable Python was not detected and Python is not in your system PATH.
echo Please install Python 3.10+ or place a portable runtime in python_runtime\
pause
exit /b 1

:launch
:: Launch application
echo.
echo Launching server on http://127.0.0.1:8000 and opening browser...
echo (Keep this window open while using the application)
echo.
"%PYTHON_EXE%" run.py

pause
