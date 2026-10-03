// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import type { IpcMainInvokeEvent } from 'electron';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import type { WorkflowResult } from '../src/shared/workflow-bridge.js';
import { emptyProject } from '../src/shared/utils.js';
import { assertNoLinks, isWithin } from './files.js';
import { contracts, pathInput } from './ipc-contracts.js';
import { IpcRouter } from './ipc-router.js';
import type { CaptureWorkflowRegistrar, IpcHost } from './main.js';
import { assertProjectPath } from './project-path.js';
import { NativeWorkflowError, workflowOutcome } from './workflow-errors.js';

/**
 * The renderer bridge (`preload.cts`), the argument contracts (`ipc-contracts.ts`) and the
 * handler modules (`ipc-*.ts`) are three separately edited lists. These tests register the real
 * handler modules on a real `IpcRouter`, run the real preload against a recording `ipcRenderer`,
 * and compare the results, so the lists cannot drift apart unnoticed.
 */

const electron = vi.hoisted(() => {
  const invoked: string[] = [];
  const listened: string[] = [];
  const exposed: Record<string, unknown> = {};
  const openPath = vi.fn(async () => '');
  return {
    invoked,
    listened,
    exposed,
    openPath,
    module: {
      app: { getPath: () => '', relaunch: () => undefined, quit: () => undefined },
      clipboard: {},
      ClipboardItem: class {},
      contextBridge: {
        exposeInMainWorld: (name: string, value: unknown) => {
          exposed[name] = value;
        },
      },
      desktopCapturer: {},
      dialog: {},
      globalShortcut: {},
      ipcRenderer: {
        invoke: async (channel: string) => {
          invoked.push(channel);
        },
        on: (channel: string) => {
          listened.push(channel);
        },
        removeListener: () => undefined,
      },
      nativeImage: {},
      screen: {},
      shell: { openPath },
      systemPreferences: {},
      webUtils: { getPathForFile: () => '' },
    },
  };
});
vi.mock('electron', () => electron.module);
// Text recognition validates its input only where it is available; make that every test host.
vi.mock('./windows-ocr.js', async (original) => ({
  ...(await original<typeof import('./windows-ocr.js')>()),
  windowsOcrAvailable: () => true,
}));

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const readSource = (name: string) => fs.readFile(path.join(electronDirectory, name), 'utf8');
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const literals = (source: string, pattern: RegExp) => sorted([...source.matchAll(pattern)].map((m) => m[1]));

