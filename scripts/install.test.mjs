import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

// These tests run the real installers with only the network and the
// platform-specific commands replaced, so a refusal is observed as "nothing was
// installed or executed", not as an internal function result.

const shellInstaller = fileURLToPath(new URL('./install.sh', import.meta.url));
const powershellInstaller = fileURLToPath(new URL('./install.ps1', import.meta.url));
const releaseRoot = 'https://github.com/Dytschgo/imnota/releases';

const bashCandidates = [
  process.env.BASH,
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' : '/usr/bin/bash',
].filter(Boolean);
const bash = bashCandidates.find((candidate) => fs.existsSync(candidate));

const powershells = (process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh']).filter(
  (command) => spawnSync(command, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0,
);

function slashes(value) {
  return value.replaceAll('\\', '/');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function checksumLine(name, content) {
  return `${sha256(content)}  ${name}`;
}

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imnota install [test]-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directories = {
    root,
    releases: path.join(root, 'releases'),
    home: path.join(root, 'home'),
    temporary: path.join(root, 'tmp'),
    log: path.join(root, 'requests.log'),
  };
  for (const directory of [directories.releases, directories.home, directories.temporary])
    fs.mkdirSync(directory);
  fs.writeFileSync(directories.log, '');
  return directories;
}

function publish(directories, tag, files) {
  const directory = path.join(directories.releases, tag);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content);
}

function requests(directories) {
  return fs.readFileSync(directories.log, 'utf8').split(/\r?\n/).filter(Boolean);
}

function assertNoTemporaryFiles(directories) {
  assert.deepEqual(fs.readdirSync(directories.temporary), []);
}

const bashFakes = String.raw`
uname() {
  case "\${1:-}" in
    -m) printf '%s\n' "\${FAKE_UNAME_M:-x86_64}" ;;
    *) printf '%s\n' "$FAKE_UNAME_S" ;;
  esac
}
curl() {
  local output="" url="" head=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --output) output=$2; shift 2 ;;
      --write-out | --retry) shift 2 ;;
      --head) head=1; shift ;;
      --*) shift ;;
      *) url=$1; shift ;;
    esac
  done
  printf '%s\n' "$url" >> "$FAKE_LOG"
  if [ "$head" = 1 ]; then
    [ -n "\${FAKE_LATEST_URL:-}" ] || return 22
    printf '%s' "$FAKE_LATEST_URL"
    return 0
  fi
  local source="$FAKE_RELEASES/\${url#https://github.com/Dytschgo/imnota/releases/download/}"
  [ -f "$source" ] || return 22
  cp "$source" "$output"
  [ "\${FAKE_PARTIAL_DOWNLOAD:-}" != "\${url##*/}" ]
}
ditto() { printf 'ditto\n' >> "$FAKE_LOG"; return 1; }
codesign() { printf 'codesign\n' >> "$FAKE_LOG"; return 1; }
open() { printf 'open\n' >> "$FAKE_LOG"; return 1; }
install() {
  [ "\${FAKE_INSTALL_FAILURE:-}" != 1 ] || return 1
  command install "$@"
}
source "$1"
`.replaceAll('\\$', '$');

function runShellInstaller(
  directories,
  { platform = 'Linux', latest, tag, partial = '', installFailure = '' } = {},
) {
  assert.ok(bash, 'Bash is required for this test');
  const env = {
    ...process.env,
    HOME: slashes(directories.home),
    TMPDIR: slashes(directories.temporary),
    FAKE_UNAME_S: platform,
    FAKE_PARTIAL_DOWNLOAD: partial,
    FAKE_INSTALL_FAILURE: installFailure,
    FAKE_LOG: slashes(directories.log),
    FAKE_RELEASES: slashes(directories.releases),
    FAKE_LATEST_URL: latest ?? '',
    IMNOTA_RELEASE_TAG: tag ?? '',
  };
  return spawnSync(bash, ['-c', bashFakes, 'test', slashes(shellInstaller)], {
    encoding: 'utf8',
    env,
  });
}

const appImage = '#!/bin/sh\nexit 0\n';
const installedLinuxApp = (directories) => path.join(directories.home, '.local', 'bin', 'imnota');

