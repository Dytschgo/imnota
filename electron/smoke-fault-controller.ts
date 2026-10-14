import fs from 'node:fs/promises';
import { z } from 'zod';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { AtomicWriteVerification, StableReadHooks } from './files.js';
import { isWithin } from './files.js';
import type { ProjectWatchDependencies } from './project-watch.js';
import {
  faultObservationSchema,
  nativeFaultCases,
  type FaultCommand,
  type FaultObservation,
  type NativeFaultKind,
  type NativeFaultOwnership,
} from '../src/shared/native-faults.js';
import { faultDigest, faultIdentity } from './smoke-fault-ownership.js';

interface CaseInput {
  caseId: string;
  projectPath: string;
  projectId: string;
  kind?: NativeFaultKind;
  itemId?: string;
  token?: string;
  repairTarget?: string;
  repairBefore?: string;
}
interface Invocation {
  channel: string;
  args: unknown[];
  serial: number;
}
const caseInputSchema = z
  .object({
    caseId: z.string().max(80),
    projectPath: z.string(),
    projectId: z.string(),
    kind: z.enum(['screenshot', 'drawing', 'text']).optional(),
    itemId: z.string().max(160).optional(),
    token: z
      .string()
      .regex(/^(?:delete|content-delete)-[a-f0-9-]{36}$/)
      .optional(),
    repairTarget: z
      .string()
      .regex(/^collections\/[a-zA-Z0-9_.-]+\/(?:text|markdown|descriptions)\/[a-zA-Z0-9_.-]+$/)
      .optional(),
    repairBefore: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
class InjectedNativeFault extends Error {
  constructor(readonly code: string) {
    super(`Controlled native fixture ${code}`);
  }
}
type WatchHandle = ReturnType<ProjectWatchDependencies['createWatch']>;
type Journal = { phase: string; [key: string]: unknown };
const RESTORE = new Set(['screenshots:undo-delete', 'content:undo-delete']);
const SAVES = new Set(['content:save', 'projects:save-screenshot', 'workflow:project-watch:cas']);

/** Main-only, one case at a time. The renderer cannot arm faults or select operands. */
export class OwnedSmokeFaultController {
  private saveObservation?: { requestId: string; started: boolean };
  private readonly context = new AsyncLocalStorage<Invocation>();
  private active?: CaseInput & {
    identity: Awaited<ReturnType<typeof faultIdentity>>;
    metadataIdentity: Awaited<ReturnType<typeof faultIdentity>>;
    before: string;
  };
  private readonly consumed = new Set<string>();
  private readonly watches = new Map<string, { handle: WatchHandle; fail: (error: Error) => void }>();
  private readonly watchProjects = new Map<string, string>();
  private serial = 0;
  private caseStart = 0;
  get caseEvents() {
    return this.events.slice(this.caseStart);
  }
  private terminal = false;
  private fatal: unknown;
  private request?: {
    command: FaultCommand;
    resolve(value: FaultObservation): void;
    reject(error: Error): void;
  };
  readonly events: Array<Record<string, unknown>> = [];
  private window?: BrowserWindow;
  private uiBarrier?: { release(): void; reject(error: Error): void };

  constructor(
    readonly proof: NativeFaultOwnership,
    readonly fixture: string,
  ) {}

  private record(event: Record<string, unknown>): void {
    if (this.events.length >= 2000 || JSON.stringify(event).length > 100000)
      this.fail('Fault evidence bound exceeded.');
    this.events.push({ at: new Date().toISOString(), ...event });
  }
  private fail(message: string): never {
    const error = new Error(message);
    this.fatal ??= error;
    throw error;
  }
  assertHealthy(): void {
    if (this.fatal) throw this.fatal;
  }

  async arm(input: CaseInput): Promise<void> {
    input = caseInputSchema.parse(input);
    this.assertHealthy();
    if (this.terminal || this.active || !nativeFaultCases(this.proof.caseSet).includes(input.caseId))
      this.fail('Fault case is terminal, duplicate or outside the fixed catalog.');
    if (!isWithin(this.fixture, input.projectPath) || input.projectPath === this.fixture)
      this.fail('Fault project escaped its fixture.');
    const marker = path.join(this.fixture, '.imnota-native-fault-fixture.json');
    await faultIdentity(marker);
    if (JSON.parse(await fs.readFile(marker, 'utf8')).nonce !== this.proof.nonce)
      this.fail('Fault fixture marker mismatch.');
    const identity = await faultIdentity(input.projectPath, true);
    const metadata = path.join(input.projectPath, 'project.json');
    const metadataIdentity = await faultIdentity(metadata);
    const source = await fs.readFile(metadata);
    if (JSON.parse(source.toString()).id !== input.projectId) this.fail('Fault project identity mismatch.');
    if (this.proof.caseSet.startsWith('restore-')) {
      if (
        !input.kind ||
        !input.itemId ||
        !input.token ||
        !/^(?:delete|content-delete)-[a-f0-9-]{36}$/.test(input.token)
      )
        this.fail('Missing real delete identity.');
      const journal = await this.journal(input);
      if (journal.phase !== 'deleted') this.fail('Restore must arm against a deleted journal.');
    }
    this.consumed.clear();
    this.caseStart = this.events.length;
    this.active = { ...input, identity, metadataIdentity, before: faultDigest(source) };
    this.record({
      event: 'armed',
      caseId: input.caseId,
      project: path.relative(this.fixture, input.projectPath),
      identity,
      metadataIdentity,
      before: faultDigest(source),
      token: input.token,
    });
  }

  private journalPath(input = this.active!): string {
    return path.join(
      input.projectPath,
      input.kind === 'screenshot' ? '.imnota-undo' : '.imnota-content-undo',
      input.token!,
      'manifest.json',
    );
  }
  private async journal(input: CaseInput = this.active!): Promise<Journal> {
    const target = this.journalPath(input as NonNullable<typeof this.active>);
    await faultIdentity(target);
    const journal = JSON.parse(await fs.readFile(target, 'utf8')) as Journal;
    const member = (input.kind === 'screenshot' ? journal.screenshot : journal.item) as
      { id?: string } | undefined;
    if (journal.token !== input.token || member?.id !== input.itemId)
      this.fail('Fault journal member or token mismatch.');
    return journal;
  }
  private async validate(): Promise<void> {
    const active = this.active;
    if (!active || this.terminal) this.fail('Fault operation after disarm.');
    const marker = path.join(this.fixture, '.imnota-native-fault-fixture.json');
    await faultIdentity(marker);
    if (JSON.parse(await fs.readFile(marker, 'utf8')).nonce !== this.proof.nonce)
      this.fail('Fault ownership marker changed before consumption.');
    const identity = await faultIdentity(active.projectPath, true);
    if (identity.dev !== active.identity.dev || identity.ino !== active.identity.ino)
      this.fail('Fault project directory identity changed.');
    await faultIdentity(path.join(active.projectPath, 'project.json'));
    if (
      JSON.parse(await fs.readFile(path.join(active.projectPath, 'project.json'), 'utf8')).id !==
      active.projectId
    )
      this.fail('Fault metadata belongs to another project.');
  }
  private async consume(event: string, detail: Record<string, unknown> = {}): Promise<void> {
    await this.validate();
    if (this.consumed.has(event)) this.fail('Duplicate fault consumption.');
    // Consume BEFORE any injected effect, including an intentionally thrown error.
    this.consumed.add(event);
    this.record({ event: 'consumed', fault: event, invocation: this.context.getStore(), ...detail });
  }
  private async transactionWitness(sourceHash: string, preimage: string) {
    const directory = path.join(this.active!.projectPath, '.imnota-transactions');
    await faultIdentity(directory, true);
    const matches = [];
    for (const token of await fs.readdir(directory)) {
      if (!/^txn-[a-f0-9-]{36}$/.test(token)) continue;
      const manifestPath = path.join(directory, token, 'manifest.json');
      await faultIdentity(manifestPath);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        token: string;
        phase: string;
        entries: Array<{ relativePath: string; before: { sha256: string }; after: { sha256: string } }>;
      };
      const metadata = manifest.entries.find((entry) => entry.relativePath === 'project.json');
      if (
        manifest.phase === 'applying' &&
        metadata?.before.sha256 === preimage &&
        metadata.after.sha256 === sourceHash
      )
        matches.push({
          token,
          manifestSha256: faultDigest(await fs.readFile(manifestPath)),
          phase: manifest.phase,
        });
    }
    if (matches.length !== 1) this.fail('Fault did not reach one exact applying transaction candidate.');
    return matches[0];
  }
  private error(code = this.code()): Error {
    return new InjectedNativeFault(code);
  }
  private code(): string {
    return this.proof.caseSet.endsWith('eacces')
      ? 'EACCES'
      : this.proof.caseSet.endsWith('eperm')
        ? 'EPERM'
        : 'EIO';
  }

  atomicVerification(target: string): AtomicWriteVerification | undefined {
    const active = this.active;
    if (!active || this.terminal) return undefined;
    const metadata = path.join(active.projectPath, 'project.json');
    const marker = active.token ? this.journalPath() : undefined;
    const repair = active.repairTarget && path.join(active.projectPath, active.repairTarget);
    if (target !== metadata && target !== marker && target !== repair) return undefined;
    const invocation = this.context.getStore();
    if (!invocation) return undefined;
    const restoring = RESTORE.has(invocation.channel);
    const saving = SAVES.has(invocation.channel);
    const restoringSet = this.proof.caseSet.startsWith('restore-');
    if (restoringSet ? !restoring : !saving) return undefined;
    let sourceHash: string;
    let preimage: string;
    let beforeIdentity: Awaited<ReturnType<typeof faultIdentity>>;
    const observers: AtomicWriteVerification = {
      beforeWrite: async (_target, source) => {
        await this.validate();
        const input = invocation.args[0] as { projectPath?: string; undoToken?: string };
        if (restoring && (input.projectPath !== active.projectPath || input.undoToken !== active.token))
          this.fail('Restore invocation project or token mismatch.');
        if (saving) {
          const request = invocation.args[0] as { projectPath?: string; watchId?: string };
          const project = request.projectPath ?? this.watchProjects.get(request.watchId ?? '');
          if (project !== active.projectPath)
            this.fail('Save invocation belongs to another fixture project.');
        }
        sourceHash = faultDigest(source);
        beforeIdentity = await faultIdentity(target);
        preimage = faultDigest(await fs.readFile(target));
        if (target === metadata && restoring && !this.consumed.has('metadata')) {
          if (
            beforeIdentity.dev !== active.metadataIdentity.dev ||
            beforeIdentity.ino !== active.metadataIdentity.ino
          )
            this.fail('Restore metadata identity changed after arming.');
          if (preimage !== active.before || (await this.journal()).phase !== 'undoing')
            this.fail('Restore target preimage or journal stage changed.');
        }
        if (
          target === marker &&
          this.proof.caseSet === 'restore-marker' &&
          this.consumed.has('metadata') &&
          !this.consumed.has('marker')
        ) {
          const next = JSON.parse(Buffer.from(source).toString()) as Journal;
          const undoAfter = next.undoAfter as { sha256?: string } | undefined;
          if (
            next.token !== active.token ||
            undoAfter?.sha256 !== faultDigest(await fs.readFile(metadata)) ||
            next.phase !== 'restored' ||
            (await this.journal()).phase !== 'undoing'
          )
            this.fail('Marker fault reached the wrong journal phase.');
          await this.consume('marker', { preimage, sourceHash });
          throw this.error('EACCES');
        }
        if (
          target === repair &&
          this.proof.caseSet === 'recovery-repair' &&
          active.caseId === 'failed-repair' &&
          this.consumed.has('candidate') &&
          !this.consumed.has('repair')
        ) {
          if (sourceHash !== active.repairBefore)
            this.fail('Repair fault is not writing the original before-image.');
          await this.consume('repair', { preimage, sourceHash });
          throw this.error('EACCES');
        }
      },
      beforeCandidateSync: async () => {
        const identity = await faultIdentity(target);
        if (
          identity.dev !== beforeIdentity.dev ||
          identity.ino !== beforeIdentity.ino ||
          faultDigest(await fs.readFile(target)) !== preimage
        )
          this.fail('Fault target changed while the real candidate was written.');
        if (target !== metadata || this.proof.caseSet !== 'recovery-repair' || this.consumed.has('candidate'))
          return;
        const transaction = await this.transactionWitness(sourceHash, preimage);
        await this.consume('candidate', { preimage, sourceHash, beforeIdentity, transaction });
        throw this.error();
      },
      beforeParentSync: async (_target, _directory, boundary) => {
        if (target !== metadata) return;
        const fault = restoring ? 'metadata' : `commit-${invocation.channel}`;
        if (this.consumed.has(fault) || (!restoring && !this.proof.caseSet.startsWith('recovery-lineage-')))
          return;
        const committedIdentity = await faultIdentity(target);
        if (faultDigest(await fs.readFile(target)) !== sourceHash)
          this.fail('Postrename bytes differ from the real candidate.');
        if (restoring) {
          if ((await this.journal()).phase !== 'undoing') this.fail('Postrename Restore is not undoing.');
          const after = path.join(path.dirname(this.journalPath()), 'undo-after.bin');
          await faultIdentity(after);
          if (faultDigest(await fs.readFile(after)) !== sourceHash)
            this.fail('Restore candidate differs from undo-after.');
          const queued = await this.command('queue-fixture-metadata');
          if (!queued.pendingMetadata || !queued.nativeMutations)
            this.fail('Metadata was not queued inside the real mutation.');
        }
        const transaction =
          saving && invocation.channel !== 'workflow:project-watch:cas'
            ? await this.transactionWitness(sourceHash, preimage)
            : undefined;
        await this.consume(fault, {
          boundary,
          preimage,
          sourceHash,
          beforeIdentity,
          committedIdentity,
          transaction,
        });
        if (invocation.channel === 'content:save') this.closeOwnedWatch();
        throw this.error();
      },
    };
    return {
      beforeWrite: (target, source) => this.observe(() => observers.beforeWrite!(target, source)),
      beforeCandidateSync: (target) => this.observe(() => observers.beforeCandidateSync!(target)),
      beforeParentSync: (target, directory, boundary) =>
        this.observe(() => observers.beforeParentSync!(target, directory, boundary)),
    };
  }

  private async observe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof InjectedNativeFault)) this.fatal ??= error;
      throw error;
    }
  }

  confirmationReadHooks(project: string): StableReadHooks | undefined {
    if (!this.active || project !== this.active.projectPath || this.proof.caseSet !== 'restore-confirmation')
      return undefined;
    return {
      beforeOpen: (target) =>
        this.observe(async () => {
          if (this.consumed.has('confirmation')) return;
          if (
            !this.consumed.has('metadata') ||
            target !== path.join(project, 'project.json') ||
            !RESTORE.has(this.context.getStore()?.channel ?? '')
          )
            this.fail('Confirmation fault reached the wrong operation.');
          await this.consume('confirmation');
          if (this.active!.caseId.endsWith('changed')) await this.writeForeignMetadata();
          else throw this.error('EACCES');
        }),
    };
  }

  async writeForeignMetadata(): Promise<void> {
    await this.validate();
    const target = path.join(this.active!.projectPath, 'project.json');
    const project = JSON.parse(await fs.readFile(target, 'utf8'));
    const source = JSON.stringify(
      {
        ...project,
        name: 'Fixture foreign metadata',
        description: `Distinct foreign description ${this.proof.nonce}`,
      },
      null,
      2,
    );
    // Deliberately external: no application atomicWrite/self marker or fabricated watch event.
    await fs.writeFile(target, source);
    this.record({ event: 'foreign-metadata', sha256: faultDigest(source), bytes: Buffer.byteLength(source) });
  }

  async invoke<T>(channel: string, args: unknown[], actual: () => T | Promise<T>): Promise<T> {
    const invocation = { channel, args, serial: ++this.serial };
    return this.context.run(invocation, async () => {
      if (this.active)
        this.record({
          event: 'ipc-invocation',
          channel,
          serial: invocation.serial,
          input: this.inputEvidence(args),
        });
      let result: T;
      try {
        result = await actual();
      } catch (error) {
        try {
          if (this.active)
            this.record({
              event: 'ipc-error',
              channel,
              input: this.inputEvidence(args),
              message: error instanceof Error ? error.message : String(error),
            });
        } catch (observationError) {
          throw new AggregateError([error, observationError], 'IPC and fault evidence both failed.');
        }
        throw error;
      }
      if (channel === 'workflow:project-watch:start' && result && typeof result === 'object') {
        const grant = result as { watchId?: string; projectPath?: string };
        if (grant.watchId && grant.projectPath && isWithin(this.fixture, grant.projectPath))
          this.watchProjects.set(grant.watchId, grant.projectPath);
      }
      if (this.active) {
        const serialized = JSON.stringify(result) ?? 'undefined';
        const narrowed = result as
          | {
              projectRevision?: string;
              warnings?: string[];
              snapshot?: { projectRevision?: string; warnings?: string[] };
              projectRevisionTransition?: unknown;
            }
          | undefined;
        this.record({
          event: 'ipc-result',
          channel,
          input: this.inputEvidence(args),
          sha256: faultDigest(serialized),
          bytes: Buffer.byteLength(serialized),
          revision: narrowed?.projectRevision ?? narrowed?.snapshot?.projectRevision,
          warnings: narrowed?.warnings ?? narrowed?.snapshot?.warnings,
          transition: narrowed?.projectRevisionTransition,
        });
        if (
          RESTORE.has(channel) &&
          this.proof.caseSet === 'restore-later-change' &&
          !this.consumed.has('response')
        ) {
          await this.consume('response');
          const pending = await this.command('queue-fixture-metadata');
          if (!pending.pendingMetadata || !pending.nativeMutations)
            this.fail('Later-response metadata input was not pending in Restore.');
          await this.writeForeignMetadata();
        }
      }
      if (
        this.active?.caseId.startsWith('undo-') &&
        this.proof.caseSet === 'recovery-ui' &&
        channel === 'workflow:project-watch:cas' &&
        !this.consumed.has('ui-save-barrier')
      ) {
        await this.consume('ui-save-barrier');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.uiBarrier = undefined;
            this.fatal ??= new Error('Real CAS response barrier exceeded 15 seconds.');
            reject(this.fatal);
          }, 15000);
          this.uiBarrier = {
            release: () => {
              clearTimeout(timer);
              this.uiBarrier = undefined;
              resolve();
            },
            reject: (error) => {
              clearTimeout(timer);
              this.uiBarrier = undefined;
              reject(error);
            },
          };
        });
      }
      return result; // The genuine handler value, never a replacement workflow outcome or snapshot.
    });
  }
  releaseUiBarrier(): void {
    if (!this.uiBarrier) this.fail('Expected real CAS response barrier was not reached.');
    this.uiBarrier.release();
  }
  private inputEvidence(args: unknown[]) {
    const serialized = JSON.stringify(args);
    const input = args[0] as
      | {
          projectPath?: string;
          watchId?: string;
          expectedRevision?: string;
          undoToken?: string;
          itemId?: string;
        }
      | undefined;
    return {
      sha256: faultDigest(serialized),
      bytes: Buffer.byteLength(serialized),
      expectedRevision: input?.expectedRevision,
      undoToken: input?.undoToken,
      itemId: input?.itemId,
      watchId: input?.watchId,
    };
  }
  wrapRealWatch(project: string, handle: WatchHandle): WatchHandle {
    if (!isWithin(this.fixture, project)) return handle;
    return {
      close: () => {
        handle.close();
        if (this.watches.get(project)?.handle === handle) this.watches.delete(project);
      },
      on: (event, listener) => {
        handle.on(event, listener);
        this.watches.set(project, { handle, fail: listener });
      },
    };
  }
  private closeOwnedWatch(): void {
    const watcher = this.active && this.watches.get(this.active.projectPath);
    if (!watcher || this.consumed.has('outage')) this.fail('Missing or duplicate real fixture watch.');
    this.consumed.add('outage');
    watcher.handle.close();
    this.record({ event: 'consumed', fault: 'outage', boundary: 'controlled-real-watch-close' });
    watcher.fail(new Error('Controlled native fixture watch outage'));
  }
  async readProjectSource(project: string, read: () => Promise<string>): Promise<string> {
    if (
      this.active?.projectPath === project &&
      this.proof.caseSet === 'restore-renderer-readback' &&
      this.consumed.has('metadata') &&
      !this.consumed.has('readback') &&
      this.context.getStore()?.channel === 'workflow:project-watch:reload'
    ) {
      await this.consume('readback');
      throw this.error('EACCES');
    }
    return read();
  }
  observeWatch(event: { projectPath: string }): void {
    if (this.active?.projectPath === event.projectPath) this.record({ event: 'watch', value: event });
  }
  setWindow(window: BrowserWindow): void {
    this.window = window;
  }
  receive(value: unknown): void {
    try {
      const observation = faultObservationSchema.parse(value);
      if (
        observation.event === 'state:revision' &&
        observation.nonce === this.proof.nonce &&
        observation.caseId === this.active?.caseId &&
        observation.projectPath === this.active.projectPath &&
        observation.projectId === this.active.projectId
      ) {
        this.record({ event: 'renderer', value: observation });
        return;
      }
      if (observation.event.startsWith('save:')) {
        const save = this.saveObservation;
        if (
          !save ||
          observation.requestId !== save.requestId ||
          observation.nonce !== this.proof.nonce ||
          observation.caseId !== this.active?.caseId ||
          observation.projectPath !== this.active.projectPath ||
          observation.projectId !== this.active.projectId
        )
          this.fail('Unmatched native save observation.');
        if (observation.event === 'save:started' && !save.started) save.started = true;
        else if (['save:completed', 'save:refused', 'save:error'].includes(observation.event) && save.started)
          this.saveObservation = undefined;
        else this.fail('Native save completion has no unique invocation.');
        this.record({ event: 'renderer', value: observation });
        return;
      }
      const pending = this.request;
      if (
        !pending ||
        observation.nonce !== this.proof.nonce ||
        observation.caseId !== this.active?.caseId ||
        observation.requestId !== pending.command.requestId ||
        observation.projectPath !== this.active.projectPath ||
        observation.projectId !== this.active.projectId
      )
        this.fail('Unmatched renderer fault receipt.');
      this.record({ event: 'renderer', value: observation });
      this.request = undefined;
      pending.resolve(observation);
    } catch (error) {
      this.fatal ??= error;
      this.request?.reject(error instanceof Error ? error : new Error(String(error)));
      this.request = undefined;
    }
  }
  async command(action: FaultCommand['action']): Promise<FaultObservation> {
    if (!this.active || this.terminal || this.request || !this.window || this.window.isDestroyed())
      this.fail('Fault renderer command is not owned or is concurrent.');
    if (action === 'stage-recovery-drafts' || action === 'render-app-failure')
      await this.consume('react-app');
    if (action === 'render-panel-failure') {
      const next = this.consumed.has('react-panel-1') ? 'react-panel-2' : 'react-panel-1';
      await this.consume(next);
    }
    const command: FaultCommand = {
      nonce: this.proof.nonce,
      caseId: this.active.caseId,
      requestId: randomUUID(),
      projectPath: this.active.projectPath,
      projectId: this.active.projectId,
      action,
    };
    if (action === 'arm-save') {
      if (this.saveObservation) this.fail('A native save observation is already pending.');
      this.saveObservation = { requestId: command.requestId, started: false };
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fatal ??= new Error('Fault renderer acknowledgement exceeded 15 seconds.');
        this.request = undefined;
        reject(this.fatal);
      }, 15000);
      this.request = {
        command,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      this.window!.webContents.send('smoke:fault-command', command);
    });
  }
  async disarm(expected: string[]): Promise<void> {
    let failure: unknown;
    try {
      this.assertHealthy();
      if (this.saveObservation) this.fail('Native save observation did not complete.');
      if (expected.slice().sort().join() !== [...this.consumed].sort().join())
        this.fail(`Fault consumption mismatch: expected ${expected}; observed ${[...this.consumed]}.`);
      if (this.active) await this.command('disarm');
    } catch (error) {
      failure = error;
    } finally {
      this.active = undefined;
    }
    try {
      this.record({ event: 'disarmed', consumed: [...this.consumed] });
    } catch (observationError) {
      if (failure)
        throw new AggregateError([failure, observationError], 'Disarm and its evidence both failed.');
      throw observationError;
    }
    if (failure) throw failure;
  }
  cancel(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.saveObservation = undefined;
    this.uiBarrier?.reject(new Error('Fault session terminated.'));
    this.active = undefined;
    this.request?.reject(new Error('Fault session terminated.'));
    this.request = undefined;
    // One reserved terminal receipt; cancellation must not replace an in-flight
    // application/evidence error when the ordinary event bound is exhausted.
    if (this.events.length <= 2000)
      this.events.push({ at: new Date().toISOString(), event: 'terminal', disarmed: true });
  }
}
