/** Electron invoke preserves error messages, but not custom Error properties. */
export const COMMITTED_WRITE_WARNING =
  'File replacement completed, but power-loss durability could not be confirmed.';
export function isCommittedWriteWarning(error: unknown): boolean {
  return error instanceof Error && error.message.includes(COMMITTED_WRITE_WARNING);
}

export const RESTORE_CONFIRMATION_FAILURE = 'Restore could not be confirmed:';
export function isUnconfirmedRestore(error: unknown): boolean {
  return (
    isCommittedWriteWarning(error) ||
    (error instanceof Error && error.message.includes(RESTORE_CONFIRMATION_FAILURE))
  );
}
