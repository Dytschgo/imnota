import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NUMBER = '(?:0|[1-9]\\d*)';
export const STABLE_TAG_PATTERN = new RegExp(`^v${NUMBER}\\.${NUMBER}\\.${NUMBER}$`);
export const NIGHTLY_VERSION_PATTERN = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}-nightly\\.(?:[1-9]\\d{7})\\.${NUMBER}(?:\\.${NUMBER})?$`,
);

export function classifyReleaseTag(tag) {
  if (STABLE_TAG_PATTERN.test(tag)) return 'stable';
  if (tag.startsWith('v') && NIGHTLY_VERSION_PATTERN.test(tag.slice(1))) return 'nightly';
  return 'invalid';
}

export function nextNightlyVersion(baseVersion, date, runId, runAttempt = '1') {
  const stable = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}$`).exec(baseVersion);
  if (!stable) throw new Error(`Expected a stable base version, received ${baseVersion}`);
  if (!/^[1-9]\d{7}$/.test(date)) throw new Error(`Expected YYYYMMDD date, received ${date}`);
  if (!new RegExp(`^${NUMBER}$`).test(String(runId)) || !new RegExp(`^${NUMBER}$`).test(String(runAttempt))) {
    throw new Error('GitHub run id and run attempt must be numeric without leading zeroes.');
  }
  const [major, minor, patch] = stable[0].split('.').map(Number);
  const rerun = String(runAttempt) === '1' ? '' : `.${runAttempt}`;
  return `${major}.${minor}.${patch + 1}-nightly.${date}.${runId}${rerun}`;
}

function expectedManifestNames(channel) {
  return [`${channel}.yml`, `${channel}-linux.yml`, `${channel}-mac.yml`];
}

function safeAssetName(value, manifestName) {
  if (
    !value ||
    value !== basename(value) ||
    isAbsolute(value) ||
    value.includes('..') ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new Error(`${manifestName} contains an unsafe asset reference ${value || '(empty)'}.`);
  }
  return value;
}

function scalar(line, key) {
  const match = new RegExp(`^\\s*${key}:\\s*(?:['"]([^'"]+)['"]|([^#\\r\\n]+?))\\s*$`).exec(line);
  return match?.[1] ?? match?.[2]?.trim();
}

function parseManifest(manifest, manifestName) {
  const lines = manifest.split(/\r?\n/);
  let version;
  let path;
  let topHash;
  const entries = [];
  const seenReferences = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('version:')) version = scalar(line, 'version');
    if (line.startsWith('path:')) path = scalar(line, 'path');
    if (line.startsWith('sha512:')) topHash = scalar(line, 'sha512');
    const entry = /^\s*-\s*url:\s*(?:['"]([^'"]+)['"]|([^#\r\n]+?))\s*$/.exec(line);
    if (!entry) {
      if ((/^\s*(?:-\s*)?url:/.test(line) || /^\s*sha512:/.test(line)) && !line.startsWith('sha512:')) {
        throw new Error(`${manifestName} has an unrecognized asset reference.`);
      }
      continue;
    }
    const url = safeAssetName((entry[1] ?? entry[2]).trim(), manifestName);
    const hash = scalar(lines[index + 1] ?? '', 'sha512');
    if (!hash) throw new Error(`${manifestName} is missing sha512 for ${url}.`);
    if (seenReferences.has(url)) throw new Error(`${manifestName} references ${url} more than once.`);
    seenReferences.add(url);
    entries.push({ url, sha512: hash });
    index += 1;
  }
  if (!version || !path || !topHash || !entries.length)
    throw new Error(`${manifestName} is missing required update fields.`);
  return { version, path: safeAssetName(path, manifestName), topHash, entries };
}

export async function normalizeReleaseAssets(directory) {
  const files = await readdir(directory);
  const renames = files.filter((file) => file.includes(' ')).map((file) => [file, file.replaceAll(' ', '-')]);
  for (const [from, to] of renames) {
    if (files.includes(to)) throw new Error(`Cannot normalize ${from}: ${to} already exists.`);
    await rename(resolve(directory, from), resolve(directory, to));
  }
  for (const manifestName of (await readdir(directory)).filter((file) => /\.ya?ml$/i.test(file))) {
    const assetPath = resolve(directory, manifestName);
    let manifest = await readFile(assetPath, 'utf8');
    for (const [from, to] of renames) manifest = manifest.replaceAll(from, to);
    await writeFile(assetPath, manifest);
  }
}

export async function validateManifestAssets(directory, version, channel = 'nightly', exact = false) {
  if (!['latest', 'nightly'].includes(channel)) throw new Error(`Unsupported update channel ${channel}.`);
  const files = await readdir(directory);
  const expected = expectedManifestNames(channel);
  const manifests = files.filter((file) => new RegExp(`^${channel}(?:-linux|-mac)?\\.yml$`).test(file));
  if (manifests.length !== expected.length || expected.some((file) => !manifests.includes(file))) {
    throw new Error(`Expected exactly ${expected.join(', ')}.`);
  }
  const referenced = new Set();
  for (const manifestName of manifests) {
    const parsed = parseManifest(await readFile(resolve(directory, manifestName), 'utf8'), manifestName);
    if (parsed.version !== version) throw new Error(`${manifestName} does not declare version ${version}.`);
    if (exact) {
      const allowed =
        manifestName === `${channel}.yml`
          ? [`Imnota-Setup-${version}.exe`]
          : manifestName === `${channel}-linux.yml`
            ? [`Imnota-${version}.AppImage`, `imnota_${version}_amd64.deb`]
            : [`Imnota-${version}-universal-mac.zip`, `Imnota-${version}-universal.dmg`];
      if (parsed.path !== allowed[0] || parsed.entries.some((entry) => !allowed.includes(entry.url)))
        throw new Error(`${manifestName} does not reference the exact versioned platform installers.`);
    }
    for (const entry of parsed.entries) {
      if (referenced.has(entry.url))
        throw new Error(`Asset ${entry.url} is referenced by more than one manifest.`);
      referenced.add(entry.url);
      const assetPath = resolve(directory, entry.url);
      let actual;
      try {
        actual = createHash('sha512')
          .update(await readFile(assetPath))
          .digest('base64');
      } catch {
        throw new Error(`${manifestName} references missing asset ${entry.url}.`);
      }
      if (actual !== entry.sha512) throw new Error(`${manifestName} has an invalid sha512 for ${entry.url}.`);
      if (entry.url === parsed.path && actual !== parsed.topHash) {
        throw new Error(`${manifestName} has an invalid top-level sha512 for ${entry.url}.`);
      }
    }
    if (!parsed.entries.some((entry) => entry.url === parsed.path)) {
      throw new Error(`${manifestName} path does not reference a verified file entry.`);
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'classify-tag') {
    const classification = classifyReleaseTag(args[0] ?? '');
    console.log(classification);
    if (classification === 'invalid') process.exitCode = 1;
    return;
  }
  if (command === 'nightly-version') {
    console.log(nextNightlyVersion(...args));
    return;
  }
  if (command === 'normalize-assets') return normalizeReleaseAssets(args[0]);
  if (command === 'validate-assets') return validateManifestAssets(args[0], args[1], args[2]);
  throw new Error('Usage: release-channel.mjs classify-tag|nightly-version|normalize-assets|validate-assets');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
