import nodeFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoLinks, isWithin } from './files.js';
import { faultOwnershipSchema, type NativeFaultOwnership } from '../src/shared/native-faults.js';

// Electron's ASAR-aware fs presents app.asar as a virtual directory. Candidate
// ownership must measure the physical archive with real bigint file identities.
const fs: typeof nodeFs = process.versions.electron
  ? createRequire(import.meta.url)('original-fs').promises
  : nodeFs;

export const faultDigest = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Do not yield to Electron startup until its profile is proved safe and selected. */
export function validateFaultProfileBootstrap(env: NodeJS.ProcessEnv, temporaryRoot: string): void {
  if (env.IMNOTA_SMOKE_MODE !== 'faults') return;
  if (env.IMNOTA_SMOKE !== '1' || !env.IMNOTA_SMOKE_USER_DATA || env.IMNOTA_SMOKE_CAPTURE_CAPABILITY)
    throw new Error('Fault profile requires the owned smoke launcher.');
  const profile = env.IMNOTA_SMOKE_USER_DATA;
  const run = path.dirname(profile);
  if (
    !path.isAbsolute(profile) ||
    path.dirname(run) !== realpathSync(temporaryRoot) ||
    !/^imnota-smoke-result-[a-zA-Z0-9_-]+$/.test(path.basename(run)) ||
    profile !== path.join(run, 'profile')
  )
    throw new Error('Unowned fault profile path.');
  for (const directory of [run, profile]) {
    if (
      realpathSync(directory) !== directory ||
      !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink()
    )
      throw new Error('Indirect fault profile.');
  }
  const marker = path.join(run, '.imnota-native-fault-owned.json');
  const stat = lstatSync(marker, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > 16384n)
    throw new Error('Unowned fault profile marker.');
  const proof = faultOwnershipSchema.parse(JSON.parse(readFileSync(marker, 'utf8')));
  if (
    proof.nonce !== env.IMNOTA_FAULT_NONCE ||
    proof.profileRoot !== profile ||
    proof.runRoot !== run ||
    readdirSync(profile).length
  )
    throw new Error('Fault profile marker or freshness mismatch.');
}

export async function faultIdentity(target: string, directory = false) {
  if (!path.isAbsolute(target) || path.resolve(target) !== target)
    throw new Error('Fault operand must be an absolute canonical path.');
  await assertNoLinks(target);
  if ((await fs.realpath(target)) !== target) throw new Error('Fault operand is a path alias.');
  const stat = await fs.lstat(target, { bigint: true });
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)
    throw new Error('Fault operand must be an unlinked regular file or owned directory.');
  return { dev: String(stat.dev), ino: String(stat.ino), nlink: String(stat.nlink) };
}

export function assertFaultRootsDisjoint(roots: string[]): void {
  for (let i = 0; i < roots.length; i++)
    for (let j = i + 1; j < roots.length; j++)
      if (isWithin(roots[i], roots[j]) || isWithin(roots[j], roots[i]))
        throw new Error('Fault roots overlap.');
}