function keepExistingLinuxApp(directories) {
  fs.mkdirSync(path.dirname(installedLinuxApp(directories)), { recursive: true });
  fs.writeFileSync(installedLinuxApp(directories), 'previous installation');
}

function assertLinuxRefusal(directories, result, message) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, message);
  assert.match(result.stderr, /no installed app was changed/i);
  assert.equal(fs.readFileSync(installedLinuxApp(directories), 'utf8'), 'previous installation');
  assert.deepEqual(fs.readdirSync(path.dirname(installedLinuxApp(directories))), ['imnota']);
  assert.equal(fs.existsSync(path.join(directories.home, '.local', 'share')), false);
  assertNoTemporaryFiles(directories);
}

test('Linux installs a verified AppImage from the resolved latest release', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  publish(directories, 'v1.2.3', {
    'Imnota.AppImage': appImage,
    'SHA256SUMS.txt': `${checksumLine('Imnota-1.2.3.AppImage', appImage)}\n${checksumLine('Imnota.AppImage', appImage).toUpperCase().replace('IMNOTA.APPIMAGE', 'Imnota.AppImage')}\n`,
  });
  // A newer release appearing mid-install must not be mixed into this one.
  publish(directories, 'v1.2.4', {
    'Imnota.AppImage': 'newer',
    'SHA256SUMS.txt': `${checksumLine('Imnota.AppImage', 'newer')}\n`,
  });

  const result = runShellInstaller(directories, { latest: `${releaseRoot}/tag/v1.2.3` });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified Imnota\.AppImage against SHA256SUMS\.txt from v1\.2\.3/);
  assert.equal(fs.readFileSync(installedLinuxApp(directories), 'utf8'), appImage);
  assert.deepEqual(requests(directories), [
    `${releaseRoot}/latest`,
    `${releaseRoot}/download/v1.2.3/Imnota.AppImage`,
    `${releaseRoot}/download/v1.2.3/SHA256SUMS.txt`,
  ]);
  assertNoTemporaryFiles(directories);
});

test('Linux installs an exact requested release without resolving latest', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  publish(directories, 'v1.2.3', {
    'Imnota.AppImage': appImage,
    'SHA256SUMS.txt': `${checksumLine('Imnota.AppImage', appImage)}\n`,
  });

  const result = runShellInstaller(directories, { tag: 'v1.2.3' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(installedLinuxApp(directories), 'utf8'), appImage);
  assert.deepEqual(requests(directories), [
    `${releaseRoot}/download/v1.2.3/Imnota.AppImage`,
    `${releaseRoot}/download/v1.2.3/SHA256SUMS.txt`,
  ]);
});

const linuxRefusals = [
  {
    name: 'a checksum mismatch',
    files: {
      'Imnota.AppImage': 'tampered',
      'SHA256SUMS.txt': `${checksumLine('Imnota.AppImage', appImage)}\n`,
    },
    message: /Checksum mismatch for Imnota\.AppImage from v1\.2\.3/,
  },
  {
    name: 'a missing checksum entry',
    files: {
      'Imnota.AppImage': appImage,
      'SHA256SUMS.txt': `${checksumLine('Imnota-1.2.3.AppImage', appImage)}\n${checksumLine('Other-Imnota.AppImage', appImage)}\n`,
    },
    message: /does not contain exactly one checksum for Imnota\.AppImage/,
  },
  {
    name: 'conflicting checksum entries',
    files: {
      'Imnota.AppImage': appImage,
      'SHA256SUMS.txt': `${checksumLine('Imnota.AppImage', 'other')}\n${checksumLine('Imnota.AppImage', appImage)}\n`,
    },
    message: /does not contain exactly one checksum for Imnota\.AppImage/,
  },
  {
    name: 'an empty checksum file',
    files: { 'Imnota.AppImage': appImage, 'SHA256SUMS.txt': '' },
    message: /does not contain exactly one checksum for Imnota\.AppImage/,
  },
  {
    name: 'a missing checksum file',
    files: { 'Imnota.AppImage': appImage },
    message: /SHA256SUMS\.txt could not be downloaded for v1\.2\.3/,
  },
  {
    name: 'a failed download',
    files: { 'SHA256SUMS.txt': `${checksumLine('Imnota.AppImage', appImage)}\n` },
    message: /Download failed/,
  },
];

