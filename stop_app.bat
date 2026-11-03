@echo off
title Stop TRIRIGA Log Analysis Server
cd /d "%~dp0"

echo Stopping TRIRIGA Log Analyzer on port 8000...
powershell -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo Server stopped.
timeout /t 2 >nul
