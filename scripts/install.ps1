$ErrorActionPreference = 'Stop'

$repository = 'Dytschgo/imnota'
$assetName = 'Imnota-Setup.exe'
$stableTagPattern = '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
$releaseTag = $env:IMNOTA_RELEASE_TAG
if ($releaseTag -and $releaseTag -cnotmatch $stableTagPattern) {
  throw 'IMNOTA_RELEASE_TAG must be an exact stable tag.'
}
$temporaryRoot = [System.IO.Path]::GetFullPath($env:TEMP)
$temporaryDirectory = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot "Imnota-Setup-$([guid]::NewGuid())"))
if ([System.IO.Path]::GetDirectoryName($temporaryDirectory) -cne $temporaryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar)) {
  throw 'Unsafe temporary download path.'
}
$installerPath = Join-Path $temporaryDirectory $assetName
$checksumsPath = Join-Path $temporaryDirectory 'SHA256SUMS.txt'
$temporaryCreated = $false

try {
  if (-not $releaseTag) {
    # The installer and SHA256SUMS.txt must come from the same release. The
    # releases/latest/download alias is resolved separately for every request,
    # so resolve the latest tag once and use tagged URLs for both downloads.
    try {
      $latest = Invoke-WebRequest -Uri "https://github.com/$repository/releases/latest" -Method Head -UseBasicParsing
      # Windows PowerShell 5.1 exposes the final URL as ResponseUri; PowerShell 7 as RequestMessage.RequestUri.
      $resolvedUri = $latest.BaseResponse.ResponseUri
      if (-not $resolvedUri) { $resolvedUri = $latest.BaseResponse.RequestMessage.RequestUri }
      $resolvedUrl = [string]$resolvedUri
    }
    catch {
      throw "The latest stable release could not be determined. No installed app was changed. Check https://github.com/$repository/releases and try again. ($($_.Exception.Message))"
    }
    $tagUrlPrefix = "https://github.com/$repository/releases/tag/"
    if (-not $resolvedUrl.StartsWith($tagUrlPrefix, [System.StringComparison]::Ordinal)) {
      throw "The latest stable release could not be determined. No installed app was changed. Check https://github.com/$repository/releases and try again."
    }
    $releaseTag = $resolvedUrl.Substring($tagUrlPrefix.Length)
    if ($releaseTag -cnotmatch $stableTagPattern) {
      throw "The latest stable release could not be determined. No installed app was changed. Check https://github.com/$repository/releases and try again."
    }
  }
  $downloadBase = "https://github.com/$repository/releases/download/$releaseTag"
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $temporaryCreated = $true

  Write-Host "Downloading Imnota $releaseTag for Windows..."
  try {
    Invoke-WebRequest -Uri "$downloadBase/$assetName" -OutFile $installerPath -UseBasicParsing
  }
  catch {
    throw "Download failed. No installed app was changed. Check https://github.com/$repository/releases and try again. ($($_.Exception.Message))"
  }
  try {
    Invoke-WebRequest -Uri "$downloadBase/SHA256SUMS.txt" -OutFile $checksumsPath -UseBasicParsing
  }
  catch {
    throw "SHA256SUMS.txt could not be downloaded for $releaseTag, so $assetName cannot be verified. Nothing was installed and no installed app was changed. ($($_.Exception.Message))"
  }

  # Refuse to run the installer unless its SHA-256 matches the single entry for
  # it in the same release's SHA256SUMS.txt.
  $expectedChecksums = @(
    foreach ($line in @(Get-Content -LiteralPath $checksumsPath)) {
      if ($line -cnotmatch '^([0-9a-fA-F]{64})  (.+)$') {
        throw "Malformed SHA256SUMS.txt for ${releaseTag}. Nothing was installed and no installed app was changed."
      }
      if ($Matches[2] -ceq $assetName) {
        $Matches[1].ToLowerInvariant()
      }
    }
  )
  if ($expectedChecksums.Count -ne 1) {
    throw "SHA256SUMS.txt for $releaseTag does not contain exactly one checksum for $assetName. Nothing was installed and no installed app was changed."
  }
  $expectedChecksum = $expectedChecksums[0]
  $actualChecksum = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualChecksum -cne $expectedChecksum) {
    throw "Checksum mismatch for $assetName from ${releaseTag}: SHA256SUMS.txt lists $expectedChecksum but the download is $actualChecksum. The download was discarded; nothing was installed and no installed app was changed."
  }
  Write-Host "Verified $assetName against SHA256SUMS.txt from $releaseTag."

  $installation = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if ($installation.ExitCode -ne 0) { throw "Imnota installation failed with exit code $($installation.ExitCode)." }
  Write-Host 'Imnota installed successfully.'
}
finally {
  if ($temporaryCreated -and (Test-Path -LiteralPath $temporaryDirectory)) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
