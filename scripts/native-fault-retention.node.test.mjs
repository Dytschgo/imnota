import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runWalkthroughChild } from './walkthrough-child.mjs';
import { logFaultLifecycle } from './native-fault-lifecycle.mjs';
import { faultCaseSets, faultCases, faultCaseErrno } from './native-fault-catalog.mjs';
import {
  retainFaultOperands,
  writeFaultEvidenceManifest,
  verifyFaultEvidenceManifest,
} from './native-fault-retention.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(dirname(root), realpathSync.native(tmpdir()));
    assert.match(basename(root), /^imnota-(?:smoke|native-fault-retain)/);
    rmSync(root, { recursive: true });
  }
});
function fixture() {
  const runRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'imnota-smoke-result-')));
  const fixtureRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'imnota-smoke-')));
  const artifactRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'imnota-native-fault-retain-')));
  roots.push(runRoot, fixtureRoot, artifactRoot);
  const proof = { runRoot, artifactRoot, profileRoot: join(runRoot, 'profile'), nonce: randomUUID() };
  mkdirSync(proof.profileRoot);
  writeFileSync(join(proof.profileRoot, 'synthetic-pending.json'), '{"draft":"retain"}');
  writeFileSync(join(runRoot, '.imnota-native-fault-owned.json'), JSON.stringify(proof));
  writeFileSync(
    join(runRoot, 'fault-session.json'),
    JSON.stringify({ nonce: proof.nonce, fixture: fixtureRoot }),
  );
  writeFileSync(
    join(fixtureRoot, '.imnota-native-fault-fixture.json'),
    JSON.stringify({ nonce: proof.nonce }),
  );
  writeFileSync(join(fixtureRoot, 'undo-after.bin'), 'exact synthetic candidate');
  return { proof, fixtureRoot };
}
function completeEvidence(root) {
  const version = '0.5.0';
  for (const caseSet of faultCaseSets) {
    const group = join(root, `imnota-verification-artifacts-${caseSet}`);
    const retained = join(group, 'retained-run');
    mkdirSync(retained, { recursive: true });
    const proof = { caseSet, version, nonce: randomUUID() };
    writeFileSync(join(retained, '.imnota-native-fault-owned.json'), JSON.stringify(proof));
    const cases = faultCases(caseSet).map((caseId) => {
      const evidence = JSON.stringify({
        caseSet,
        caseId,
        passed: true,
        disarmed: true,
        events: ['armed', 'injected', 'disarmed'].map((event) => ({
          event,
          caseId,
          errno: faultCaseErrno(caseSet, caseId),
        })),
      });
      mkdirSync(join(group, caseId));
      writeFileSync(join(group, caseId, 'case.json'), evidence);
      return {
        caseId,
        passed: true,
        disarmed: true,
        sha256: createHash('sha256').update(evidence).digest('hex'),
      };
    });
    writeFileSync(
      join(retained, 'result.json'),
      JSON.stringify({
        passed: true,
        mode: 'faults',
        version,
        faults: { caseSet, nonce: proof.nonce, disarmed: true, cases },
      }),
    );
  }
  writeFileSync(
    join(root, 'aggregate.json'),
    JSON.stringify({
      schemaVersion: 1,
      version,
      passed: true,
      expected: faultCaseSets,
      results: faultCaseSets.map((caseSet) => ({ caseSet, passed: true })),
    }),
  );
}
function rewriteJson(file, update) {
  writeFileSync(file, JSON.stringify(update(JSON.parse(readFileSync(file, 'utf8')))));
}

