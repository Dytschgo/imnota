import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyReleaseTag,
  nextNightlyVersion,
  normalizeReleaseAssets,
  validateManifestAssets,
} from './release-channel.mjs';
import test from 'node:test';

const version = '0.2.1-nightly.20260905.1234.2';

function hash(contents) {
  return createHash('sha512').update(contents).digest('base64');
}

function manifest(asset, contents) {
  const assetHash = hash(contents);
  return `version: ${version}\nfiles:\n  - url: ${asset}\n    sha512: ${assetHash}\npath: ${asset}\nsha512: ${assetHash}\n`;
}

async function writeChannelAssets(directory) {
  for (const [suffix, asset] of [
    ['', 'Imnota Setup.exe'],
    ['-linux', 'Imnota Linux.AppImage'],
    ['-mac', 'Imnota mac.zip'],
  ]) {
    const contents = `asset-${suffix || 'windows'}`;
    await writeFile(join(directory, asset), contents);
    await writeFile(join(directory, `nightly${suffix}.yml`), manifest(asset, contents));
  }
}

test('classifies exact tags and rejects missing prefixes or leading zeroes', () => {
  assert.equal(classifyReleaseTag('v0.2.1'), 'stable');
  assert.equal(classifyReleaseTag('v0.2.1-nightly.20260905.1234.2'), 'nightly');
  for (const tag of [
    'x0.2.1-nightly.20260905.1234',
    '0.2.1-nightly.20260905.1234',
    'v00.2.1',
    'v0.2.1-nightly.20260905.01234',
  ]) {
    assert.equal(classifyReleaseTag(tag), 'invalid');
  }
});

test('derives next-patch nightly versions with dot-separated reruns', () => {
  assert.equal(nextNightlyVersion('0.2.0', '20260905', '1234'), '0.2.1-nightly.20260905.1234');
  assert.equal(nextNightlyVersion('0.2.0', '20260905', '1234', '2'), version);
  assert.throws(() => nextNightlyVersion('0.02.0', '20260905', '1234'));
  assert.throws(() => nextNightlyVersion('0.2.0', '20260905', '01234'));
});

test('runs the CLI when invoked from this host path', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'release-channel.mjs');
  const result = spawnSync(process.execPath, [script, 'classify-tag', 'v0.2.1'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'stable');
});

test('normalizes manifest URLs and validates all required nightly assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imnota-nightly-'));
  try {
    await writeChannelAssets(directory);
    await normalizeReleaseAssets(directory);
    await validateManifestAssets(directory, version);
    assert.match(await readFile(join(directory, 'nightly.yml'), 'utf8'), /Imnota-Setup\.exe/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects incomplete, unsafe, duplicate, and incorrect manifest references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imnota-nightly-'));
  try {
    await writeChannelAssets(directory);
    await writeFile(join(directory, 'nightly.yml'), manifest('../escape', 'asset-windows'));
    await assert.rejects(validateManifestAssets(directory, version), /unsafe asset reference/);
    await writeFile(join(directory, 'nightly.yml'), manifest('Imnota.exe?query', 'asset-windows'));
    await assert.rejects(validateManifestAssets(directory, version), /unsafe asset reference/);
    await writeFile(join(directory, 'nightly.yml'), manifest('Imnota Setup.exe', 'asset-windows'));
    await normalizeReleaseAssets(directory);
    await rm(join(directory, 'nightly-mac.yml'));
    await assert.rejects(validateManifestAssets(directory, version), /Expected exactly/);
    await writeFile(join(directory, 'nightly-mac.yml'), manifest('Imnota-mac.zip', 'asset--mac'));
    await writeFile(
      join(directory, 'nightly.yml'),
      `${manifest('Imnota-Setup.exe', 'asset-windows')}  - url: Imnota-Setup.exe\n    sha512: ${hash('asset-windows')}\n`,
    );
    await assert.rejects(validateManifestAssets(directory, version), /more than once/);
    await writeFile(join(directory, 'nightly.yml'), manifest('../escape', 'asset-windows'));
    await assert.rejects(validateManifestAssets(directory, version), /unsafe asset reference/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a wrong top-level hash and path absent from verified entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imnota-nightly-'));
  try {
    await writeChannelAssets(directory);
    await normalizeReleaseAssets(directory);
    const nightly = join(directory, 'nightly.yml');
    const contents = await readFile(nightly, 'utf8');
    await writeFile(nightly, contents.replace(/^sha512: .*$/m, 'sha512: wrong'));
    await assert.rejects(validateManifestAssets(directory, version), /invalid top-level sha512/);
    await writeFile(nightly, contents.replace('path: Imnota-Setup.exe', 'path: missing.exe'));
    await assert.rejects(validateManifestAssets(directory, version), /path does not reference/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
