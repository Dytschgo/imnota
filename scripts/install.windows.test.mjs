import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  assertNoTemporaryFiles,
  checksumLine,
  hostileChecksums,
  publish,
  releaseRoot,
  requests,
  sandbox,
  sha256,
} from './test-support/install-harness.mjs';

// Windows: install.ps1 under each available PowerShell edition.
// Shared fixtures live in test-support/install-harness.mjs; see its header.

const powershellInstaller = fileURLToPath(new URL('./install.ps1', import.meta.url));
const powershells = (process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh']).filter(
  (command) => spawnSync(command, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0,
);

const powershellHarness = String.raw`
param([string]$Script)
function Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [string]$Method, [switch]$UseBasicParsing)
  Add-Content -LiteralPath $env:FAKE_LOG -Value $Uri
  if ($Method -eq 'Head') {
    if (-not $env:FAKE_LATEST_URL) { throw 'The remote name could not be resolved.' }
    if ($env:FAKE_URI_SHAPE -eq 'RequestMessage') {
      $base = [pscustomobject]@{ RequestMessage = [pscustomobject]@{ RequestUri = [uri]$env:FAKE_LATEST_URL } }
    } else {
      $base = [pscustomobject]@{ ResponseUri = [uri]$env:FAKE_LATEST_URL }
    }
    return [pscustomobject]@{ BaseResponse = $base }
  }
  $source = Join-Path $env:FAKE_RELEASES $Uri.Substring('https://github.com/Dytschgo/imnota/releases/download/'.Length)
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'The remote server returned an error: (404) Not Found.' }
  Copy-Item -LiteralPath $source -Destination $OutFile
  if ($env:FAKE_JUNCTION_TARGET -and $Uri.EndsWith('/Imnota-Setup.exe')) {
    # PS 5.1 New-Item resolves -Target as a wildcard path; keep the sandbox's
    # literal brackets and use Node's native junction creation for this fixture.
    & $env:FAKE_NODE $env:FAKE_JUNCTION_HELPER $env:FAKE_JUNCTION_TARGET (Join-Path (Split-Path -Parent $OutFile) 'linked-data')
    if ($LASTEXITCODE -ne 0) { throw 'Fixture junction creation failed' }
    Add-Content -LiteralPath $env:FAKE_LOG -Value 'junction'
  }
  if ($env:FAKE_PARTIAL_DOWNLOAD -and $Uri.EndsWith('/' + $env:FAKE_PARTIAL_DOWNLOAD)) { throw 'Interrupted download' }
}
function Start-Process {
  param([string]$FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru, $WindowStyle)
  Add-Content -LiteralPath $env:FAKE_LOG -Value "run $ArgumentList $((Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant())"
  [pscustomobject]@{ ExitCode = [int]$env:FAKE_EXIT_CODE }
}
try {
  . $Script
} catch {
  # Assert the script's actual error contract, independent of ConciseView's
  # wrapping/ANSI decorations. Rethrow to preserve the nonzero process result.
  [System.IO.File]::WriteAllText($env:FAKE_ERROR, $_.Exception.Message)
  throw
}
`;

function runPowershellInstaller(
  shell,
  directories,
  { latest, tag, shape, exitCode = 0, partial = '', junctionTarget = '' } = {},
) {
  const harness = path.join(directories.root, 'harness.ps1');
  fs.writeFileSync(harness, powershellHarness);
  const junctionHelper = path.join(directories.root, 'junction.cjs');
  if (junctionTarget)
    fs.writeFileSync(
      junctionHelper,
      "require('node:fs').symlinkSync(process.argv[2], process.argv[3], 'junction');",
    );
  return spawnSync(
    shell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, powershellInstaller],
    {
      encoding: 'utf8',
      env: {
        // PowerShell editions need their own default module paths.
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
        ),
        TEMP: directories.temporary,
        FAKE_LOG: directories.log,
        FAKE_ERROR: path.join(directories.root, 'exception.txt'),
        FAKE_RELEASES: directories.releases,
        FAKE_LATEST_URL: latest ?? '',
        FAKE_URI_SHAPE: shape ?? '',
        FAKE_EXIT_CODE: String(exitCode),
        FAKE_PARTIAL_DOWNLOAD: partial,
        FAKE_JUNCTION_TARGET: junctionTarget,
        FAKE_NODE: process.execPath,
        FAKE_JUNCTION_HELPER: junctionHelper,
        IMNOTA_RELEASE_TAG: tag ?? '',
      },
    },
  );
}

