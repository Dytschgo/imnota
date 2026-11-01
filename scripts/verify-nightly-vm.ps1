[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Guest-only orchestration. The application and existing verifiers stay at b80ef9f.
if (-not $env:AGENTLAB_EVIDENCE_DIR) { throw 'Run only through the managed Windows guest.' }
$version = '0.4.1-nightly.20261031.41222265922'
$tag = "v$version"
$asset = "Imnota-Setup-$version.exe"
$expectedHash = 'b55d0db053b2d489226349a55240bb606566ed2386fe21b6236115607019539e'
$evidence = Join-Path $env:AGENTLAB_EVIDENCE_DIR 'imnota-verification-artifacts-nightly-vm'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$report = [ordered]@{
    candidateSha = 'b80ef9f2901acae6569eb056aa63d57cc114e5e4'
    version = $version
    status = 'running'
    steps = @()
    error = $null
}
$exitCode = 1
function Save-Checkpoint([string]$Stage) {
    $report.stage = $Stage
    $report.updatedUtc = [DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText((Join-Path $evidence 'vm-report.json'), ($report | ConvertTo-Json -Depth 8))
}
try {
    Save-Checkpoint 'guest-dependencies'
    $nodeVersion = & node --version
    $report.nodeVersion = $nodeVersion
    $report.nodePath = (Get-Command node).Source
    if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion -replace '^v(\d+).*$', '$1') -lt 22) {
        throw 'Existing Node.js 22+ is required for the UI verifier dependencies.'
    }
    $env:CI = 'true'
    & corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Guest dependency restore failed.' }
    & corepack pnpm exec install-electron
    if ($LASTEXITCODE -ne 0) { throw 'Guest verifier Electron dependency preparation failed.' }
    $report.steps += @{ name = 'guest-dependencies'; status = 'passed'; nodeVersion = $nodeVersion }

    Save-Checkpoint 'public-installer-download'
    $download = Join-Path $evidence $asset
    Invoke-WebRequest -Uri "https://github.com/Dytschgo/imnota/releases/download/$tag/$asset" -OutFile $download -UseBasicParsing -TimeoutSec 300 -MaximumRedirection 5
    $actualHash = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -cne $expectedHash) { throw 'Published installer checksum mismatch; refusing execution.' }
    $report.steps += @{ name = 'public-installer-checksum'; status = 'passed'; sha256 = $actualHash }

    Save-Checkpoint 'install-published-nsis'
    $installDirectory = Join-Path (Get-Location).Path 'nightly-vm-install'
    if (Test-Path -LiteralPath $installDirectory) { throw 'Private install target already exists; refusing replacement.' }
    $installer = Start-Process -FilePath $download -ArgumentList "/S /D=$installDirectory" -WindowStyle Hidden -PassThru
    if (-not $installer.WaitForExit(120000)) { throw 'Installer did not complete within two minutes.' }
    if ($installer.ExitCode -ne 0) { throw "Installer failed: $($installer.ExitCode)" }
    $executable = Join-Path $installDirectory 'Imnota.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Installer did not produce Imnota.exe in the private target.' }
    $report.steps += @{ name = 'install-published-nsis'; status = 'passed' }

    $env:IMNOTA_EXPECT_VERSION = $version
    $env:IMNOTA_MCP_CLIENT_NODE = (Get-Command node).Source
    $env:IMNOTA_MCP_ARTIFACT_DIR = Join-Path $evidence 'imnota-verification-artifacts-mcp'
    $env:IMNOTA_SMOKE_ARTIFACT_DIR = Join-Path $evidence 'imnota-verification-artifacts-ui'
    Save-Checkpoint 'installed-feature-ui-walkthrough'
    & node scripts/smoke.mjs $executable
    if ($LASTEXITCODE -ne 0) { throw 'Installed application feature walkthrough failed.' }
    $report.steps += @{ name = 'installed-feature-ui-walkthrough'; status = 'passed' }

    if ([int]($nodeVersion -replace '^v(\d+).*$', '$1') -lt 24) {
        $report.steps += @{ name = 'mcp-inspection-relay-readonly-boundaries'; status = 'blocked'; reason = 'Existing Node.js 24+ is required for the Windows relay.' }
        $report.status = 'partial'
        $exitCode = 2
    } else {
        Save-Checkpoint 'mcp-verifier-fixture-build'
        # The MCP verifier imports canonical fixture constructors from dist-electron.
        # This prepares fixtures only; the executable under test remains the downloaded install.
        & corepack pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'MCP verifier fixture build failed.' }
        $report.steps += @{ name = 'mcp-verifier-fixture-build'; status = 'passed' }
        Save-Checkpoint 'mcp-inspection-relay-readonly-boundaries'
        & node scripts/verify-mcp.mjs $executable $download
        if ($LASTEXITCODE -ne 0) { throw 'Packaged MCP verification failed.' }
        $report.steps += @{ name = 'mcp-inspection-relay-readonly-boundaries'; status = 'passed' }
        $report.status = 'passed'
        $exitCode = 0
    }
} catch {
    $report.status = 'failed'
    $report.error = $_.Exception.Message
    Write-Host $report.error
} finally {
    # Do not retain an installer binary in the bounded text/screenshot evidence transfer.
    if ($download -and (Test-Path -LiteralPath $download)) { Remove-Item -LiteralPath $download -Force }
    Save-Checkpoint $report.stage
}
exit $exitCode
