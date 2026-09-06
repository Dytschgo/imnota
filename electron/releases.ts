import { z } from 'zod';
import type { UpdateChannel } from '../src/shared/types.js';

const repository = 'https://github.com/Dytschgo/imnota';
const api = 'https://api.github.com/repos/Dytschgo/imnota/releases';
// Match only the two version formats Imnota publishes; no loose coercion.
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-nightly\.(\d{8})\.([1-9]\d*)(?:\.([1-9]\d*))?)?$/;
export function parseReleaseVersion(version: string) {
  const match = versionPattern.exec(version);
  if (!match) throw new Error('The release has an unsupported version.');
  const parts = match.slice(1).map((part) => (part === undefined ? undefined : Number(part)));
  if (parts.some((part) => part !== undefined && !Number.isSafeInteger(part)))
    throw new Error('The release version is out of range.');
  return parts;
}
export function compareReleaseVersions(left: string, right: string): number {
  const a = parseReleaseVersion(left),
    b = parseReleaseVersion(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1;
  if (a[3] === undefined || b[3] === undefined) return a[3] === b[3] ? 0 : a[3] === undefined ? 1 : -1;
  for (let i = 3; i < 6; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    return a[i]! > b[i]! ? 1 : -1;
  }
  return 0;
}
const releaseSchema = z.object({
  tag_name: z.string().max(120),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z
    .array(
      z.object({
        name: z.string().max(255),
        size: z.number().positive(),
        browser_download_url: z.string().url(),
      }),
    )
    .max(100),
});
export interface ReleaseCandidate {
  version: string;
  url: string;
  feedUrl: string;
  assetUrls: string[];
  checksumUrl?: string;
}
export function selectRelease(
  value: unknown,
  channel: UpdateChannel,
  platform: string,
): ReleaseCandidate | null {
  const parsed = releaseSchema.safeParse(value);
  if (!parsed.success) return null;
  const release = parsed.data;
  if (release.draft || release.prerelease !== (channel === 'nightly') || !release.tag_name.startsWith('v'))
    return null;
  const version = release.tag_name.slice(1);
  try {
    if ((parseReleaseVersion(version)[3] !== undefined) !== (channel === 'nightly')) return null;
  } catch {
    return null;
  }
  const feedUrl = `${repository}/releases/download/${release.tag_name}/`;
  const manifest = `${channel === 'stable' ? 'latest' : 'nightly'}${platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : ''}.yml`;
  const hasAsset = (test: (name: string) => boolean) =>
    release.assets.some(
      (asset) =>
        test(asset.name) &&
        !/[\\/]/.test(asset.name) &&
        asset.browser_download_url === feedUrl + encodeURIComponent(asset.name),
    );
  if (
    !hasAsset((name) => name === manifest) ||
    !hasAsset((name) =>
      platform === 'darwin'
        ? name.endsWith('-mac.zip')
        : platform === 'win32'
          ? name.endsWith('.exe')
          : name.endsWith('.AppImage'),
    )
  )
    return null;
  const assetUrls = release.assets
    .filter(
      (asset) =>
        !/[\\/]/.test(asset.name) &&
        asset.browser_download_url === feedUrl + encodeURIComponent(asset.name) &&
        (platform === 'darwin'
          ? asset.name.endsWith('-mac.zip') || asset.name.endsWith('.dmg')
          : platform === 'win32'
            ? asset.name.endsWith('.exe')
            : asset.name.endsWith('.AppImage') || asset.name.endsWith('.deb')),
    )
    .map((asset) => asset.browser_download_url);
  return {
    version,
    url: `${repository}/releases/tag/${release.tag_name}`,
    feedUrl,
    assetUrls,
    checksumUrl: hasAsset((name) => name === 'SHA256SUMS.txt') ? `${feedUrl}SHA256SUMS.txt` : undefined,
  };
}

export async function discoverRelease(
  channel: UpdateChannel,
  platform: string,
  request = fetch,
): Promise<ReleaseCandidate | null> {
  async function read(url: string) {
    const response = await request(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Imnota' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404 && channel === 'stable') return null;
    if (!response.ok) throw new Error('GitHub release information is unavailable. Try again later.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Release information is empty.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4_000_000) {
          await reader.cancel();
          throw new Error('Release information is too large.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  if (channel === 'stable') {
    const value = await read(`${api}/latest`);
    if (value === null) return null;
    const candidate = selectRelease(value, channel, platform);
    if (!candidate) throw new Error('The stable release is incomplete for this platform. Try again later.');
    return candidate;
  }
  // Bound pagination, and fail rather than reporting a false up-to-date result.
  for (let page = 1; page <= 10; page++) {
    const value = await read(`${api}?per_page=100&page=${page}`);
    if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid release listing.');
    for (const item of value) {
      const candidate = selectRelease(item, channel, platform);
      if (candidate) return candidate;
      const release = releaseSchema.safeParse(item);
      if (
        release.success &&
        !release.data.draft &&
        release.data.prerelease &&
        /^v\d+\.\d+\.\d+-nightly\./.test(release.data.tag_name)
      )
        throw new Error('The newest nightly is incomplete for this platform. Try again later.');
    }
    if (value.length < 100) return null;
  }
  throw new Error(
    'No compatible nightly was found in recent releases. Open GitHub releases or try again later.',
  );
}
