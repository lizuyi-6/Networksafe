param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [string]$VoiceName = "Microsoft Huihui Desktop",

    [int]$Rate = 1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Input text file not found: $InputPath"
}

$text = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($text)) {
    throw "Input text file is empty: $InputPath"
}

$outputDir = Split-Path -Parent $OutputPath
if (-not [string]::IsNullOrWhiteSpace($outputDir) -and -not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $installedVoices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
    $selectedVoice = $VoiceName

    if (-not ($installedVoices -contains $selectedVoice)) {
        $selectedVoice = $installedVoices | Where-Object { $_ -like "*Huihui*" } | Select-Object -First 1
    }

    if (-not $selectedVoice) {
        $selectedVoice = $installedVoices | Select-Object -First 1
    }

    if (-not $selectedVoice) {
        throw "No installed Windows voice is available for synthesis."
    }

    $synth.SelectVoice($selectedVoice)
    $synth.Rate = $Rate
    $synth.SetOutputToWaveFile($OutputPath)
    $synth.Speak($text)
    $synth.SetOutputToNull()

    Write-Output $selectedVoice
}
finally {
    $synth.Dispose()
}
