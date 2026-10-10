import { randomUUID, createHash } from 'node:crypto';
import { faultCases, assertFaultReport } from './native-fault-catalog.mjs';
import { retainFaultOperands } from './native-fault-retention.mjs';
import { spawn } from 'node:child_process';
import process from 'node:process';
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

export function normalizeNativeVerificationMode(mode = 'smoke') {
  if (!['smoke', 'stress', 'clipboard', 'faults'].includes(mode))
    throw new Error(`Unknown native verification mode: ${mode}.`);
  return mode;
}

export function nativeVerificationEnvironment(inherited, platform = process.platform) {
  const environment = { ...inherited };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.VITE_DEV_SERVER_URL;
  if (inherited.IMNOTA_SMOKE_CAPTURE_CAPABILITY === 'real-memory-only')
    delete environment.IMNOTA_SMOKE_CAPTURE_SOURCE;
  else if (platform === 'win32' || platform === 'darwin')
    environment.IMNOTA_SMOKE_CAPTURE_SOURCE = 'synthetic';
  else delete environment.IMNOTA_SMOKE_CAPTURE_SOURCE;
  return environment;
}

export function prepareArtifactDirectory(requestedPath) {
  if (!requestedPath) return undefined;
  if (!isAbsolute(requestedPath)) throw new Error('IMNOTA_SMOKE_ARTIFACT_DIR must be absolute.');
  const target = resolve(requestedPath);
  if (!ARTIFACT_NAME.test(basename(target)))
    throw new Error(
      'IMNOTA_SMOKE_ARTIFACT_DIR must name a dedicated imnota-smoke-artifacts-* or imnota-verification-artifacts-* directory.',
    );
  const parent = realpathSync.native(resolve(target, '..'));
  if (!isStrictChild(parent, target)) throw new Error('Artifact directory escaped its verified parent.');
  if (!existsSync(target)) mkdirSync(target);
  const real = realpathSync.native(target);
  if (comparable(real) !== comparable(target))
    throw new Error('Artifact directory cannot be a link or alias.');
  const stat = lstatSync(real);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Artifact path must be a real directory.');
  if (readdirSync(real).length)
    throw new Error('Artifact directory must be newly created or empty; existing files were not touched.');
  return real;
}

export function createRunDirectory() {
  const created = realpathSync.native(mkdtempSync(join(tmpdir(), 'imnota-smoke-result-')));
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
  const temporaryRoot = realpathSync.native(tmpdir());
  if (!isStrictChild(temporaryRoot, resolved))
    throw new Error('Refusing to clean a smoke directory outside the system temporary directory.');
  if (existsSync(resolved)) {
    const real = realpathSync.native(resolved);
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
        reject(
          Object.assign(
            new Error(`Native verification exceeded its ${Math.round(timeoutMs / 1000)} second limit.`),
            { nativeChildOutcome: { code, signal, pid: child.pid, timedOut: true } },
          ),
        );
      else resolvePromise({ code, signal, pid: child.pid });
    });
  });
}

