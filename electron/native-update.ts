import type { UpdateChannel } from '../src/shared/types.js';
import type { ReleaseCandidate } from './releases.js';

interface NativeUpdater {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL: (options: { provider: 'generic'; url: string; channel: string }) => void;
  checkForUpdates: () => Promise<{
    isUpdateAvailable?: boolean;
    updateInfo: {
      version: string;
      files: Array<{ url: string; sha512: string }>;
      path?: string;
      packages?: unknown;
    };
  } | null>;
}

export async function prepareNativeUpdate(
  updater: NativeUpdater,
  release: ReleaseCandidate,
  channel: UpdateChannel,
) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.channel = channel === 'stable' ? 'latest' : 'nightly';
  updater.allowPrerelease = channel === 'nightly';
  // The channel setter itself enables downgrades; reset after setting it.
  updater.allowDowngrade = false;
  updater.setFeedURL({ provider: 'generic', url: release.feedUrl, channel: updater.channel });
  const result = await updater.checkForUpdates();
  if (!result || result.isUpdateAvailable !== true || result.updateInfo.version !== release.version)
    throw new Error('The update manifest does not match the selected release.');
  const info = result.updateInfo;
  const matches = (file: string) => {
    const url = new URL(file, release.feedUrl).href;
    return url.startsWith(release.feedUrl) && release.assetUrls.includes(url);
  };
  if (
    !info.files?.length ||
    info.packages ||
    !info.files.every((file) => matches(file.url) && /^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) ||
    (info.path && !matches(info.path))
  )
    throw new Error('The update installer is not part of the selected release.');
}
