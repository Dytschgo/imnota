import { spawnSync } from 'node:child_process';
import { access, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
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

async function smokeLinuxAppImage(target, faults) {
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
    if (faults)
      run(
        process.execPath,
        ['scripts/smoke.mjs', executable, target, executable, join(extractedRoot, 'resources', 'app.asar')],
        {
          env: { ...process.env, IMNOTA_SMOKE_MODE: 'faults' },
        },
      );
    else {
      if (process.env.IMNOTA_SMOKE_MODE !== 'clipboard')
        run(process.execPath, ['scripts/verify-mcp.mjs', executable, target], { env: process.env });
      run(process.execPath, ['scripts/smoke.mjs', executable], { env: process.env });
    }
  } finally {
    if (!faults) await rm(root, { recursive: true, force: true });
    else console.error('Retained owned fault extraction:', root);
  }
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
  const executable =
    platform === 'windows'
      ? `Imnota ${version}.exe`
      : platform === 'linux'
        ? `Imnota-${version}.AppImage`
        : undefined;
  if (!executable) throw new Error(`Unsupported packaged smoke platform ${platform}.`);
  const target = resolve(positional[1] ?? 'release', executable);
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
      run(
        process.execPath,
        ['scripts/verify-mcp.mjs', resolve(positional[1] ?? 'release', 'win-unpacked/Imnota.exe'), target],
        { env: process.env },
      );
    return run(process.execPath, ['scripts/smoke.mjs', target], { env: process.env });
  }
}

await main();
