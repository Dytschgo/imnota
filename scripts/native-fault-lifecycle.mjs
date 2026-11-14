import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { faultCases } from './native-fault-catalog.mjs';

/** Replay bounded, candidate-bound receipts after observed exit, including a failed case's start. */
export function logFaultLifecycle(proof, complete, log = console.log) {
  const filename = join(proof.artifactRoot, 'case-lifecycle.jsonl');
  let stat;
  try {
    stat = lstatSync(filename);
  } catch (error) {
    if (error.code === 'ENOENT' && !complete) return;
    throw error;
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 65536 ||
    realpathSync.native(filename) !== resolve(filename)
  )
    throw new Error('Unsafe native fault lifecycle receipt.');
  const source = readFileSync(filename, 'utf8');
  if (source && !source.endsWith('\n')) throw new Error('Incomplete native fault lifecycle receipt.');
  const receipts = source
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const expected = faultCases(proof.caseSet).flatMap((caseId) =>
    ['starting', 'passed'].map((phase) => ({ caseId, phase })),
  );
  if (receipts.length > expected.length || (complete && receipts.length !== expected.length))
    throw new Error('Missing or extra native fault lifecycle receipts.');
  receipts.forEach((receipt, index) => {
    const entry = expected[index];
    if (
      receipt.nonce !== proof.nonce ||
      receipt.sourceSha !== proof.sourceSha ||
      receipt.caseSet !== proof.caseSet ||
      receipt.caseId !== entry.caseId ||
      receipt.phase !== entry.phase
    )
      throw new Error('Foreign or out-of-order native fault lifecycle receipt.');
  });
  // Validate the entire sequence before publishing any line as evidence.
  for (const receipt of receipts)
    log(`Native fault case ${receipt.phase}: ${receipt.caseSet}/${receipt.caseId}`);
}
