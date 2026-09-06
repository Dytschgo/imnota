import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseReleaseVersion, type ReleaseCandidate } from './releases.js';

export function shellQuote(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Unsupported character in update path.');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

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

export async function prepareTerminalUpdate(
  release: ReleaseCandidate,
  appPath: string,
  helperPath: string,
  cachePath: string,
  currentVersion: string,
): Promise<{ command: string; run: () => Promise<void> }> {
  const args = terminalUpdateArguments(release, appPath, currentVersion);
  const directory = await fs.mkdtemp(path.join(cachePath, 'imnota-update-'));
  const helper = path.join(directory, 'update-macos.sh');
  const launcher = path.join(directory, 'Update Imnota.command');
  await fs.copyFile(helperPath, helper);
  await fs.chmod(helper, 0o700);
  const script = `#!/bin/bash\n/bin/bash ${[helper, ...args].map(shellQuote).join(' ')}\nresult=$?\nif [ "$result" -ne 0 ]; then\n  printf '\\nUpdate stopped. Press Return to close this window.'\n  read -r _\nfi\nexit "$result"\n`;
  await fs.writeFile(launcher, script, { mode: 0o700 });
  return {
    command: `/bin/bash ${shellQuote(launcher)}`,
    run: async () => {
      await promisify(execFile)('/usr/bin/open', ['-a', 'Terminal', launcher]);
    },
  };
}
