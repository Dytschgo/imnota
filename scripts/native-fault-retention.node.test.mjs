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
import { randomUUID } from 'node:crypto';
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

it('detects hidden journal loss, byte changes and extra files after evidence transport', () => {
  const { proof } = fixture();
  const journal = join(proof.artifactRoot, '.imnota-undo');
  mkdirSync(journal);
  const member = join(journal, 'undo-before.bin');
  writeFileSync(member, 'foreign exact bytes');
  writeFileSync(join(proof.artifactRoot, '.ownership'), 'nonce');
  writeFaultEvidenceManifest(proof.artifactRoot);
  assert.equal(verifyFaultEvidenceManifest(proof.artifactRoot), 2);
  writeFileSync(member, 'changed exact bytes');
  assert.throws(() => verifyFaultEvidenceManifest(proof.artifactRoot), /manifest/);
  writeFileSync(member, 'foreign exact bytes');
  writeFileSync(join(proof.artifactRoot, 'extra'), 'unexpected');
  assert.throws(() => verifyFaultEvidenceManifest(proof.artifactRoot), /manifest/);
  rmSync(join(proof.artifactRoot, 'extra'));
  rmSync(member);
  assert.throws(() => verifyFaultEvidenceManifest(proof.artifactRoot), /manifest/);
});
