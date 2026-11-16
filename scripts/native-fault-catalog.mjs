// Kept in sync with the compiled shared catalog by native-fault-contract.node.test.mjs
// (set names) and electron/native-fault-catalog-sync.test.ts (case IDs and errnos).
export const faultCaseSets = Object.freeze([
  'restore-errno',
  'restore-confirmation',
  'restore-marker',
  'restore-later-change',
  'restore-renderer-readback',
  'recovery-lineage-errno',
  'recovery-repair',
  'recovery-ui',
]);
const errnoFamilies = Object.freeze(['restore-errno', 'recovery-lineage-errno']);
const errnos = Object.freeze(['eio', 'eacces', 'eperm']);
export function faultCases(set) {
  if (!faultCaseSets.includes(set)) throw new Error('Unknown native fault case set.');
  const kinds = ['screenshot', 'drawing', 'text'];
  if (set === 'restore-errno') return errnos.flatMap((errno) => kinds.map((kind) => `${kind}-${errno}`));
  if (set === 'recovery-lineage-errno')
    return errnos.flatMap((errno) => ['healthy', 'foreign'].map((lineage) => `${lineage}-${errno}`));
  if (set === 'restore-confirmation')
    return kinds.flatMap((kind) => ['changed', 'unreadable'].map((reason) => `${kind}-${reason}`));
  if (set.startsWith('restore-')) return kinds;
  return set === 'recovery-repair'
    ? ['baseline-repair', 'failed-repair']
    : ['panel-retry-reset', 'undo-hover', 'undo-focus'];
}
/** The errno an errno-family case must inject, or undefined for fixed-errno scenarios. */
export function faultCaseErrno(set, caseId) {
  if (!faultCases(set).includes(caseId)) throw new Error('Unknown native fault case.');
  return errnoFamilies.includes(set) ? caseId.slice(caseId.lastIndexOf('-') + 1).toUpperCase() : undefined;
}
/**
 * Checks one hash-verified case.json: exactly one arm and one disarm for this case, and
 * every injected fault between them belongs to this case. Errno-family cases must inject
 * at least one fault, all with their own errno, so a combined launch cannot leak or omit one.
 */
export function assertFaultCaseEvidence(set, caseId, evidence) {
  const errno = faultCaseErrno(set, caseId);
  const events = Array.isArray(evidence?.events) ? evidence.events : [];
  const indexes = (name) => events.flatMap((event, index) => (event?.event === name ? [index] : []));
  const armed = indexes('armed');
  const disarmed = indexes('disarmed');
  const injected = indexes('injected');
  if (
    evidence?.passed !== true ||
    evidence.caseSet !== set ||
    evidence.caseId !== caseId ||
    evidence.disarmed !== true ||
    armed.length !== 1 ||
    disarmed.length !== 1 ||
    events[armed[0]].caseId !== caseId ||
    (errno !== undefined && events[armed[0]].errno !== errno) ||
    injected.some(
      (index) =>
        index < armed[0] ||
        index > disarmed[0] ||
        events[index].caseId !== caseId ||
        (errno !== undefined && events[index].errno !== errno),
    ) ||
    (errno !== undefined && injected.length === 0)
  )
    throw new Error('Native fault case evidence does not prove its own armed and disarmed fault.');
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
