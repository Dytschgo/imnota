import path from 'node:path';
import { parseReleaseVersion, type ReleaseCandidate } from './releases.js';
import { UpdateFailure } from './update-controller.js';

export type MacArchiveArchitecture = 'arm64' | 'universal';

/** The Mac running this update; Rosetta-translated Imnota still reports Apple silicon. */
export interface MacHost {
  appleSilicon: boolean;
}

/**
 * A universal Imnota opened with Rosetta reports `x64`, but Electron's
 * `app.runningUnderARM64Translation` still identifies the Apple silicon host.
 */
export function detectMacHost(arch: string, runningUnderARM64Translation: boolean): MacHost {
  return { appleSilicon: arch === 'arm64' || runningUnderARM64Translation };
}

export function intelUnsupportedMessage(version: string): string {
  return `Imnota ${version} needs a Mac with Apple silicon. Intel Macs are no longer supported, so this update cannot be installed here. Your current app keeps working.`;
}

/**
 * Chooses the one macOS archive the updater may install from a release:
 * `Imnota-<v>-arm64-mac.zip` when the release lists it, otherwise
 * `Imnota-<v>-universal-mac.zip`. update-macos.sh applies the same rule to
 * SHA256SUMS.txt and refuses a release whose two listings disagree.
 */
export function selectMacArchive(release: ReleaseCandidate): {
  url: string;
  architecture: MacArchiveArchitecture;
} {
  parseReleaseVersion(release.version);
  const base = `https://github.com/Dytschgo/imnota/releases/download/v${release.version}/`;
  if (release.feedUrl !== base) throw new Error('The selected release has no supported macOS archive.');
  for (const architecture of ['arm64', 'universal'] as const) {
    const url = `${base}Imnota-${release.version}-${architecture}-mac.zip`;
    const listed = release.assetUrls.filter((asset) => asset === url).length;
    if (listed > 1) throw new Error('The selected release lists its macOS archive more than once.');
    if (listed === 1) return { url, architecture };
  }
  throw new Error('The selected release has no supported macOS archive.');
}

export function terminalUpdateArguments(
  release: ReleaseCandidate,
  appPath: string,
  currentVersion: string,
  host: MacHost,
): string[] {
  parseReleaseVersion(release.version);
  parseReleaseVersion(currentVersion);
  const base = `https://github.com/Dytschgo/imnota/releases/download/v${release.version}/`;
  const archive = selectMacArchive(release);
  // Refuse before any download: an arm64-only app cannot run on an Intel Mac.
  if (archive.architecture === 'arm64' && !host.appleSilicon)
    throw new UpdateFailure(intelUnsupportedMessage(release.version));
  if (release.checksumUrl !== `${base}SHA256SUMS.txt`)
    throw new Error('The selected release has no checksum file. Try checking again later.');
  if (!path.posix.isAbsolute(appPath) || !appPath.endsWith('/Imnota.app'))
    throw new Error('Run Imnota from an installed Imnota.app before updating.');
  return [`v${release.version}`, archive.url, release.checksumUrl, appPath, currentVersion];
}
