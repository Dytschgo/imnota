import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseEvidence } from './release-readiness.mjs';

const candidate = { sha: 'a'.repeat(40), version: '0.2.0' };

function validEvidence() {
  const platform = {
    package: { status: 'passed', evidence: 'CI package artifact URL' },
    installSmoke: { status: 'passed', evidence: 'Installed artifact smoke result' },
  };
  return {
    schemaVersion: 1,
    candidate: { ...candidate },
    featureChecks: [
      { name: 'Export changed behavior', status: 'passed', evidence: 'Targeted test and manual check' },
    ],
    platformChecks: { windows: platform, macos: platform, linux: platform },
    acceptance: {
      status: 'accepted',
      author: 'release-author',
      reviewer: 'independent-reviewer',
      rollbackAcknowledged: true,
      knownLimitationsAcknowledged: true,
    },
    rollback: { plan: 'Restore the prior stable installer and tell testers to reinstall it.' },
    knownLimitations: [],
  };
}

test('accepts complete evidence for the exact candidate', () => {
  assert.deepEqual(validateReleaseEvidence(validEvidence(), candidate), []);
});

test('rejects malformed evidence', () => {
  assert.match(validateReleaseEvidence(null, candidate).join('\n'), /JSON object/);
});

test('rejects stale candidate evidence', () => {
  const evidence = validEvidence();
  evidence.candidate.sha = 'b'.repeat(40);
  assert.match(validateReleaseEvidence(evidence, candidate).join('\n'), /exact release commit/);
});

test('rejects evidence for a different version or missing feature evidence', () => {
  const evidence = validEvidence();
  evidence.candidate.version = '0.1.0';
  evidence.featureChecks[0].evidence = ' ';
  const errors = validateReleaseEvidence(evidence, candidate).join('\n');
  assert.match(errors, /candidate.version/);
  assert.match(errors, /featureChecks/);
});

test('rejects missing platforms and invalid limitation records', () => {
  const evidence = validEvidence();
  delete evidence.platformChecks.linux;
  evidence.knownLimitations = [null];
  const errors = validateReleaseEvidence(evidence, candidate).join('\n');
  assert.match(errors, /platformChecks.linux/);
  assert.match(errors, /knownLimitations/);
});

test('rejects a failed platform check', () => {
  const evidence = validEvidence();
  evidence.platformChecks.windows.installSmoke.status = 'failed';
  assert.match(validateReleaseEvidence(evidence, candidate).join('\n'), /platformChecks.windows/);
});

test('rejects missing feature acceptance', () => {
  const evidence = validEvidence();
  delete evidence.acceptance;
  assert.match(validateReleaseEvidence(evidence, candidate).join('\n'), /acceptance/);
});

test('rejects missing acceptance acknowledgement and self-review', () => {
  const evidence = validEvidence();
  evidence.acceptance.reviewer = evidence.acceptance.author;
  delete evidence.acceptance.rollbackAcknowledged;
  assert.match(validateReleaseEvidence(evidence, candidate).join('\n'), /independent/);
  assert.match(validateReleaseEvidence(evidence, candidate).join('\n'), /rollbackAcknowledged/);
});
