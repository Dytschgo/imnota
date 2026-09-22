import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { assertNoLinks } from './files.js';
import {
  processTerminationObservation,
  type TerminationDetails,
  type TerminationMemorySources,
} from './process-termination-diagnostics.js';

const MAX_BYTES = 1_048_576;
const MAX_PENDING = 128;
const ERROR_CODES = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'EBUSY',
  'ENOSPC',
  'EIO',
  'EROFS',
  'EMFILE',
  'ENOTDIR',
]);

export function diagnosticErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && ERROR_CODES.has(code) ? code : 'operation-failed';
}

type Phase = 'begin' | 'complete' | 'failed' | 'observed';
type StorageStage =
  | 'idle'
  | 'queued'
  | 'directory'
  | 'retention'
  | 'inspect-log'
  | 'rotate'
  | 'open'
  | 'write'
  | 'sync'
  | 'close';
export interface DiagnosticsHealth {
  state: 'ready' | 'stalled' | 'failed';
  stage: StorageStage;
  pending: number;
  dropped: number;
  stalls: number;
  recoveries: number;
  lastFailure?: {
    reason: 'timeout' | 'io-error' | 'queue-full';
    stage: StorageStage;
    errorCode?: string;
  };
}
interface TraceEvent {
  category: 'operation' | 'filesystem' | 'integrity' | 'lifecycle';
  action: string;
  phase: Phase;
  target?: string;
  error?: unknown;
  count?: number;
  termination?: { details: TerminationDetails; memory: TerminationMemorySources };
}

/** Local, bounded operational evidence. Never serialize payloads, paths, messages or stacks. */
export class PersistenceDiagnostics {
  private readonly session = randomUUID();
  private readonly salt = randomBytes(32);
  private readonly prefix = `operations-${process.pid}-${this.session}`;
  private pruned = false;
  private readonly context = new AsyncLocalStorage<string>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private storageFailed = false;
  private stalledWrite?: symbol;
  private stage: StorageStage = 'idle';
  private dropped = 0;
  private stalls = 0;
  private recoveries = 0;
  private lastFailure?: DiagnosticsHealth['lastFailure'];

  health(): DiagnosticsHealth {
    return {
      state: this.storageFailed ? 'failed' : this.stalledWrite ? 'stalled' : 'ready',
      stage: this.stage,
      pending: this.pending,
      dropped: this.dropped,
      stalls: this.stalls,
      recoveries: this.recoveries,
      ...(this.lastFailure ? { lastFailure: { ...this.lastFailure } } : {}),
    };
  }

  retryStorage(): void {
    this.storageFailed = false;
    this.stalledWrite = undefined;
  }

  constructor(
    private readonly directory: () => string,
    private readonly application: { version: string; platform: string },
  ) {}

  async openDirectory(): Promise<string> {
    const directory = this.directory();
    await assertNoLinks(directory);
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }

