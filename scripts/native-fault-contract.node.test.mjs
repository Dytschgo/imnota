import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import {
  faultCaseSets,
  faultCases,
  faultCaseErrno,
  assertFaultCaseEvidence,
  assertFaultReport,
  assertFaultAggregate,
} from './native-fault-catalog.mjs';
import { normalizeNativeVerificationMode } from './smoke-process.mjs';

describe('closed packaged native fault gate', () => {
  it('has a single ordered finite catalog and rejects partial or duplicate aggregates', () => {
    const shared = readFileSync(new URL('../src/shared/native-faults.ts', import.meta.url), 'utf8');
    const declaration = shared.slice(shared.indexOf('NATIVE_FAULT_CASE_SETS'), shared.indexOf('] as const;'));
    assert.deepEqual(
      [...declaration.matchAll(/'([^']+)'/g)].map((value) => value[1]),
      faultCaseSets,
    );
    assert.equal(normalizeNativeVerificationMode('faults'), 'faults');
    assert.throws(() => faultCases('arbitrary-plan'));
    const results = faultCaseSets.map((caseSet) => ({ caseSet, passed: true }));
    assert.doesNotThrow(() => assertFaultAggregate(results));
    assert.throws(() => assertFaultAggregate(results.slice(1)));
    assert.throws(() => assertFaultAggregate([...results, results[0]]));
    assert.throws(() =>
      assertFaultAggregate(results.map((value, i) => (i ? value : { ...value, passed: false }))),
    );
    // The retired per-errno launches are not accepted in place of their combined set.
    assert.throws(() => faultCases('restore-eio'));
    assert.throws(() => faultCases('recovery-lineage-eperm'));
    assert.throws(() =>
      assertFaultAggregate([
        ...['restore-eio', 'restore-eacces', 'restore-eperm'].map((caseSet) => ({ caseSet, passed: true })),
        ...results.slice(1),
      ]),
    );
  });
  it('keeps every errno x scenario case distinct inside the combined launches', () => {
    assert.equal(faultCaseSets.length, 8);
    assert.equal(faultCaseSets.flatMap((caseSet) => faultCases(caseSet)).length, 35);
    for (const [caseSet, scenarios] of [
      ['restore-errno', ['screenshot', 'drawing', 'text']],
      ['recovery-lineage-errno', ['healthy', 'foreign']],
    ]) {
      const cases = faultCases(caseSet);
      assert.equal(new Set(cases).size, cases.length);
      assert.deepEqual(
        cases,
        ['eio', 'eacces', 'eperm'].flatMap((errno) => scenarios.map((scenario) => `${scenario}-${errno}`)),
      );
      for (const caseId of cases)
        assert.equal(faultCaseErrno(caseSet, caseId), caseId.split('-').at(-1).toUpperCase());
    }
    assert.equal(faultCaseErrno('restore-marker', 'text'), undefined);
    assert.throws(() => faultCaseErrno('restore-errno', 'text'));
  });
  it('accepts case evidence only with one arm, one disarm and its own errno injections', () => {
    const evidence = (caseSet, caseId, events) => ({
      passed: true,
      caseSet,
      caseId,
      disarmed: true,
      events,
    });
    const armed = (caseId, errno) => ({ event: 'armed', caseId, errno });
    const injected = (caseId, errno) => ({ event: 'injected', caseId, errno });
    const disarmed = { event: 'disarmed', consumed: ['metadata'] };
    const valid = [armed('drawing-eacces', 'EACCES'), injected('drawing-eacces', 'EACCES'), disarmed];
    assert.doesNotThrow(() =>
      assertFaultCaseEvidence(
        'restore-errno',
        'drawing-eacces',
        evidence('restore-errno', 'drawing-eacces', valid),
      ),
    );
    for (const [label, caseId, events, overrides] of [
      ['wrong errno', 'drawing-eacces', [valid[0], injected('drawing-eacces', 'EIO'), disarmed]],
      ['leaked case', 'drawing-eacces', [valid[0], injected('screenshot-eacces', 'EACCES'), disarmed]],
      ['no injection', 'drawing-eacces', [valid[0], disarmed]],
      ['armed errno', 'drawing-eacces', [armed('drawing-eacces', 'EPERM'), valid[1], disarmed]],
      ['missing arm', 'drawing-eacces', [valid[1], disarmed]],
      ['missing disarm', 'drawing-eacces', valid.slice(0, 2)],
      ['double arm', 'drawing-eacces', [valid[0], ...valid]],
      ['injection after disarm', 'drawing-eacces', [valid[0], disarmed, valid[1]]],
      ['other case evidence', 'text-eacces', valid],
      ['failed', 'drawing-eacces', valid, { passed: false }],
      ['not disarmed', 'drawing-eacces', valid, { disarmed: false }],
      ['wrong set', 'drawing-eacces', valid, { caseSet: 'restore-marker' }],
    ])
      assert.throws(
        () =>
          assertFaultCaseEvidence('restore-errno', caseId, {
            ...evidence('restore-errno', 'drawing-eacces', events),
            ...overrides,
          }),
        /own armed/,
        label,
      );
    // Fixed-errno scenarios keep their designed codes and may finish without an injection.
    assert.doesNotThrow(() =>
      assertFaultCaseEvidence(
        'restore-marker',
        'text',
        evidence('restore-marker', 'text', [
          armed('text', 'EIO'),
          injected('text', 'EIO'),
          injected('text', 'EACCES'),
          disarmed,
        ]),
      ),
    );
    assert.doesNotThrow(() =>
      assertFaultCaseEvidence(
        'restore-later-change',
        'text',
        evidence('restore-later-change', 'text', [armed('text', 'EIO'), disarmed]),
      ),
    );
  });
  it('requires every case, exact nonce/version and disarm before accepting a child result', () => {
    for (const caseSet of faultCaseSets) {
      const proof = { caseSet, nonce: 'owned', version: 'candidate' };
      const report = {
        passed: true,
        mode: 'faults',
        version: proof.version,
        faults: {
          ...proof,
          disarmed: true,
          cases: faultCases(caseSet).map((caseId) => ({
            caseId,
            passed: true,
            disarmed: true,
            sha256: 'a'.repeat(64),
          })),
        },
      };
      assert.doesNotThrow(() => assertFaultReport(report, proof));
      assert.throws(() => assertFaultReport(report, { ...proof, nonce: 'foreign' }));
      assert.throws(() =>
        assertFaultReport({ ...report, faults: { ...report.faults, disarmed: false } }, proof),
      );
      assert.throws(() =>
        assertFaultReport(
          { ...report, faults: { ...report.faults, cases: report.faults.cases.slice(1) } },
          proof,
        ),
      );
    }
  });
  it('keeps all three package workflows gated with separate always-uploaded fault evidence', () => {
    for (const name of ['ci', 'nightly', 'release']) {
      const source = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
      for (const command of [
        'bash scripts/verify-mac.sh --faults',
        'node scripts/verify-packaged.mjs windows --faults',
        'xvfb-run --auto-servernum node scripts/verify-packaged.mjs linux --faults',
      ])
        assert.equal(source.split(`run: ${command}`).length - 1, 1);
      const upload = source
        .slice(source.indexOf('- name: Retain native fault evidence'))
        .split('\n      - ')
        .at(0);
      assert.match(upload, /always\(\)/);
      assert.match(upload, /name: native-fault-evidence-/);
      assert.match(upload, /if-no-files-found: error/);
      assert.match(upload, /include-hidden-files: true/);
      assert.match(source, /node scripts\/smoke\.mjs --verify-fault-evidence/);
      assert.match(source, /name: Download native fault evidence for manifest verification/);
      assert.doesNotMatch(upload, /continue-on-error/);
      const packageJob = load(source).jobs.package;
      const download = packageJob.steps.find(
        (step) => step.name === 'Download native fault evidence for manifest verification',
      );
      const firstDownload = packageJob.steps.find(
        (step) => step.name === 'Download native fault evidence (first attempt)',
      );
      const verify = packageJob.steps.find(
        (step) => step.name === 'Verify downloaded native fault evidence manifest',
      );
      assert.equal(packageJob.permissions.actions, 'read');
      assert.equal(packageJob.permissions.contents, 'read');
      assert.equal(download.with['artifact-ids'], '${{ steps.native_fault_upload.outputs.artifact-id }}');
      // Same-job evidence must use the current-run artifact service, not REST publication lookup.
      assert.equal(download.with['github-token'], undefined);
      assert.equal(download.with['run-id'], undefined);
      assert.equal(download.with.repository, undefined);
      assert.equal(download.with.name, undefined);
      assert.equal(download.id, 'native_fault_download');
      // Only the first attempt may fail softly; the retry runs exactly when it failed, and it
      // and the manifest check fail the job.
      assert.equal(firstDownload.id, 'native_fault_download_first');
      assert.equal(firstDownload['continue-on-error'], true);
      assert.equal(firstDownload.uses, download.uses);
      assert.equal(firstDownload.with['artifact-ids'], download.with['artifact-ids']);
      assert.equal(firstDownload.with.path, download.with.path);
      assert.equal(firstDownload.with['github-token'], undefined);
      assert.equal(firstDownload.with['run-id'], undefined);
      assert.equal(download.if, "always() && steps.native_fault_download_first.outcome == 'failure'");
      assert.equal(
        verify.if,
        "always() && (steps.native_fault_download_first.outcome == 'success' || steps.native_fault_download.outcome == 'success')",
      );
      assert.notEqual(download['continue-on-error'], true);
      assert.notEqual(verify['continue-on-error'], true);
      if (name === 'nightly') {
        assert.match(source, /needs: \[guard, quality, package\]/);
        assert.match(source, /pattern: nightly-\*/);
        assert.match(source, /draft: true/);
        assert.match(source, /make_latest: false/);
        const workflow = load(source);
        const steps = workflow.jobs.package.steps;
        for (const platform of ['macos', 'windows', 'linux']) {
          const step = steps.find((value) => value.name === `Verify packaged native faults on ${platform}`);
          assert.equal(step.env.IMNOTA_EXPECT_VERSION, '${{ needs.guard.outputs.version }}');
        }
      }
    }
  });
});
