import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}.`);
}

function contained(root, candidate) {
  const path = resolve(candidate);
  const relativePath = relative(resolve(root), path);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    relativePath.includes('..\\') ||
    relativePath.includes('../')
  ) {
    throw new Error(`Refusing an extraction path outside its temporary directory: ${path}`);
  }
  return path;
}

function ownedTemporaryDirectory(candidate) {
  const temporaryRoot = resolve(tmpdir());
  const path = resolve(candidate);
  const relativePath = relative(temporaryRoot, path);
  if (
    !relativePath.startsWith('imnota-appimage-') ||
    relativePath.includes('..') ||
    relativePath.includes('/') ||
    relativePath.includes('\\')
  ) {
    throw new Error(`Refusing to clean unexpected temporary directory: ${path}`);
  }
  return path;
}

async function regularFileWithin(root, candidate) {
  const path = contained(root, candidate);
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular extracted file: ${path}`);
  if ((await realpath(path)) !== path) throw new Error(`Refusing an indirect extracted file: ${path}`);
  return path;
}

async function smokeLinuxAppImage(target) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'imnota-appimage-'));
  const root = ownedTemporaryDirectory(temporaryDirectory);
  try {
    run(target, ['--appimage-extract'], { cwd: root });
    const extractedRoot = contained(root, join(root, 'squashfs-root'));
    const sandboxHelper = await regularFileWithin(extractedRoot, join(extractedRoot, 'chrome-sandbox'));
    const executable = await regularFileWithin(extractedRoot, join(extractedRoot, 'imnota'));
    if (!(await lstat(extractedRoot)).isDirectory())
      throw new Error('AppImage extraction did not create squashfs-root.');
    // Match the existing CI Electron helper policy without disabling the sandbox or changing host AppArmor.
    run('sudo', ['chown', 'root:root', sandboxHelper]);
    run('sudo', ['chmod', '4755', sandboxHelper]);
    if (process.env.IMNOTA_SMOKE_MODE !== 'clipboard')
      run(process.execPath, ['scripts/verify-mcp.mjs', executable, target], { env: process.env });
    run(process.execPath, ['scripts/smoke.mjs', executable], { env: process.env });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function onPath(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(lookup, [command], { stdio: 'ignore' }).status === 0;
}

/**
 * Problems that make the packaged smoke impossible before it starts (for example on a fresh
 * clone), each with the command that fixes it. An empty list means the smoke can run.
 */
export function packagedSmokePreflight({
  platform,
  version,
  releaseDirectory = 'release',
  has = existsSync,
  command = onPath,
}) {
  const executable =
    platform === 'windows'
      ? `Imnota ${version}.exe`
      : platform === 'linux'
        ? `Imnota-${version}.AppImage`
        : undefined;
  if (!executable)
    return { problems: [`Unsupported packaged smoke platform ${platform}. Use linux or windows.`] };
  const target = resolve(releaseDirectory, executable);
  const problems = [];
  if (!has(target))
    problems.push(
      `Run "pnpm package:${platform === 'windows' ? 'win' : 'linux'}" first (expected ${target}).`,
    );
  if (platform === 'windows' && !has(resolve(releaseDirectory, 'win-unpacked/Imnota.exe')))
    problems.push(
      `Run "pnpm package:win" first (expected ${resolve(releaseDirectory, 'win-unpacked/Imnota.exe')}).`,
    );
  if (!has(resolve('dist-electron/electron/main.js')))
    problems.push(
      'Run "pnpm build" first (expected dist-electron/electron/main.js, used by the MCP verification).',
    );
  if (platform === 'linux') {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
      problems.push(
        'No display. Run it under xvfb: xvfb-run --auto-servernum node scripts/verify-packaged.mjs linux.',
      );
    if (!command('sudo')) problems.push('sudo is required to set up the AppImage chrome-sandbox helper.');
  }
  return { target, problems };
}

async function main() {
  const platform = process.argv[2];
  const version =
    process.env.IMNOTA_EXPECT_VERSION ?? JSON.parse(await readFile('package.json', 'utf8')).version;
  const { target, problems } = packagedSmokePreflight({
    platform,
    version,
    releaseDirectory: process.argv[3],
  });
  if (problems.length) {
    process.stderr.write(
      `Packaged smoke cannot start: build first.\n${problems.map((item) => `- ${item}`).join('\n')}\n`,
    );
    process.exitCode = 2;
    return;
  }
  await access(target);
  if (!(await lstat(target)).isFile()) throw new Error(`Expected a regular packaged file: ${target}`);
  if (platform === 'linux') return smokeLinuxAppImage(target);
  if (platform === 'windows') {
    // The portable launcher extracts a child; use the same build's direct packaged exe for owned stdio.
    // The portable distributable still receives the existing full UI/clipboard walkthroughs.
    if (process.env.IMNOTA_SMOKE_MODE !== 'clipboard')
      run(
        process.execPath,
        ['scripts/verify-mcp.mjs', resolve(process.argv[3] ?? 'release', 'win-unpacked/Imnota.exe'), target],
        { env: process.env },
      );
    return run(process.execPath, ['scripts/smoke.mjs', target], { env: process.env });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
