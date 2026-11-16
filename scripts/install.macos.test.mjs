import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import {
  macChecksums,
  appImage,
  assertNoTemporaryFiles,
  bash,
  checksumLine,
  nativeMacSkip,
  publish,
  releaseRoot,
  requests,
  runShellInstaller,
  sandbox,
  slashes,
} from './test-support/install-harness.mjs';

// macOS: install.sh verification, app replacement transactions and rollback.
// Shared fixtures live in test-support/install-harness.mjs; see its header.

test('macOS refuses to extract or replace the app after a failed verification', { skip: !bash }, (t) => {
  const cases = [
    [
      { 'Imnota-mac.zip': 'tampered', 'SHA256SUMS.txt': `${macChecksums('zip')}\n` },
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
    [{ 'SHA256SUMS.txt': `${macChecksums('zip')}\n` }, /Download failed/],
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
    'SHA256SUMS.txt': `${macChecksums('zip')}\n`,
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

test('macOS refuses a checksum list that does not identify the Mac archive', { skip: !bash }, (t) => {
  const alias = checksumLine('Imnota-mac.zip', 'zip');
  const cases = [
    [`${alias}\n`, /lists no Imnota-1\.2\.3 macOS archive/],
    [
      `${alias}\n${checksumLine('Imnota-1.2.3-universal-mac.zip', 'other')}\n`,
      /Imnota-mac\.zip is not Imnota-1\.2\.3-universal-mac\.zip/,
    ],
    [
      `${macChecksums('zip')}\n${checksumLine('Imnota-1.2.3-universal-mac.zip', 'zip')}\n`,
      /lists a macOS archive more than once/,
    ],
  ];
  for (const [checksums, message] of cases) {
    const directories = sandbox(t);
    publish(directories, 'v1.2.3', { 'Imnota-mac.zip': 'zip', 'SHA256SUMS.txt': checksums });
    const result = runShellInstaller(directories, { platform: 'Darwin', tag: 'v1.2.3' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.match(result.stderr, /no installed app was changed/i);
    assert.equal(requests(directories).includes('ditto'), false);
    assertNoTemporaryFiles(directories);
  }
});

test(
  'macOS installs an Apple silicon archive only on Apple silicon, including Rosetta',
  { skip: !bash },
  (t) => {
    const arm64Only = `${checksumLine('Imnota-mac.zip', 'zip')}\n${checksumLine('Imnota-1.2.3-arm64-mac.zip', 'zip')}\n`;
    const refusal = /needs a Mac with Apple silicon\. Intel Macs are no longer supported/;
    for (const [macHardware, checksums, refused] of [
      ['intel', arm64Only, true],
      ['arm64', arm64Only, false],
      ['rosetta', arm64Only, false],
      ['intel', `${macChecksums('zip')}\n`, false],
    ]) {
      const directories = sandbox(t);
      publish(directories, 'v1.2.3', { 'Imnota-mac.zip': 'zip', 'SHA256SUMS.txt': checksums });
      const result = runShellInstaller(directories, { platform: 'Darwin', tag: 'v1.2.3', macHardware });
      assert.notEqual(result.status, 0);
      if (refused) {
        assert.match(result.stderr, refusal);
        assert.equal(requests(directories).includes('ditto'), false, 'Intel refusal must precede extraction');
      } else {
        // The fake ditto fails, so an accepted archive stops at extraction.
        assert.doesNotMatch(result.stderr, refusal);
        assert.equal(requests(directories).at(-1), 'ditto', `${macHardware}: ${result.stderr}`);
      }
      assertNoTemporaryFiles(directories);
    }
  },
);

function publishMacBundle(directories, { minimum = '10.0.0', executable = true } = {}) {
  const bundle = path.join(directories.root, 'Imnota.app');
  const contents = path.join(bundle, 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.writeFileSync(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.dytschgo.imnota</string><key>LSMinimumSystemVersion</key><string>${minimum}</string></dict></plist>`,
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
    'SHA256SUMS.txt': macChecksums(bytes),
  });
}

function keepExistingMacApp(directories) {
  const app = path.join(directories.home, 'Applications', 'Imnota.app');
  macBackup(path.dirname(app), 'Imnota.app');
  fs.writeFileSync(
    path.join(app, 'Contents', 'Info.plist'),
    '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.dytschgo.imnota</string></dict></plist>',
  );
  fs.writeFileSync(path.join(app, 'marker'), 'previous installation');
  return app;
}

function macBackup(parent, name, id = 'com.dytschgo.imnota') {
  const bundle = path.join(parent, name);
  fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'bundle-id'), id);
  fs.writeFileSync(path.join(bundle, 'marker'), 'preserve');
  return bundle;
}

function publishPortableMacBundle(directories) {
  const bundle = macBackup(directories.root, 'fixture.app');
  fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'));
  fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'Imnota'), appImage, { mode: 0o755 });
  fs.writeFileSync(path.join(bundle, 'marker'), 'verified bundle');
  publish(directories, 'v1.2.3', {
    'Imnota-mac.zip': 'zip',
    'SHA256SUMS.txt': macChecksums('zip'),
  });
}

const portableMacOptions = { platform: 'Darwin', tag: 'v1.2.3', portableMac: true, codesignExit: 0 };

test('macOS repeated installs retire only identified Imnota backups', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  const app = keepExistingMacApp(directories);
  const parent = path.dirname(app);
  publishPortableMacBundle(directories);
  const retired = [
    macBackup(parent, 'Imnota-backup-20260101-010101.app'),
    macBackup(parent, 'Imnota Backup 1.2.0 20260101-010101 42.app'),
    macBackup(parent, '.imnota-backups.noindex/Imnota.app'),
    macBackup(parent, '.imnota-backups.noindex/.rollback-123.app'),
  ];
  const preserved = [
    macBackup(parent, 'Imnota-backup-20260102-010101.app', 'com.example.other'),
    macBackup(parent, 'Imnota Backup 1.2.0 20260102-010101 42.app', 'com.example.other'),
    macBackup(parent, 'Imnota-backup-my-project.app'),
    macBackup(parent, 'User Project.app'),
    macBackup(parent, '.imnota-backups.noindex/Other.app'),
    macBackup(parent, '.imnota-backups.noindex/.rollback-foreign.app', 'com.example.other'),
  ];
  for (let iteration = 0; iteration < 3; iteration++) {
    const result = runShellInstaller(directories, portableMacOptions);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'verified bundle');
    for (const bundle of retired) assert.equal(fs.existsSync(bundle), false, bundle);
    for (const bundle of preserved)
      assert.equal(fs.readFileSync(path.join(bundle, 'marker'), 'utf8'), 'preserve', bundle);
    assert.equal(
      fs.readdirSync(parent).some((name) => name.startsWith('.imnota-install.')),
      false,
    );
    assert.equal(fs.existsSync(path.join(parent, '.imnota-update.lock')), false);
    assertNoTemporaryFiles(directories);
  }
});

test('macOS removes the empty managed backup directory after success', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  const app = keepExistingMacApp(directories);
  macBackup(path.dirname(app), '.imnota-backups.noindex/Imnota.app');
  publishPortableMacBundle(directories);
  const result = runShellInstaller(directories, portableMacOptions);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Imnota.app']);
  assertNoTemporaryFiles(directories);
});

test(
  'macOS copy, final verification and open failures restore the old app without retiring backups',
  { skip: !bash },
  (t) => {
    for (const options of [
      { macCopyFailure: true },
      { macVerifyFailure: true },
      { macMissingExecutable: true },
      { macOpenFailure: true },
    ]) {
      const directories = sandbox(t);
      const app = keepExistingMacApp(directories);
      const legacy = macBackup(path.dirname(app), 'Imnota-backup-20260101-010101.app');
      publishPortableMacBundle(directories);
      const result = runShellInstaller(directories, { ...portableMacOptions, ...options });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /previous Imnota app was restored/);
      assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'previous installation');
      assert.equal(fs.readFileSync(path.join(legacy, 'marker'), 'utf8'), 'preserve');
      assert.deepEqual(fs.readdirSync(path.dirname(app)).sort(), [
        'Imnota-backup-20260101-010101.app',
        'Imnota.app',
      ]);
      assert.equal(requests(directories).includes('open'), !!options.macOpenFailure);
      assertNoTemporaryFiles(directories);
    }
  },
);

test('macOS failed first install removes the partial bundle', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  publishPortableMacBundle(directories);
  const result = runShellInstaller(directories, { ...portableMacOptions, macCopyFailure: true });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(fs.readdirSync(path.join(directories.home, 'Applications')), []);
  assertNoTemporaryFiles(directories);
});

test(
  'macOS preserves recovery files and reports their path if automatic restore fails',
  { skip: !bash },
  (t) => {
    const directories = sandbox(t);
    const app = keepExistingMacApp(directories);
    publishPortableMacBundle(directories);
    const result = runShellInstaller(directories, {
      ...portableMacOptions,
      macCopyFailure: true,
      macRestoreFailure: true,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Automatic restore failed.*previous app is preserved at/);
    const staging = fs.readdirSync(path.dirname(app)).filter((name) => name.startsWith('.imnota-install.'));
    assert.equal(staging.length, 1);
    const recovery = path.join(path.dirname(app), staging[0]);
    assert.equal(
      fs.readFileSync(path.join(recovery, 'previous-Imnota.app', 'marker'), 'utf8'),
      'previous installation',
    );
    assert.equal(
      fs.readFileSync(path.join(recovery, 'failed-Imnota.app', 'marker'), 'utf8'),
      'verified bundle',
    );
    assert.equal(fs.existsSync(app), false);
    assertNoTemporaryFiles(directories);
  },
);

test('macOS interruption immediately after moving the previous app restores it', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  const app = keepExistingMacApp(directories);
  publishPortableMacBundle(directories);
  const result = runShellInstaller(directories, { ...portableMacOptions, macInterrupt: true });
  assert.equal(result.status, 130, result.stderr);
  assert.match(result.stderr, /previous Imnota app was restored/);
  assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'previous installation');
  assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Imnota.app']);
  assertNoTemporaryFiles(directories);
});

test('macOS respects another transaction lock and leaves its rollback untouched', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  const app = keepExistingMacApp(directories);
  const parent = path.dirname(app);
  const lock = path.join(parent, '.imnota-update.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'pid'), '123');
  const rollback = macBackup(parent, '.imnota-backups.noindex/.rollback-123.app');
  publishPortableMacBundle(directories);
  const result = runShellInstaller(directories, portableMacOptions);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Another install\/update may be running/);
  assert.equal(fs.readFileSync(path.join(lock, 'pid'), 'utf8'), '123');
  assert.equal(fs.readFileSync(path.join(rollback, 'marker'), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'previous installation');
  assertNoTemporaryFiles(directories);
});

test('macOS refuses an unidentified Imnota.app and preserves personal files', { skip: !bash }, (t) => {
  for (const id of ['', 'com.example.personal']) {
    const directories = sandbox(t);
    const app = macBackup(path.join(directories.home, 'Applications'), 'Imnota.app', id);
    fs.writeFileSync(path.join(app, 'personal.txt'), 'personal workspace');
    publishPortableMacBundle(directories);
    const result = runShellInstaller(directories, portableMacOptions);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /not an identified Imnota bundle/);
    assert.equal(fs.readFileSync(path.join(app, 'personal.txt'), 'utf8'), 'personal workspace');
    assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Imnota.app']);
    assert.equal(requests(directories).includes('open'), false);
    assertNoTemporaryFiles(directories);
  }
});

test(
  'macOS refuses a symlinked or junctioned Applications parent without cleanup outside HOME',
  { skip: !bash },
  (t) => {
    const directories = sandbox(t);
    const outside = path.join(directories.root, 'outside');
    const old = macBackup(outside, 'Imnota.app');
    const backup = macBackup(outside, 'Imnota-backup-20260101-010101.app');
    fs.symlinkSync(
      outside,
      path.join(directories.home, 'Applications'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    publishPortableMacBundle(directories);
    const result = runShellInstaller(directories, portableMacOptions);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Applications folder.*symlink|physical directory/);
    assert.deepEqual(fs.readdirSync(outside).sort(), ['Imnota-backup-20260101-010101.app', 'Imnota.app']);
    for (const bundle of [old, backup])
      assert.equal(fs.readFileSync(path.join(bundle, 'marker'), 'utf8'), 'preserve');
    assertNoTemporaryFiles(directories);
  },
);

test(
  'macOS cleanup preserves symlinked or junctioned backup candidates and managed roots',
  { skip: !bash },
  (t) => {
    for (const managed of [false, true]) {
      const directories = sandbox(t);
      const app = keepExistingMacApp(directories);
      const outside = path.join(directories.root, 'outside');
      const bundle = macBackup(outside, 'Imnota.app');
      const link = path.join(
        path.dirname(app),
        managed ? '.imnota-backups.noindex' : 'Imnota-backup-20260101-010101.app',
      );
      fs.symlinkSync(managed ? outside : bundle, link, process.platform === 'win32' ? 'junction' : 'dir');
      publishPortableMacBundle(directories);
      const result = runShellInstaller(directories, portableMacOptions);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.lstatSync(link).isSymbolicLink());
      assert.equal(fs.readFileSync(path.join(bundle, 'marker'), 'utf8'), 'preserve');
      assertNoTemporaryFiles(directories);
    }
  },
);

// The holder is a separate Bash process. It signals only after acquire_lock;
// stdin releases it, so the contender overlaps an observable live transaction.
test(
  'macOS installer refuses a concurrently running updater and leaves its rollback intact',
  { skip: !bash },
  async (t) => {
    const directories = sandbox(t);
    const app = keepExistingMacApp(directories);
    const parent = path.dirname(app);
    const rollback = macBackup(parent, '.imnota-backups.noindex/.rollback-123.app');
    publishPortableMacBundle(directories);
    const updater = fileURLToPath(new URL('./update-macos.sh', import.meta.url));
    // Match update-macos.test.mjs: retain native macOS mode/ACL checks, use GNU
    // modes on Linux, and model mode bits on Git Bash (which cannot enforce them).
    const privateDirectoryShims =
      process.platform === 'darwin'
        ? ''
        : `
directory_mode() { ${process.platform === 'win32' ? 'printf 700' : '/usr/bin/stat -c "%a" "$1"'}; }
directory_acl_entries() { :; }
/bin/chmod() { if [[ "$1" == -N ]]; then return 0; fi; command /bin/chmod "$@"; }
`;
    const holder = spawn(
      bash,
      [
        '-c',
        `source "$1"
${privateDirectoryShims}
trap cleanup EXIT
acquire_lock "$(cd "$2" && pwd -P)"
printf "locked\\n"
read -r release`,
        'holder',
        slashes(updater),
        slashes(parent),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    t.after(() => {
      if (!holder.stdin.destroyed) holder.stdin.end('release\n');
    });
    const exited = new Promise((resolve) => holder.on('close', resolve));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('updater did not acquire lock')), 10000);
      holder.stdout.once('data', () => {
        clearTimeout(timeout);
        resolve();
      });
      holder.once('error', reject);
      holder.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('updater exited before lock handoff'));
      });
    });
    const result = runShellInstaller(directories, portableMacOptions);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Another install\/update may be running/);
    assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'previous installation');
    assert.equal(fs.readFileSync(path.join(rollback, 'marker'), 'utf8'), 'preserve');
    assert.ok(fs.existsSync(path.join(parent, '.imnota-update.lock', 'pid')));
    holder.stdin.end('release\n');
    assert.equal(await exited, 0);
    assert.equal(fs.existsSync(path.join(parent, '.imnota-update.lock')), false);
  },
);

const nativeMacOptions = { platform: 'Darwin', tag: 'v1.2.3', nativeDitto: true, codesignExit: 0 };

test(
  'macOS installs a verified synthetic bundle with native ditto and removes the transaction rollback',
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
    assert.equal(backups.length, 0);
    assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Imnota.app']);
    assert.deepEqual(requests(directories), [
      `${releaseRoot}/download/v1.2.3/Imnota-mac.zip`,
      `${releaseRoot}/download/v1.2.3/SHA256SUMS.txt`,
      'ditto',
      'codesign',
      'ditto',
      'codesign',
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
          'SHA256SUMS.txt': macChecksums('invalid zip'),
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

test('macOS restores the previous app when native copying fails', { skip: nativeMacSkip }, (t) => {
  const directories = sandbox(t);
  const app = keepExistingMacApp(directories);
  publishMacBundle(directories);
  const result = runShellInstaller(directories, { ...nativeMacOptions, macCopyFailure: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /previous Imnota app was restored/);
  const names = fs.readdirSync(path.dirname(app));
  assert.equal(names.length, 1);
  assert.equal(names[0], 'Imnota.app');
  assert.equal(
    fs.readFileSync(path.join(path.dirname(app), names[0], 'marker'), 'utf8'),
    'previous installation',
  );
  assert.equal(requests(directories).includes('open'), false);
  assertNoTemporaryFiles(directories);
});

for (const readiness of ['missing', 'exits', 'wrong-path', 'zombie']) {
  test(`macOS accepted open with replacement ${readiness} restores rollback`, { skip: !bash }, (t) => {
    const directories = sandbox(t);
    const app = keepExistingMacApp(directories);
    const legacy = macBackup(path.dirname(app), 'Imnota-backup-20260101-010101.app');
    publishPortableMacBundle(directories);
    const result = runShellInstaller(directories, { ...portableMacOptions, macReadiness: readiness });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /replacement.*(running|exited)|reopened/i);
    assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'previous installation');
    assert.equal(fs.readFileSync(path.join(legacy, 'marker'), 'utf8'), 'preserve');
    assertNoTemporaryFiles(directories);
  });
}

test('macOS running app refusing to quit aborts before replacement', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  const app = keepExistingMacApp(directories);
  const inode = fs.statSync(app).ino;
  publishPortableMacBundle(directories);
  const result = runShellInstaller(directories, {
    ...portableMacOptions,
    macRunning: true,
    macQuitRefused: true,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /did not quit.*60 seconds/);
  assert.match(result.stderr, /No installed app was changed/);
  assert.equal(fs.statSync(app).ino, inode);
  assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'previous installation');
  assert.equal(requests(directories).includes('open'), false);
  assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Imnota.app']);
  assertNoTemporaryFiles(directories);
});

test('macOS running app quits before observed replacement retires rollback', { skip: !bash }, (t) => {
  const directories = sandbox(t);
  const app = keepExistingMacApp(directories);
  publishPortableMacBundle(directories);
  const result = runShellInstaller(directories, { ...portableMacOptions, macRunning: true });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(requests(directories).includes('quit'));
  assert.ok(requests(directories).indexOf('quit') < requests(directories).indexOf('open'));
  assert.match(result.stdout, /Observed.*replacement/);
  assert.equal(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'verified bundle');
  assert.deepEqual(fs.readdirSync(path.dirname(app)), ['Imnota.app']);
});
