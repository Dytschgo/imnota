import path from 'node:path';
import { parseReleaseVersion, type ReleaseCandidate } from './releases.js';

export function terminalUpdateArguments(
  release: ReleaseCandidate,
  appPath: string,
  currentVersion: string,
): string[] {
  parseReleaseVersion(release.version);
  parseReleaseVersion(currentVersion);
  const base = `https://github.com/Dytschgo/imnota/releases/download/v${release.version}/`;
  const filename = `Imnota-${release.version}-universal-mac.zip`;
  const archive = base + filename;
  if (release.feedUrl !== base || !release.assetUrls.includes(archive))
    throw new Error('The selected release has no supported macOS archive.');
  if (release.checksumUrl !== `${base}SHA256SUMS.txt`)
    throw new Error('The selected release has no checksum file. Try checking again later.');
  if (!path.posix.isAbsolute(appPath) || !appPath.endsWith('/Imnota.app'))
    throw new Error('Run Imnota from an installed Imnota.app before updating.');
  return [`v${release.version}`, archive, release.checksumUrl, appPath, currentVersion];
}