type Kind = 'queued' | 'concurrent' | 'workflow' | 'capture';
type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
interface Registration {
  kind: Kind;
  module: string;
  source: string;
  /** The handler module's own listener, behind the router's trust check and contract. */
  listener: Mock<Listener>;
  invoke(event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown>;
}

const mainContents = {
  mainFrame: { name: 'main frame' },
  isDestroyed: () => false,
  once: () => undefined,
  removeListener: () => undefined,
};
const trusted = {
  sender: mainContents,
  senderFrame: mainContents.mainFrame,
} as unknown as IpcMainInvokeEvent;
let senderCheck: (contents: unknown) => (event: IpcMainInvokeEvent) => boolean;

// Execute the real main.ts predicate without importing the application startup side effects.
async function loadSenderCheck() {
  const source = ts.createSourceFile('main.ts', await readSource('main.ts'), ts.ScriptTarget.Latest, true);
  let predicate: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'IpcRouter') {
      const options = node.arguments?.[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find((item) => item.name?.getText(source) === 'trustedSender');
        if (property && ts.isPropertyAssignment(property)) predicate = property.initializer.getText(source);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!predicate) throw new Error('main.ts does not register a trustedSender predicate.');
  return new vm.Script(`(mainWindow) => (${predicate})`).runInNewContext() as (
    window: unknown,
  ) => (event: IpcMainInvokeEvent) => boolean;
}

const isMainFrameSender = (event: IpcMainInvokeEvent, contents: unknown) =>
  senderCheck(contents == null ? contents : { webContents: contents })(event);

/**
 * A host whose every member records and refuses use, apart from the given overrides. A handler
 * that reaches the host after a rejected sender, payload or path shows up in `reached`.
 */
function tripwireHost(overrides: Record<string, unknown>) {
  const reached: string[] = [];
  const trap = (name: string): unknown =>
    new Proxy(function () {}, {
      get: (_target, key) => (key === 'then' ? undefined : trap(`${name}.${String(key)}`)),
      apply: () => {
        reached.push(name);
        throw new Error(`Host reached: ${name}`);
      },
    });
  const host = new Proxy(overrides, {
    get: (target, key) => (key in target ? target[key as string] : trap(String(key))),
    set: (_target, key) => {
      reached.push(`set ${String(key)}`);
      return true;
    },
  });
  return { host: host as unknown as IpcHost, reached };
}

/** Registers every `register*Ipc` export of every `electron/ipc-*.ts` module, as `main.ts` does. */
async function registerHandlerModules(
  host: IpcHost,
  options: { mainWindowContents?: () => unknown; updateInstallPending?: () => boolean } = {},
) {
  const registry = new Map<string, Registration>();
  const duplicates: string[] = [];
  const registrars: string[] = [];
  const wrapped = new Map<string, Listener>();
  const router = new IpcRouter({
    register: (channel, listener) => wrapped.set(channel, listener),
    trustedSender: (event) =>
      isMainFrameSender(event, options.mainWindowContents ? options.mainWindowContents() : mainContents),
    updateInstallPending: options.updateInstallPending ?? (() => false),
    contracts,
    // Mirrors main.ts. No registered channel may depend on it; see the consistency tests.
    defaultContract: z.tuple([pathInput]),
    tracesChannel: () => false,
    trace: async (_channel, run) => run(),
  });
  let module = '';
  const add = (
    channel: string,
    kind: Kind,
    listener: Mock<Listener>,
    source = String(listener.getMockImplementation()),
  ) => {
    if (registry.has(channel)) duplicates.push(channel);
    registry.set(channel, {
      kind,
      module,
      source,
      listener,
      invoke: (event, ...args) => Promise.resolve().then(() => wrapped.get(channel)!(event, ...args)),
    });
  };
  const recording: Pick<IpcRouter, 'handle' | 'handleConcurrent' | 'handleWorkflow'> = {
    handle: (channel, listener) => {
      const spy = vi.fn(listener);
      router.handle(channel, spy);
      add(channel, 'queued', spy);
    },
    handleConcurrent: (channel, listener) => {
      const spy = vi.fn(listener);
      router.handleConcurrent(channel, spy);
      add(channel, 'concurrent', spy);
    },
    handleWorkflow: (channel, listener, queued) => {
      const spy = vi.fn(listener);
      router.handleWorkflow(channel, spy, queued);
      add(channel, 'workflow', spy);
    },
  };
  const facade = Object.assign(Object.create(router) as IpcRouter, recording);
  // Compile the real main.ts registrar, injecting its native dependencies rather than
  // loading app startup. This preserves trust/admission ordering and cleanup behavior.
  const mainSource = ts.createSourceFile(
    'main.ts',
    await readSource('main.ts'),
    ts.ScriptTarget.Latest,
    true,
  );
  const registrar = mainSource.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'captureWorkflowRegistrar',
  );
  if (!registrar) throw new Error('main.ts has no captureWorkflowRegistrar.');
  const compiledRegistrar = ts.transpileModule(registrar.getText(mainSource), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const createCaptureRegistrar = new vm.Script(
    `${compiledRegistrar}; captureWorkflowRegistrar`,
  ).runInNewContext({
    ipcMain: { handle: (channel: string, listener: Listener) => wrapped.set(channel, listener) },
    workflowOutcome,
    NativeWorkflowError,
    captureAdmissionGate: { acquire: () => ({}), revoke: () => undefined, release: () => undefined },
    cancelCaptureDelay: () => undefined,
    settleCaptureOverlay: () => undefined,
    diagnostics: { run: (_channel: string, run: () => unknown) => run() },
  }) as (router: IpcRouter) => CaptureWorkflowRegistrar;
  const registerCapture = createCaptureRegistrar(router);
  const handleCaptureWorkflow: CaptureWorkflowRegistrar = (channel, listener) => {
    const spy = vi.fn(listener);
    registerCapture(channel, spy);
    add(channel, 'capture', spy as unknown as Mock<Listener>, String(listener));
  };
  const files = (await fs.readdir(electronDirectory))
    .filter((name) => /^ipc-.+\.ts$/.test(name) && !name.endsWith('.test.ts'))
    .sort();
  for (const file of files) {
    module = file;
    const exports = (await import(/* @vite-ignore */ `./${file.slice(0, -3)}.js`)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(exports)) {
      if (!/^register\w+Ipc$/.test(name) || typeof value !== 'function') continue;
      registrars.push(name);
      if (value.length === 3) value(facade, handleCaptureWorkflow, host);
      else value(facade, host);
    }
  }
  return { registry, duplicates, registrars, files };
}

const failure = (result: unknown) => result as Extract<WorkflowResult<unknown>, { ok: false }>;
const isResultKind = (kind: Kind) => kind === 'workflow' || kind === 'capture';

let root: string;
let workspace: string;
let project: string;
let outsideProject: string;
let linkedProject: string;
const authorize = vi.fn((projectPath: string) => assertProjectPath(workspace, projectPath));
const { host, reached } = tripwireHost({
  assertProjectPath: authorize,
  workspaceOrThrow: () => workspace,
  backupService: { recoverInterruptedRestores: async () => undefined },
  pendingCapturePng: Buffer.from('buffered capture'),
});
let registry: Map<string, Registration>;
let duplicates: string[];
let registrars: string[];
let moduleFiles: string[];
const channelsOf = (...kinds: Kind[]) =>
  sorted([...registry].filter(([, entry]) => kinds.includes(entry.kind)).map(([channel]) => channel));
const entry = (channel: string) => {
  const found = registry.get(channel);
  if (!found) throw new Error(`No handler is registered for ${channel}.`);
  return found;
};

beforeAll(async () => {
  senderCheck = await loadSenderCheck();
  ({ registry, duplicates, registrars, files: moduleFiles } = await registerHandlerModules(host));
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ipc-boundary-')));
  workspace = path.join(root, 'workspace');
  project = path.join(workspace, 'project');
  outsideProject = path.join(root, 'outside', 'project');
  linkedProject = path.join(workspace, 'linked-project');
  for (const folder of [project, outsideProject]) {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'project.json'), JSON.stringify(emptyProject('Project', '')));
  }
  await fs.symlink(outsideProject, linkedProject, process.platform === 'win32' ? 'junction' : 'dir');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  reached.length = 0;
  authorize.mockClear();
  electron.openPath.mockClear();
  for (const registration of registry.values()) registration.listener.mockClear();
});

