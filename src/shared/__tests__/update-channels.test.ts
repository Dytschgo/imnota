import { expect, it, vi } from 'vitest';
import { compareReleaseVersions, discoverRelease, selectRelease } from '../../../electron/releases';
import { UpdateController } from '../../../electron/update-controller';
import { prepareNativeUpdate } from '../../../electron/native-update';
import { settingsPatchSchema } from '../schema';

function release(version = '0.3.0', prerelease = false) {
  const base = `https://github.com/Dytschgo/imnota/releases/download/v${version}/`;
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease,
    assets: [`${prerelease ? 'nightly' : 'latest'}-mac.yml`, 'Imnota-mac.zip'].map((name) => ({
      name,
      size: 100,
      browser_download_url: base + name,
    })),
  };
}
const nightlyVersion = '0.3.0-nightly.20260905.1234';
it('accepts all API-listed Linux installer entries from the pinned manifest', async () => {
  const base = 'https://github.com/Dytschgo/imnota/releases/download/v0.3.0/';
  const assets = ['latest-linux.yml', 'Imnota-0.3.0.AppImage', 'imnota_0.3.0_amd64.deb'].map((name) => ({
    name,
    size: 100,
    browser_download_url: base + name,
  }));
  const candidate = selectRelease({ ...release(), assets }, 'stable', 'linux')!;
  expect(candidate.assetUrls).toEqual(assets.slice(1).map((asset) => asset.browser_download_url));
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: true,
    channel: 'latest',
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: {
        version: '0.3.0',
        files: assets.slice(1).map((asset) => ({ url: asset.name, sha512: 'A'.repeat(86) + '==' })),
      },
    }),
  };
  await expect(prepareNativeUpdate(updater, candidate, 'stable')).resolves.toBeUndefined();
});
it('validates channel settings and keeps old settings compatible', () => {
  expect(settingsPatchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
  expect(settingsPatchSchema.parse({ updateChannel: 'nightly' }).updateChannel).toBe('nightly');
  expect(() => settingsPatchSchema.parse({ updateChannel: 'latest' })).toThrow();
});
it('strictly isolates stable and nightly and excludes drafts and missing manifests', () => {
  const stable = release(),
    nightly = release(nightlyVersion, true);
  expect(selectRelease(stable, 'stable', 'darwin')?.version).toBe('0.3.0');
  expect(selectRelease(nightly, 'stable', 'darwin')).toBeNull();
  expect(selectRelease(stable, 'nightly', 'darwin')).toBeNull();
  expect(selectRelease({ ...nightly, draft: true }, 'nightly', 'darwin')).toBeNull();
  expect(selectRelease({ ...nightly, assets: [] }, 'nightly', 'darwin')).toBeNull();
  nightly.assets[0].browser_download_url = 'https://example.com/nightly-mac.yml';
  expect(selectRelease(nightly, 'nightly', 'darwin')).toBeNull();
});
it('orders stable and nightly versions without lexical comparisons or automatic downgrades', () => {
  expect(compareReleaseVersions('0.10.0', '0.9.0')).toBe(1);
  expect(compareReleaseVersions('0.3.0', nightlyVersion)).toBe(1);
  expect(compareReleaseVersions('0.2.0', nightlyVersion)).toBe(-1);
  expect(compareReleaseVersions(`${nightlyVersion}.2`, nightlyVersion)).toBe(1);
  expect(() => compareReleaseVersions('0.3.0-beta.1', '0.2.0')).toThrow();
});
it('paginates nightly discovery and pins the exact release URL', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(Array(100).fill(release()))))
    .mockResolvedValueOnce(new Response(JSON.stringify([release(nightlyVersion, true)])));
  const result = await discoverRelease('nightly', 'darwin', request);
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[0][0]).toBe('https://api.github.com/repos/Dytschgo/imnota/releases/latest');
  expect(result?.url).toBe(`https://github.com/Dytschgo/imnota/releases/tag/v${nightlyVersion}`);
  expect(result?.sourceChannel).toBe('nightly');
  expect(request.mock.calls[2][0]).toContain('page=2');
});
it('does not fall back to older nightlies with an incomplete new release', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(release('0.2.0'))))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { ...release(nightlyVersion, true), assets: [] },
          release('0.3.0-nightly.20260904.1233', true),
        ]),
      ),
    );
  await expect(discoverRelease('nightly', 'darwin', request)).rejects.toThrow(/incomplete/);
});
it('uses a newer stable on the nightly preference and returns to nightly when it advances', async () => {
  const stableVersion = '0.2.2';
  const olderNightly = '0.2.2-nightly.20260905.10';
  const stableRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(release(stableVersion))))
    .mockResolvedValueOnce(new Response(JSON.stringify([release(olderNightly, true)])));
  const fallback = await discoverRelease('nightly', 'darwin', stableRequest);
  expect(fallback).toMatchObject({ version: stableVersion, sourceChannel: 'stable' });
  expect(fallback?.feedUrl).toBe('https://github.com/Dytschgo/imnota/releases/download/v0.2.2/');

  const nextNightly = '0.2.3-nightly.20260907.1';
  const nightlyRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(release(stableVersion))))
    .mockResolvedValueOnce(new Response(JSON.stringify([release(nextNightly, true)])));
  const candidate = await discoverRelease('nightly', 'darwin', nightlyRequest);
  expect(candidate).toMatchObject({ version: nextNightly, sourceChannel: 'nightly' });
});
it('handles a missing channel candidate and does not hide incomplete or failed discovery', async () => {
  const onlyNightlyRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([release(nightlyVersion, true)])));
  await expect(discoverRelease('nightly', 'darwin', onlyNightlyRequest)).resolves.toMatchObject({
    version: nightlyVersion,
    sourceChannel: 'nightly',
  });

  const onlyStableRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(release('0.2.2'))))
    .mockResolvedValueOnce(new Response(JSON.stringify([])));
  await expect(discoverRelease('nightly', 'darwin', onlyStableRequest)).resolves.toMatchObject({
    version: '0.2.2',
    sourceChannel: 'stable',
  });

  const absentRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([])));
  await expect(discoverRelease('nightly', 'darwin', absentRequest)).resolves.toBeNull();

  const incompleteStable = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...release('0.2.2'), assets: [] })));
  await expect(discoverRelease('nightly', 'darwin', incompleteStable)).rejects.toThrow(
    /stable release is incomplete/,
  );
});
it('offers newer stable despite an older incomplete nightly but rejects a newer incomplete nightly', async () => {
  const stable = release('0.2.2');
  const olderIncomplete = { ...release('0.2.1-nightly.20260905.2', true), assets: [] };
  const olderRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(stable)))
    .mockResolvedValueOnce(new Response(JSON.stringify([olderIncomplete])));
  await expect(discoverRelease('nightly', 'darwin', olderRequest)).resolves.toMatchObject({
    version: '0.2.2',
    sourceChannel: 'stable',
  });

  const newerIncomplete = { ...release('0.2.3-nightly.20260905.2', true), assets: [] };
  const newerRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(stable)))
    .mockResolvedValueOnce(new Response(JSON.stringify([newerIncomplete])));
  await expect(discoverRelease('nightly', 'darwin', newerRequest)).rejects.toThrow(/nightly is incomplete/);
});
it('handles absent releases, offline responses and malformed JSON', async () => {
  expect(
    await discoverRelease(
      'stable',
      'darwin',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })),
    ),
  ).toBeNull();
  await expect(
    discoverRelease(
      'nightly',
      'darwin',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 })),
    ),
  ).rejects.toThrow();
  await expect(
    discoverRelease('nightly', 'darwin', vi.fn<typeof fetch>().mockResolvedValue(new Response('bad'))),
  ).rejects.toThrow();
});

