// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHost } from './main.js';
import type { WorkspaceSettings } from '../src/shared/types.js';
import { resolvePreferenceSettings } from '../src/shared/preference-settings.js';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/shared/workspace-settings.js';
import { DEFAULT_PREFERENCE_SETTINGS } from '../src/shared/preferences.js';
import { emptyProject } from '../src/shared/utils.js';
import { persistSettings, writeApplicationFile } from './application-persistence.js';
import { CommittedWriteError, atomicWrite, writtenFileIdentity, type WrittenFileEvidence } from './files.js';
import { PersistenceDiagnostics } from './persistence-diagnostics.js';
import {
  persistenceSession,
  trackWatch,
  persistenceFault,
  type PersistenceLedger,
} from '../src/test/persistence-ledger.js';
import { IpcRouter } from './ipc-router.js';
import { registerSettingsIpc } from './ipc-settings.js';
import { ProjectWatchManager, projectRevisionForSource } from './project-watch.js';
import { assertProjectPath } from './project-path.js';
import { LocalMcpServer } from './mcp-server.js';
import { UpdateController } from './update-controller.js';
import {
  commitScreenshotTransaction,
  screenshotTransactionBaseline,
  stageScreenshotTransaction,
} from './screenshot-transactions.js';

const showOpenDialog = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { getPath: () => '/documents' }, dialog: { showOpenDialog }, shell: {} }));
const platform = process.platform;
const session = persistenceSession();
const { ledger, it } = session;
const root = () => ledger().fixtureRoots()[0];
beforeEach(async (context) => {
  session.start(context);
  const owner = ledger();
  await owner.span('fixture root', async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-commit-outcome-')));
    owner.own(directory, 'imnota-commit-outcome-');
  });
});
afterEach(async (context) => {
  try {
    await session.cleanup(context);
  } finally {
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

it('forwards descriptor evidence through the application write wrapper without changing publication', async () => {
  const target = path.join(root(), 'created.png');
  const diagnostics = new PersistenceDiagnostics(() => path.join(root(), 'diagnostics'), {
    version: 'test',
    platform: process.platform,
  });
  ledger().diagnostics(diagnostics);
  let identity: WrittenFileEvidence | undefined;
  const published = vi.fn();
  const invalidated = vi.fn();
  await writeApplicationFile(
    target,
    'OURS',
    {
      diagnostics,
      recordSelfWrite: published,
      invalidate: invalidated,
    },
    (evidence) => {
      identity = evidence;
    },
  );
  expect(identity).toBeDefined();
  const current = writtenFileIdentity(await fs.lstat(target, { bigint: true }));
  expect(identity).toMatchObject({
    dev: current?.dev,
    ino: current?.ino,
    size: current?.size,
    sha256: createHash('sha256').update('OURS').digest('hex'),
  });
  expect(published).toHaveBeenCalledExactlyOnceWith(target, 'OURS');
  expect(invalidated).toHaveBeenCalledExactlyOnceWith(target);
});

// POSIX uses real directory handles and fsync except the single injected failure.
// Windows exercises the POSIX branch with synthetic directory handles; file bytes/rename remain real.
function failWrite(target: string, stage: 'directory' | 'candidate' | 'rename', code = 'EIO') {
  return persistenceFault(ledger(), target, stage, code);
}

function harness() {
  const owner = ledger();
  return owner.span('fixture construction', () => buildHarness(owner));
}

async function buildHarness(ledger: PersistenceLedger) {
  const root = ledger.fixtureRoots()[0];
  const oldRoot = path.join(root, 'old');
  const nextRoot = path.join(root, 'next');
  for (const workspace of [oldRoot, nextRoot])
    await fs.mkdir(path.join(workspace, 'project'), { recursive: true });
  let settings: WorkspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS, workspacePath: oldRoot };
  let preferences = structuredClone(DEFAULT_PREFERENCE_SETTINGS);
  const file = path.join(root, 'settings.json');
  await ledger.span('initial settings creation', () => fs.writeFile(file, JSON.stringify(settings)));
  const diagnostics = new PersistenceDiagnostics(() => path.join(root, 'diagnostics'), {
    version: 'test',
    platform,
  });
  ledger.diagnostics(diagnostics);
  const publishWrite = vi.fn();
  const invalidate = vi.fn();
  const invalidateWorkspace = vi.fn();
  const syncShortcut = vi.fn();
  const server = new LocalMcpServer({
    enabled: () => preferences.agentAccess.enabled,
    workspacePath: () => settings.workspacePath,
    appVersion: () => 'test',
  });
  ledger.stop(() => server.stop());
  const update = new UpdateController('stable', {
    currentVersion: '0.1.0',
    enabled: false,
    manual: false,
    discover: async () => null,
    prepare: async () => undefined,
    download: async () => undefined,
    install: () => undefined,
    open: async () => undefined,
    emit: vi.fn(),
  });
  const persist = (next: WorkspaceSettings, prefs = preferences) =>
    persistSettings(next, prefs, {
      filePath: file,
      retained: { futureSetting: 'kept' },
      profile: resolvePreferenceSettings({}, false).profile,
      write: (target, source) =>
        ledger.span('write', () =>
          writeApplicationFile(target, source, { diagnostics, recordSelfWrite: publishWrite, invalidate }),
        ),
      publish: (nextSettings, nextPreferences) => {
        if (settings.workspacePath !== nextSettings.workspacePath) invalidateWorkspace();
        settings = nextSettings;
        preferences = nextPreferences;
      },
      savePreference: (enabled, save) => server.savePreference(enabled, save, { port: 0 }),
      syncShortcut,
    });
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const router = new IpcRouter({
    register: (channel, listener) => handlers.set(channel, listener),
    trustedSender: () => true,
    updateInstallPending: () => false,
    contracts: {},
    defaultContract: z.array(z.unknown()),
    tracesChannel: () => true,
    trace: (channel, run) => diagnostics.run(channel, run),
  });
  registerSettingsIpc(router, {
    get settings() {
      return settings;
    },
    persistApplicationSettings: persist,
    diagnostics,
    updateController: update,
  } as unknown as IpcHost);
  const call = (channel: string, ...args: unknown[]) =>
    ledger.span(channel, () =>
      ledger.checkFault(file, async () => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)),
    );
  return {
    file,
    oldRoot,
    nextRoot,
    call,
    router,
    persist: (next: WorkspaceSettings, prefs = preferences) =>
      ledger.checkFault(file, () => persist(next, prefs)),
    settings: () => settings,
    preferences: () => preferences,
    diagnostics,
    publishWrite,
    invalidate,
    invalidateWorkspace,
    syncShortcut,
    server,
    update,
  };
}

it.each(['EIO', 'EACCES', 'EPERM'])(
  'publishes committed settings, index/authorization and later queued patches after directory %s',
  async (code) => {
    const h = await harness();
    const assertFault = failWrite(h.file, 'directory', code);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [h.nextRoot] });
    const chosen = expect(h.call('settings:choose-workspace')).rejects.toMatchObject({
      committed: true,
      code,
    });
    const following = h.call('settings:set', { confirmBeforeDeletion: false });
    await chosen;
    assertFault();
    await following;
    expect(h.settings()).toMatchObject({ workspacePath: h.nextRoot, confirmBeforeDeletion: false });
    expect(JSON.parse(await fs.readFile(h.file, 'utf8'))).toMatchObject({
      workspacePath: h.nextRoot,
      confirmBeforeDeletion: false,
      futureSetting: 'kept',
    });
    expect(h.invalidateWorkspace).toHaveBeenCalledOnce();
    expect(h.publishWrite).toHaveBeenCalledTimes(2);
    expect(h.syncShortcut).toHaveBeenCalledTimes(2);
    await expect(
      assertProjectPath(h.settings().workspacePath, path.join(h.nextRoot, 'project')),
    ).resolves.toBeTruthy();
    await expect(
      assertProjectPath(h.settings().workspacePath, path.join(h.oldRoot, 'project')),
    ).rejects.toThrow();
    const logs = (await fs.readdir(path.join(root(), 'diagnostics'))).filter((file) =>
      file.endsWith('.jsonl'),
    );
    const events = (await fs.readFile(path.join(root(), 'diagnostics', logs[0]), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      events,
      `Expected committed-durability-unconfirmed: injection fired; missing event may reflect dropped diagnostics during stalled/failed storage. Health: ${JSON.stringify(h.diagnostics.health())}`,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'filesystem',
          phase: 'committed-durability-unconfirmed',
          errorCode: code,
        }),
      ]),
    );
  },
);

