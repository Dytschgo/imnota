[CmdletBinding()]
param([switch]$CheckSourceOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Historical October 31 reproducer, not the current nightly verifier.
# CheckSourceOnly performs read-only validation on any host; installation remains guest-only.
if (-not $CheckSourceOnly -and -not $env:AGENTLAB_EVIDENCE_DIR) { throw 'Run only through the managed Windows guest.' }
$candidateSha = 'b80ef9f2901acae6569eb056aa63d57cc114e5e4'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ((Get-Location).Path -ine $repository) { throw 'Run from the historical checkout root.' }
# Compare both index and worktree, including the transitive verifier/fixture sources.
# Only this orchestration file may differ from the pinned application/verifier snapshot.
& git -C $repository diff --cached --quiet $candidateSha -- . ':(exclude)scripts/verify-nightly-vm.ps1'
if ($LASTEXITCODE -ne 0) { throw 'Pinned verifier source mismatch. Use the October 31 checkout; current main is not supported by this historical reproducer.' }
& git -C $repository diff --quiet -- . ':(exclude)scripts/verify-nightly-vm.ps1'
if ($LASTEXITCODE -ne 0) { throw 'Pinned verifier source mismatch. Use the October 31 checkout; current main is not supported by this historical reproducer.' }
if ($CheckSourceOnly) {
    Write-Output 'Pinned verifier source confirmed. No downloads or installation were performed.'
    exit 0
}
$version = '0.4.1-nightly.20261031.41222265922'
$tag = "v$version"
$asset = "Imnota-Setup-$version.exe"
$expectedHash = 'b55d0db053b2d489226349a55240bb606566ed2386fe21b6236115607019539e'
$evidence = Join-Path $env:AGENTLAB_EVIDENCE_DIR 'imnota-verification-artifacts-nightly-vm'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$report = [ordered]@{
    candidateSha = $candidateSha
    verifierSourceSha = $candidateSha
    harnessSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
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
    try {
        if ($download -and (Test-Path -LiteralPath $download)) { Remove-Item -LiteralPath $download -Force }
    } catch {
        # Cleanup failure must not replace the command outcome or skip its final report.
        $report.cleanupWarning = $_.Exception.Message
    } finally {
        Save-Checkpoint $report.stage
    }
}
exit $exitCode
