/**
 * Write queues and journals are per process, so two interactive instances sharing one
 * profile could interleave writes to the same project. Only the interactive application
 * takes the single-instance lock:
 *
 * - `--mcp` is a short-lived stdio server that an editor spawns while Imnota may already
 *   be open. It must neither be refused nor raise the running window.
 * - Smoke and packaged verification run with an isolated, disposable profile and may run
 *   beside an installed instance. Their profile is never shared, so they take no lock.
 */
export function requiresSingleInstanceLock(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env.IMNOTA_SMOKE === '1') return false;
  return !argv.includes('--mcp');
}
