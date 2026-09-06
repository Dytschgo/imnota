import { spawn } from 'node:child_process';
import process from 'node:process';
import electron from 'electron';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

const ARTIFACT_NAME = /^imnota-(?:smoke|verification)-artifacts-[a-z0-9_-]+$/i;
const RESULT_NAME = /^imnota-smoke-result-[a-z0-9_-]+$/i;

function comparable(target) {
  const resolved = resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isStrictChild(parent, target) {
  const difference = relative(comparable(parent), comparable(target));
  return difference !== '' && !difference.startsWith('..') && !isAbsolute(difference);
}

export function prepareArtifactDirectory(requestedPath) {
  if (!requestedPath) return undefined;
  if (!isAbsolute(requestedPath)) throw new Error('IMNOTA_SMOKE_ARTIFACT_DIR must be absolute.');
  const target = resolve(requestedPath);
  if (!ARTIFACT_NAME.test(basename(target)))
    throw new Error(
      'IMNOTA_SMOKE_ARTIFACT_DIR must name a dedicated imnota-smoke-artifacts-* or imnota-verification-artifacts-* directory.',
    );
  const parent = realpathSync(resolve(target, '..'));
  if (!isStrictChild(parent, target)) throw new Error('Artifact directory escaped its verified parent.');
  if (!existsSync(target)) mkdirSync(target);
  const real = realpathSync(target);
  if (comparable(real) !== comparable(target))
    throw new Error('Artifact directory cannot be a link or alias.');
  const stat = lstatSync(real);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Artifact path must be a real directory.');
  if (readdirSync(real).length)
    throw new Error('Artifact directory must be newly created or empty; existing files were not touched.');
  return real;
}

function createRunDirectory() {
  const created = realpathSync(mkdtempSync(join(tmpdir(), 'imnota-smoke-result-')));
  if (!RESULT_NAME.test(basename(created))) throw new Error('Unexpected smoke result directory name.');
  writeFileSync(join(created, '.imnota-smoke-owned'), 'disposable native verification fixture\n', {
    flag: 'wx',
  });
  return created;
}

export function removeRunDirectory(runDirectory) {
  const resolved = resolve(runDirectory);
  if (!RESULT_NAME.test(basename(resolved)))
    throw new Error('Refusing to clean a directory not created for Imnota smoke results.');
  const temporaryRoot = realpathSync(tmpdir());
  if (!isStrictChild(temporaryRoot, resolved))
    throw new Error('Refusing to clean a smoke directory outside the system temporary directory.');
  if (existsSync(resolved)) {
    const real = realpathSync(resolved);
    if (comparable(real) !== comparable(resolved))
      throw new Error('Refusing to clean a linked smoke directory.');
    const marker = join(real, '.imnota-smoke-owned');
    if (!existsSync(marker) || lstatSync(marker).isSymbolicLink() || !lstatSync(marker).isFile())
      throw new Error('Refusing to clean a smoke directory without its ownership marker.');
  }
  rmSync(resolved, { recursive: true, force: true });
}

function runChild(executable, args, env, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { env, stdio: 'inherit' });
    let timedOut = false;
    let forceKill;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = globalThis.setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);
    child.once('error', (error) => {
      globalThis.clearTimeout(timeout);
      globalThis.clearTimeout(forceKill);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      globalThis.clearTimeout(timeout);
      globalThis.clearTimeout(forceKill);
      if (timedOut)
        reject(new Error(`Native verification exceeded its ${Math.round(timeoutMs / 1000)} second limit.`));
      else resolvePromise({ code, signal });
    });
  });
}

export async function runNativeVerification({ packagedExecutable, mode = 'smoke' } = {}) {
  if (!['smoke', 'stress'].includes(mode)) throw new Error(`Unknown native verification mode: ${mode}.`);
  const runDirectory = createRunDirectory();
  try {
    const reportPath = join(runDirectory, 'result.json');
    const profilePath = join(runDirectory, 'profile');
    mkdirSync(profilePath);
    const artifactDirectory = prepareArtifactDirectory(process.env.IMNOTA_SMOKE_ARTIFACT_DIR);
    const env = {
      ...process.env,
      IMNOTA_SMOKE: '1',
      IMNOTA_SMOKE_MODE: mode,
      IMNOTA_SMOKE_RESULT: reportPath,
      IMNOTA_SMOKE_USER_DATA: profilePath,
      ...(artifactDirectory ? { IMNOTA_SMOKE_ARTIFACT_DIR: artifactDirectory } : {}),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const executable = packagedExecutable ?? electron;
    const args = packagedExecutable ? [] : ['.'];
    const timeoutMs = mode === 'stress' ? 15 * 60_000 : 3 * 60_000;
    const result = await runChild(executable, args, env, timeoutMs);
    let report;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      throw new Error(
        `Native verification exited without a readable report (exit ${result.code}, signal ${result.signal}).`,
      );
    }
    if (result.code !== 0)
      throw new Error(
        `Native verification failed (exit ${result.code}, signal ${result.signal}): ${report.error ?? 'no application detail'}`,
      );
    if (
      report.passed !== true ||
      typeof report.version !== 'string' ||
      report.mode !== mode ||
      (env.IMNOTA_EXPECT_VERSION && report.version !== env.IMNOTA_EXPECT_VERSION)
    )
      throw new Error('The application did not confirm the expected native verification result.');
    return report;
  } finally {
    removeRunDirectory(runDirectory);
  }
}