function controller(manual = false) {
  const candidate = selectRelease(release(nightlyVersion, true), 'nightly', 'darwin')!;
  const ops = {
    currentVersion: '0.2.0',
    enabled: true,
    manual,
    discover: vi.fn(async () => candidate),
    prepare: vi.fn(async () => undefined),
    download: vi.fn(async (): Promise<void> => undefined),
    install: vi.fn(),
    open: vi.fn(async () => undefined),
    emit: vi.fn(),
  };
  return { ops, candidate, instance: new UpdateController('nightly', ops) };
}
it('coalesces checks and refuses channel switches until the check finishes', async () => {
  const { instance, ops, candidate } = controller();
  let finish!: (value: typeof candidate) => void;
  ops.discover.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = instance.check();
  expect(instance.check()).toBe(first);
  const persist = vi.fn(async () => undefined);
  await expect(instance.switchChannel('stable', persist)).rejects.toThrow(/Finish/);
  expect(persist).not.toHaveBeenCalled();
  finish(candidate);
  await first;
  expect(ops.download).not.toHaveBeenCalled();
  expect(instance.getStatus().channel).toBe('nightly');
});
it('persists before switching, retains old channel on write failure and checks the new channel', async () => {
  const { instance, ops } = controller();
  await expect(
    instance.switchChannel('stable', async () => {
      throw new Error('disk');
    }),
  ).rejects.toThrow('disk');
  expect(instance.getStatus().channel).toBe('nightly');
  await instance.switchChannel('stable', async () => undefined);
  await instance.check();
  expect(ops.discover).toHaveBeenCalledWith('stable');
  expect(ops.download).not.toHaveBeenCalled();
});
it('blocks switching during download and after download, and ignores late progress', async () => {
  const { instance, ops } = controller();
  await instance.check();
  let finish!: () => void;
  ops.download.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const download = instance.download();
  instance.progress(40);
  expect(instance.getStatus().percent).toBe(40);
  await expect(instance.switchChannel('stable', async () => undefined)).rejects.toThrow();
  finish();
  await download;
  instance.progress(12);
  expect(instance.getStatus().state).toBe('downloaded');
  expect(instance.getStatus().percent).toBe(100);
  await expect(instance.switchChannel('stable', async () => undefined)).rejects.toThrow();
  await instance.install();
  expect(ops.install).toHaveBeenCalledOnce();
});
it('retains a downloaded update after asynchronous install failure and allows retry', async () => {
  const { instance, ops } = controller();
  await instance.check();
  await instance.download();
  await instance.install();
  expect(instance.getStatus().installing).toBe(true);
  await expect(instance.install()).rejects.toThrow();
  expect(ops.install).toHaveBeenCalledOnce();
  instance.installationFailed();
  expect(instance.getStatus()).toMatchObject({ state: 'downloaded', installing: false });
  await instance.install();
  expect(ops.install).toHaveBeenCalledTimes(2);
});
it('recovers from a rejected install without losing the downloaded update', async () => {
  const { instance, ops } = controller();
  await instance.check();
  await instance.download();
  ops.install.mockRejectedValueOnce(new Error('installer unavailable'));
  await expect(instance.install()).rejects.toThrow('could not be installed');
  expect(instance.getStatus()).toMatchObject({ state: 'downloaded', installing: false });
});
it('uses exact manual Mac release links and never prepares or downloads a native update', async () => {
  const { instance, ops, candidate } = controller(true);
  await instance.check();
  await instance.download();
  expect(ops.open).toHaveBeenCalledWith(candidate.url);
  expect(ops.prepare).not.toHaveBeenCalled();
  expect(ops.download).not.toHaveBeenCalled();
});
it('runs the prepared terminal updater for a Mac upgrade without opening GitHub', async () => {
  const { ops, candidate } = controller(true);
  const run = vi.fn(async () => {});
  const prepareTerminal = vi.fn(async () => ({ command: '/bin/bash local-update.command', run }));
  const instance = new UpdateController('nightly', { ...ops, prepareTerminal });
  await instance.check();
  expect(prepareTerminal).toHaveBeenCalledWith(candidate);
  expect(instance.getStatus().terminalCommand).toBe('/bin/bash local-update.command');
  await instance.download();
  expect(run).toHaveBeenCalledOnce();
  expect(ops.open).not.toHaveBeenCalled();
  expect(ops.prepare).not.toHaveBeenCalled();
});
it('does not prepare a terminal command for a downgrade', async () => {
  const { ops } = controller(true);
  ops.currentVersion = '1.0.0';
  const prepareTerminal = vi.fn();
  const instance = new UpdateController('nightly', { ...ops, prepareTerminal });
  await instance.check();
  expect(prepareTerminal).not.toHaveBeenCalled();
  expect(instance.getStatus().terminalCommand).toBeUndefined();
});
it('offers a manual stable fallback for a newer installed nightly, never a downgrade', async () => {
  const { ops } = controller();
  ops.currentVersion = nightlyVersion;
  ops.discover.mockResolvedValue(selectRelease(release('0.2.0'), 'stable', 'darwin')!);
  const instance = new UpdateController('stable', ops);
  await instance.check();
  expect(instance.getStatus().message).toContain('downgrades are disabled');
  await instance.download();
  expect(ops.prepare).not.toHaveBeenCalled();
  expect(ops.download).not.toHaveBeenCalled();
});
it('offers a newer stable while keeping Nightly selected for future checks', async () => {
  const { ops } = controller();
  const stable = selectRelease(release('0.2.2'), 'stable', 'darwin')!;
  ops.discover.mockResolvedValue(stable);
  const instance = new UpdateController('nightly', ops);
  await instance.check();
  expect(ops.prepare).toHaveBeenCalledWith(stable, 'stable');
  expect(instance.getStatus()).toMatchObject({
    state: 'available',
    channel: 'nightly',
    version: '0.2.2',
  });
  expect(instance.getStatus().message).toContain('Stable 0.2.2 is newer');
  expect(instance.getStatus().message).toContain('Nightly remains selected');
  await instance.download();
  expect(instance.getStatus()).toMatchObject({
    state: 'downloaded',
    channel: 'nightly',
    version: '0.2.2',
    percent: 100,
  });
  expect(instance.getStatus().message).toBeUndefined();

  ops.currentVersion = '0.2.2';
  const currentInstance = new UpdateController('nightly', ops);
  await currentInstance.check();
  expect(currentInstance.getStatus()).toMatchObject({ state: 'not-available', channel: 'nightly' });
  expect(currentInstance.getStatus().message).toContain('newest build currently available');
  expect(currentInstance.getStatus().message).toContain('Nightly remains selected');
});
it('retries after check failure and invalidates failed downloads', async () => {
  const { instance, ops } = controller();
  ops.discover.mockRejectedValueOnce(new Error('offline'));
  await instance.check();
  expect(instance.getStatus().state).toBe('error');
  await instance.check();
  expect(instance.getStatus().state).toBe('available');
  ops.download.mockRejectedValueOnce(new Error('network'));
  await instance.download();
  expect(instance.getStatus().state).toBe('error');
  await expect(instance.install()).rejects.toThrow();
  await expect(instance.download()).rejects.toThrow(/Check/);
});
it('sets native channel before resetting downgrades and rejects a mismatched manifest', async () => {
  const { candidate } = controller();
  let channel: string | null = null;
  const native = {
    get channel() {
      return channel;
    },
    set channel(value: string | null) {
      channel = value;
      this.allowDowngrade = true;
    },
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: candidate.version,
        files: [{ url: candidate.assetUrls[0], sha512: 'a'.repeat(86) + '==' }],
      },
    })),
  };
  await prepareNativeUpdate(native, candidate, 'nightly');
  expect(native.allowDowngrade).toBe(false);
  expect(native.autoDownload).toBe(false);
  expect(native.autoInstallOnAppQuit).toBe(false);
  expect(native.setFeedURL).toHaveBeenCalledWith({
    provider: 'generic',
    url: candidate.feedUrl,
    channel: 'nightly',
  });
  native.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: '9.0.0', files: [] },
  });
  await expect(prepareNativeUpdate(native, candidate, 'nightly')).rejects.toThrow(/manifest/);
  native.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: false,
    updateInfo: {
      version: candidate.version,
      files: [{ url: candidate.assetUrls[0], sha512: 'a'.repeat(86) + '==' }],
    },
  });
  await expect(prepareNativeUpdate(native, candidate, 'nightly')).rejects.toThrow(/manifest/);
  for (const url of [
    'https://example.com/installer.exe',
    '../v0.2.0/installer.exe',
    candidate.feedUrl + 'unlisted.exe',
  ]) {
    native.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: candidate.version, files: [{ url, sha512: 'a'.repeat(86) + '==' }] },
    });
    await expect(prepareNativeUpdate(native, candidate, 'nightly')).rejects.toThrow(/installer/);
  }
});

