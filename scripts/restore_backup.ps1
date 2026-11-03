$ErrorActionPreference = 'Stop'
$rootDir = (Get-Item $PSScriptRoot).Parent.FullName
$snapshotDir = Join-Path $rootDir 'snapshots\pre_ops_hub_backup'

if (-not (Test-Path $snapshotDir)) {
    Write-Error "Snapshot directory not found: $snapshotDir"
    exit 1
}

Write-Host "Restoring codebase from snapshot: $snapshotDir ..." -ForegroundColor Yellow

Copy-Item -Recurse -Force -Path (Join-Path $snapshotDir 'frontend\src\*') -Destination (Join-Path $rootDir 'frontend\src')
if (Test-Path (Join-Path $snapshotDir 'frontend\dist')) {
    Copy-Item -Recurse -Force -Path (Join-Path $snapshotDir 'frontend\dist\*') -Destination (Join-Path $rootDir 'frontend\dist')
}
Copy-Item -Recurse -Force -Path (Join-Path $snapshotDir 'backend\app\*') -Destination (Join-Path $rootDir 'backend\app')
Copy-Item -Force -Path (Join-Path $snapshotDir 'backend\main.py') -Destination (Join-Path $rootDir 'backend\main.py')
Copy-Item -Recurse -Force -Path (Join-Path $snapshotDir 'backend\tests\*') -Destination (Join-Path $rootDir 'backend\tests')

Write-Host "Codebase successfully restored to pre-ops-hub snapshot." -ForegroundColor Green
