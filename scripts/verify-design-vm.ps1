[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Lab Manager requires a short invocation of a checked-in guest script. This
# entry point orchestrates the existing project commands without replacing them.
# Never execute project checks on the coding PC.
if (-not $env:AGENTLAB_EVIDENCE_DIR) { throw 'Run only through the managed Windows guest.' }
$evidence = $env:AGENTLAB_EVIDENCE_DIR
$report = [ordered]@{ status = 'running'; stage = 'prepare'; steps = @(); error = $null }
function Save-Checkpoint([string]$Stage) {
    $report.stage = $Stage
    $report.updatedUtc = [DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText((Join-Path $evidence 'design-vm-report.json'), ($report | ConvertTo-Json -Depth 8))
}
function Invoke-ProjectStep([string]$Name, [scriptblock]$Command) {
    Save-Checkpoint $Name
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
    $report.steps += @{ name = $Name; status = 'passed' }
    Save-Checkpoint $Name
}
$exitCode = 1
try {
    $report.nodeVersion = & node --version
    $report.nodePath = (Get-Command node).Source
    $report.sourceVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $env:CI = 'true'
    Invoke-ProjectStep 'dependencies' { corepack pnpm install --frozen-lockfile }
    Invoke-ProjectStep 'electron-runtime' { corepack pnpm exec install-electron }
    Invoke-ProjectStep 'format-check' { corepack pnpm format:check }
    Invoke-ProjectStep 'lint' { corepack pnpm lint }
    Invoke-ProjectStep 'typecheck' { corepack pnpm typecheck }
    Invoke-ProjectStep 'full-tests' { corepack pnpm test }
    Invoke-ProjectStep 'package-windows' { corepack pnpm package:win }
    $executable = Join-Path (Get-Location).Path 'release/win-unpacked/Imnota.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Packaged executable is missing.' }
    $report.executableSha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    $env:IMNOTA_EXPECT_VERSION = $report.sourceVersion
    $env:IMNOTA_SMOKE_ARTIFACT_DIR = Join-Path $evidence 'imnota-verification-artifacts-design'
    # UI verification is independent of the Node 24 prerequisite for strict MCP relay acceptance.
    Invoke-ProjectStep 'packaged-ui-walkthrough' { node scripts/smoke.mjs $executable }
    $differences = Join-Path $evidence 'design-visual-differences'
    Invoke-ProjectStep 'visual-baseline-comparison' {
        node scripts/visual-regression.mjs tests/visual/win32 $env:IMNOTA_SMOKE_ARTIFACT_DIR $differences |
            Tee-Object -FilePath (Join-Path $evidence 'design-visual-comparison.json')
    }
    $report.status = 'passed'
    $exitCode = 0
} catch {
    $report.status = 'failed'
    $report.error = $_.Exception.Message
    Write-Host $report.error
} finally {
    Save-Checkpoint $report.stage
}
exit $exitCode
