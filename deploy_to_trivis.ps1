# ====================================================================
# Deploy TRIRIGA Admin Dashboard & Log Forensics to TRIVIS Production
# ====================================================================
$ErrorActionPreference = "Stop"

$appDir = $PSScriptRoot
if (-not $appDir) { $appDir = (Get-Location).Path }

$trivisRoot = "\\trivis\c$\Program Files\Apache Software Foundation\Tomcat 10.1\webapps\ROOT"
$trivisApp = "$trivisRoot\admindashboard"
$trivisBackend = "$trivisApp\backend"

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "  DEPLOYING TRIRIGA LOG FORENSICS TO TRIVIS PRODUCTION" -ForegroundColor Cyan
Write-Host "  Target: $trivisApp" -ForegroundColor White
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify access to TRIVIS
Write-Host "[1/5] Checking connectivity to TRIVIS UNC share..." -ForegroundColor Yellow
if (-not (Test-Path $trivisApp)) {
    throw "Cannot access $trivisApp. Ensure TRIVIS is reachable and you have permissions."
}
Write-Host "  [+] TRIVIS UNC path accessible." -ForegroundColor Green

# 2. Build Frontend
Write-Host "[2/5] Building Frontend SPA with Vite..." -ForegroundColor Yellow
$nodeExe = "C:\Users\bradyp\AppData\Local\ms-playwright-go\1.57.0\node.exe"
if (-not (Test-Path $nodeExe)) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) { $nodeExe = $nodeCmd.Source }
}

if (-not (Test-Path $nodeExe)) {
    throw "Node.js executable not found. Cannot build frontend."
}

$frontendDir = Join-Path $appDir "frontend"
Push-Location $frontendDir
try {
    $viteScript = Join-Path $frontendDir "node_modules\vite\bin\vite.js"
    & $nodeExe $viteScript build
    if ($LASTEXITCODE -ne 0) {
        throw "Vite build failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}
Write-Host "  [+] Frontend build succeeded (dist folder ready)." -ForegroundColor Green

# 3. Deploy Frontend Assets
Write-Host "[3/5] Deploying Frontend Assets to $trivisApp..." -ForegroundColor Yellow
$distDir = Join-Path $frontendDir "dist"
$targetAssets = Join-Path $trivisApp "assets"

if (-not (Test-Path $targetAssets)) {
    New-Item -ItemType Directory -Path $targetAssets -Force | Out-Null
}

# Copy newly built hashed asset files
Get-ChildItem (Join-Path $distDir "assets") | ForEach-Object {
    try {
        Copy-Item -Path $_.FullName -Destination (Join-Path $targetAssets $_.Name) -Force
    } catch {
        Write-Warning "Could not copy $($_.Name): $($_.Exception.Message)"
    }
}

Copy-Item -Path (Join-Path $distDir "index.html") -Destination (Join-Path $trivisApp "index.html") -Force

# Copy static PWA assets if present
$staticPwaFiles = @("sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.ico")
foreach ($f in $staticPwaFiles) {
    $src = Join-Path $distDir $f
    if (-not (Test-Path $src)) {
        $src = Join-Path $frontendDir "public\$f"
    }
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $trivisApp $f) -Force
    }
}
Write-Host "  [+] Frontend deployed successfully." -ForegroundColor Green

# 4. Deploy Backend Code (Preserving Database, Logs, and python_runtime)
Write-Host "[4/5] Deploying Backend Code to $trivisBackend..." -ForegroundColor Yellow
$backendSrc = Join-Path $appDir "backend"

# Deploy to backend/app
$targetApp1 = Join-Path $trivisBackend "app"
$targetApp2 = Join-Path $trivisBackend "backend\app"

# Helper to sync python code excluding caches
function Sync-PyFolder($src, $dst) {
    if (-not (Test-Path $dst)) {
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
    }
    Get-ChildItem -Path $src -Recurse | Where-Object { $_.FullName -notmatch "__pycache__|\.pytest_cache|\.db" } | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length).TrimStart("\")
        $targetFile = Join-Path $dst $rel
        if ($_.PSIsContainer) {
            if (-not (Test-Path $targetFile)) {
                New-Item -ItemType Directory -Path $targetFile -Force | Out-Null
            }
        } else {
            Copy-Item -Path $_.FullName -Destination $targetFile -Force
        }
    }
}

Sync-PyFolder (Join-Path $backendSrc "app") $targetApp1
if (Test-Path (Join-Path $trivisBackend "backend")) {
    Sync-PyFolder (Join-Path $backendSrc "app") $targetApp2
}

# Copy main.py
Copy-Item -Path (Join-Path $backendSrc "main.py") -Destination (Join-Path $trivisBackend "main.py") -Force
if (Test-Path (Join-Path $trivisBackend "backend")) {
    Copy-Item -Path (Join-Path $backendSrc "main.py") -Destination (Join-Path $trivisBackend "backend\main.py") -Force
}

# Copy scripts folder
$scriptsSrc = Join-Path $appDir "scripts"
if (Test-Path $scriptsSrc) {
    $targetScripts = Join-Path $trivisBackend "scripts"
    if (-not (Test-Path $targetScripts)) {
        New-Item -ItemType Directory -Path $targetScripts -Force | Out-Null
    }
    Copy-Item -Path (Join-Path $scriptsSrc "*") -Destination $targetScripts -Recurse -Force
}

Write-Host "  [+] Backend Python code and scripts deployed." -ForegroundColor Green

# 5. Restart Scheduled Task on TRIVIS and Verify Health
Write-Host "[5/5] Restarting 'TRIRIGA_AdminDashboard_Backend' service on TRIVIS..." -ForegroundColor Yellow
cmd.exe /c "taskkill /s TRIVIS /f /im python.exe >nul 2>&1"
cmd.exe /c "schtasks /end /s TRIVIS /tn TRIRIGA_AdminDashboard_Backend >nul 2>&1"
Start-Sleep -Seconds 2
cmd.exe /c "schtasks /run /s TRIVIS /tn TRIRIGA_AdminDashboard_Backend >nul 2>&1"

Write-Host "  Waiting for service health verification..." -ForegroundColor Yellow
$maxAttempts = 15
$attempt = 0
$healthy = $false

while ($attempt -lt $maxAttempts -and -not $healthy) {
    $attempt++
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-WebRequest -Uri "https://trivis.i.opw.ie/admindashboard/api/health" -UseBasicParsing -TimeoutSec 3
        if ($res.StatusCode -eq 200) {
            $healthy = $true
            Write-Host "  [+] Health Check Passed (HTTP 200 OK) on attempt $attempt" -ForegroundColor Green
            Write-Host "  [+] Response: $($res.Content)" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "  [...] Waiting for service initialization (attempt $attempt of $maxAttempts)..." -ForegroundColor Gray
    }
}

if (-not $healthy) {
    Write-Host "  [!] Warning: Health check did not return HTTP 200 within timeout." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "====================================================================" -ForegroundColor Green
    Write-Host "  DEPLOYMENT TO TRIVIS PRODUCTION SUCCESSFUL!" -ForegroundColor Green
    Write-Host "  Production URL: https://trivis.i.opw.ie/admindashboard/" -ForegroundColor White
    Write-Host "====================================================================" -ForegroundColor Green
}
