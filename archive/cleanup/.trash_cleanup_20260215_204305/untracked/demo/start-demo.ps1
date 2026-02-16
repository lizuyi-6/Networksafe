# FluxGuard Demo - Windows Startup Script
# This script starts the complete demo environment with real Multi-Agent System

param(
    [switch]$Attack,
    [switch]$Stop,
    [switch]$Logs,
    [switch]$PullOllama,
    [string]$Model = "llama3:8b"
)

$ErrorActionPreference = "Stop"

$DemoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $DemoDir

function Write-Header {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "        FluxGuard Multi-Agent Security Demo                     " -ForegroundColor Cyan
    Write-Host "           Real AI Agents + Traffic Interceptor                 " -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Test-Docker {
    try {
        $null = docker --version
        return $true
    } catch {
        Write-Host "Docker is not running. Please start Docker Desktop." -ForegroundColor Red
        return $false
    }
}

function Wait-ForService {
    param(
        [string]$Url,
        [string]$ServiceName,
        [int]$TimeoutSeconds = 60
    )
    
    Write-Host "   Waiting for $ServiceName..." -NoNewline
    $startTime = Get-Date
    
    while (((Get-Date) - $startTime).TotalSeconds -lt $TimeoutSeconds) {
        try {
            $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Host " OK" -ForegroundColor Green
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    
    Write-Host " FAILED" -ForegroundColor Red
    return $false
}

function Start-Demo {
    Write-Header
    
    if (-not (Test-Docker)) {
        exit 1
    }

    Write-Host "Starting FluxGuard Multi-Agent Demo Environment..." -ForegroundColor Yellow
    Write-Host ""

    Set-Location $DemoDir

    Write-Host "Building containers..." -ForegroundColor Blue
    docker-compose -f docker-compose.demo.yml build --parallel

    Write-Host ""
    Write-Host "Starting core services..." -ForegroundColor Blue
    
    docker-compose -f docker-compose.demo.yml up -d redis ollama

    Write-Host ""
    Write-Host "Waiting for Ollama to be ready (this may take a minute)..." -ForegroundColor Blue
    
    $ollamaReady = Wait-ForService -Url "http://localhost:11434/api/tags" -ServiceName "Ollama" -TimeoutSeconds 120
    
    if ($ollamaReady) {
        Write-Host ""
        Write-Host "Pulling AI model ($Model)..." -ForegroundColor Blue
        Write-Host "   This may take several minutes on first run..." -ForegroundColor Gray
        
        try {
            docker exec demo-ollama-1 ollama pull $Model 2>&1 | ForEach-Object { 
                Write-Host "   $_" -ForegroundColor Gray 
            }
        } catch {
            Write-Host "   Could not pull model automatically. Pull manually with:" -ForegroundColor Yellow
            Write-Host "   docker exec -it demo-ollama-1 ollama pull $Model" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "Starting application services..." -ForegroundColor Blue
    docker-compose -f docker-compose.demo.yml up -d vulnerable-app backend dashboard

    Write-Host ""
    Write-Host "Waiting for services to be ready..." -ForegroundColor Blue
    
    Wait-ForService -Url "http://localhost:8080/health" -ServiceName "Vulnerable App"
    Wait-ForService -Url "http://localhost:3005/api/health" -ServiceName "Backend API"

    Write-Host ""
    Write-Host "Demo environment is ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Access Points:" -ForegroundColor White
    Write-Host "   Dashboard:        http://localhost:5175" -ForegroundColor Cyan
    Write-Host "   Vulnerable App:   http://localhost:8080" -ForegroundColor Cyan
    Write-Host "   Backend API:      http://localhost:3005" -ForegroundColor Cyan
    Write-Host "   Ollama API:       http://localhost:11434" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Dashboard Pages:" -ForegroundColor White
    Write-Host "   Agent Monitor:    http://localhost:5175/dashboard/agents" -ForegroundColor Green
    Write-Host "   Traffic Monitor:  http://localhost:5175/dashboard/traffic" -ForegroundColor Green
    Write-Host "   Attack Simulator: http://localhost:5175/dashboard/attack" -ForegroundColor Green
    Write-Host ""
    Write-Host "Attack Simulation:" -ForegroundColor White
    Write-Host "   Run: .\start-demo.ps1 -Attack" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "View Logs:" -ForegroundColor White
    Write-Host "   Run: .\start-demo.ps1 -Logs" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Stop Demo:" -ForegroundColor White
    Write-Host "   Run: .\start-demo.ps1 -Stop" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Multi-Agent System Features:" -ForegroundColor White
    Write-Host "   L1: Multi-Agent Collaboration" -ForegroundColor Gray
    Write-Host "   L2: Role Playing (Socrates/Plato/Aristotle)" -ForegroundColor Gray
    Write-Host "   L3: Scene Traversal and Distributed Tracing" -ForegroundColor Gray
    Write-Host "   L4: Capability Incarnation" -ForegroundColor Gray
    Write-Host "   L5: Debate Protocol" -ForegroundColor Gray
    Write-Host "   L6: Heterogeneous Model Collaboration" -ForegroundColor Gray
    Write-Host "   L7: Synthesis and Self-Evolution" -ForegroundColor Gray
    Write-Host ""
}

function Start-Attack {
    Write-Header
    Write-Host "Running Attack Simulation..." -ForegroundColor Red
    Write-Host ""

    Set-Location $DemoDir
    docker-compose -f docker-compose.demo.yml --profile attack run --rm attack-simulator
}

function Stop-Demo {
    Write-Header
    Write-Host "Stopping Demo Environment..." -ForegroundColor Yellow
    
    Set-Location $DemoDir
    docker-compose -f docker-compose.demo.yml down -v
    
    Write-Host ""
    Write-Host "Demo environment stopped." -ForegroundColor Green
}

function Show-Logs {
    Set-Location $DemoDir
    docker-compose -f docker-compose.demo.yml logs -f
}

function Pull-OllamaModel {
    Write-Header
    Write-Host "Pulling Ollama Model: $Model" -ForegroundColor Blue
    Write-Host ""
    
    Set-Location $DemoDir
    
    docker-compose -f docker-compose.demo.yml up -d ollama
    
    Start-Sleep -Seconds 5
    
    Write-Host "Pulling model (this may take several minutes)..." -ForegroundColor Yellow
    docker exec demo-ollama-1 ollama pull $Model
    
    Write-Host ""
    Write-Host "Model $Model pulled successfully!" -ForegroundColor Green
}

# Main
if ($Stop) {
    Stop-Demo
} elseif ($Attack) {
    Start-Attack
} elseif ($Logs) {
    Show-Logs
} elseif ($PullOllama) {
    Pull-OllamaModel
} else {
    Start-Demo
}
