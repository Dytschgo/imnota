import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  appImage,
  assertNoTemporaryFiles,
  bash,
  checksumLine,
  hostileChecksums,
  linuxReplacementSkip,
  publish,
  releaseRoot,
  requests,
  runShellInstaller,
  sandbox,
  sha256,
} from './test-support/install-harness.mjs';

// Linux: install.sh with a synthetic AppImage release.
// Shared fixtures live in test-support/install-harness.mjs; see its header.

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