const setup = 'synthetic installer';
const setupRequests = [
  `${releaseRoot}/latest`,
  `${releaseRoot}/download/v1.2.3/Imnota-Setup.exe`,
  `${releaseRoot}/download/v1.2.3/SHA256SUMS.txt`,
];

for (const shell of powershells) {
  test(`${shell} selects the literal checksum among hostile filenames`, (t) => {
    const directories = sandbox(t);
    publish(directories, 'v1.2.3', {
      'Imnota-Setup.exe': setup,
      'SHA256SUMS.txt': hostileChecksums('Imnota-Setup.exe', setup),
    });
    const result = runPowershellInstaller(shell, directories, { tag: 'v1.2.3' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(requests(directories), [...setupRequests.slice(1), `run /S ${sha256(setup)}`]);
    assertNoTemporaryFiles(directories);
  });

  test(`${shell} runs only a verified installer from the resolved latest release`, (t) => {
    for (const shape of ['ResponseUri', 'RequestMessage']) {
      const directories = sandbox(t);
      publish(directories, 'v1.2.3', {
        'Imnota-Setup.exe': setup,
        'SHA256SUMS.txt': `${checksumLine('Imnota-Setup-1.2.3.exe', setup)}\n${checksumLine('Imnota-Setup.exe', setup)}\n`,
      });
      publish(directories, 'v1.2.4', {
        'Imnota-Setup.exe': 'newer',
        'SHA256SUMS.txt': `${checksumLine('Imnota-Setup.exe', 'newer')}\n`,
      });

      const result = runPowershellInstaller(shell, directories, {
        latest: `${releaseRoot}/tag/v1.2.3`,
        shape,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Verified Imnota-Setup\.exe against SHA256SUMS\.txt from v1\.2\.3/);
      assert.deepEqual(requests(directories), [...setupRequests, `run /S ${sha256(setup)}`]);
      assertNoTemporaryFiles(directories);
    }
  });

  test(`${shell} installs an exact requested release and reports installer failure`, (t) => {
    const directories = sandbox(t);
    publish(directories, 'v1.2.3', {
      'Imnota-Setup.exe': setup,
      'SHA256SUMS.txt': `${checksumLine('Imnota-Setup.exe', setup).toUpperCase().replace('IMNOTA-SETUP.EXE', 'Imnota-Setup.exe')}\n`,
    });

    const result = runPowershellInstaller(shell, directories, { tag: 'v1.2.3', exitCode: 2 });

    assert.notEqual(result.status, 0);
    assert.match(
      fs.readFileSync(path.join(directories.root, 'exception.txt'), 'utf8'),
      /installation failed with exit code 2/,
    );
    assert.deepEqual(requests(directories), [...setupRequests.slice(1), `run /S ${sha256(setup)}`]);
    assertNoTemporaryFiles(directories);
  });

  test(`${shell} refuses to run an unverified installer`, (t) => {
    const cases = [
      [
        { 'Imnota-Setup.exe': setup, 'SHA256SUMS.txt': 'z'.repeat(64) + '  Imnota-Setup.exe' },
        /Malformed SHA256SUMS/,
      ],
      [
        {
          'Imnota-Setup.exe': setup,
          'SHA256SUMS.txt': checksumLine('Imnota-Setup.exe', setup) + '\nmalformed',
        },
        /Malformed SHA256SUMS/,
      ],
      [
        { 'Imnota-Setup.exe': 'tampered', 'SHA256SUMS.txt': `${checksumLine('Imnota-Setup.exe', setup)}\n` },
        /Checksum mismatch for Imnota-Setup\.exe from v1\.2\.3/,
      ],
      [
        {
          'Imnota-Setup.exe': setup,
          'SHA256SUMS.txt': `${checksumLine('Imnota-Setup-1.2.3.exe', setup)}\n${checksumLine('imnota-setup.exe', setup)}\n`,
        },
        /does not contain exactly one checksum for Imnota-Setup\.exe/,
      ],
      [
        {
          'Imnota-Setup.exe': setup,
          'SHA256SUMS.txt': `${checksumLine('Imnota-Setup.exe', 'other')}\n${checksumLine('Imnota-Setup.exe', setup)}\n`,
        },
        /does not contain exactly one checksum for Imnota-Setup\.exe/,
      ],
      [
        { 'Imnota-Setup.exe': setup, 'SHA256SUMS.txt': '' },
        /does not contain exactly one checksum for Imnota-Setup\.exe/,
      ],
      [{ 'Imnota-Setup.exe': setup }, /SHA256SUMS\.txt could not be downloaded for v1\.2\.3/],
      [{ 'SHA256SUMS.txt': `${checksumLine('Imnota-Setup.exe', setup)}\n` }, /Download failed/],
    ];
    for (const [files, message] of cases) {
      const directories = sandbox(t);
      publish(directories, 'v1.2.3', files);

      const result = runPowershellInstaller(shell, directories, {
        latest: `${releaseRoot}/tag/v1.2.3`,
      });

      assert.equal(
        requests(directories).some((entry) => entry.startsWith('run ')),
        false,
      );
      assertNoTemporaryFiles(directories);
      assert.notEqual(result.status, 0);
      assert.match(fs.readFileSync(path.join(directories.root, 'exception.txt'), 'utf8'), message);
    }
  });

  test(`${shell} refuses to download when the latest release cannot be resolved`, (t) => {
    for (const latest of [
      '',
      releaseRoot,
      `${releaseRoot}/tag/v1.2.3-nightly.20260906.14`,
      'https://github.com/other/imnota/releases/tag/v1.2.3',
    ]) {
      const directories = sandbox(t);
      publish(directories, 'v1.2.3', {
        'Imnota-Setup.exe': setup,
        'SHA256SUMS.txt': `${checksumLine('Imnota-Setup.exe', setup)}\n`,
      });

      const result = runPowershellInstaller(shell, directories, { latest });

      assert.notEqual(result.status, 0);
      assert.deepEqual(requests(directories), [`${releaseRoot}/latest`]);
      assertNoTemporaryFiles(directories);
      assert.match(
        fs.readFileSync(path.join(directories.root, 'exception.txt'), 'utf8'),
        /latest stable release could not be determined/,
      );
    }
  });

  test(`${shell} cleans interrupted downloads without executing them`, (t) => {
    for (const partial of ['Imnota-Setup.exe', 'SHA256SUMS.txt']) {
      const directories = sandbox(t);
      publish(directories, 'v1.2.3', {
        'Imnota-Setup.exe': setup,
        'SHA256SUMS.txt': checksumLine('Imnota-Setup.exe', setup),
      });
      const result = runPowershellInstaller(shell, directories, { tag: 'v1.2.3', partial });
      assert.notEqual(result.status, 0);
      assert.equal(
        requests(directories).some((entry) => entry.startsWith('run ')),
        false,
      );
      assertNoTemporaryFiles(directories);
    }
  });

  test(
    `${shell} cleanup removes a temporary junction without traversing its target`,
    { skip: process.platform !== 'win32' && 'Windows junction cleanup boundary' },
    (t) => {
      const directories = sandbox(t);
      const target = path.join(directories.root, 'preserved-data');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'marker'), 'preserve');
      publish(directories, 'v1.2.3', { 'Imnota-Setup.exe': setup });
      const result = runPowershellInstaller(shell, directories, {
        tag: 'v1.2.3',
        partial: 'Imnota-Setup.exe',
        junctionTarget: target,
      });
      assert.equal(
        requests(directories).some((entry) => entry.startsWith('run ')),
        false,
      );
      assert.deepEqual(requests(directories), [
        `${releaseRoot}/download/v1.2.3/Imnota-Setup.exe`,
        'junction',
      ]);
      assert.notEqual(result.status, 0);
      assert.match(
        fs.readFileSync(path.join(directories.root, 'exception.txt'), 'utf8'),
        /Download failed.*Interrupted download/,
      );
      assert.deepEqual(fs.readdirSync(target), ['marker']);
      assert.equal(fs.readFileSync(path.join(target, 'marker'), 'utf8'), 'preserve');
      assertNoTemporaryFiles(directories);
    },
  );
}