export async function runNativeVerification({
  packagedExecutable,
  mode = 'smoke',
  environment = process.env,
} = {}) {
  mode = normalizeNativeVerificationMode(mode);
  if (mode === 'faults') {
    faultCases(environment.IMNOTA_FAULT_CASE_SET);
    if (environment.IMNOTA_SMOKE_CAPTURE_CAPABILITY)
      throw new Error('Fault mode cannot select a desktop capture capability.');
  }
  const runDirectory = createRunDirectory();
  let outcome;
  let faultProof;
  let originalFailure;
  let retentionFailure;
  let report;
  try {
    const reportPath = join(runDirectory, 'result.json');
    const profilePath = join(runDirectory, 'profile');
    mkdirSync(profilePath);
    const artifactDirectory = prepareArtifactDirectory(environment.IMNOTA_SMOKE_ARTIFACT_DIR);
    const env = {
      ...nativeVerificationEnvironment(environment),
      IMNOTA_SMOKE: '1',
      IMNOTA_SMOKE_MODE: mode,
      IMNOTA_SMOKE_RESULT: reportPath,
      IMNOTA_SMOKE_USER_DATA: profilePath,
      ...(artifactDirectory ? { IMNOTA_SMOKE_ARTIFACT_DIR: artifactDirectory } : {}),
    };
    if (mode === 'faults') {
      if (!packagedExecutable || !artifactDirectory || !env.IMNOTA_EXPECT_VERSION || !env.IMNOTA_FAULT_GRANT)
        throw new Error('Fault mode requires a packaged candidate, version, grant and evidence root.');
      for (const key of [
        'IMNOTA_FAULT_EXECUTABLE_SHA256',
        'IMNOTA_FAULT_ASAR_SHA256',
        'IMNOTA_FAULT_BUILD_SHA256',
        'IMNOTA_FAULT_SUPPLIED_SHA256',
      ])
        if (!/^[a-f0-9]{64}$/.test(env[key] ?? '')) throw new Error(`Missing fault hash ${key}.`);
      for (const key of ['IMNOTA_FAULT_SOURCE_SHA', 'IMNOTA_FAULT_SOURCE_TREE'])
        if (!/^[a-f0-9]{40}$/.test(env[key] ?? '')) throw new Error(`Missing fault source ${key}.`);
      const supplied = realpathSync.native(env.IMNOTA_FAULT_SUPPLIED);
      if (
        createHash('sha256').update(readFileSync(supplied)).digest('hex') !== env.IMNOTA_FAULT_SUPPLIED_SHA256
      )
        throw new Error('Supplied package changed before launch.');
      faultProof = {
        schemaVersion: 1,
        nonce: randomUUID(),
        grantId: env.IMNOTA_FAULT_GRANT,
        runRoot: runDirectory,
        profileRoot: profilePath,
        artifactRoot: artifactDirectory,
        launcherPid: process.pid,
        caseSet: env.IMNOTA_FAULT_CASE_SET,
        sourceSha: env.IMNOTA_FAULT_SOURCE_SHA,
        sourceTree: env.IMNOTA_FAULT_SOURCE_TREE,
        version: env.IMNOTA_EXPECT_VERSION,
        suppliedExecutable: supplied,
        suppliedSha256: env.IMNOTA_FAULT_SUPPLIED_SHA256,
        executableSha256: env.IMNOTA_FAULT_EXECUTABLE_SHA256,
        asarSha256: env.IMNOTA_FAULT_ASAR_SHA256,
        buildSha256: env.IMNOTA_FAULT_BUILD_SHA256,
      };
      writeFileSync(join(runDirectory, '.imnota-native-fault-owned.json'), JSON.stringify(faultProof), {
        flag: 'wx',
      });
      env.IMNOTA_FAULT_NONCE = faultProof.nonce;
    }
    const executable = packagedExecutable ?? (await import('electron')).default;
    const args = packagedExecutable ? [] : ['.'];
    // The Windows walkthrough completed its assertions in 225 seconds in run
    // 36265303628; portable extraction/startup and shutdown also share this budget.
    // Per-operation deadlines remain unchanged, and a timed-out run still fails.
    const timeoutMs = mode === 'stress' ? 15 * 60_000 : mode === 'clipboard' ? 4 * 60_000 : 6 * 60_000;
    const result = await runChild(executable, args, env, timeoutMs);
    outcome = result;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      throw new Error(
        `Native verification exited without a readable report (exit ${result.code}, signal ${result.signal}).`,
      );
    }
    if (report.diagnosticsHealth)
      console.log('Local diagnostics health:', JSON.stringify(report.diagnosticsHealth));
    if (result.code !== 0) {
      if (report.rendererState)
        console.error(
          'Isolated fixture renderer diagnostics:',
          JSON.stringify(report.rendererState).slice(0, 24000),
        );
      throw new Error(
        `Native verification failed (exit ${result.code}, signal ${result.signal}): ${report.error ?? 'no application detail'}`,
      );
    }
    if (
      report.passed !== true ||
      typeof report.version !== 'string' ||
      report.mode !== mode ||
      (env.IMNOTA_EXPECT_VERSION && report.version !== env.IMNOTA_EXPECT_VERSION)
    )
      throw new Error('The application did not confirm the expected native verification result.');
    if (faultProof) assertFaultReport(report, faultProof);
  } catch (error) {
    originalFailure = error;
    outcome ??= error.nativeChildOutcome;
  } finally {
    try {
      if (mode !== 'faults') removeRunDirectory(runDirectory);
      else {
        writeFileSync(
          join(runDirectory, 'termination.json'),
          JSON.stringify(
            {
              outcome,
              launcherPid: process.pid,
              retainedRun: runDirectory,
              nonce: faultProof?.nonce,
              childExited: Boolean(outcome),
            },
            null,
            2,
          ),
          { flag: 'wx' },
        );
        console.error('Retained native fault run:', runDirectory);
        retainFaultOperands(faultProof, outcome);
      }
    } catch (error) {
      retentionFailure = error;
    }
  }
  if (originalFailure && retentionFailure)
    throw new AggregateError(
      [originalFailure, retentionFailure],
      'Native verification and operand retention both failed; original operands retained.',
    );
  if (originalFailure) throw originalFailure;
  if (retentionFailure) throw retentionFailure;
  return report;
}