/** Called before profile selection or preload bootstrap; declarations alone grant nothing. */
export async function validateFaultLaunch(input: {
  env: NodeJS.ProcessEnv;
  temporaryRoot: string;
  executable: string;
  asar: string;
  version: string;
  packaged: boolean;
}): Promise<NativeFaultOwnership | undefined> {
  if (input.env.IMNOTA_SMOKE_MODE !== 'faults') return undefined;
  if (!input.packaged || input.env.IMNOTA_SMOKE !== '1' || input.env.VITE_DEV_SERVER_URL)
    throw new Error('Fault verification requires an owned packaged smoke session.');
  const profile = input.env.IMNOTA_SMOKE_USER_DATA;
  if (!profile) throw new Error('Missing fault profile.');
  const run = path.dirname(profile);
  const temporary = await fs.realpath(input.temporaryRoot);
  if (path.dirname(run) !== temporary || !/^imnota-smoke-result-[a-zA-Z0-9_-]+$/.test(path.basename(run)))
    throw new Error('Fault run is not a fresh canonical temporary child.');
  await faultIdentity(run, true);
  await faultIdentity(profile, true);
  const marker = path.join(run, '.imnota-native-fault-owned.json');
  await faultIdentity(marker);
  const proof = faultOwnershipSchema.parse(JSON.parse(await fs.readFile(marker, 'utf8')));
  if (
    proof.runRoot !== run ||
    proof.profileRoot !== profile ||
    profile !== path.join(run, 'profile') ||
    proof.nonce !== input.env.IMNOTA_FAULT_NONCE ||
    proof.caseSet !== input.env.IMNOTA_FAULT_CASE_SET ||
    proof.version !== input.version ||
    proof.version !== input.env.IMNOTA_EXPECT_VERSION ||
    input.env.IMNOTA_SMOKE_RESULT !== path.join(run, 'result.json') ||
    proof.artifactRoot !== input.env.IMNOTA_SMOKE_ARTIFACT_DIR
  )
    throw new Error('Fault launch binding mismatch.');
  // Electron may have populated its profile by a later check, so this is bootstrap-only.
  if ((await fs.readdir(profile)).length) throw new Error('Fault profile is not fresh.');
  if (!/^imnota-(?:smoke|verification)-artifacts-[a-z0-9_-]+$/i.test(path.basename(proof.artifactRoot)))
    throw new Error('Fault artifact namespace mismatch.');
  await faultIdentity(proof.artifactRoot, true);
  if ((await fs.readdir(proof.artifactRoot)).length) throw new Error('Fault artifact root is not fresh.');
  for (const [target, expected] of [
    [proof.suppliedExecutable, proof.suppliedSha256],
    [input.executable, proof.executableSha256],
    [input.asar, proof.asarSha256],
  ]) {
    await faultIdentity(target);
    if (faultDigest(await fs.readFile(target)) !== expected)
      throw new Error('Fault candidate hash mismatch.');
  }
  const buildPath = input.env.IMNOTA_FAULT_BUILD_MANIFEST;
  if (!buildPath) throw new Error('Missing source/build manifest.');
  await faultIdentity(buildPath);
  const buildBytes = await fs.readFile(buildPath);
  const build = JSON.parse(buildBytes.toString());
  if (
    faultDigest(buildBytes) !== proof.buildSha256 ||
    build.sourceSha !== proof.sourceSha ||
    build.sourceTree !== proof.sourceTree ||
    build.version !== proof.version ||
    build.asarSha256 !== proof.asarSha256 ||
    build.executableSha256 !== proof.executableSha256 ||
    build.suppliedSha256 !== proof.suppliedSha256
  )
    throw new Error('Source/build/candidate manifest mismatch.');
  assertFaultRootsDisjoint([run, proof.artifactRoot, path.dirname(input.executable)]);
  return Object.freeze(proof);
}

export async function bindFaultFixture(proof: NativeFaultOwnership, fixture: string, temporary: string) {
  if (path.dirname(fixture) !== temporary || !/^imnota-smoke-[a-zA-Z0-9_-]+$/.test(path.basename(fixture)))
    throw new Error('Fault fixture is not a fresh temporary child.');
  await faultIdentity(fixture, true);
  if ((await fs.readdir(fixture)).length) throw new Error('Fault fixture is not fresh.');
  assertFaultRootsDisjoint([
    fixture,
    proof.runRoot,
    proof.artifactRoot,
    path.dirname(proof.suppliedExecutable),
  ]);
  await fs.writeFile(
    path.join(fixture, '.imnota-native-fault-fixture.json'),
    JSON.stringify({
      nonce: proof.nonce,
      sourceSha: proof.sourceSha,
      caseSet: proof.caseSet,
    }),
    { flag: 'wx' },
  );
}