it.each(['candidate', 'rename'] as const)(
  'leaves memory, authorization and publications unchanged on precommit %s failure',
  async (stage) => {
    const h = await harness();
    failWrite(h.file, stage);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [h.nextRoot] });
    await expect(h.call('settings:choose-workspace')).rejects.not.toBeInstanceOf(CommittedWriteError);
    expect(h.settings().workspacePath).toBe(h.oldRoot);
    expect(JSON.parse(await fs.readFile(h.file, 'utf8')).workspacePath).toBe(h.oldRoot);
    expect(h.invalidateWorkspace).not.toHaveBeenCalled();
    expect(h.publishWrite).not.toHaveBeenCalled();
    expect(h.syncShortcut).not.toHaveBeenCalled();
    await h.call('settings:set', { interfaceScale: 1.2 });
    expect(h.settings()).toMatchObject({ workspacePath: h.oldRoot, interfaceScale: 1.2 });
  },
);

it('keeps committed update-channel and MCP lifecycle state despite the rejected durability promise', async () => {
  const h = await harness();
  failWrite(h.file, 'directory');
  await expect(h.call('settings:set', { updateChannel: 'nightly' })).rejects.toBeInstanceOf(
    CommittedWriteError,
  );
  expect(h.update.getStatus().channel).toBe('nightly');
  expect(h.settings().updateChannel).toBe('nightly');
  vi.restoreAllMocks();
  failWrite(h.file, 'directory');
  await expect(
    h.persist(h.settings(), { ...h.preferences(), agentAccess: { enabled: true } }),
  ).rejects.toBeInstanceOf(CommittedWriteError);
  expect(h.preferences().agentAccess.enabled).toBe(true);
  expect(h.server.listening()).not.toBeNull();
  vi.restoreAllMocks();
  failWrite(h.file, 'directory');
  await expect(
    h.persist(h.settings(), { ...h.preferences(), agentAccess: { enabled: false } }),
  ).rejects.toBeInstanceOf(CommittedWriteError);
  expect(h.preferences().agentAccess.enabled).toBe(false);
  expect(h.server.listening()).toBeNull();
});

