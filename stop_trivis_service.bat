@echo off
title Stop TRIVIS Admin Dashboard Backend Service
cd /d "%~dp0"

echo ====================================================================
echo   Stopping TRIVIS Admin Dashboard Backend Service (TRIVIS Production)
echo ====================================================================
echo.

echo Stopping scheduled task 'TRIRIGA_AdminDashboard_Backend' on TRIVIS...
schtasks /end /s TRIVIS /tn "TRIRIGA_AdminDashboard_Backend"
if %errorlevel% equ 0 (
    echo   [+] Successfully terminated TRIRIGA_AdminDashboard_Backend task.
) else (
    echo   [!] Task was not running or an error occurred.
)

echo.
echo ====================================================================
echo   TRIVIS Backend Service Stopped.
echo ====================================================================
echo.
timeout /t 3