it('uses the stable manifest when Nightly discovery selects a stable fallback', async () => {
  const stable = selectRelease(release('0.2.2'), 'stable', 'darwin')!;
  const native = {
    channel: 'nightly' as string | null,
    allowPrerelease: true,
    allowDowngrade: true,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: stable.version,
        files: [{ url: stable.assetUrls[0], sha512: 'a'.repeat(86) + '==' }],
      },
    })),
  };
  await prepareNativeUpdate(native, stable, 'nightly');
  expect(native.channel).toBe('latest');
  expect(native.allowPrerelease).toBe(false);
  expect(native.allowDowngrade).toBe(false);
  expect(native.setFeedURL).toHaveBeenCalledWith({
    provider: 'generic',
    url: stable.feedUrl,
    channel: 'latest',
  });
});

it('does not expose download after a new-channel native prepare is rejected', async () => {
  const { instance, ops } = controller();
  await instance.check();
  expect(instance.getStatus().state).toBe('available');
  ops.prepare.mockRejectedValueOnce(new Error('native update is not available'));
  await instance.switchChannel('stable', async () => undefined);
  await instance.check();
  expect(instance.getStatus().state).toBe('error');
  await expect(instance.download()).rejects.toThrow();
  expect(ops.download).not.toHaveBeenCalled();
});
