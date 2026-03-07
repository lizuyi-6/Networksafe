$ftpServer = "ftp://171.80.8.102/"
$username = "ftp6627177"
$password = "Li15227225280"

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