for (const refusal of linuxRefusals) {
  test(`Linux refuses to install after ${refusal.name}`, { skip: !bash }, (t) => {
    const directories = sandbox(t);
    keepExistingLinuxApp(directories);
    publish(directories, 'v1.2.3', refusal.files);

    const result = runShellInstaller(directories, { latest: `${releaseRoot}/tag/v1.2.3` });

    assertLinuxRefusal(directories, result, refusal.message);
  });
}

test('Linux refuses to install when the latest release cannot be resolved', { skip: !bash }, (t) => {
  for (const latest of [
    '',
    releaseRoot,
    `${releaseRoot}/tag/v1.2.3-nightly.20260906.14`,
    'https://github.com/other/imnota/releases/tag/v1.2.3',
    `${releaseRoot}/tag/v1.2.3/../../download/v1.2.3`,
  ]) {
    const directories = sandbox(t);
    keepExistingLinuxApp(directories);
    publish(directories, 'v1.2.3', {
      'Imnota.AppImage': appImage,
      'SHA256SUMS.txt': `${checksumLine('Imnota.AppImage', appImage)}\n`,
    });

    const result = runShellInstaller(directories, { latest });

    assertLinuxRefusal(directories, result, /latest stable release could not be determined/);
    assert.deepEqual(requests(directories), [`${releaseRoot}/latest`]);
  }
});

test('macOS refuses to extract or replace the app after a failed verification', { skip: !bash }, (t) => {
  const cases = [
    [
      { 'Imnota-mac.zip': 'tampered', 'SHA256SUMS.txt': `${checksumLine('Imnota-mac.zip', 'zip')}\n` },
      /Checksum mismatch for Imnota-mac\.zip/,
    ],
    [
      {
        'Imnota-mac.zip': 'zip',
        'SHA256SUMS.txt': `${checksumLine('Imnota-1.2.3-universal-mac.zip', 'zip')}\n`,
      },
      /does not contain exactly one checksum for Imnota-mac\.zip/,
    ],
    [{ 'Imnota-mac.zip': 'zip' }, /SHA256SUMS\.txt could not be downloaded/],
    [{ 'SHA256SUMS.txt': `${checksumLine('Imnota-mac.zip', 'zip')}\n` }, /Download failed/],
  ];
  for (const [files, message] of cases) {
    const directories = sandbox(t);
    const installedApp = path.join(directories.home, 'Applications', 'Imnota.app');
    fs.mkdirSync(installedApp, { recursive: true });
    fs.writeFileSync(path.join(installedApp, 'marker'), 'previous installation');
    publish(directories, 'v1.2.3', files);

    const result = runShellInstaller(directories, {
      platform: 'Darwin',
      latest: `${releaseRoot}/tag/v1.2.3`,
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.match(result.stderr, /no installed app was changed/i);
    assert.deepEqual(fs.readdirSync(path.dirname(installedApp)), ['Imnota.app']);
    assert.equal(fs.readFileSync(path.join(installedApp, 'marker'), 'utf8'), 'previous installation');
    assert.equal(
      requests(directories).some((entry) => ['ditto', 'codesign', 'open'].includes(entry)),
      false,
    );
    assertNoTemporaryFiles(directories);
  }
});

test('macOS extracts the archive only after it is verified', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  publish(directories, 'v1.2.3', {
    'Imnota-mac.zip': 'zip',
    'SHA256SUMS.txt': `${checksumLine('Imnota-mac.zip', 'zip')}\n`,
  });

  // The fake ditto fails, so this stops at extraction; real installation is
  // covered by the macOS release workflow.
  const result = runShellInstaller(directories, { platform: 'Darwin', tag: 'v1.2.3' });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Verified Imnota-mac\.zip against SHA256SUMS\.txt from v1\.2\.3/);
  assert.deepEqual(requests(directories), [
    `${releaseRoot}/download/v1.2.3/Imnota-mac.zip`,
    `${releaseRoot}/download/v1.2.3/SHA256SUMS.txt`,
    'ditto',
  ]);
  assertNoTemporaryFiles(directories);
});

