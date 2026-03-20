param(
    [string]$Image = "ghcr.io/xu-cheng/texlive-full:latest",
    [switch]$NoPull,
    [switch]$ForceDocker
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedDir = (Resolve-Path $scriptDir).Path
$texFile = "aetherguard_ieee_access.tex"
$toolDir = Join-Path $scriptDir ".build-tools\\tectonic"
$tectonicExe = Join-Path $toolDir "tectonic.exe"

function Invoke-TectonicBuild {
    if (-not (Test-Path $tectonicExe)) {
        New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/tectonic-typesetting/tectonic/releases/latest"
        $asset = $release.assets | Where-Object { $_.name -match 'x86_64-pc-windows-msvc\.zip$' } | Select-Object -First 1
        if (-not $asset) {
            throw "Unable to resolve a Windows Tectonic release asset."
        }

        $zipPath = Join-Path $toolDir "tectonic.zip"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
        Expand-Archive -Force $zipPath $toolDir
    }

    Push-Location $scriptDir
    try {
        for ($i = 1; $i -le 2; $i++) {
            & $tectonicExe -k --keep-logs --synctex $texFile
            if ($LASTEXITCODE -ne 0) {
                throw "Tectonic failed on pass $i with exit code $LASTEXITCODE."
            }
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-DockerBuild {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker is not available in the current environment."
    }

    if (-not $NoPull) {
        Write-Host "Pulling LaTeX image: $Image"
        docker pull $Image
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to pull Docker image $Image."
        }
    }

    Write-Host "Building $texFile in $resolvedDir with Docker"
    $dockerArgs = @(
        "run", "--rm",
        "-v", "${resolvedDir}:/work",
        "-w", "/work",
        $Image,
        "latexmk", "-pdf", "-bibtex", "-interaction=nonstopmode", "-halt-on-error", $texFile
    )

    docker @dockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Docker build failed with exit code $LASTEXITCODE."
    }
}

if (-not $ForceDocker) {
    try {
        Write-Host "Building with Tectonic"
        Invoke-TectonicBuild
        exit 0
    }
    catch {
        Write-Warning $_.Exception.Message
    }
}

Invoke-DockerBuild
