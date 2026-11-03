@echo off
title Restart TRIVIS Admin Dashboard Backend Service
cd /d "%~dp0"

echo ====================================================================
echo   Restarting TRIVIS Admin Dashboard Backend Service (TRIVIS Production)
echo ====================================================================
echo.

echo [1/3] Stopping background python processes and scheduled task on TRIVIS...
taskkill /s TRIVIS /f /im python.exe >nul 2>&1
schtasks /end /s TRIVIS /tn "TRIRIGA_AdminDashboard_Backend" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/3] Starting scheduled task 'TRIRIGA_AdminDashboard_Backend' on TRIVIS...
schtasks /run /s TRIVIS /tn "TRIRIGA_AdminDashboard_Backend" >nul 2>&1

echo [3/3] Waiting for FastAPI backend to initialize and verify health...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$maxAttempts = 12; $attempt = 0; $healthy = $false;" ^
  "while ($attempt -lt $maxAttempts -and -not $healthy) {" ^
  "  $attempt++; Start-Sleep -Seconds 1;" ^
  "  try {" ^
  "    $res = Invoke-WebRequest -Uri 'https://trivis.i.opw.ie/admindashboard/api/health' -UseBasicParsing -TimeoutSec 3;" ^
  "    if ($res.StatusCode -eq 200) {" ^
  "      $healthy = $true;" ^
  "      Write-Host '  [+] Health Check Passed (HTTP 200 OK) on attempt' $attempt -ForegroundColor Green;" ^
  "      Write-Host '  [+] Response:' $res.Content -ForegroundColor Cyan;" ^
  "    }" ^
  "  } catch {" ^
  "    Write-Host '  [...] Waiting for service initialization (attempt' $attempt 'of' $maxAttempts')...';" ^
  "  }" ^
  "}" ^
  "if (-not $healthy) {" ^
  "  Write-Host '  [!] Warning: Health check did not return HTTP 200 within timeout. Check service.log on TRIVIS.' -ForegroundColor Yellow;" ^
  "}"

echo.
echo ====================================================================
echo   Service Restart Complete!
echo   Production URL: https://trivis.i.opw.ie/admindashboard/
echo ====================================================================
echo.
pause
