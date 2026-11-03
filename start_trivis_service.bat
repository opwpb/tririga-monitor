@echo off
title Start TRIVIS Admin Dashboard Backend Service
cd /d "%~dp0"

echo ====================================================================
echo   Starting TRIVIS Admin Dashboard Backend Service (TRIVIS Production)
echo ====================================================================
echo.

echo [1/2] Starting scheduled task 'TRIRIGA_AdminDashboard_Backend' on TRIVIS...
schtasks /run /s TRIVIS /tn "TRIRIGA_AdminDashboard_Backend"

echo [2/2] Waiting for FastAPI backend to initialize and verify health...
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
echo   Service Start Requested!
echo   Production URL: https://trivis.i.opw.ie/admindashboard/
echo ====================================================================
echo.
pause
