# SECURITY (audit 2026-08, DP-002): FTPS only — ftps:// (explicit TLS via
# AUTH TLS) is required, plaintext ftp:// is hard-rejected. Credentials come
# from the environment; certificates validate against the machine trust store.
$ErrorActionPreference = 'Stop'

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

$request = [System.Net.FtpWebRequest]::Create($ftpServer)
$request.Method = [System.Net.WebRequestMethods+Ftp]::ListDirectory
$request.Credentials = New-Object System.Net.NetworkCredential($username, $password)
$request.EnableSsl = $true

try {
    $response = $request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $listing = $reader.ReadToEnd()
    $reader.Close()
    $response.Close()
    Write-Host "FTPS Directory Listing:"
    Write-Host $listing
}
catch {
    Write-Error "Failed to list directory: $_"
}
