export type CaptureAdmissionAssertion = () => void | Promise<void>;

/** Revoke a capture immediately after any asynchronous read that precedes a write. */
export async function readWithCaptureAdmission<T>(
  read: () => Promise<T>,
  assertAdmission: CaptureAdmissionAssertion,
): Promise<T> {
  const value = await read();
  await assertAdmission();
  return value;
}

/** Used by the transaction helper before staging and immediately before commit. */
export async function assertCaptureCommitAdmission(
  assertAdmission: CaptureAdmissionAssertion,
  assertBaseline: () => Promise<void>,
): Promise<void> {
  await assertAdmission();
  await assertBaseline();
  await assertAdmission();
}
