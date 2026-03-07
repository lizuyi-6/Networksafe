$sourceDir = "c:\Users\Abraham\Desktop\api-security-middleware\frontend\dist"
$ftpServer = "ftp://171.80.8.102/Web/"
$username = "ftp6627177"
$password = "Li15227225280"

function Upload-File {
    param(
        [string]$FilePath,
        [string]$FtpPath
    )

    $uri = New-Object System.Uri($FtpPath)
    $webclient = New-Object System.Net.WebClient
    $webclient.Credentials = New-Object System.Net.NetworkCredential($username, $password)
    
    Write-Host "Uploading $(Split-Path $FilePath -Leaf) to $FtpPath..."
    try {
        $webclient.UploadFile($uri, $FilePath)
    }
    catch {
        Write-Error "Failed to upload $FilePath : $_"
    }
}

function Create-Directory {
    param(
        [string]$FtpPath
    )
    
    $uri = New-Object System.Uri($FtpPath)
    $request = [System.Net.WebRequest]::Create($uri)
    $request.Method = [System.Net.WebRequestMethods+Ftp]::MakeDirectory
    $request.Credentials = New-Object System.Net.NetworkCredential($username, $password)
    
    try {
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
Write-Host "Starting deployment to $ftpServer..."
Upload-FolderRecurse -LocalDir $sourceDir -RemoteUrl $ftpServer
Write-Host "Deployment completed!"
