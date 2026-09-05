$ErrorActionPreference = 'Stop'

$downloadUrl = 'https://github.com/Dytschgo/imnota/releases/latest/download/Imnota-Setup.exe'
$installerPath = Join-Path $env:TEMP "Imnota-Setup-$([guid]::NewGuid()).exe"

try {
  Write-Host 'Downloading the latest Imnota release for Windows...'
  Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath
  Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait
  Write-Host 'Imnota installed successfully.'
}
finally {
  if (Test-Path -LiteralPath $installerPath) {
    Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
  }
}
