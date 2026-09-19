import { readWindowsClipboardFiles } from './windows-clipboard.js';

interface SmokeClipboardReadOptions {
  timeoutMs?: number;
  now?: () => number;
  yieldControl?: () => Promise<void>;
  readFiles?: (owner: Buffer) => string[];
  log?: (message: string) => void;
}

function busyCode(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^Windows clipboard is busy \((\d+)\)\.$/.exec(message);
  return match ? Number(match[1]) : undefined;
}

/** Smoke-only state wait: yields solely after OpenClipboard explicitly reports busy. */
export async function readWindowsClipboardFilesForSmoke(
  owner: Buffer,
  context: string,
  options: SmokeClipboardReadOptions = {},
): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const now = options.now ?? Date.now;
  const yieldControl = options.yieldControl ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  const readFiles = options.readFiles ?? readWindowsClipboardFiles;
  const log = options.log ?? console.info;
  const started = now();
  let busyChecks = 0;
  while (true) {
    try {
      const files = readFiles(owner);
      if (busyChecks) {
        log(
          `${context}: Windows clipboard became available after ${busyChecks} busy checks over ${now() - started}ms.`,
        );
      }
      return files;
    } catch (error) {
      const nativeCode = busyCode(error);
      if (nativeCode === undefined) throw error;
      busyChecks += 1;
      const elapsed = now() - started;
      if (elapsed >= timeoutMs) {
        throw new Error(
          `${context}: Windows clipboard remained busy after ${busyChecks} availability checks over ${elapsed}ms (${nativeCode}).`,
          { cause: error },
        );
      }
      await yieldControl();
    }
  }
}
