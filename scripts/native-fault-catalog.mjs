// Kept in sync with the compiled shared catalog by native-fault-contract.node.test.mjs.
export const faultCaseSets = Object.freeze([
  'restore-eio',
  'restore-eacces',
  'restore-eperm',
  'restore-confirmation',
  'restore-marker',
  'restore-later-change',
  'restore-renderer-readback',
  'recovery-lineage-eio',
  'recovery-lineage-eacces',
  'recovery-lineage-eperm',
  'recovery-repair',
  'recovery-ui',
]);
export function faultCases(set) {
  if (!faultCaseSets.includes(set)) throw new Error('Unknown native fault case set.');
  const kinds = ['screenshot', 'drawing', 'text'];
  if (set === 'restore-confirmation')
    return kinds.flatMap((kind) => ['changed', 'unreadable'].map((reason) => `${kind}-${reason}`));
  if (set.startsWith('restore-')) return kinds;
  if (set.startsWith('recovery-lineage-')) return ['healthy', 'foreign'];
  return set === 'recovery-repair'
    ? ['baseline-repair', 'failed-repair']
    : ['panel-retry-reset', 'undo-hover', 'undo-focus'];
}
export function assertFaultReport(report, proof) {
  const actual = report?.faults;
  if (
    report?.passed !== true ||
    report.mode !== 'faults' ||
    report.version !== proof.version ||
    actual?.caseSet !== proof.caseSet ||
    actual.nonce !== proof.nonce ||
    actual.disarmed !== true ||
    JSON.stringify(actual.cases?.map((value) => value.caseId)) !==
      JSON.stringify(faultCases(proof.caseSet)) ||
    actual.cases.some(
      (value) => value.passed !== true || value.disarmed !== true || !/^[a-f0-9]{64}$/.test(value.sha256),
    )
  )
    throw new Error('Incomplete or mismatched native fault evidence.');
}
export function assertFaultAggregate(results) {
  if (
    JSON.stringify(results.map((value) => value.caseSet)) !== JSON.stringify(faultCaseSets) ||
    results.some((value) => value.passed !== true)
  )
    throw new Error('Native fault case sets are missing, duplicated or failed.');
}
