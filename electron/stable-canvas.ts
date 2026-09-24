export async function waitForStableCanvasSample<T>(
  sample: () => Promise<T | null>,
  wait: (ms: number) => Promise<void>,
  timeoutMs = 10_000,
  stableMs = 400,
): Promise<T> {
  const started = Date.now();
  let previous = '';
  let unchangedSince = started;
  while (Date.now() - started < timeoutMs) {
    const current = await sample();
    if (current === null) {
      previous = '';
      unchangedSince = Date.now();
    } else {
      const serialized = JSON.stringify(current);
      if (serialized !== previous) {
        previous = serialized;
        unchangedSince = Date.now();
      } else if (Date.now() - unchangedSince >= stableMs) {
        return current;
      }
    }
    await wait(50);
  }
  throw new Error('Canvas layout did not settle before native interaction.');
}
