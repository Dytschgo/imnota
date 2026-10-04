import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { faultDigest, validateFaultLaunch } from './smoke-fault-ownership.js';
import type { NativeFaultOwnership } from '../src/shared/native-faults.js';

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) {
    expect(path.dirname(root)).toBe(await fs.realpath(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^imnota-(?:smoke-result|native-fault-proof)-/);
    await fs.rm(root, { recursive: true });
  }
});
async function proofFixture() {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const runRoot = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'imnota-smoke-result-')));
  const operands = await fs.realpath(
    await fs.mkdtemp(path.join(temporaryRoot, 'imnota-native-fault-proof-')),
  );
  owned.push(runRoot, operands);
  const profileRoot = path.join(runRoot, 'profile');
  const artifactRoot = path.join(operands, 'imnota-verification-artifacts-proof');
  const bin = path.join(operands, 'bin');
  for (const directory of [profileRoot, artifactRoot, bin]) await fs.mkdir(directory);
  const executable = path.join(bin, 'synthetic.exe'),
    asar = path.join(bin, 'synthetic.asar');
  await fs.writeFile(executable, 'inert synthetic executable operand, never launched');
  await fs.writeFile(asar, 'inert synthetic archive operand');
  const build = {
    sourceSha: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    version: 'unit',
    suppliedSha256: faultDigest(await fs.readFile(executable)),
    executableSha256: faultDigest(await fs.readFile(executable)),
    asarSha256: faultDigest(await fs.readFile(asar)),
  };
  const buildPath = path.join(operands, 'source-build.json');
  await fs.writeFile(buildPath, JSON.stringify(build));
  const proof: NativeFaultOwnership = {
    schemaVersion: 1,
    nonce: randomUUID(),
    grantId: 'synthetic-proof',
    runRoot,
    profileRoot,
    artifactRoot,
    launcherPid: process.pid,
    caseSet: 'restore-eio',
    ...build,
    suppliedExecutable: executable,
    buildSha256: faultDigest(JSON.stringify(build)),
  };
  const marker = path.join(runRoot, '.imnota-native-fault-owned.json');
  await fs.writeFile(marker, JSON.stringify(proof), { flag: 'wx' });
  const env = {
    IMNOTA_SMOKE: '1',
    IMNOTA_SMOKE_MODE: 'faults',
    IMNOTA_SMOKE_USER_DATA: profileRoot,
    IMNOTA_FAULT_NONCE: proof.nonce,
    IMNOTA_FAULT_CASE_SET: proof.caseSet,
    IMNOTA_EXPECT_VERSION: proof.version,
    IMNOTA_SMOKE_RESULT: path.join(runRoot, 'result.json'),
    IMNOTA_SMOKE_ARTIFACT_DIR: artifactRoot,
    IMNOTA_FAULT_BUILD_MANIFEST: buildPath,
  };
  return {
    proof,
    marker,
    input: { env, temporaryRoot, executable, asar, version: proof.version, packaged: true },
  };
}
it('accepts only the bound fresh fixture proof without executing any candidate', async () => {
  const value = await proofFixture();
  expect(await validateFaultLaunch(value.input)).toEqual(value.proof);
});
it.each(['nonce', 'version', 'marker', 'profile', 'asar', 'manifest', 'link', 'hardlink'] as const)(
  'refuses %s ownership mismatch before granting a preload capability',
  async (problem) => {
    const value = await proofFixture();
    if (problem === 'nonce') value.input.env.IMNOTA_FAULT_NONCE = randomUUID();
    if (problem === 'version') value.input.version = 'wrong';
    if (problem === 'marker') await fs.unlink(value.marker);
    if (problem === 'profile')
      await fs.writeFile(path.join(value.proof.profileRoot, 'not-fresh'), 'preserve me');
    if (problem === 'asar') await fs.writeFile(value.input.asar, 'changed');
    if (problem === 'manifest') await fs.writeFile(value.input.env.IMNOTA_FAULT_BUILD_MANIFEST, '{}');
    if (problem === 'link') {
      await fs.rmdir(value.proof.profileRoot);
      await fs.symlink(
        value.proof.artifactRoot,
        value.proof.profileRoot,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    if (problem === 'hardlink') await fs.link(value.marker, path.join(value.proof.runRoot, 'marker-peer'));
    await expect(validateFaultLaunch(value.input)).rejects.toThrow();
  },
);