  private async pruneInactiveSessions(directory: string): Promise<void> {
    const groups = new Map<string, Array<{ file: string; modified: number }>>();
    for (const name of await fs.readdir(directory)) {
      const match = /^(operations-(\d+)-[a-f0-9-]{36})(?:\.previous)?\.jsonl$/.exec(name);
      if (!match) continue;
      try {
        process.kill(Number(match[2]), 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
      }
      const file = path.join(directory, name);
      const stat = await fs.lstat(file).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      const group = groups.get(match[1]) ?? [];
      group.push({ file, modified: stat.mtimeMs });
      groups.set(match[1], group);
    }
    const inactive = [...groups.values()].sort(
      (left, right) =>
        Math.max(...right.map((file) => file.modified)) - Math.max(...left.map((file) => file.modified)),
    );
    for (const group of inactive.slice(4))
      for (const file of group) await fs.unlink(file.file).catch(() => undefined);
  }

  async record(event: TraceEvent): Promise<boolean> {
    if (this.storageFailed || this.stalledWrite || this.pending >= MAX_PENDING) {
      this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + 1);
      if (!this.storageFailed && !this.stalledWrite)
        this.lastFailure = { reason: 'queue-full', stage: 'queued' };
      return false;
    }
    const writeToken = Symbol();
    let writeStage: StorageStage = 'queued';
    let failureStage: StorageStage | undefined;
    const setStage = (stage: StorageStage) => {
      writeStage = stage;
      this.stage = stage;
    };
    const operationId = this.context.getStore();
    const line =
      JSON.stringify({
        schema: 1,
        time: new Date().toISOString(),
        session: this.session,
        version: this.application.version,
        platform: this.application.platform,
        operationId,
        category: event.category,
        action: /^[a-z0-9:-]{1,80}$/.test(event.action) ? event.action : 'unknown',
        phase: event.phase,
        ...(event.target
          ? {
              targetId: createHmac('sha256', this.salt)
                .update(
                  this.application.platform === 'win32'
                    ? path.resolve(event.target).toLowerCase()
                    : path.resolve(event.target),
                )
                .digest('hex')
                .slice(0, 24),
            }
          : {}),
        ...(event.error !== undefined ? { errorCode: diagnosticErrorCode(event.error) } : {}),
        ...(Number.isSafeInteger(event.count) && event.count! >= 0 ? { count: event.count } : {}),
        ...(event.termination
          ? {
              termination: processTerminationObservation(event.termination.details, event.termination.memory),
            }
          : {}),
      }) + '\n';
    this.pending++;
    let stored = false;
    const work = this.queue
      .then(async () => {
        setStage('directory');
        const directory = await this.openDirectory();
        if (!this.pruned) {
          setStage('retention');
          await this.pruneInactiveSessions(directory);
          this.pruned = true;
        }
        const current = path.join(directory, `${this.prefix}.jsonl`);
        const previous = path.join(directory, `${this.prefix}.previous.jsonl`);
        setStage('inspect-log');
        await assertNoLinks(current);
        const stat = await fs.stat(current).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if ((stat?.size ?? 0) + Buffer.byteLength(line) > MAX_BYTES) {
          setStage('rotate');
          await assertNoLinks(previous);
          await fs.unlink(previous).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
          if (stat) await fs.rename(current, previous);
        }
        setStage('open');
        const handle = await fs.open(current, 'a', 0o600);
        try {
          setStage('write');
          await handle.writeFile(line, 'utf8');
          setStage('sync');
          await handle.sync();
          stored = true;
        } catch (error) {
          failureStage = writeStage;
          throw error;
        } finally {
          setStage('close');
          await handle.close().catch((error: unknown) => {
            failureStage = 'close';
            throw error;
          });
        }
        // Only this accepted write can clear its timeout. A later I/O failure
        // remains latched, and no timed-out write is automatically retried.
        if (this.stalledWrite === writeToken) {
          this.stalledWrite = undefined;
          this.recoveries = Math.min(Number.MAX_SAFE_INTEGER, this.recoveries + 1);
        }
      })
      .catch((error: unknown) => {
        this.storageFailed = true;
        this.stalledWrite = undefined;
        this.lastFailure = {
          reason: 'io-error',
          stage: failureStage ?? writeStage,
          errorCode: diagnosticErrorCode(error),
        };
      })
      .finally(() => {
        this.pending--;
        this.stage = 'idle';
      });
    this.queue = work;
    // A broken diagnostics disk must not indefinitely block a save on another disk.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 1500);
        }),
      ]);
      if (!stored && !this.storageFailed) {
        this.stalledWrite = writeToken;
        this.stalls = Math.min(Number.MAX_SAFE_INTEGER, this.stalls + 1);
        this.lastFailure = { reason: 'timeout', stage: writeStage };
      }
      return stored;
    } finally {
      clearTimeout(timeout);
    }
  }

  async run<T>(action: string, operation: () => Promise<T> | T): Promise<T> {
    return this.context.run(randomUUID(), async () => {
      await this.record({ category: 'operation', action, phase: 'begin' });
      try {
        const result = await operation();
        const failure = result && typeof result === 'object' && 'ok' in result && result.ok === false;
        await this.record({ category: 'operation', action, phase: failure ? 'failed' : 'complete' });
        return result;
      } catch (error) {
        const recorded = await this.record({ category: 'operation', action, phase: 'failed', error });
        if (recorded && error instanceof Error) {
          try {
            error.message += ` [Diagnostic reference: ${this.context.getStore()}]`;
          } catch {
            /* Preserve frozen errors. */
          }
        }
        throw error;
      }
    });
  }

  async filesystem<T>(
    action: 'write' | 'copy' | 'unlink' | 'remove-directory' | 'trash',
    target: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.record({ category: 'filesystem', action, phase: 'begin', target });
    try {
      const result = await operation();
      await this.record({ category: 'filesystem', action, phase: 'complete', target });
      return result;
    } catch (error) {
      await this.record({ category: 'filesystem', action, phase: 'failed', target, error });
      throw error;
    }
  }
}

/** Exclude clipboard contents, hosted sharing, and per-keystroke read-only queries. */
export function tracesPersistenceChannel(channel: string): boolean {
  return /^(projects:(create|load|open-dialog|save|save-screenshot|update-metadata|set-archived|archive|delete|duplicate)|screenshots:|content:|collections:edit|recovery:|backups:|workflow:project-watch:(reload|cas)|workflow:capture:(region|repeat-last-region))/.test(
    channel,
  );
}
