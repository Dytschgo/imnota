import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  faultCaseSets,
  faultCases,
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
      assert.doesNotMatch(upload, /continue-on-error/);
      if (name === 'nightly') {
        assert.match(source, /needs: \[guard, quality, package\]/);
        assert.match(source, /pattern: nightly-\*/);
        assert.match(source, /draft: true/);
        assert.match(source, /make_latest: false/);
        assert.equal(source.split('IMNOTA_EXPECT_VERSION: ${{ needs.guard.outputs.version }}').length - 1, 6);
      }
    }
  });
});
