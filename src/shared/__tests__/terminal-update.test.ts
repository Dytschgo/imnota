// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  detectMacHost,
  selectMacArchive,
  terminalUpdateArguments,
} from '../../../electron/terminal-update.js';
import { selectRelease } from '../../../electron/releases.js';
import { UpdateFailure } from '../../../electron/update-controller.js';

const version = '0.2.2-nightly.20260905.33994708543';
const base = `https://github.com/Dytschgo/imnota/releases/download/v${version}/`;
const archive = `${base}Imnota-${version}-universal-mac.zip`;
const arm64Archive = `${base}Imnota-${version}-arm64-mac.zip`;
const release = {
  version,
  feedUrl: base,
  url: base,
  assetUrls: [archive],
  checksumUrl: `${base}SHA256SUMS.txt`,
};
const appleSilicon = { appleSilicon: true };
const intel = { appleSilicon: false };
const appPath = '/Users/Dylan/Applications/Imnota.app';

function apiRelease(names: string[]) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: true,
    assets: names.map((name) => ({ name, size: 100, browser_download_url: base + name })),
  };
}

describe('terminal updates', () => {
  it('accepts only an API-listed checksum asset from the exact release', () => {
    const value = apiRelease(['nightly-mac.yml', `Imnota-${version}-universal-mac.zip`, 'SHA256SUMS.txt']);
    expect(selectRelease(value, 'nightly', 'darwin')?.checksumUrl).toBe(base + 'SHA256SUMS.txt');
    value.assets[2].browser_download_url = 'https://example.com/SHA256SUMS.txt';
    expect(selectRelease(value, 'nightly', 'darwin')?.checksumUrl).toBeUndefined();
  });
  it('pins both archive and checksums to the selected nightly', () => {
    expect(terminalUpdateArguments(release, appPath, '0.2.1', appleSilicon)).toEqual([
      `v${version}`,
      archive,
      `${base}SHA256SUMS.txt`,
      appPath,
      '0.2.1',
    ]);
  });
  it('rejects substituted feeds, unlisted archives and unsupported app paths', () => {
    expect(() =>
      terminalUpdateArguments(
        { ...release, feedUrl: 'https://example.com/' },
        '/Applications/Imnota.app',
        '0.2.1',
        appleSilicon,
      ),
    ).toThrow();
    expect(() =>
      terminalUpdateArguments(
        { ...release, assetUrls: [] },
        '/Applications/Imnota.app',
        '0.2.1',
        appleSilicon,
      ),
    ).toThrow();
    expect(() => terminalUpdateArguments(release, 'Imnota.app', '0.2.1', appleSilicon)).toThrow();
    expect(() =>
      terminalUpdateArguments(
        { ...release, checksumUrl: undefined },
        '/Applications/Imnota.app',
        '0.2.1',
        appleSilicon,
      ),
    ).toThrow();
  });
});

describe('macOS archive selection during the Apple silicon bridge', () => {
  it('uses the universal archive when it is the only one listed', () => {
    expect(selectMacArchive(release)).toEqual({ url: archive, architecture: 'universal' });
  });
  it('uses the arm64 archive when it is the only one listed', () => {
    const arm64 = { ...release, assetUrls: [arm64Archive] };
    expect(selectMacArchive(arm64)).toEqual({ url: arm64Archive, architecture: 'arm64' });
    expect(terminalUpdateArguments(arm64, appPath, '0.2.1', appleSilicon)[1]).toBe(arm64Archive);
  });
  it('prefers the arm64 archive when both are listed, in either order', () => {
    for (const assetUrls of [
      [archive, arm64Archive],
      [arm64Archive, archive],
    ])
      expect(selectMacArchive({ ...release, assetUrls }).url).toBe(arm64Archive);
  });
  it('refuses a release that lists neither archive', () => {
    for (const assetUrls of [
      [],
      [`${base}Imnota-${version}-x64-mac.zip`],
      [`${base}Imnota-mac.zip`],
      [`${base}Imnota-0.2.1-arm64-mac.zip`],
      [`https://example.com/Imnota-${version}-arm64-mac.zip`],
      [`${base}Imnota-${version}-arm64-mac.zip.blockmap`],
    ])
      expect(() => selectMacArchive({ ...release, assetUrls })).toThrow(/no supported macOS archive/);
  });
  it('refuses a duplicated archive listing instead of picking one copy', () => {
    expect(() => selectMacArchive({ ...release, assetUrls: [arm64Archive, arm64Archive, archive] })).toThrow(
      /more than once/,
    );
    expect(() => selectMacArchive({ ...release, assetUrls: [archive, archive] })).toThrow(/more than once/);
  });
  it('refuses an arm64-only target on an Intel Mac with a shown reason', () => {
    const arm64 = { ...release, assetUrls: [arm64Archive] };
    let failure: unknown;
    try {
      terminalUpdateArguments(arm64, appPath, '0.2.1', intel);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(UpdateFailure);
    expect((failure as Error).message).toMatch(/Intel Macs are no longer supported/);
    // Both listed still selects arm64, so Intel is refused rather than silently downgraded.
    expect(() =>
      terminalUpdateArguments({ ...release, assetUrls: [archive, arm64Archive] }, appPath, '0.2.1', intel),
    ).toThrow(/Intel Macs are no longer supported/);
  });
  it('still updates an Intel Mac to a universal target', () => {
    expect(terminalUpdateArguments(release, appPath, '0.2.1', intel)[1]).toBe(archive);
  });
  it('keeps arm64 asset URLs reachable through the in-app release checker', () => {
    const value = apiRelease(['nightly-mac.yml', `Imnota-${version}-arm64-mac.zip`, 'SHA256SUMS.txt']);
    const candidate = selectRelease(value, 'nightly', 'darwin');
    expect(candidate?.assetUrls).toEqual([arm64Archive]);
    expect(selectMacArchive(candidate!).architecture).toBe('arm64');
  });
  it('treats Rosetta-translated Imnota as running on Apple silicon', () => {
    expect(detectMacHost('arm64', false)).toEqual(appleSilicon);
    expect(detectMacHost('x64', true)).toEqual(appleSilicon);
    expect(detectMacHost('x64', false)).toEqual(intel);
  });
});