it.each(
  ['EIO', 'EACCES', 'EPERM'].flatMap((code) =>
    (['directory', 'candidate', 'rename'] as const).map((stage) => ({ code, stage })),
  ),
)(
  'publishes committed watch revisions and still reports subsequent unmatched external changes ($stage, $code)',
  async ({ stage, code }) => {
    const project = emptyProject('Watch', '');
    const file = path.join(root(), 'project.json');
    const baseline = JSON.stringify(project);
    await fs.writeFile(file, baseline);
    const diagnostics = new PersistenceDiagnostics(() => path.join(root(), 'diagnostics'), {
      version: 'test',
      platform,
    });
    ledger().diagnostics(diagnostics);
    const invalidated = vi.fn();
    const events: unknown[] = [];
    let listener: (event: string, filename: string | Buffer | null) => void = () => undefined;
    let flush: () => void = () => undefined;
    let reads = 0;
    const manager = new ProjectWatchManager({
      createWatch: (_target, next) => {
        listener = next;
        return { close: vi.fn(), on: vi.fn() };
      },
      schedule: (run) => {
        flush = run;
        const timer = setTimeout(() => undefined, 60_000);
        clearTimeout(timer);
        return timer;
      },
      readWatchedFile: async (target) => {
        const bytes = await fs.readFile(target);
        reads++;
        return bytes;
      },
      loadSnapshot: async () => ({ projectPath: root(), project, thumbnails: {}, recoveryFound: false }),
      saveProject: async () => {
        throw new Error('not used');
      },
      emit: (event) => events.push(event),
    });
    trackWatch(ledger(), manager);
    ledger().stop(() => manager.stopAll());
    const grant = await manager.start(root());
    const published = vi.fn((target: string, bytes: string | Uint8Array) =>
      manager.recordSelfWrite(target, bytes),
    );
    const write = (source: string) =>
      writeApplicationFile(file, source, {
        diagnostics,
        recordSelfWrite: published,
        invalidate: invalidated,
      });
    const assertFault = failWrite(file, stage, code);
    const next = JSON.stringify({ ...project, name: 'Committed' });
    await expect(write(next)).rejects.toThrow();
    assertFault();
    expect(published).toHaveBeenCalledTimes(stage === 'directory' ? 1 : 0);
    expect(invalidated).toHaveBeenCalledTimes(stage === 'directory' ? 1 : 0);
    listener('change', 'project.json');
    flush();
    if (stage === 'directory') {
      await vi.waitFor(() => expect(reads).toBe(1));
      expect(events).toEqual([]);
    } else {
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toMatchObject({
        watchId: grant.watchId,
        projectRevision: projectRevisionForSource(baseline),
      });
      events.length = 0;
    }
    const readCount = reads;
    await write(JSON.stringify({ ...project, name: 'Following' }));
    listener('change', 'project.json');
    flush();
    await vi.waitFor(() => expect(reads).toBe(readCount + 1));
    expect(events).toEqual([]);
    // Self-write suppression must not mask an unmatched later external revision.
    await fs.writeFile(file, JSON.stringify({ ...project, name: 'External' }));
    listener('change', 'project.json');
    flush();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      watchId: grant.watchId,
      kind: 'external-change',
      changedPaths: ['project.json'],
    });
  },
);

