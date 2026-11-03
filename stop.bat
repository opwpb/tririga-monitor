@echo off
title Stop TRIRIGA Log Analysis Server
cd /d "%~dp0"

echo ====================================================================
echo   Stopping TRIRIGA Log Analysis Server on Port 8000
echo ====================================================================
powershell -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo Server stopped successfully.
timeout /t 2 >nul
