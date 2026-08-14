# AetherGuard Production Deployment Script
# Usage: ./deploy.ps1 [command]
# Commands: start, stop, restart, status, logs, build, clean
#
# DP-014 fix (audit 2026-08): previously bootstrapped a LOCAL .env via
# Copy-Item .env.example (weak change_me* values production validation
# hard-rejects), invoked the legacy docker-compose v1 binary (cannot parse
# include/env_file long syntax), and printed stale ports 8888/3010. The prod
# entrypoint includes the repository-root Compose file and reads the ROOT
# .env — generate it with deployment/production/setup-env.sh (bash) or
# scripts/setup.mjs (node).

param(
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "build", "clean")]
    [string]$Command = "start"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootEnv = Join-Path $ScriptDir "..\..\.env"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

# Compose v2.24+ is REQUIRED (include/env_file long syntax).
function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "Docker is not installed or not in PATH"
        exit 1
    }
    docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker Compose v2 is required (legacy docker-compose v1 cannot parse this stack)"
        exit 1
    }
}

function Test-RootEnv {
    if (-not (Test-Path $RootEnv)) {
        Write-Host "Error: repository root .env not found ($RootEnv)" -ForegroundColor Red
        Write-Host "Generate it first:  bash deployment/production/setup-env.sh   (or: node scripts/setup.mjs)" -ForegroundColor Yellow
        Write-Host "(copying .env.example produces weak change_me* values that production validation rejects)" -ForegroundColor Yellow
        exit 1
    }
}

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    & docker compose -f (Join-Path $ScriptDir "docker-compose.prod.yml") @ComposeArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Start-Deployment {
    Write-Header "Starting AetherGuard Production Deployment"

    Test-RootEnv

    Write-Host "Building and starting containers..." -ForegroundColor Green
    Invoke-Compose @("up", "-d", "--build")

    Write-Host ""
    Write-Host "Waiting for services to become healthy..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10

    Show-Status

    Write-Host ""
    Write-Host "Deployment complete!" -ForegroundColor Green
    Write-Host "Dashboard/API entrypoint (nginx reverse proxy): http://localhost:8080" -ForegroundColor Cyan
    Write-Host "Backend health is reported by: docker compose -f docker-compose.prod.yml ps" -ForegroundColor Cyan
}

function Stop-Deployment {
    Write-Header "Stopping AetherGuard Production Deployment"
    Invoke-Compose @("down")
    Write-Host "Deployment stopped." -ForegroundColor Green
}

function Restart-Deployment {
    Stop-Deployment
    Start-Sleep -Seconds 3
    Start-Deployment
}

function Show-Status {
    Write-Header "AetherGuard Deployment Status"
    Invoke-Compose @("ps")
}

function Show-Logs {
    param([string]$Service = "")
    if ($Service) {
        Invoke-Compose @("logs", "-f", $Service)
    } else {
        Invoke-Compose @("logs", "-f")
    }
}

function Build-Images {
    Write-Header "Building AetherGuard Docker Images"
    Test-RootEnv
    Invoke-Compose @("build", "--no-cache")
    Write-Host "Images built successfully." -ForegroundColor Green
}

function Clear-Deployment {
    Write-Header "Cleaning Up AetherGuard Deployment"
    Invoke-Compose @("down", "-v", "--rmi", "local")
    Write-Host "Deployment cleaned up." -ForegroundColor Green
}

Test-Docker

switch ($Command) {
    "start"   { Start-Deployment }
    "stop"    { Stop-Deployment }
    "restart" { Restart-Deployment }
    "status"  { Show-Status }
    "logs"    { Show-Logs }
    "build"   { Build-Images }
    "clean"   { Clear-Deployment }
}