it('retains original operands and captures them even when result and screenshot are missing', () => {
  const { proof, fixtureRoot } = fixture();
  retainFaultOperands(proof, { code: 1, pid: 123, signal: null });
  assert.equal(
    readFileSync(join(proof.artifactRoot, 'retained-fixture', 'undo-after.bin'), 'utf8'),
    'exact synthetic candidate',
  );
  assert.equal(
    readFileSync(join(proof.artifactRoot, 'retained-run', 'profile', 'synthetic-pending.json'), 'utf8'),
    '{"draft":"retain"}',
  );
  assert.ok(existsSync(join(fixtureRoot, 'undo-after.bin')));
  assert.ok(existsSync(proof.profileRoot));
});
it('refuses a foreign fixture marker and linked operands without following or deleting them', () => {
  const { proof, fixtureRoot } = fixture();
  writeFileSync(
    join(fixtureRoot, '.imnota-native-fault-fixture.json'),
    JSON.stringify({ nonce: randomUUID() }),
  );
  assert.throws(() => retainFaultOperands(proof, { code: 1 }), /nonce/);
  assert.ok(existsSync(join(fixtureRoot, 'undo-after.bin')));
  writeFileSync(
    join(fixtureRoot, '.imnota-native-fault-fixture.json'),
    JSON.stringify({ nonce: proof.nonce }),
  );
  symlinkSync(
    fixtureRoot,
    join(proof.profileRoot, 'alias'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => retainFaultOperands(proof, { code: 1 }), /indirect/);
  assert.ok(existsSync(join(fixtureRoot, 'undo-after.bin')));
});
it('does not capture or clean a run whose child exit has not been observed', () => {
  const { proof } = fixture();
  retainFaultOperands(proof, undefined);
  assert.ok(existsSync(proof.profileRoot));
  assert.equal(existsSync(join(proof.artifactRoot, 'retained-run')), false);
});

it('retains the early receipt and pending profile after a timed-out child actually exits', async () => {
  const { proof } = fixture();
  await assert.rejects(
    runWalkthroughChild(process.execPath, ['--eval', 'setInterval(() => {}, 60000)'], {
      timeoutMs: 100,
      windowsHide: true,
    }),
    (error) => {
      assert.match(error.message, /exceeded/);
      assert.ok(error.nativeChildOutcome?.pid > 0, 'observed exit must carry child identity');
      assert.equal(error.nativeChildOutcome.timedOut, true);
      assert.throws(() => process.kill(error.nativeChildOutcome.pid, 0), { code: 'ESRCH' });
      retainFaultOperands(proof, error.nativeChildOutcome);
      assert.equal(
        readFileSync(join(proof.artifactRoot, 'retained-run', 'profile', 'synthetic-pending.json'), 'utf8'),
        '{"draft":"retain"}',
      );
      assert.ok(existsSync(join(proof.artifactRoot, 'retained-run', 'fault-session.json')));
      return true;
    },
  );
});

it('detects hidden journal loss, byte changes and extra files after evidence transport', () => {
  const { proof } = fixture();
  completeEvidence(proof.artifactRoot);
  const journal = join(proof.artifactRoot, '.imnota-undo');
  mkdirSync(journal);
  const member = join(journal, 'undo-before.bin');
  writeFileSync(member, 'foreign exact bytes');
  writeFileSync(join(proof.artifactRoot, '.ownership'), 'nonce');
  writeFaultEvidenceManifest(proof.artifactRoot);
  assert.ok(verifyFaultEvidenceManifest(proof.artifactRoot) > 2);
  writeFileSync(member, 'changed exact bytes');
  assert.throws(() => verifyFaultEvidenceManifest(proof.artifactRoot), /manifest/);
  writeFileSync(member, 'foreign exact bytes');
  writeFileSync(join(proof.artifactRoot, 'extra'), 'unexpected');
  assert.throws(() => verifyFaultEvidenceManifest(proof.artifactRoot), /manifest/);
  rmSync(join(proof.artifactRoot, 'extra'));
  rmSync(member);
  assert.throws(() => verifyFaultEvidenceManifest(proof.artifactRoot), /manifest/);
});

const firstSet = faultCaseSets[0];
const firstGroup = (root) => join(root, `imnota-verification-artifacts-${firstSet}`);
const changeAggregate = (root, update) => rewriteJson(join(root, 'aggregate.json'), update);
const changeReport = (root, update) =>
  rewriteJson(join(firstGroup(root), 'retained-run', 'result.json'), update);
for (const [label, corrupt] of [
  ['missing aggregate', (root) => rmSync(join(root, 'aggregate.json'))],
  ['unfinished run', (root) => changeAggregate(root, (value) => ({ ...value, passed: false }))],
  [
    'missing set',
    (root) => changeAggregate(root, (value) => ({ ...value, results: value.results.slice(1) })),
  ],
  [
    'duplicated set',
    (root) => changeAggregate(root, (value) => ({ ...value, results: [...value.results, value.results[0]] })),
  ],
  [
    'failed set',
    (root) =>
      changeAggregate(root, (value) => ({
        ...value,
        results: value.results.map((entry, index) => (index ? entry : { ...entry, passed: false })),
      })),
  ],
  [
    'retired catalog',
    (root) =>
      changeAggregate(root, (value) => ({ ...value, expected: ['restore-eio', ...value.expected.slice(1)] })),
  ],
  [
    'retired result',
    (root) =>
      changeAggregate(root, (value) => ({
        ...value,
        results: [{ caseSet: 'restore-eio', passed: true }, ...value.results.slice(1)],
      })),
  ],
  ['missing set directory', (root) => rmSync(firstGroup(root), { recursive: true })],
  ['retired set directory', (root) => mkdirSync(join(root, 'imnota-verification-artifacts-restore-eio'))],
  ['failed set report', (root) => changeReport(root, (value) => ({ ...value, passed: false }))],
  [
    'duplicated report cases',
    (root) =>
      changeReport(root, (value) => ({
        ...value,
        faults: { ...value.faults, cases: [...value.faults.cases, value.faults.cases[0]] },
      })),
  ],
  [
    'failed report case',
    (root) =>
      changeReport(root, (value) => ({
        ...value,
        faults: {
          ...value.faults,
          cases: value.faults.cases.map((entry, index) => (index ? entry : { ...entry, passed: false })),
        },
      })),
  ],
  [
    'mismatched run version',
    (root) => changeAggregate(root, (value) => ({ ...value, version: 'foreign-version' })),
  ],
  [
    'mismatched set proof',
    (root) =>
      rewriteJson(join(firstGroup(root), 'retained-run', '.imnota-native-fault-owned.json'), (value) => ({
        ...value,
        caseSet: faultCaseSets[1],
      })),
  ],
  [
    'missing report case',
    (root) =>
      changeReport(root, (value) => ({
        ...value,
        faults: { ...value.faults, cases: value.faults.cases.slice(1) },
      })),
  ],
  [
    'case hash mismatch',
    (root) =>
      rewriteJson(join(firstGroup(root), faultCases(firstSet)[0], 'case.json'), (value) => ({
        ...value,
        passed: false,
      })),
  ],
  [
    'rehashed wrong fault errno',
    (root) => {
      const file = join(firstGroup(root), faultCases(firstSet)[0], 'case.json');
      rewriteJson(file, (value) => ({
        ...value,
        events: value.events.map((event) =>
          event.event === 'injected' ? { ...event, errno: 'EXDEV' } : event,
        ),
      }));
      const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
      changeReport(root, (value) => ({
        ...value,
        faults: {
          ...value.faults,
          cases: value.faults.cases.map((entry, index) => (index ? entry : { ...entry, sha256 })),
        },
      }));
    },
  ],
  ['missing case evidence', (root) => rmSync(join(firstGroup(root), faultCases(firstSet)[0], 'case.json'))],
]) {
  it(`rejects hash-valid downloaded evidence with ${label}`, () => {
    const { proof } = fixture();
    completeEvidence(proof.artifactRoot);
    corrupt(proof.artifactRoot);
    // Seal the already incomplete run: transport integrity alone must not pass it.
    writeFaultEvidenceManifest(proof.artifactRoot);
    assert.throws(() => verifyFaultEvidenceManifest(proof.artifactRoot));
  });
}

it('surfaces candidate-bound case starts on failure and rejects forged or incomplete success logs', () => {
  const { proof } = fixture();
  Object.assign(proof, { caseSet: 'restore-errno', sourceSha: 'a'.repeat(40) });
  const filename = join(proof.artifactRoot, 'case-lifecycle.jsonl');
  const receipts = faultCases('restore-errno').flatMap((caseId) =>
    ['starting', 'passed'].map((phase) => ({
      nonce: proof.nonce,
      sourceSha: proof.sourceSha,
      caseSet: proof.caseSet,
      caseId,
      phase,
    })),
  );
  const write = (values) =>
    writeFileSync(filename, values.map((value) => JSON.stringify(value) + '\n').join(''));
  write(receipts.slice(0, 1));
  const failedLines = [];
  logFaultLifecycle(proof, false, (line) => failedLines.push(line));
  assert.deepEqual(failedLines, ['Native fault case starting: restore-errno/screenshot-eio']);
  assert.throws(() => logFaultLifecycle(proof, true), /Missing/);
  write(receipts);
  const lines = [];
  logFaultLifecycle(proof, true, (line) => lines.push(line));
  assert.equal(lines.length, 18);
  assert.equal(lines.at(-1), 'Native fault case passed: restore-errno/text-eperm');
  for (const invalid of [
    receipts.map((entry) => ({ ...entry, nonce: 'foreign' })),
    receipts.map((entry) => ({ ...entry, sourceSha: 'b'.repeat(40) })),
    [receipts[1], receipts[0], ...receipts.slice(2)],
    [...receipts, receipts[0]],
    // One errno variant missing from the combined launch.
    receipts.filter((entry) => entry.caseId !== 'drawing-eacces'),
  ]) {
    write(invalid);
    const rejectedLines = [];
    assert.throws(() => logFaultLifecycle(proof, true, (line) => rejectedLines.push(line)));
    assert.deepEqual(rejectedLines, []);
  }
});