it.each(
  ['EIO', 'EACCES', 'EPERM'].flatMap((code) =>
    ['project.json', 'note.md'].map((failedPath) => ({ code, failedPath })),
  ),
)(
  'distinguishes transaction commit from an intermediate file commit ($failedPath, $code)',
  async ({ failedPath, code }) => {
    const before = Buffer.from('before');
    const after = Buffer.from('after');
    for (const name of ['project.json', 'note.md']) await fs.writeFile(path.join(root(), name), before);
    const staged = await stageScreenshotTransaction(root(), {
      kind: 'save',
      writes: ['project.json', 'note.md'].map((relativePath) => ({
        relativePath,
        after,
        expectedBefore: screenshotTransactionBaseline(before),
      })),
    });
    const assertFault = failWrite(path.join(root(), failedPath), 'directory', code);
    if (failedPath === 'project.json') {
      const result = await ledger().span('transaction commit', () =>
        commitScreenshotTransaction(root(), staged.token),
      );
      assertFault();
      expect(result).toMatchObject({ status: 'committed', warning: expect.stringContaining('durability') });
      expect(await fs.readFile(path.join(root(), 'project.json'), 'utf8')).toBe('after');
    } else {
      await expect(commitScreenshotTransaction(root(), staged.token)).rejects.toMatchObject({
        code: 'commit-failed',
        candidateAvailable: true,
      });
      assertFault();
      for (const name of ['project.json', 'note.md'])
        expect(await fs.readFile(path.join(root(), name), 'utf8')).toBe('before');
    }
  },
);

it('advances the per-file queue after committed durability rejection', async () => {
  const file = path.join(root(), 'queue.txt');
  await fs.writeFile(file, 'before');
  const assertFault = failWrite(file, 'directory');
  const first = expect(atomicWrite(file, 'first')).rejects.toMatchObject({ committed: true, code: 'EIO' });
  const second = atomicWrite(file, 'second');
  await first;
  assertFault();
  await second;
  expect(await fs.readFile(file, 'utf8')).toBe('second');
});
