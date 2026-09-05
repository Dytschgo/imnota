import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageReleaseAssets } from './stage-release-assets.mjs';

const version = '0.2.0';
const sourceAssets = [
  `Imnota-${version}-universal-mac.zip`,
  `Imnota-${version}-universal-mac.zip.blockmap`,
  `Imnota-${version}-universal.dmg`,
  `Imnota-${version}-universal.dmg.blockmap`,
  `Imnota-${version}.AppImage`,
  `Imnota-${version}.exe`,
  `Imnota-Setup-${version}.exe`,
  `Imnota-Setup-${version}.exe.blockmap`,
  `imnota_${version}_amd64.deb`,
];

function hash(contents) {
  return createHash('sha512').update(contents).digest('base64');
}

async function fixture(directory, channel = 'latest') {
  for (const asset of sourceAssets) await writeFile(join(directory, asset), asset);
  for (const [suffix, asset] of [
    ['', `Imnota-Setup-${version}.exe`],
    ['-linux', `Imnota-${version}.AppImage`],
    ['-mac', `Imnota-${version}-universal-mac.zip`],
  ]) {
    const contents = asset;
    const assetHash = hash(contents);
    await writeFile(
      join(directory, `${channel}${suffix}.yml`),
      `version: ${version}\nfiles:\n  - url: ${asset}\n    sha512: ${assetHash}\npath: ${asset}\nsha512: ${assetHash}\n`,
    );
  }
}

test('stages only exact pinned builder assets and deterministic stable aliases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imnota-stage-'));
  try {
    await fixture(directory);
    await stageReleaseAssets(directory, version, 'latest', true);
    assert.deepEqual(
      (await readdir(directory)).sort(),
      [
        ...sourceAssets,
        'Imnota.AppImage',
        'Imnota-Setup.exe',
        'Imnota-mac.zip',
        'SHA256SUMS.txt',
        'latest-linux.yml',
        'latest-mac.yml',
        'latest.yml',
      ].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects hash-valid cross-platform manifest references before publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imnota-stage-'));
  try {
    await fixture(directory);
    const linux = await readFile(join(directory, 'latest-linux.yml'), 'utf8');
    await writeFile(join(directory, 'latest.yml'), linux);
    await assert.rejects(stageReleaseAssets(directory, version, 'latest', true), /exact versioned platform/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects extra and wrong-platform artifact files before aliases are created', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imnota-stage-'));
  try {
    await fixture(directory);
    await writeFile(join(directory, 'builder-debug.yml'), 'debug');
    await assert.rejects(
      stageReleaseAssets(directory, version, 'latest', true),
      /unexpected: builder-debug.yml/,
    );
    await rm(join(directory, 'builder-debug.yml'));
    await rm(join(directory, `imnota_${version}_amd64.deb`));
    await writeFile(join(directory, `imnota_${version}_arm64.deb`), 'wrong platform');
    await assert.rejects(
      stageReleaseAssets(directory, version, 'latest', true),
      /missing: imnota_0.2.0_amd64.deb/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
