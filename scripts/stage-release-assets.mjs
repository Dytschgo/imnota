import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeReleaseAssets, validateManifestAssets } from './release-channel.mjs';

function sourceAssetNames(version, channel) {
  return [
    `Imnota-${version}-universal-mac.zip`,
    `Imnota-${version}-universal-mac.zip.blockmap`,
    `Imnota-${version}-universal.dmg`,
    `Imnota-${version}-universal.dmg.blockmap`,
    `Imnota-${version}.AppImage`,
    `Imnota-${version}.exe`,
    `Imnota-Setup-${version}.exe`,
    `Imnota-Setup-${version}.exe.blockmap`,
    `imnota_${version}_amd64.deb`,
    `${channel}.yml`,
    `${channel}-linux.yml`,
    `${channel}-mac.yml`,
  ];
}

function aliases(version) {
  return [
    [`Imnota-Setup-${version}.exe`, 'Imnota-Setup.exe'],
    [`Imnota-${version}-universal-mac.zip`, 'Imnota-mac.zip'],
    [`Imnota-${version}.AppImage`, 'Imnota.AppImage'],
  ];
}

function assertExactFiles(actual, expected, label) {
  const unexpected = actual.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !actual.includes(file));
  if (unexpected.length || missing.length) {
    throw new Error(
      `${label} mismatch; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`,
    );
  }
}

export async function stageReleaseAssets(directory, version, channel, includeAliases) {
  await normalizeReleaseAssets(directory);
  const source = sourceAssetNames(version, channel);
  assertExactFiles(await readdir(directory), source, 'Downloaded release artifacts');
  if (includeAliases) {
    for (const [from, to] of aliases(version))
      await copyFile(resolve(directory, from), resolve(directory, to));
  }
  const expected = includeAliases ? [...source, ...aliases(version).map(([, to]) => to)] : source;
  assertExactFiles(await readdir(directory), expected, 'Staged release artifacts');
  await validateManifestAssets(directory, version, channel, true);
  const checksums = await Promise.all(
    [...expected].sort().map(
      async (file) =>
        `${createHash('sha256')
          .update(await readFile(resolve(directory, file)))
          .digest('hex')}  ${file}`,
    ),
  );
  await writeFile(resolve(directory, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
}

async function main() {
  const [directory, version, channel, aliasMode] = process.argv.slice(2);
  if (
    !directory ||
    !version ||
    !['latest', 'nightly'].includes(channel) ||
    !['stable', 'nightly'].includes(aliasMode)
  ) {
    throw new Error(
      'Usage: stage-release-assets.mjs <directory> <version> <latest|nightly> <stable|nightly>',
    );
  }
  await stageReleaseAssets(directory, version, channel, aliasMode === 'stable');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
