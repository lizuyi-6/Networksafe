# SECURITY: credentials must come from the environment, never hardcoded.
$ftpServer = $env:AETHERGUARD_FTP_SERVER
$username = $env:AETHERGUARD_FTP_USERNAME
$password = $env:AETHERGUARD_FTP_PASSWORD
if (-not $ftpServer -or -not $username -or -not $password) {
    Write-Error "Missing AETHERGUARD_FTP_SERVER / AETHERGUARD_FTP_USERNAME / AETHERGUARD_FTP_PASSWORD environment variables."
    exit 1
}

$request = [System.Net.WebRequest]::Create($ftpServer)
$request.Method = [System.Net.WebRequestMethods+Ftp]::ListDirectory
$request.Credentials = New-Object System.Net.NetworkCredential($username, $password)

try {
    $response = $request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $listing = $reader.ReadToEnd()
    $reader.Close()
    $response.Close()
    Write-Host "FTP Directory Listing:"
    Write-Host $listing
}
catch {
    Write-Error "Failed to list directory: $_"
}
