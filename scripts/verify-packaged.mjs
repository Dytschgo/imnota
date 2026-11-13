import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { runWalkthroughChild } from './walkthrough-child.mjs';
import { access, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

async function run(command, args, options = {}) {
  const result = await runWalkthroughChild(command, args, {
    cancellationGraceMs: 5_000,
    forwardToGroup: false,
    ...options,
  });
  if (result.code !== 0) throw new Error(`${command} failed with exit code ${result.code ?? 'unknown'}.`);
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

async function smokeLinuxAppImage(target, faults) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'imnota-appimage-'));
  const root = ownedTemporaryDirectory(temporaryDirectory);
  try {
    await run(target, ['--appimage-extract'], { cwd: root });
    const extractedRoot = contained(root, join(root, 'squashfs-root'));
    const sandboxHelper = await regularFileWithin(extractedRoot, join(extractedRoot, 'chrome-sandbox'));
    const executable = await regularFileWithin(extractedRoot, join(extractedRoot, 'imnota'));
    if (!(await lstat(extractedRoot)).isDirectory())
      throw new Error('AppImage extraction did not create squashfs-root.');
    // Match the existing CI Electron helper policy without disabling the sandbox or changing host AppArmor.
    await run('sudo', ['chown', 'root:root', sandboxHelper]);
    await run('sudo', ['chmod', '4755', sandboxHelper]);
    if (faults)
      await run(
        process.execPath,
        ['scripts/smoke.mjs', executable, target, executable, join(extractedRoot, 'resources', 'app.asar')],
        {
          env: { ...process.env, IMNOTA_SMOKE_MODE: 'faults' },
        },
      );
    else {
      if (process.env.IMNOTA_SMOKE_MODE !== 'clipboard')
        await run(process.execPath, ['scripts/verify-mcp.mjs', executable, target], { env: process.env });
      await run(process.execPath, ['scripts/smoke.mjs', executable], { env: process.env });
    }
  } finally {
    if (!faults) await rm(root, { recursive: true, force: true });
    else console.error('Retained owned fault extraction:', root);
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
  smokeMode = process.env.IMNOTA_SMOKE_MODE,
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
  if (
    smokeMode !== 'clipboard' &&
    platform === 'windows' &&
    !has(resolve(releaseDirectory, 'win-unpacked/Imnota.exe'))
  )
    problems.push(
      `Run "pnpm package:win" first (expected ${resolve(releaseDirectory, 'win-unpacked/Imnota.exe')}).`,
    );
  const mcpFixtures = ['utils.js', 'preferences.js'].map((name) => resolve('dist-electron/src/shared', name));
  if (smokeMode !== 'clipboard' && mcpFixtures.some((file) => !has(file)))
    problems.push(
      'Run "pnpm build" first (expected dist-electron/src/shared/utils.js and preferences.js for MCP fixtures).',
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
  const args = process.argv.slice(2);
  const faults = args.includes('--faults');
  const positional = args.filter((value) => value !== '--faults');
  if (
    positional.length > 2 ||
    args.filter((value) => value === '--faults').length > 1 ||
    positional.some((value) => value.startsWith('--'))
  )
    throw new Error('Unknown packaged verification arguments.');
  const platform = positional[0];
  if (!faults && process.env.IMNOTA_SMOKE_MODE === 'faults')
    throw new Error('Use explicit --faults packaged mode.');
  if (!faults) delete process.env.IMNOTA_FAULT_CASE_SET;
  const version =
    process.env.IMNOTA_EXPECT_VERSION ?? JSON.parse(await readFile('package.json', 'utf8')).version;
  const { target, problems } = packagedSmokePreflight({
    platform,
    version,
    releaseDirectory: positional[1],
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
  if (platform === 'linux') return smokeLinuxAppImage(target, faults);
  if (platform === 'windows' && faults)
    return run(
      process.execPath,
      [
        'scripts/smoke.mjs',
        target,
        target,
        resolve(positional[1] ?? 'release', 'win-unpacked', 'Imnota.exe'),
        resolve(positional[1] ?? 'release', 'win-unpacked', 'resources', 'app.asar'),
      ],
      { env: { ...process.env, IMNOTA_SMOKE_MODE: 'faults' } },
    );
  if (platform === 'windows') {
    // Preserve main's owned MCP stdio check and portable UI walkthrough.
    if (process.env.IMNOTA_SMOKE_MODE !== 'clipboard')
      await run(
        process.execPath,
        ['scripts/verify-mcp.mjs', resolve(positional[1] ?? 'release', 'win-unpacked/Imnota.exe'), target],
        { env: process.env },
      );
    return run(process.execPath, ['scripts/smoke.mjs', target], { env: process.env });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
