param(
    [string]$BaseUrl = "http://localhost:3005",
    [ValidateSet("production", "demo")]
    [string]$ExpectedMode = "production"
)

$ErrorActionPreference = "Stop"

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )
    if (-not $Condition) {
        throw "ASSERT FAILED: $Message"
    }
    Write-Host "[PASS] $Message"
}

function Get-Json {
    param([string]$Url)
    $resp = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing
    return @{
        StatusCode = [int]$resp.StatusCode
        Json = ($resp.Content | ConvertFrom-Json)
    }
}

function Get-StatusCode {
    param([string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing
        return [int]$resp.StatusCode
    } catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            return [int]$_.Exception.Response.StatusCode.value__
        }
        throw
    }
}

Write-Host "Verifying demo separation at $BaseUrl (expected mode: $ExpectedMode)"

$modeResp = Get-Json "$BaseUrl/api/system/mode"
Assert-True ($modeResp.StatusCode -eq 200) "/api/system/mode returns 200"
Assert-True ($modeResp.Json.appMode -eq $ExpectedMode) "appMode matches expected ($ExpectedMode)"

if ($ExpectedMode -eq "production") {
    Assert-True ($modeResp.Json.demoEnabled -eq $false) "demoEnabled=false in production"
    Assert-True ($modeResp.Json.attackSimEnabled -eq $false) "attackSimEnabled=false in production"

    $attackTypesCode = Get-StatusCode "$BaseUrl/api/attack/types"
    Assert-True ($attackTypesCode -eq 404) "/api/attack/types returns 404 in production"

    $trafficStats = (Get-Json "$BaseUrl/api/ai-system/traffic/stats").Json
    Assert-True ($trafficStats.cpuUsage -eq 0) "traffic stats cpuUsage=0 in production no-data path"
    Assert-True ($trafficStats.memoryUsage -eq 0) "traffic stats memoryUsage=0 in production no-data path"

    $flows = (Get-Json "$BaseUrl/api/ai-system/traffic/flows").Json
    Assert-True ($flows.Count -eq 0) "traffic flows empty in production no-data path"

    $protocols = (Get-Json "$BaseUrl/api/ai-system/traffic/protocols").Json
    Assert-True ($protocols.http -eq 0 -and $protocols.https -eq 0 -and $protocols.dns -eq 0 -and $protocols.other -eq 0) "protocol distribution is all zero in production no-data path"
}
else {
    Assert-True ($modeResp.Json.demoEnabled -eq $true) "demoEnabled=true in demo mode"
    Assert-True ($modeResp.Json.attackSimEnabled -eq $true) "attackSimEnabled=true in demo mode"

    $attackTypesCode = Get-StatusCode "$BaseUrl/api/attack/types"
    Assert-True ($attackTypesCode -eq 200) "/api/attack/types returns 200 in demo mode"
}

Write-Host ""
Write-Host "All demo-separation checks passed."
