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
// Pre-verification control flow is portable. Replacement tests must use the
// supported platform's own filesystem utilities (GNU mv on Linux, BSD ditto on
// macOS); a stubbed uname does not turn another host into that platform.
const linuxReplacementSkip =
  !bash || (process.platform !== 'linux' && 'Requires native Linux replacement utilities; runs in Linux CI');
const nativeMacSkip =
  !bash || (process.platform !== 'darwin' && 'Requires native macOS ditto and PlistBuddy');

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
ditto() {
  printf 'ditto\n' >> "$FAKE_LOG"
  [ "\${FAKE_NATIVE_DITTO:-}" = 1 ] || return 1
  if [ "$1" != -x ] && [ "\${FAKE_MAC_COPY_FAILURE:-}" = 1 ]; then return 1; fi
  command ditto "$@"
}
codesign() { printf 'codesign\n' >> "$FAKE_LOG"; return "\${FAKE_CODESIGN_EXIT:-1}"; }
open() { printf 'open\n' >> "$FAKE_LOG"; return 0; }
# Never execute even the synthetic AppImage.
nohup() { :; }
install() {
  [ "\${FAKE_INSTALL_FAILURE:-}" != 1 ] || return 1
  command install "$@"
}
source "$1"
`.replaceAll('\\$', '$');

function runShellInstaller(
  directories,
  {
    platform = 'Linux',
    latest,
    tag,
    partial = '',
    installFailure = '',
    nativeDitto = false,
    codesignExit = 1,
    macCopyFailure = false,
  } = {},
) {
  assert.ok(bash, 'Bash is required for this test');
  const env = {
    ...process.env,
    HOME: slashes(directories.home),
    TMPDIR: slashes(directories.temporary),
    FAKE_UNAME_S: platform,
    FAKE_PARTIAL_DOWNLOAD: partial,
    FAKE_INSTALL_FAILURE: installFailure,
    FAKE_NATIVE_DITTO: nativeDitto ? '1' : '',
    FAKE_CODESIGN_EXIT: String(codesignExit),
    FAKE_MAC_COPY_FAILURE: macCopyFailure ? '1' : '',
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

test(
  'Linux installs a verified AppImage from the resolved latest release',
  { skip: linuxReplacementSkip },
  (t) => {
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
  },
);

test(
  'Linux installs an exact requested release without resolving latest',
  { skip: linuxReplacementSkip },
  (t) => {
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
  },
);

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

test('Linux leaves the old predictable staging path untouched', { skip: linuxReplacementSkip }, (t) => {
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

function hostileChecksums(assetName, content) {
  return ['*', '[]', '$', `../${assetName}`, assetName.toLowerCase()]
    .map((name) => checksumLine(name, 'unrelated bytes'))
    .concat(checksumLine(assetName, content))
    .join('\n');
}

test('Linux selects the literal checksum among hostile filenames', { skip: linuxReplacementSkip }, (t) => {
  const directories = sandbox(t);
  publish(directories, 'v1.2.3', {
    'Imnota.AppImage': appImage,
    'SHA256SUMS.txt': hostileChecksums('Imnota.AppImage', appImage),
  });
  const result = runShellInstaller(directories, { tag: 'v1.2.3' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(installedLinuxApp(directories), 'utf8'), appImage);
  assert.deepEqual(fs.readdirSync(path.dirname(installedLinuxApp(directories))), ['imnota']);
  assertNoTemporaryFiles(directories);
});

test(
  'Linux replacement never follows destination symlinks or overwrites a hardlink peer',
  { skip: linuxReplacementSkip },
  (t) => {
    for (const kind of ['file symlink', 'directory symlink', 'dangling symlink', 'hardlink']) {
      const directories = sandbox(t);
      const destination = installedLinuxApp(directories);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const target = path.join(directories.root, 'target');
      if (kind === 'directory symlink') {
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'marker'), 'preserve');
      } else if (kind !== 'dangling symlink') {
        fs.writeFileSync(target, 'preserve');
      }
      if (kind === 'hardlink') fs.linkSync(target, destination);
      else fs.symlinkSync(target, destination);
      publish(directories, 'v1.2.3', {
        'Imnota.AppImage': appImage,
        'SHA256SUMS.txt': checksumLine('Imnota.AppImage', appImage),
      });
      const result = runShellInstaller(directories, { tag: 'v1.2.3' });
      assert.equal(result.status, 0, `${kind}: ${result.stderr}`);
      assert.equal(fs.lstatSync(destination).isSymbolicLink(), false, kind);
      assert.equal(fs.readFileSync(destination, 'utf8'), appImage, kind);
      assert.ok(fs.statSync(destination).mode & 0o111, kind);
      if (kind === 'directory symlink') {
        assert.deepEqual(fs.readdirSync(target), ['marker']);
        assert.equal(fs.readFileSync(path.join(target, 'marker'), 'utf8'), 'preserve');
      } else if (kind === 'dangling symlink') {
        assert.equal(fs.existsSync(target), false);
      } else {
        assert.equal(fs.readFileSync(target, 'utf8'), 'preserve', kind);
      }
      assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['imnota']);
      assertNoTemporaryFiles(directories);
    }
  },
);

test(
  'Linux refuses a directory destination and cleans staging without changing its contents',
  { skip: linuxReplacementSkip },
  (t) => {
    const directories = sandbox(t);
    const destination = installedLinuxApp(directories);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'marker'), 'preserve');
    publish(directories, 'v1.2.3', {
      'Imnota.AppImage': appImage,
      'SHA256SUMS.txt': checksumLine('Imnota.AppImage', appImage),
    });
    const result = runShellInstaller(directories, { tag: 'v1.2.3' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Verified Imnota\.AppImage/);
    assert.deepEqual(fs.readdirSync(destination), ['marker']);
    assert.equal(fs.readFileSync(path.join(destination, 'marker'), 'utf8'), 'preserve');
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['imnota']);
    assert.equal(fs.existsSync(path.join(directories.home, '.local', 'share')), false);
    assertNoTemporaryFiles(directories);
  },
);

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

function publishMacBundle(directories, { minimum = '10.0.0', executable = true } = {}) {
  const bundle = path.join(directories.root, 'Imnota.app');
  const contents = path.join(bundle, 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.writeFileSync(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>LSMinimumSystemVersion</key><string>${minimum}</string></dict></plist>`,
  );
  if (executable) fs.writeFileSync(path.join(contents, 'MacOS', 'Imnota'), appImage, { mode: 0o755 });
  fs.writeFileSync(path.join(bundle, 'marker'), 'verified bundle');
  const archive = path.join(directories.root, 'bundle.zip');
  const packed = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', bundle, archive], {
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  const bytes = fs.readFileSync(archive);
  publish(directories, 'v1.2.3', {
    'Imnota-mac.zip': bytes,
    'SHA256SUMS.txt': checksumLine('Imnota-mac.zip', bytes),
  });
}

