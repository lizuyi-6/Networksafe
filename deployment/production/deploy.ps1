# AetherGuard Production Deployment Script
# Usage: ./deploy.ps1 [command]
# Commands: start, stop, restart, status, logs, build

param(
    [Parameter(Position=0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "build", "clean")]
    [string]$Command = "start"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "Docker is not installed or not in PATH"
        exit 1
    }
    if (-not (Get-Command docker-compose -ErrorAction SilentlyContinue)) {
        Write-Error "docker-compose is not installed or not in PATH"
        exit 1
    }
}

function Start-Deployment {
    Write-Header "Starting AetherGuard Production Deployment"

    if (-not (Test-Path "$ScriptDir\.env")) {
        Write-Host "Creating .env file from .env.example..." -ForegroundColor Yellow
        Copy-Item "$ScriptDir\.env.example" "$ScriptDir\.env"
        Write-Host "Please edit $ScriptDir\.env with your configuration" -ForegroundColor Yellow
    }

    Write-Host "Building and starting containers..." -ForegroundColor Green
    Set-Location $ScriptDir
    docker-compose -f docker-compose.prod.yml up -d --build

    Write-Host ""
    Write-Host "Waiting for services to be healthy..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10

    Show-Status

    Write-Host ""
    Write-Host "Deployment complete!" -ForegroundColor Green
    Write-Host "Dashboard: http://localhost:8888" -ForegroundColor Cyan
    Write-Host "API:       http://localhost:3010/api" -ForegroundColor Cyan
    Write-Host "Health:    http://localhost:3010/api/health" -ForegroundColor Cyan
}

function Stop-Deployment {
    Write-Header "Stopping AetherGuard Production Deployment"
    Set-Location $ScriptDir
    docker-compose -f docker-compose.prod.yml down
    Write-Host "Deployment stopped." -ForegroundColor Green
}

function Restart-Deployment {
    Stop-Deployment
    Start-Sleep -Seconds 3
    Start-Deployment
}

function Show-Status {
    Write-Header "AetherGuard Deployment Status"
    Set-Location $ScriptDir
    docker-compose -f docker-compose.prod.yml ps

    Write-Host ""
    Write-Host "Service Health:" -ForegroundColor Yellow

    $backendHealth = Invoke-WebRequest -Uri "http://localhost:3010/api/health" -UseBasicParsing -ErrorAction SilentlyContinue
    if ($backendHealth -and $backendHealth.StatusCode -eq 200) {
        Write-Host "  Backend:  Healthy" -ForegroundColor Green
    } else {
        Write-Host "  Backend:  Unhealthy" -ForegroundColor Red
    }

    $frontendHealth = Invoke-WebRequest -Uri "http://localhost/health" -UseBasicParsing -ErrorAction SilentlyContinue
    if ($frontendHealth -and $frontendHealth.StatusCode -eq 200) {
        Write-Host "  Frontend: Healthy" -ForegroundColor Green
    } else {
        Write-Host "  Frontend: Unhealthy" -ForegroundColor Red
    }
}

function Show-Logs {
    param([string]$Service = "")
    Set-Location $ScriptDir
    if ($Service) {
        docker-compose -f docker-compose.prod.yml logs -f $Service
    } else {
        docker-compose -f docker-compose.prod.yml logs -f
    }
}

function Build-Images {
    Write-Header "Building AetherGuard Docker Images"
    Set-Location $ScriptDir
    docker-compose -f docker-compose.prod.yml build --no-cache
    Write-Host "Images built successfully." -ForegroundColor Green
}

function Clear-Deployment {
    Write-Header "Cleaning Up AetherGuard Deployment"
    Set-Location $ScriptDir
    docker-compose -f docker-compose.prod.yml down -v --rmi local
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