describe('renderer bridge, contracts and handlers stay consistent', () => {
  let invoked: string[];
  let listened: string[];
  let preloadSource: string;

  beforeAll(async () => {
    // The bridge skips text recognition off Windows; exercise the Windows bridge on every host.
    preloadSource = await readSource('preload.cts');
    const compiled = ts.transpileModule(preloadSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    new vm.Script(compiled.outputText, { filename: 'preload.cjs' }).runInNewContext({
      exports: {},
      require: (name: string) => {
        if (name !== 'electron') throw new Error(`Unexpected preload dependency: ${name}`);
        return electron.module;
      },
      process: { platform: 'win32' },
    });
    const bridge = electron.exposed.imnota as Record<string, unknown>;
    for (const member of Object.values(bridge))
      if (typeof member === 'function') await (member as (...args: unknown[]) => unknown)(() => undefined);
    invoked = sorted(electron.invoked);
    listened = sorted(electron.listened);
    preloadSource = await readSource('preload.cts');
  });

  it('exercises every channel written in the preload source', () => {
    expect(invoked.length).toBeGreaterThan(50);
    expect(invoked).toEqual(literals(preloadSource, /ipcRenderer\.invoke\(\s*'([^']+)'/g));
    expect(listened).toEqual(literals(preloadSource, /ipcRenderer\.on\(\s*'([^']+)'/g));
  });

  it('registers exactly one handler for every channel the preload invokes, and no others', () => {
    expect(duplicates).toEqual([]);
    expect(sorted(registry.keys())).toEqual(invoked);
  });

  it('declares a contract for every router-validated channel and none for any other channel', () => {
    // A queued or concurrent channel without its own entry would silently accept one path.
    expect(sorted(Object.keys(contracts))).toEqual(channelsOf('queued', 'concurrent'));
  });

  it('wires every handler module and the main-frame sender check into main.ts', async () => {
    const main = await readSource('main.ts');
    expect(registrars.length).toBeGreaterThan(0);
    expect(literals(main, /^ {2}(register\w+Ipc)\(router, /gm)).toEqual(sorted(registrars));
    expect(
      sorted(moduleFiles.filter((file) => main.includes(`from './${file.replace(/\.ts$/, '.js')}'`))),
    ).toEqual(moduleFiles);
    expect(main).toMatch(
      /new IpcRouter\(\{[^}]*\n {4}contracts,\n {4}defaultContract: z\.tuple\(\[pathInput\]\),/,
    );
  });

  it('sends every event the preload listens for, and listens for every event sent to the main window', async () => {
    const sent: string[] = [];
    for (const file of await fs.readdir(electronDirectory)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      sent.push(...literals(await readSource(file), /webContents\.send\(\s*'([^']+)'/g));
    }
    expect(sorted(sent.filter((channel) => !channel.startsWith('capture-overlay:')))).toEqual(listened);
  });

  it('keeps the capture overlay preload and its main-process listeners in step', async () => {
    const overlay = await readSource('capture-overlay-preload.cts');
    const main = await readSource('main.ts');
    const capture = await readSource('ipc-capture.ts');
    const overlayOnly = (channels: string[]) =>
      channels.filter((channel) => channel.startsWith('capture-overlay:'));
    expect(literals(overlay, /ipcRenderer\.invoke\(\s*'([^']+)'/g)).toEqual(
      overlayOnly(literals(main, /ipcMain\.handle\(\s*'([^']+)'/g)),
    );
    expect(literals(overlay, /ipcRenderer\.send\(\s*'([^']+)'/g)).toEqual(
      overlayOnly(literals(main, /ipcMain\.on\(\s*'([^']+)'/g)),
    );
    expect(literals(overlay, /ipcRenderer\.on\(\s*'([^']+)'/g)).toEqual(
      overlayOnly(literals(main + capture, /webContents\.send\(\s*'([^']+)'/g)),
    );
  });
});

describe('sender check', () => {
  const otherContents = { mainFrame: { name: 'other window frame' } };
  const untrusted: [string, unknown][] = [
    ['another window', { sender: otherContents, senderFrame: otherContents.mainFrame }],
    ['a subframe of the main window', { sender: mainContents, senderFrame: { name: 'subframe' } }],
    ['a main-window frame that no longer exists', { sender: mainContents, senderFrame: null }],
    [
      'another window presenting the main frame',
      { sender: otherContents, senderFrame: mainContents.mainFrame },
    ],
  ];

  it.each(untrusted)('refuses every channel when called from %s', async (_label, event) => {
    for (const [channel, registration] of registry) {
      const call = registration.invoke(event as IpcMainInvokeEvent, project);
      if (isResultKind(registration.kind))
        expect(failure(await call), channel).toMatchObject({
          ok: false,
          error: { code: 'permission-denied', message: 'Untrusted IPC sender.' },
        });
      else await expect(call, channel).rejects.toThrow('Untrusted IPC sender.');
      expect(registration.listener, channel).not.toHaveBeenCalled();
    }
    expect(reached).toEqual([]);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('refuses every channel while there is no main window', async () => {
    const closed = tripwireHost({});
    const withoutWindow = await registerHandlerModules(closed.host, { mainWindowContents: () => undefined });
    for (const [channel, registration] of withoutWindow.registry) {
      const call = registration.invoke(trusted, project);
      if (isResultKind(registration.kind)) expect(failure(await call).ok, channel).toBe(false);
      else await expect(call, channel).rejects.toThrow('Untrusted IPC sender.');
      expect(registration.listener, channel).not.toHaveBeenCalled();
    }
    expect(closed.reached).toEqual([]);
  });

  it('accepts only the top frame of the current window contents', () => {
    expect(isMainFrameSender(trusted, trusted.sender)).toBe(true);
    for (const [, event] of untrusted)
      expect(isMainFrameSender(event as IpcMainInvokeEvent, trusted.sender)).toBe(false);
    expect(isMainFrameSender(trusted, undefined)).toBe(false);
    expect(isMainFrameSender(trusted, null)).toBe(false);
  });
});

describe('wrongly typed payloads', () => {
  it.each([[[42]], [[null]], [[[]]], [[42, 'extra']], [[{ unexpected: true }, 'extra']]])(
    'rejects %j on every router-validated channel before its handler runs',
    async (args) => {
      for (const channel of channelsOf('queued', 'concurrent')) {
        await expect(entry(channel).invoke(trusted, ...args), channel).rejects.toMatchObject({
          name: 'ZodError',
        });
        expect(entry(channel).listener, channel).not.toHaveBeenCalled();
      }
      expect(reached).toEqual([]);
    },
  );

  // Workflow handlers validate their own arguments. This one takes none and ignores any it is sent.
  const ignoresArguments = ['workflow:capture:renderer-ready'];

  it.each([[[42]], [[{ unexpected: true }, 'extra']]])(
    'reports %j as invalid input on every workflow channel without reaching the host',
    async (args) => {
      for (const channel of channelsOf('workflow', 'capture')) {
        if (ignoresArguments.includes(channel)) continue;
        expect(failure(await entry(channel).invoke(trusted, ...args)), channel).toMatchObject({
          ok: false,
          error: { code: 'invalid-input' },
        });
      }
      expect(reached).toEqual([]);
      expect(authorize).not.toHaveBeenCalled();
    },
  );

  it('keeps the unvalidated workflow channels to the reviewed list', () => {
    expect(channelsOf('workflow', 'capture')).toEqual(expect.arrayContaining(ignoresArguments));
  });

  it('has no handler for a channel the application does not define', () => {
    for (const channel of [
      'projects:exec',
      'system:open-external',
      'workflow:shell',
      'constructor',
      '__proto__',
    ])
      expect(registry.has(channel), channel).toBe(false);
  });
});

const revision = 'a'.repeat(64);
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
const snapshotId = `snapshot-20260101T000000000Z-${'0'.repeat(32)}`;
const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const projectData = () => emptyProject('Project', '');
const screenshot = () => ({
  collectionId: '001-collection',
  id: 'shot_1',
  originalFilename: 'capture.png',
  storedFilename: 'capture.png',
  title: 'Capture',
  description: '',
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  priority: 'medium',
  annotationFile: 'collections/001-collection/annotations/capture.png.json',
  descriptionFile: 'collections/001-collection/descriptions/capture.png.md',
  originalWidth: 10,
  originalHeight: 10,
  includeInExport: true,
});

/** A well-formed call for every channel whose handler authorizes a renderer-supplied project path. */
const projectPathCalls: Record<string, (projectPath: string) => unknown[]> = {
  'projects:load': (projectPath) => [projectPath],
  'projects:save': (projectPath) => [projectPath, projectData()],
  'projects:duplicate': (projectPath) => [projectPath],
  'projects:archive': (projectPath) => [projectPath],
  'projects:delete': (projectPath) => [projectPath],
  'collections:edit': (projectPath) => [{ projectPath, action: 'create' }],
  'projects:save-screenshot': (projectPath) => [
    { projectPath, screenshot: screenshot(), annotations: [], contentRevision: revision },
  ],
  'screenshots:load-content': (projectPath) => [{ projectPath, screenshot: screenshot() }],
  'screenshots:duplicate': (projectPath) => [{ projectPath, screenshot: screenshot() }],
  'screenshots:import-files': (projectPath) => [{ projectPath, paths: [path.join(root, 'image.png')] }],
  'screenshots:paste': (projectPath) => [projectPath, '001-collection'],
  'screenshots:delete': (projectPath) => [{ projectPath, screenshotId: 'shot_1' }],
  'screenshots:undo-delete': (projectPath) => [{ projectPath, undoToken: 'undo-token' }],
  'content:create': (projectPath) => [{ projectPath, collectionId: '001-collection', kind: 'text' }],
  'content:load': (projectPath) => [{ projectPath, itemId: 'item_1' }],
  'content:save': (projectPath) => [
    { projectPath, itemId: 'item_1', contentRevision: revision, markdown: 'Text' },
  ],
  'content:duplicate': (projectPath) => [{ projectPath, itemId: 'item_1' }],
  'content:delete': (projectPath) => [{ projectPath, itemId: 'item_1' }],
  'content:undo-delete': (projectPath) => [{ projectPath, undoToken: 'undo-token' }],
  'exports:annotated-image': (projectPath) => [
    { projectPath, filename: 'annotated.png', dataUrl: pngDataUrl },
  ],
  'exports:package': (projectPath) => [
    {
      projectPath,
      markdown: '# Context',
      annotatedImages: [{ filename: 'annotated.png', dataUrl: pngDataUrl }],
      includeOriginal: true,
      includeAnnotations: true,
    },
  ],
  'recovery:save': (projectPath) => [{ projectPath, project: projectData(), annotations: {} }],
  'recovery:clear': (projectPath) => [projectPath],
  'backups:create': (projectPath) => [{ projectPath }],
  'backups:restore': (projectPath) => [
    { snapshotId, mode: 'in-place', projectPath, confirmation: 'RESTORE' },
  ],
  'workflow:project-watch:start': (projectPath) => [{ projectPath }],
  'workflow:capture:commit-buffered': (projectPath) => [{ projectPath, collectionId: '001-collection' }],
};

/** Channels that mention a project path but whose authorization this file cannot observe. */
const authorizedElsewhere: Record<string, string> = {
  'projects:open-dialog': 'authorizes the folder chosen in a native dialog, not a renderer argument',
  'projects:update-metadata': 'main.ts mutateProjectMetadata authorizes the path',
  'projects:set-archived': 'main.ts mutateProjectMetadata authorizes the path',
  'workflow:prompt-export:start': 'PromptBundleWorkflow authorizes the path (prompt-bundle-workflow.test.ts)',
  'workflow:capture:region': 'platform and permission gates precede authorization',
  'workflow:capture:repeat-last-region': 'platform and permission gates precede authorization',
};

describe('project path authorization', () => {
  const escapes = (): [string, string, RegExp][] => [
    [
      'parent traversal',
      [project, '..', '..', 'outside', 'project'].join(path.sep),
      /outside the selected workspace/,
    ],
    ['forward-slash traversal', `${project}/../../outside/project`, /outside the selected workspace/],
    ['an absolute path outside the workspace', outsideProject, /outside the selected workspace/],
    ['the workspace itself', workspace, /outside the selected workspace/],
    ['a relative path', 'project', /outside the selected workspace/],
    ['a link inside the workspace that leaves it', linkedProject, /Linked workspace paths/],
  ];

  it('has a rejection case for every handler that authorizes a renderer-supplied project path', () => {
    const authorizing = [...registry]
      .filter(([, registration]) => /projectPath|assertProjectPath/.test(registration.source))
      .map(([channel]) => channel);
    expect(authorizing.length).toBeGreaterThan(20);
    expect(sorted(authorizing)).toEqual(
      sorted([...Object.keys(projectPathCalls), ...Object.keys(authorizedElsewhere)]),
    );
  });

  it('accepts a real project folder inside the workspace', async () => {
    await expect(assertProjectPath(workspace, project)).resolves.toBe(project);
    await expect(assertProjectPath(workspace, `${project}${path.sep}.${path.sep}`)).resolves.toBe(project);
  });

  it('refuses paths that leave the workspace, in every form', async () => {
    for (const [label, target, message] of escapes())
      await expect(assertProjectPath(workspace, target), label).rejects.toThrow(message);
    for (const target of [
      'C:\\Windows\\System32',
      'Z:project',
      '\\\\127.0.0.1\\imnota-missing-share\\project',
      `\\\\?\\${outsideProject}`,
      `${workspace}\\..\\outside\\project`,
      path.join(workspace, 'missing-project'),
      path.join(project, 'project.json'),
      path.join(workspace, '.imnota-backups', 'project'),
    ])
      await expect(assertProjectPath(workspace, target), target).rejects.toThrow();
    await expect(assertProjectPath('', project)).rejects.toThrow('Choose a workspace folder');
    await expect(assertProjectPath(null, project)).rejects.toThrow('Choose a workspace folder');
    await expect(assertProjectPath(workspace, '')).rejects.toMatchObject({ name: 'ZodError' });
    await expect(assertProjectPath(workspace, 'p'.repeat(2001))).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('refuses a project whose reserved folders or files are links', async () => {
    const candidate = path.join(workspace, 'linked-contents');
    await fs.mkdir(candidate);
    await fs.writeFile(path.join(candidate, 'project.json'), '{}');
    await expect(assertProjectPath(workspace, candidate)).resolves.toBe(candidate);
    await fs.symlink(
      path.join(root, 'outside'),
      path.join(candidate, 'collections'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(assertProjectPath(workspace, candidate)).rejects.toThrow('Linked workspace paths');
  });

  it('refuses a workspace reached through a link', async () => {
    const alias = path.join(root, 'workspace-alias');
    await fs.symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(assertProjectPath(alias, path.join(alias, 'project'))).rejects.toThrow(
      'Linked workspace paths',
    );
    await expect(assertNoLinks(path.join(alias, 'project', 'new-file.md'))).rejects.toThrow(
      'Linked workspace paths',
    );
    await expect(
      assertNoLinks(path.join(project, 'not-created-yet', 'new-file.md')),
    ).resolves.toBeUndefined();
  });

  it('treats only real descendants as inside a folder', () => {
    expect(isWithin(workspace, project)).toBe(true);
    expect(isWithin(workspace, workspace)).toBe(true);
    expect(isWithin(workspace, path.join(workspace, '..project'))).toBe(true);
    expect(isWithin(workspace, `${workspace}-sibling`)).toBe(false);
    expect(isWithin(workspace, path.join(workspace, '..'))).toBe(false);
    expect(isWithin(workspace, `${project}/../../outside`)).toBe(false);
    expect(isWithin(project, workspace)).toBe(false);
    if (process.platform === 'win32') {
      expect(isWithin('C:\\workspace', 'D:\\workspace\\project')).toBe(false);
      expect(isWithin('C:\\workspace', '\\\\server\\share\\workspace\\project')).toBe(false);
      expect(isWithin('C:\\workspace', 'C:/workspace/project')).toBe(true);
      expect(isWithin('C:\\workspace', 'C:\\workspace\\..\\secret')).toBe(false);
    }
  });

  it('stops every path-taking handler at authorization for each escaping path', async () => {
    for (const [channel, call] of Object.entries(projectPathCalls)) {
      const registration = entry(channel);
      for (const [label, target, message] of escapes()) {
        authorize.mockClear();
        const outcome = registration.invoke(trusted, ...call(target));
        if (isResultKind(registration.kind))
          expect(failure(await outcome), `${channel}: ${label}`).toMatchObject({
            ok: false,
            error: { message: expect.stringMatching(message) },
          });
        else await expect(outcome, `${channel}: ${label}`).rejects.toThrow(message);
        // The payload passed its contract and the handler asked for authorization of this path.
        expect(authorize, `${channel}: ${label}`).toHaveBeenCalledWith(target);
      }
      expect(reached, channel).toEqual([]);
    }
  });

  it('rejects an oversized project path before authorization', async () => {
    const oversized = path.join(workspace, 'p'.repeat(2001));
    for (const [channel, call] of Object.entries(projectPathCalls)) {
      const registration = entry(channel);
      const outcome = registration.invoke(trusted, ...call(oversized));
      if (isResultKind(registration.kind))
        expect(failure(await outcome), channel).toMatchObject({
          ok: false,
          error: { code: 'invalid-input' },
        });
      else await expect(outcome, channel).rejects.toMatchObject({ name: 'ZodError' });
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(reached).toEqual([]);
  });
});

type InvalidCase = [channel: string, label: string, args: unknown[]];
const long = (length: number) => 'x'.repeat(length);
const traversalNames = [
  '..',
  '../outside',
  'nested/name',
  'nested\\name',
  'C:name',
  'trailing.',
  'trailing ',
  'nul\u0000',
];
const withNames = (channel: string, field: string, build: (name: string) => unknown[]): InvalidCase[] =>
  traversalNames.map((name) => [channel, `${field} ${JSON.stringify(name)}`, build(name)]);
const anyPath = 'project';
const call = (channel: string, change: (payload: Record<string, unknown>) => void): unknown[] => {
  const args = structuredClone(projectPathCalls[channel](anyPath));
  change(args[0] as Record<string, unknown>);
  return args;
};

/** Payloads that must be refused before any handler work, grouped by the module that registers them. */
const invalidCases: Record<string, InvalidCase[]> = {
  'ipc-projects.ts': [
    ['projects:create', 'an empty name', [{ name: '', description: '' }]],
    ['projects:create', 'an oversized name', [{ name: long(121), description: '' }]],
    ['projects:create', 'an oversized description', [{ name: 'Project', description: long(3001) }]],
    ['projects:create', 'an unknown icon', [{ name: 'Project', description: '', icon: '../icon' }]],
    ['projects:load', 'an empty path', ['']],
    ['projects:load', 'an oversized path', [long(2001)]],
    ['projects:load', 'a second argument', [anyPath, anyPath]],
    ['projects:delete', 'an object instead of a path', [{ projectPath: anyPath }]],
    ['projects:duplicate', 'no argument', []],
    ['projects:archive', 'a list of paths', [[anyPath]]],
    ['projects:save', 'a project that is not a project', [anyPath, { name: 'Project' }]],
    [
      'projects:update-metadata',
      'a malformed revision',
      [{ projectPath: anyPath, expectedRevision: '../revision', patch: { name: 'Name' } }],
    ],
    [
      'projects:update-metadata',
      'an empty patch',
      [{ projectPath: anyPath, expectedRevision: revision, patch: {} }],
    ],
    [
      'projects:update-metadata',
      'a patch of fields the renderer may not set',
      [{ projectPath: anyPath, expectedRevision: revision, patch: { id: 'project_other' } }],
    ],
    [
      'projects:set-archived',
      'a non-boolean flag',
      [{ projectPath: anyPath, expectedRevision: revision, archived: 'yes' }],
    ],
    ['projects:search', 'an excessive limit', [{ query: 'a', limit: 101 }]],
    ['projects:search-content', 'an oversized query', [{ workspacePath: anyPath, query: long(501) }]],
    ['projects:search-content', 'an unknown field', [{ workspacePath: anyPath, query: 'a', root: '/' }]],
    ['collections:edit', 'an unknown action', [{ projectPath: anyPath, action: 'delete' }]],
    ...withNames('collections:edit', 'collectionId', (collectionId) => [
      { projectPath: anyPath, action: 'archive', collectionId },
    ]),
  ],
  'ipc-screenshots.ts': [
    ...withNames('projects:save-screenshot', 'storedFilename', (name) =>
      call('projects:save-screenshot', (input) =>
        Object.assign(input.screenshot as object, { storedFilename: name }),
      ),
    ),
    [
      'projects:save-screenshot',
      'an annotation file outside its collection',
      call('projects:save-screenshot', (input) =>
        Object.assign(input.screenshot as object, {
          annotationFile: 'collections/../annotations/capture.png.json',
        }),
      ),
    ],
    [
      'screenshots:load-content',
      'an absolute description file',
      call('screenshots:load-content', (input) =>
        Object.assign(input.screenshot as object, { descriptionFile: '/etc/passwd' }),
      ),
    ],
    [
      'projects:save-screenshot',
      'a malformed content revision',
      call('projects:save-screenshot', (input) => (input.contentRevision = 'latest')),
    ],
    ['screenshots:import-files', 'no files', [{ projectPath: anyPath, paths: [] }]],
    [
      'screenshots:import-files',
      'too many files',
      [{ projectPath: anyPath, paths: Array(51).fill(anyPath) }],
    ],
    ['screenshots:import-files', 'an oversized source path', [{ projectPath: anyPath, paths: [long(2001)] }]],
    ...withNames('screenshots:import-files', 'collectionId', (collectionId) => [
      { projectPath: anyPath, paths: [anyPath], collectionId },
    ]),
    ...withNames('screenshots:paste', 'collectionId', (collectionId) => [anyPath, collectionId]),
    ['screenshots:delete', 'an empty screenshot id', [{ projectPath: anyPath, screenshotId: '' }]],
    ['screenshots:delete', 'an oversized screenshot id', [{ projectPath: anyPath, screenshotId: long(201) }]],
    ...withNames('screenshots:undo-delete', 'undoToken', (undoToken) => [
      { projectPath: anyPath, undoToken },
    ]),
  ],
  'ipc-content.ts': [
    [
      'content:create',
      'an unknown kind',
      [{ projectPath: anyPath, collectionId: '001-collection', kind: 'script' }],
    ],
    [
      'content:create',
      'an unknown field',
      [{ projectPath: anyPath, collectionId: '001-collection', kind: 'text', filename: 'a.md' }],
    ],
    ...withNames('content:create', 'collectionId', (collectionId) => [
      { projectPath: anyPath, collectionId, kind: 'text' },
    ]),
    ['content:load', 'an oversized item id', [{ projectPath: anyPath, itemId: long(201) }]],
    ['content:save', 'oversized text', call('content:save', (input) => (input.markdown = long(2_000_001)))],
    ...withNames('content:save', 'image filename', (filename) =>
      call('content:save', (input) => (input.image = { filename, dataUrl: pngDataUrl, width: 1, height: 1 })),
    ),
    [
      'content:save',
      'an image that is not a PNG data URL',
      call(
        'content:save',
        (input) =>
          (input.image = { filename: 'a.png', dataUrl: 'data:text/html;base64,AAAA', width: 1, height: 1 }),
      ),
    ],
    [
      'content:save',
      'oversized image dimensions',
      call(
        'content:save',
        (input) => (input.image = { filename: 'a.png', dataUrl: pngDataUrl, width: 16_385, height: 1 }),
      ),
    ],
    ...withNames('content:undo-delete', 'undoToken', (undoToken) => [{ projectPath: anyPath, undoToken }]),
  ],
  'ipc-system.ts': [
    ...withNames('exports:annotated-image', 'filename', (filename) => [
      { projectPath: anyPath, filename, dataUrl: pngDataUrl },
    ]),
    ...withNames('exports:annotated-image', 'collectionId', (collectionId) => [
      { projectPath: anyPath, filename: 'a.png', dataUrl: pngDataUrl, collectionId },
    ]),
    [
      'exports:annotated-image',
      'a file URL instead of image data',
      [{ projectPath: anyPath, filename: 'a.png', dataUrl: 'file:///etc/passwd' }],
    ],
    ...withNames('exports:package', 'image filename', (filename) =>
      call('exports:package', (input) => (input.annotatedImages = [{ filename, dataUrl: pngDataUrl }])),
    ),
    [
      'exports:package',
      'oversized markdown',
      call('exports:package', (input) => (input.markdown = long(2_000_001))),
    ],
    [
      'exports:package',
      'too many images',
      call(
        'exports:package',
        (input) => (input.annotatedImages = Array(1001).fill({ filename: 'a.png', dataUrl: pngDataUrl })),
      ),
    ],
    ['system:open-path', 'an oversized path', [long(2001)]],
    ['system:open-path', 'an empty path', ['']],
    ['system:copy-text', 'oversized text', [long(2_000_001)]],
    ['system:copy-image', 'a remote image', ['https://example.com/image.png']],
    ['system:copy-context', 'an unknown field', [{ markdown: 'a', imageDataUrl: pngDataUrl, path: anyPath }]],
    [
      'onboarding:prepare-handoff',
      'a chosen filename',
      [
        {
          markdown: 'a',
          imageDataUrl: pngDataUrl,
          markdownFilename: '../component-search.md',
          pngFilename: 'component-search.png',
        },
      ],
    ],
    ['onboarding:copy-handoff', 'a session id that is a path', [{ sessionId: '../session', action: 'rich' }]],
    ['onboarding:open-handoff', 'an unknown target', [{ sessionId, target: 'executable' }]],
    [
      'recovery:save',
      'annotations that are not lists',
      call('recovery:save', (input) => (input.annotations = { a: 'b' })),
    ],
    ['update:install', 'an argument', ['https://example.com/update.exe']],
  ],
  'ipc-settings.ts': [
    ['settings:get', 'an argument', ['workspacePath']],
    ['settings:choose-workspace', 'a renderer-chosen folder', [anyPath]],
    ['backups:choose-location', 'a renderer-chosen folder', [anyPath]],
    ['backups:create', 'an unknown field', [{ projectPath: anyPath, destination: anyPath }]],
    ['backups:inspect', 'a snapshot id that is a path', [{ snapshotId: `../${snapshotId}` }]],
    ['backups:export', 'a renderer-chosen destination', [{ snapshotId, filePath: anyPath }]],
    [
      'backups:restore',
      'an unconfirmed in-place restore',
      [{ snapshotId, mode: 'in-place', projectPath: anyPath }],
    ],
    ['backups:restore', 'an unknown mode', [{ snapshotId, mode: 'overwrite', projectPath: anyPath }]],
  ],
  'ipc-preferences.ts': [
    ['workflow:preferences:get', 'an argument', [{}]],
    ['workflow:preferences:set', 'a non-object update', ['enabled']],
    ['workflow:window:raise', 'an argument', [1]],
    ['workflow:ocr:recognize', 'an unknown field', [{ pngDataUrl, path: anyPath }]],
    [
      'workflow:ocr:recognize',
      'a negative crop',
      [{ pngDataUrl, crop: { x: -1, y: 0, width: 1, height: 1 } }],
    ],
  ],
  'ipc-prompt-export.ts': [
    ...withNames('workflow:prompt-export:start', 'collectionId', (collectionId) => [
      { projectPath: anyPath, collectionId, bundles: [{ bundleNumber: 1, width: 1, height: 1 }] },
    ]),
    [
      'workflow:prompt-export:start',
      'no bundles',
      [{ projectPath: anyPath, collectionId: '001-collection', bundles: [] }],
    ],
    [
      'workflow:prompt-export:start',
      'a text-only bundle with dimensions',
      [
        {
          projectPath: anyPath,
          collectionId: '001-collection',
          bundles: [{ bundleNumber: 1, hasImage: false, width: 1, height: 1 }],
        },
      ],
    ],
    [
      'workflow:prompt-export:write',
      'a session id that is a path',
      [{ sessionId: '../session', bundleNumber: 1, markdown: 'a' }],
    ],
    ['workflow:prompt-export:write', 'bundle number zero', [{ sessionId, bundleNumber: 0, markdown: 'a' }]],
    ['workflow:prompt-export:write', 'empty markdown', [{ sessionId, bundleNumber: 1, markdown: '' }]],
    ...withNames('workflow:prompt-export:write', 'source filename', (name) => [
      { sessionId, bundleNumber: 1, markdown: 'a', sourceAssets: [{ filename: name, source: '{}' }] },
    ]).filter(([, label]) => !/trailing|nul/.test(label)),
    [
      'workflow:prompt-export:write',
      'a source file that is not JSON',
      [{ sessionId, bundleNumber: 1, markdown: 'a', sourceAssets: [{ filename: 'run.cmd', source: '' }] }],
    ],
    ['workflow:prompt-export:finish', 'an unknown field', [{ sessionId, target: anyPath }]],
    ['workflow:prompt-export:cancel', 'a session id with separators', [{ sessionId: 'a/b' }]],
    ['workflow:prompt-export:read', 'a fractional bundle number', [{ sessionId, bundleNumber: 1.5 }]],
    ['workflow:prompt-export:copy', 'an unknown target', [{ sessionId, bundleNumber: 1, target: 'shell' }]],
    [
      'workflow:prompt-export:open',
      'an unknown target',
      [{ sessionId, bundleNumber: 1, target: '../folder' }],
    ],
  ],
  'ipc-capture.ts': [
    ['workflow:capture:region', 'a project without a collection', [{ projectPath: anyPath }]],
    ['workflow:capture:region', 'an unknown delay', [{ delaySeconds: 4 }]],
    ['workflow:capture:region', 'an unknown overlay mode', [{ overlayMode: 'everything' }]],
    ...withNames('workflow:capture:region', 'collectionId', (collectionId) => [
      { projectPath: anyPath, collectionId },
    ]),
    ...withNames('workflow:capture:repeat-last-region', 'collectionId', (collectionId) => [
      { projectPath: anyPath, collectionId },
    ]),
    ...withNames('workflow:capture:commit-buffered', 'collectionId', (collectionId) => [
      { projectPath: anyPath, collectionId },
    ]),
    ['workflow:capture:discard-buffered', 'an argument', [anyPath]],
    ['workflow:capture:relaunch', 'an argument', [anyPath]],
    ['workflow:capture:repair-permission', 'an argument', [anyPath]],
  ],
  'ipc-project-watch.ts': [
    ['workflow:project-watch:start', 'an unknown field', [{ projectPath: anyPath, recursive: true }]],
    ['workflow:project-watch:start', 'an oversized path', [{ projectPath: long(2001) }]],
    ['workflow:project-watch:stop', 'a watch id that is a path', [{ watchId: '../watch' }]],
    ['workflow:project-watch:reload', 'an oversized watch id', [{ watchId: long(201) }]],
    [
      'workflow:project-watch:cas',
      'a malformed revision',
      [{ watchId: 'watch', expectedRevision: 'latest', project: projectData() }],
    ],
  ],
  'ipc-hosted-share.ts': [
    [
      'workflow:hosted-share:plan',
      'a session id that is a path',
      [{ sessionId: '../session', bundleNumbers: [1] }],
    ],
    ['workflow:hosted-share:plan', 'no bundles', [{ sessionId, bundleNumbers: [] }]],
    ['workflow:hosted-share:pair', 'an argument', ['https://example.com']],
    ['workflow:hosted-share:cancel', 'a request id that is not a UUID', [{ requestId: '../request' }]],
    ['workflow:hosted-share:revoke', 'an empty id', [{ id: '' }]],
    ['workflow:hosted-share:recovery-warning:dismiss', 'an id that is a path', [{ id: 'recovery:../x' }]],
  ],
};

describe('invalid payloads by handler module', () => {
  it('covers every handler module', () => {
    expect(sorted(Object.keys(invalidCases))).toEqual(
      sorted([...registry.values()].map((item) => item.module)),
    );
  });

  it('keeps the well-formed calls these cases are derived from valid', () => {
    for (const [channel, build] of Object.entries(projectPathCalls))
      if (contracts[channel])
        expect(contracts[channel].safeParse(build(anyPath)).success, channel).toBe(true);
  });

  describe.each(Object.entries(invalidCases))('%s', (module, cases) => {
    it.each(cases)('%s refuses %s', async (channel, _label, args) => {
      const registration = entry(channel);
      expect(registration.module).toBe(module);
      const outcome = registration.invoke(trusted, ...args);
      if (isResultKind(registration.kind)) {
        expect(failure(await outcome)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
      } else {
        await expect(outcome).rejects.toMatchObject({ name: 'ZodError' });
        expect(registration.listener).not.toHaveBeenCalled();
      }
      expect(authorize).not.toHaveBeenCalled();
      expect(reached).toEqual([]);
    });
  });
});

describe('workspace-scoped handlers in ipc-system.ts and ipc-projects.ts', () => {
  const open = (target: string) => entry('system:open-path').invoke(trusted, target);

  it('opens a regular folder inside the workspace', async () => {
    await open(project);
    expect(electron.openPath).toHaveBeenCalledExactlyOnceWith(project);
  });

  it('refuses to open anything outside the workspace, linked, or not a folder', async () => {
    await expect(open(outsideProject)).rejects.toThrow('outside the workspace');
    await expect(open([project, '..', '..', 'outside'].join(path.sep))).rejects.toThrow(
      'outside the workspace',
    );
    await expect(open(`${workspace}/../outside/project`)).rejects.toThrow('outside the workspace');
    await expect(open('project')).rejects.toThrow('outside the workspace');
    await expect(open(linkedProject)).rejects.toThrow('Linked workspace paths');
    await expect(open(path.join(linkedProject, 'exports'))).rejects.toThrow('Linked workspace paths');
    await expect(open(path.join(project, 'project.json'))).rejects.toThrow(
      'Only workspace folders can be opened.',
    );
    await expect(open(path.join(workspace, 'missing'))).rejects.toThrow();
    expect(electron.openPath).not.toHaveBeenCalled();
  });

  it('refuses a content search for a workspace other than the selected one', async () => {
    for (const workspacePath of [path.join(root, 'outside'), project, path.join(workspace, '..')])
      await expect(
        entry('projects:search-content').invoke(trusted, { workspacePath, query: 'secret' }),
        workspacePath,
      ).rejects.toThrow('The workspace changed.');
    // Only the cache invalidation of an unrelated handler may touch search; the scan never starts.
    expect(reached).toEqual([]);
  });
});
