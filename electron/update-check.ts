/** Coalesce refresh clicks; always release the lock after a failed/offline request. */
export function createUpdateCheck(check: () => Promise<unknown>, reportError: () => void) {
  let pending: Promise<void> | null = null;
  return () => {
    if (!pending)
      pending = Promise.resolve()
        .then(check)
        .then(() => undefined)
        .catch(reportError)
        .finally(() => {
          pending = null;
        });
    return pending;
  };
}
