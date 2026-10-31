// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  prepareTerminalUpdate,
  shellQuote,
  terminalUpdateArguments,
} from '../../../electron/terminal-update.js';
import { selectRelease } from '../../../electron/releases.js';

const version = '0.2.2-nightly.20260905.33994708543';
const base = `https://github.com/Dytschgo/imnota/releases/download/v${version}/`;
const archive = `${base}Imnota-${version}-universal-mac.zip`;
const release = {
  version,
  feedUrl: base,
  url: base,
  assetUrls: [archive],
  checksumUrl: `${base}SHA256SUMS.txt`,
};

describe('terminal updates', () => {
  it('copies the security observer beside the updater and tolerates a missing older-bundle helper', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-prepare-test-'));
    try {
      const helper = path.join(root, 'update-macos.sh');
      const observer = path.join(root, 'observer');
      await fs.writeFile(helper, '#!/bin/bash\n');
      await fs.writeFile(observer, 'synthetic observer bytes');
      for (const present of [true, false]) {
        const cache = path.join(root, present ? 'present' : 'missing');
        await fs.mkdir(cache);
        const prepared = await prepareTerminalUpdate(
          release,
          '/Applications/Imnota.app',
          helper,
          cache,
          '0.4.0',
          present ? observer : path.join(root, 'absent'),
        );
        expect(prepared.command).toContain('Update Imnota.command');
        const [name] = await fs.readdir(cache);
        const copied = path.join(cache, name, 'imnota-security-observer');
        if (present) {
          expect(await fs.readFile(copied, 'utf8')).toBe('synthetic observer bytes');
          if (process.platform !== 'win32') expect((await fs.stat(copied)).mode & 0o777).toBe(0o700);
        } else {
          await expect(fs.stat(copied)).rejects.toMatchObject({ code: 'ENOENT' });
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('accepts only an API-listed checksum asset from the exact release', () => {
    const assets = ['nightly-mac.yml', `Imnota-${version}-universal-mac.zip`, 'SHA256SUMS.txt'].map(
      (name) => ({
        name,
        size: 100,
        browser_download_url: base + name,
      }),
    );
    const value = { tag_name: `v${version}`, draft: false, prerelease: true, assets };
    expect(selectRelease(value, 'nightly', 'darwin')?.checksumUrl).toBe(base + 'SHA256SUMS.txt');
    assets[2].browser_download_url = 'https://example.com/SHA256SUMS.txt';
    expect(selectRelease(value, 'nightly', 'darwin')?.checksumUrl).toBeUndefined();
  });
  it('pins both archive and checksums to the selected nightly', () => {
    expect(terminalUpdateArguments(release, '/Users/Dylan/Applications/Imnota.app', '0.2.1')).toEqual([
      `v${version}`,
      archive,
      `${base}SHA256SUMS.txt`,
      '/Users/Dylan/Applications/Imnota.app',
      '0.2.1',
    ]);
  });
  it('rejects substituted feeds, unlisted archives and unsupported app paths', () => {
    expect(() =>
      terminalUpdateArguments(
        { ...release, feedUrl: 'https://example.com/' },
        '/Applications/Imnota.app',
        '0.2.1',
      ),
    ).toThrow();
    expect(() =>
      terminalUpdateArguments({ ...release, assetUrls: [] }, '/Applications/Imnota.app', '0.2.1'),
    ).toThrow();
    expect(() => terminalUpdateArguments(release, 'Imnota.app', '0.2.1')).toThrow();
    expect(() =>
      terminalUpdateArguments({ ...release, checksumUrl: undefined }, '/Applications/Imnota.app', '0.2.1'),
    ).toThrow();
  });
  it('quotes shell metacharacters as literal path content', () => {
    expect(shellQuote("/Users/Dylan's files/$(touch injected);`cmd`/Imnota.app")).toBe(
      "'/Users/Dylan'\\''s files/$(touch injected);`cmd`/Imnota.app'",
    );
    expect(() => shellQuote('bad\npath')).toThrow();
    expect(() => shellQuote('bad\0path')).toThrow();
  });
});
