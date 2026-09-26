import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { workflowOutcome } from './workflow-errors.js';

/**
 * Listeners declare the argument types their channel contract guarantees. The router
 * validates against that contract before calling them, as `ipcMain.handle` listeners did.
 */
type Listener = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

export interface IpcRouterOptions {
  register(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
  /** Only the current main window's top frame may call the application bridge. */
  trustedSender(event: IpcMainInvokeEvent): boolean;
  updateInstallPending(): boolean;
  /** Argument contracts by channel. Channels without one accept a single project path. */
  contracts: Readonly<Record<string, z.ZodType<unknown[]>>>;
  defaultContract: z.ZodType<unknown[]>;
  tracesChannel(channel: string): boolean;
  trace<T>(channel: string, run: () => T | Promise<T>): Promise<T>;
}

const UPDATE_PENDING = 'Imnota is restarting to install an update.';

/**
 * Registers renderer IPC handlers behind one trust check, argument validation and a
 * single serial queue, so concurrent read/modify/write handlers cannot lose updates.
 */
export class IpcRouter {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: IpcRouterOptions) {}

  /** Run after every earlier queued operation settles. Failures do not block later work. */
  enqueue<T>(run: () => T | Promise<T>): Promise<T> {
    const result = this.pending.then(run);
    this.pending = result.catch(() => undefined);
    return result;
  }

  /** Settle once every operation queued so far has finished. */
  async drain(): Promise<void> {
    await this.pending;
  }

  private assertTrusted(event: IpcMainInvokeEvent): void {
    if (!this.options.trustedSender(event)) throw new Error('Untrusted IPC sender.');
  }

  private validate(channel: string, args: unknown[]): unknown[] {
    return (this.options.contracts[channel] ?? this.options.defaultContract).parse(args);
  }

  private traced(channel: string, invoke: () => unknown): () => unknown {
    return () => (this.options.tracesChannel(channel) ? this.options.trace(channel, invoke) : invoke());
  }

  /** Validated and queued. Update channels skip the queue so they stay usable during installs. */
  handle = (channel: string, listener: Listener): void => {
    this.options.register(channel, (event, ...args) => {
      this.assertTrusted(event);
      const validated = this.validate(channel, args);
      if (channel.startsWith('update:')) return listener(event, ...validated);
      if (this.options.updateInstallPending()) throw new Error(UPDATE_PENDING);
      // Search is read-only and owns a single cancellable scan. Do not queue obsolete queries
      // behind mutations or block saves while the workspace text is being indexed.
      if (channel === 'projects:search-content') return listener(event, ...validated);
      return this.enqueue(this.traced(channel, () => listener(event, ...validated)));
    });
  };

  /** Validated but not queued, for handlers that own their own concurrency. */
  handleConcurrent = (channel: string, listener: Listener): void => {
    this.options.register(channel, (event, ...args) => {
      this.assertTrusted(event);
      const validated = this.validate(channel, args);
      if (this.options.updateInstallPending()) throw new Error(UPDATE_PENDING);
      return listener(event, ...validated);
    });
  };

  /** Workflow handlers return `{ ok }` outcomes and validate their own inputs. */
  handleWorkflow = (channel: string, listener: Listener, queued = false): void => {
    this.options.register(channel, (event, ...args) =>
      workflowOutcome(async () => {
        this.assertTrusted(event);
        if (this.options.updateInstallPending()) throw new Error(UPDATE_PENDING);
        const invoke = this.traced(channel, () => listener(event, ...args));
        return queued ? this.enqueue(invoke) : invoke();
      }),
    );
  };

  assertCallable(event: IpcMainInvokeEvent): void {
    this.assertTrusted(event);
    if (this.options.updateInstallPending()) throw new Error(UPDATE_PENDING);
  }
}