function keepExistingMacApp(directories) {
  const app = path.join(directories.home, 'Applications', 'Imnota.app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'marker'), 'previous installation');
  return app;
}

const nativeMacOptions = { platform: 'Darwin', tag: 'v1.2.3', nativeDitto: true, codesignExit: 0 };

test(
  'macOS installs a verified synthetic bundle with native ditto and preserves the previous app',
  { skip: nativeMacSkip },
  (t) => {
    const directories = sandbox(t);
    const app = keepExistingMacApp(directories);
    publishMacBundle(directories);
    const result = runShellInstaller(directories, nativeMacOptions);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified Imnota-mac\.zip/);
    assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'verified bundle');
    assert.equal(fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'Imnota'), 'utf8'), appImage);
    const backups = fs.readdirSync(path.dirname(app)).filter((name) => /^Imnota-backup-.*\.app$/.test(name));
    assert.equal(backups.length, 1);
    assert.equal(
      fs.readFileSync(path.join(path.dirname(app), backups[0], 'marker'), 'utf8'),
      'previous installation',
    );
    assert.deepEqual(requests(directories), [
      `${releaseRoot}/download/v1.2.3/Imnota-mac.zip`,
      `${releaseRoot}/download/v1.2.3/SHA256SUMS.txt`,
      'ditto',
      'codesign',
      'ditto',
      'open',
    ]);
    assertNoTemporaryFiles(directories);
  },
);

test(
  'macOS native extraction and bundle checks fail before replacing the previous app',
  { skip: nativeMacSkip },
  (t) => {
    for (const boundary of ['extraction', 'executable', 'signature', 'minimum version']) {
      const directories = sandbox(t);
      const app = keepExistingMacApp(directories);
      if (boundary === 'extraction') {
        publish(directories, 'v1.2.3', {
          'Imnota-mac.zip': 'invalid zip',
          'SHA256SUMS.txt': checksumLine('Imnota-mac.zip', 'invalid zip'),
        });
      } else {
        publishMacBundle(directories, {
          executable: boundary !== 'executable',
          minimum: boundary === 'minimum version' ? '999.0.0' : '10.0.0',
        });
      }
      const result = runShellInstaller(directories, {
        ...nativeMacOptions,
        codesignExit: boundary === 'signature' ? 1 : 0,
      });
      assert.notEqual(result.status, 0, boundary);
      assert.match(result.stdout, /Verified Imnota-mac\.zip/);
      assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'previous installation', boundary);
      assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Imnota.app']);
      assert.equal(requests(directories).includes('open'), false);
      assert.equal(requests(directories).filter((entry) => entry === 'ditto').length, 1);
      if (boundary === 'minimum version') assert.match(result.stderr, /requires macOS 999\.0\.0 or later/);
      assertNoTemporaryFiles(directories);
    }
  },
);

test(
  'macOS preserves a recoverable backup when copying the verified bundle fails',
  { skip: nativeMacSkip },
  (t) => {
    const directories = sandbox(t);
    const app = keepExistingMacApp(directories);
    publishMacBundle(directories);
    const result = runShellInstaller(directories, { ...nativeMacOptions, macCopyFailure: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Installation failed.*previous app is preserved/);
    const names = fs.readdirSync(path.dirname(app));
    assert.equal(names.length, 1);
    assert.match(names[0], /^Imnota-backup-.*\.app$/);
    assert.equal(
      fs.readFileSync(path.join(path.dirname(app), names[0], 'marker'), 'utf8'),
      'previous installation',
    );
    assert.equal(requests(directories).includes('open'), false);
    assertNoTemporaryFiles(directories);
  },
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