test(
  'Linux cleans interrupted downloads and failed staging while preserving the previous app',
  { skip: !bash },
  (t) => {
    for (const options of [
      { partial: 'Imnota.AppImage' },
      { partial: 'SHA256SUMS.txt' },
      { installFailure: '1' },
    ]) {
      const directories = sandbox(t);
      keepExistingLinuxApp(directories);
      publish(directories, 'v1.2.3', {
        'Imnota.AppImage': appImage,
        'SHA256SUMS.txt': checksumLine('Imnota.AppImage', appImage),
      });
      const result = runShellInstaller(directories, { tag: 'v1.2.3', ...options });
      assert.notEqual(result.status, 0);
      assert.equal(fs.readFileSync(installedLinuxApp(directories), 'utf8'), 'previous installation');
      assert.deepEqual(fs.readdirSync(path.dirname(installedLinuxApp(directories))), ['imnota']);
      assertNoTemporaryFiles(directories);
    }
  },
);

test('Linux leaves the old predictable staging path untouched', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  keepExistingLinuxApp(directories);
  const hostilePath = installedLinuxApp(directories) + '.new';
  fs.mkdirSync(hostilePath);
  fs.writeFileSync(path.join(hostilePath, 'marker'), 'preserve');
  publish(directories, 'v1.2.3', {
    'Imnota.AppImage': appImage,
    'SHA256SUMS.txt': checksumLine('Imnota.AppImage', appImage),
  });
  const result = runShellInstaller(directories, { tag: 'v1.2.3' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(hostilePath, 'marker'), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(installedLinuxApp(directories), 'utf8'), appImage);
  assertNoTemporaryFiles(directories);
});

for (const metadata of [
  'z'.repeat(64) + '  Imnota.AppImage',
  'abc  Imnota.AppImage',
  checksumLine('Imnota.AppImage', appImage) + '\nmalformed',
  sha256(appImage) + '  ../Imnota.AppImage',
]) {
  test('Linux rejects hostile checksum metadata ' + metadata.slice(0, 12), { skip: !bash }, (t) => {
    const directories = sandbox(t);
    keepExistingLinuxApp(directories);
    publish(directories, 'v1.2.3', { 'Imnota.AppImage': appImage, 'SHA256SUMS.txt': metadata });
    assertLinuxRefusal(
      directories,
      runShellInstaller(directories, { tag: 'v1.2.3' }),
      /Malformed|exactly one checksum/,
    );
  });
}

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
  if ($env:FAKE_PARTIAL_DOWNLOAD -and $Uri.EndsWith('/' + $env:FAKE_PARTIAL_DOWNLOAD)) { throw 'Interrupted download' }
}
function Start-Process {
  param([string]$FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru, $WindowStyle)
  Add-Content -LiteralPath $env:FAKE_LOG -Value "run $ArgumentList $((Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant())"
  [pscustomobject]@{ ExitCode = [int]$env:FAKE_EXIT_CODE }
}
. $Script
`;

function runPowershellInstaller(shell, directories, { latest, tag, shape, exitCode = 0, partial = '' } = {}) {
  const harness = path.join(directories.root, 'harness.ps1');
  fs.writeFileSync(harness, powershellHarness);
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
        FAKE_RELEASES: directories.releases,
        FAKE_LATEST_URL: latest ?? '',
        FAKE_URI_SHAPE: shape ?? '',
        FAKE_EXIT_CODE: String(exitCode),
        FAKE_PARTIAL_DOWNLOAD: partial,
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
    assert.match(result.stderr, /installation failed with exit code 2/);
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

      assert.notEqual(result.status, 0);
      assert.match(result.stderr.replace(/\s+/g, ' '), message);
      assert.equal(
        requests(directories).some((entry) => entry.startsWith('run ')),
        false,
      );
      assertNoTemporaryFiles(directories);
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
      assert.match(result.stderr.replace(/\s+/g, ' '), /latest stable release could not be determined/);
      assert.deepEqual(requests(directories), [`${releaseRoot}/latest`]);
      assertNoTemporaryFiles(directories);
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
}
