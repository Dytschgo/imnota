const IPC_WRAPPER = /^Error invoking remote method '[^']+':\s*/i;
const ERROR_PREFIX = /^(?:Error(?:[.:]\s*|\s+))+/i;

/**
 * Removes Electron's IPC wrapper and repeated `Error:` prefixes so a failure reads as the
 * recovery instruction the main process wrote, not as a channel name.
 */
export function userFacingErrorMessage(
  message: string,
  fallback = 'Something went wrong. Try again.',
): string {
  return message.replace(IPC_WRAPPER, '').replace(ERROR_PREFIX, '') || fallback;
}

const DIAGNOSTIC_REFERENCE = /\s*\[Diagnostic reference: ([^\]]+)\]$/;

/** Separates a trailing main-process diagnostic reference from the instruction before it. */
export function splitDiagnosticReference(message: string): { text: string; reference?: string } {
  const match = DIAGNOSTIC_REFERENCE.exec(message);
  return match ? { text: message.slice(0, match.index), reference: match[1] } : { text: message };
}

/** The user-facing message for a caught value, or `fallback` when it carries none. */
export function reasonMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? userFacingErrorMessage(reason.message, fallback) : fallback;
}
