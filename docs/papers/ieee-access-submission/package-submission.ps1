param(
    [switch]$SkipBuild,
    [switch]$OpenFolder
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$uploadDir = Join-Path $scriptDir "upload-package"
$pdfDir = Join-Path $uploadDir "01_PDF"
$sourceDir = Join-Path $uploadDir "02_SOURCE"
$extrasDir = Join-Path $uploadDir "03_EXTRAS"
$zipPath = Join-Path $scriptDir "ieee-access-upload-package.zip"

if (-not $SkipBuild) {
    & (Join-Path $scriptDir "build-paper.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed. Package generation stopped."
    }
}

if (Test-Path $uploadDir) {
    Remove-Item -Recurse -Force $uploadDir
}

New-Item -ItemType Directory -Force -Path $pdfDir | Out-Null
New-Item -ItemType Directory -Force -Path $sourceDir | Out-Null
New-Item -ItemType Directory -Force -Path $extrasDir | Out-Null

$pdfFiles = @(
    "aetherguard_ieee_access.pdf"
)

$sourceFiles = @(
    "aetherguard_ieee_access.tex",
    "author-metadata.tex",
    "references.bib",
    "build-paper.ps1",
    "ieeeaccess.cls",
    "IEEEtran.cls",
    "IEEEtran.bst",
    "spotcolor.sty",
    "logo.png",
    "notaglinelogo.png",
    "bullet.png"
)

$extraFiles = @(
    "cover-letter.txt",
    "data-availability.txt",
    "graphical-abstract.svg",
    "submission-checklist.md",
    "README.md",
    "00-START-HERE-zh-CN.md"
)

foreach ($file in $pdfFiles) {
    Copy-Item (Join-Path $scriptDir $file) -Destination $pdfDir -Force
}

foreach ($file in $sourceFiles) {
    Copy-Item (Join-Path $scriptDir $file) -Destination $sourceDir -Force
}

Get-ChildItem -Path $scriptDir -File | Where-Object {
    $_.Name -match '^t1.*\.(pfb|tfm|map|fd)$'
} | Copy-Item -Destination $sourceDir -Force

foreach ($file in $extraFiles) {
    Copy-Item (Join-Path $scriptDir $file) -Destination $extrasDir -Force
}

Set-Content -Path (Join-Path $uploadDir "README-FIRST.txt") -Value @"
1. Open 03_EXTRAS\\00-START-HERE-zh-CN.md first.
2. Edit 02_SOURCE\\author-metadata.tex only.
3. Re-run package-submission.ps1 after your edits.
4. Upload the PDF, source files, and optional extras from this folder.
"@

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $uploadDir "*") -DestinationPath $zipPath

Write-Host "Upload package ready:"
Write-Host "  Folder: $uploadDir"
Write-Host "  Zip:    $zipPath"

if ($OpenFolder) {
    Invoke-Item $uploadDir
}
