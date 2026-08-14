# SECURITY (audit 2026-08, DP-002): this script only speaks FTPS.
#   - AETHERGUARD_FTP_SERVER MUST start with ftps:// (explicit TLS via AUTH TLS).
#     Plain ftp:// control+data channels send credentials and the frontend
#     bundle in cleartext (MITM can capture or tamper both) -> hard reject.
#   - Credentials must come from the environment, never hardcoded.
#   - Server certificates are validated against the machine trust store
#     (no ServicePointManager callback override = default validation).
$ErrorActionPreference = 'Stop'

$sourceDir = $env:AETHERGUARD_FRONTEND_DIST_DIR
if (-not $sourceDir) {
    # Keep the historical default for local dev machines, allow override.
    $sourceDir = Join-Path $PSScriptRoot '..\frontend\dist'
}
if (-not (Test-Path $sourceDir)) {
    Write-Error "Frontend dist directory not found: $sourceDir (build the frontend first, or set AETHERGUARD_FRONTEND_DIST_DIR)."
    exit 1
}

$ftpServer = $env:AETHERGUARD_FTP_SERVER
$username = $env:AETHERGUARD_FTP_USERNAME
$password = $env:AETHERGUARD_FTP_PASSWORD
if (-not $ftpServer -or -not $username -or -not $password) {
    Write-Error "Missing AETHERGUARD_FTP_SERVER / AETHERGUARD_FTP_USERNAME / AETHERGUARD_FTP_PASSWORD environment variables."
    exit 1
}
if ($ftpServer -notmatch '^ftps://') {
    Write-Error "AETHERGUARD_FTP_SERVER must use ftps:// (explicit TLS). Refusing plaintext ftp:// (audit DP-002)."
    exit 1
}

function New-FtpsRequest {
    param(
        [string]$FtpPath,
        [string]$Method
    )
    $request = [System.Net.FtpWebRequest]::Create($FtpPath)
    $request.Method = $Method
    $request.Credentials = New-Object System.Net.NetworkCredential($username, $password)
    # ftps:// in the URI already implies TLS; set EnableSsl explicitly so the
    # guarantee does not depend on scheme handling.
    $request.EnableSsl = $true
    $request.UseBinary = $true
    return $request
}

function Upload-File {
    param(
        [string]$FilePath,
        [string]$FtpPath
    )

    Write-Host "Uploading $(Split-Path $FilePath -Leaf) to $FtpPath..."
    try {
        $request = New-FtpsRequest -FtpPath $FtpPath -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile)
        $request.ContentLength = (Get-Item $FilePath).Length
        $requestStream = $request.GetRequestStream()
        $fileStream = [System.IO.File]::OpenRead($FilePath)
        try {
            $fileStream.CopyTo($requestStream)
        }
        finally {
            $fileStream.Close()
            $requestStream.Close()
        }
        $response = $request.GetResponse()
        $response.Close()
    }
    catch {
        Write-Error "Failed to upload $FilePath : $_"
    }
}

function Create-Directory {
    param(
        [string]$FtpPath
    )

    try {
        $request = New-FtpsRequest -FtpPath $FtpPath -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory)
        $response = $request.GetResponse()
        $response.Close()
        Write-Host "Created directory $FtpPath"
    }
    catch {
        # Ignore error if directory exists (550)
        $msg = $_.Exception.Message
        if ($msg -notlike "*550*") {
            Write-Warning "Directory creation note for $FtpPath : $msg"
        }
    }
}

function Upload-FolderRecurse {
    param(
        [string]$LocalDir,
        [string]$RemoteUrl
    )

    $items = Get-ChildItem -Path $LocalDir

    foreach ($item in $items) {
        if ($item.PSIsContainer) {
            $newRemoteUrl = "$RemoteUrl" + $item.Name + "/"
            Create-Directory -FtpPath $newRemoteUrl
            Upload-FolderRecurse -LocalDir $item.FullName -RemoteUrl $newRemoteUrl
        }
        else {
            $remoteFilePath = "$RemoteUrl" + $item.Name
            Upload-File -FilePath $item.FullName -FtpPath $remoteFilePath
        }
    }
}

# Start Upload
Write-Host "Starting FTPS deployment to $ftpServer..."
Upload-FolderRecurse -LocalDir $sourceDir -RemoteUrl $ftpServer
Write-Host "Deployment completed!"
