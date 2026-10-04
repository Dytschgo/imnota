import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync, mkdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { faultCaseSets, assertFaultAggregate, assertFaultReport } from './native-fault-catalog.mjs';
import { prepareArtifactDirectory, runNativeVerification } from './smoke-process.mjs';

import { writeFaultEvidenceManifest } from './native-fault-retention.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', cwd: process.cwd(), windowsHide: true });
  if (result.status !== 0) throw new Error('Cannot bind the fault candidate to its source checkout.');
  return result.stdout.trim();
}
function file(target) {
  const absolute = resolve(target);
  if (realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile())
    throw new Error('Indirect fault package operand.');
  return absolute;
}

/** Fixed case partitions share the existing smoke process lifecycle and deadlines. */
export async function runPackagedFaults({ executable, suppliedPackage, runningExecutable, asar }) {
  const root = prepareArtifactDirectory(process.env.IMNOTA_SMOKE_ARTIFACT_DIR);
  if (!root) throw new Error('Packaged faults require a new explicit evidence directory.');
  const version =
    process.env.IMNOTA_EXPECT_VERSION ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
  const sourceSha = git('rev-parse', 'HEAD');
  const sourceTree = git('rev-parse', 'HEAD^{tree}');
  const supplied = file(suppliedPackage),
    running = file(runningExecutable),
    archive = file(asar);
  const manifest = {
    schemaVersion: 1,
    sourceSha,
    sourceTree,
    version,
    suppliedSha256: digest(readFileSync(supplied)),
    executableSha256: digest(readFileSync(running)),
    asarSha256: digest(readFileSync(archive)),
    sourceDeclaration: 'Checkout SHA/tree; package and executable hashes measured before launching.',
  };
  const manifestPath = join(root, 'source-build-package.json');
  const serialized = JSON.stringify(manifest, null, 2);
  writeFileSync(manifestPath, serialized, { flag: 'wx' });
  const results = [];
  let complete = false;
  try {
    for (const caseSet of faultCaseSets) {
      const artifacts = join(root, `imnota-verification-artifacts-${caseSet}`);
      mkdirSync(artifacts);
      const env = {
        ...process.env,
        IMNOTA_SMOKE_MODE: 'faults',
        IMNOTA_FAULT_CASE_SET: caseSet,
        IMNOTA_SMOKE_ARTIFACT_DIR: artifacts,
        IMNOTA_EXPECT_VERSION: version,
        IMNOTA_FAULT_SOURCE_SHA: sourceSha,
        IMNOTA_FAULT_SOURCE_TREE: sourceTree,
        IMNOTA_FAULT_EXECUTABLE_SHA256: manifest.executableSha256,
        IMNOTA_FAULT_ASAR_SHA256: manifest.asarSha256,
        IMNOTA_FAULT_BUILD_MANIFEST: manifestPath,
        IMNOTA_FAULT_BUILD_SHA256: digest(serialized),
        IMNOTA_FAULT_SUPPLIED: supplied,
        IMNOTA_FAULT_SUPPLIED_SHA256: manifest.suppliedSha256,
        IMNOTA_FAULT_GRANT:
          process.env.IMNOTA_FAULT_GRANT ??
          (process.env.CI === 'true'
            ? `ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
            : ''),
      };
      const entry = { caseSet, passed: false };
      results.push(entry);
      console.log(`Native fault set starting: ${caseSet}`);
      const report = await runNativeVerification({
        packagedExecutable: file(executable),
        mode: 'faults',
        environment: env,
      });
      const proof = JSON.parse(
        readFileSync(join(artifacts, 'retained-run', '.imnota-native-fault-owned.json'), 'utf8'),
      );
      if (
        proof.caseSet !== caseSet ||
        proof.version !== version ||
        proof.sourceSha !== sourceSha ||
        proof.asarSha256 !== manifest.asarSha256 ||
        proof.executableSha256 !== manifest.executableSha256
      )
        throw new Error('Fault group candidate binding changed.');
      assertFaultReport(report, proof);
      for (const resultCase of report.faults.cases) {
        if (digest(readFileSync(join(artifacts, resultCase.caseId, 'case.json'))) !== resultCase.sha256)
          throw new Error('Fault case evidence is missing or changed.');
      }
      entry.passed = true;
      console.log(
        `Native fault set passed: ${caseSet}; cases: ${report.faults.cases.map((value) => value.caseId).join(', ')}`,
      );
    }
    assertFaultAggregate(results);
    complete = true;
  } finally {
    writeFileSync(
      join(root, 'aggregate.json'),
      JSON.stringify(
        {
          ...manifest,
          expected: faultCaseSets,
          results,
          passed: complete,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    writeFaultEvidenceManifest(root);
  }
}
