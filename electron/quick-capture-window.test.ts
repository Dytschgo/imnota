// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;
interface TestWindow {
  webContents: { mainFrame: object; send: ReturnType<typeof vi.fn>; startDrag: ReturnType<typeof vi.fn> };
  showInactive: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  destroy(): void;
}

const native = vi.hoisted(() => ({
  handles: new Map<string, Handler>(),
  events: new Map<string, Handler>(),
  windows: [] as TestWindow[],
  writeImage: vi.fn(async () => undefined),
  windowLoad: vi.fn(async () => undefined),
}));
vi.mock('./native-clipboard.js', () => ({ nativeClipboard: { writeImage: native.writeImage } }));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      native.handles.set(channel, handler),
    on: (channel: string, handler: (...args: unknown[]) => unknown) => native.events.set(channel, handler),
  },
  screen: {
    getCursorScreenPoint: () => ({ x: -100, y: 200 }),
    getDisplayNearestPoint: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }),
  },
  nativeImage: {
    createFromBuffer: (png: Buffer) => {
      const image = {
        getSize: () => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }),
        isEmpty: () => false,
        resize: () => image,
        toDataURL: () => `data:image/png;base64,${png.toString('base64')}`,
      };
      return image;
    },
  },
  BrowserWindow: class {
    destroyed = false;
    handlers = new Map<string, Handler>();
    webContents = {
      mainFrame: {},
      send: vi.fn(),
      startDrag: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    hide = vi.fn();
    show = vi.fn();
    showInactive = vi.fn();
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    setOpacity = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    loadFile = native.windowLoad;
    loadURL = native.windowLoad;
    constructor(public options: unknown) {
      native.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return true;
    }
    isFocused() {
      return false;
    }
    on(name: string, handler: (...args: unknown[]) => unknown) {
      this.handlers.set(name, handler);
    }
    destroy() {
      this.destroyed = true;
      this.handlers.get('closed')?.();
    }
  },
}));

import { QuickCaptureWindow, quickCaptureBounds } from './quick-capture-window.js';

const fixtures: string[] = [];
beforeEach(() => {
  native.handles.clear();
  native.events.clear();
  native.windows.length = 0;
  native.writeImage.mockReset().mockResolvedValue(undefined);
  native.windowLoad.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fs.rm(fixture, { recursive: true, force: true });
});

function png(width = 720, height = 480) {
  const bytes = Buffer.alloc(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-quick-test-'));
  fixtures.push(directory);
  const insert = vi.fn(async () => undefined);
  const dependencies = {
    preload: '/preload.cjs',
    html: '/quick.html',
    temporaryDirectory: directory,
    corner: () => 'right' as const,
    updatePending: () => false,
    destinations: vi.fn(async () => [
      { projectPath: '/project', collectionId: 'collection', label: 'Project / Collection' },
    ]),
    authorize: vi.fn(async (target: string) => target),
    insert,
  };
  const manager = new QuickCaptureWindow(dependencies);
  manager.registerIpc();
  const id = await manager.add(png());
  const window = native.windows.at(-1)!;
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return {
    manager,
    id,
    dependencies,
    window,
    event,
    call: (channel: string, ...args: unknown[]) => native.handles.get(channel)!(event, ...args),
  };
}

it('bounds cards and editor inside negative-origin, small and mixed display work areas', () => {
  for (const area of [
    { x: -1920, y: -120, width: 1920, height: 1040 },
    { x: 1920, y: 0, width: 800, height: 600 },
    { x: 0, y: 0, width: 300, height: 200 },
  ])
    for (const corner of ['left', 'right'] as const)
      for (const editor of [false, true]) {
        const bounds = quickCaptureBounds(area, corner, editor, 3);
        expect(bounds.x).toBeGreaterThanOrEqual(area.x);
        expect(bounds.y).toBeGreaterThanOrEqual(area.y);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
      }
});

it('rejects every quick bridge call from another window or a subframe before exposing captures', async () => {
  const { event } = await setup();
  for (const handler of native.handles.values()) {
    expect(await handler({ sender: { mainFrame: {} }, senderFrame: {} })).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
    expect(await handler({ ...event, senderFrame: {} })).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
  }
  const foreign = { sender: { send: vi.fn(), startDrag: vi.fn(), mainFrame: {} }, senderFrame: {} };
  native.events.get('quick-capture:drag')!(foreign, { id: 'anything', revision: 1 });
  expect(foreign.sender.startDrag).not.toHaveBeenCalled();
});

it('keeps image actions available when the workspace cannot supply destination collections', async () => {
  const { call, dependencies, id, manager } = await setup();
  dependencies.destinations.mockRejectedValue(new Error('Workspace drive disconnected'));
  expect(await call('quick-capture:state')).toMatchObject({
    ok: true,
    value: { cards: [{ id }], destinations: [], destinationError: 'Workspace drive disconnected' },
  });
  native.writeImage.mockRejectedValueOnce(new Error('Clipboard busy'));
  expect(await call('quick-capture:copy', { id, revision: 1 })).toMatchObject({ ok: false });
  expect(manager.store.size).toBe(1);
  expect(await call('quick-capture:copy', { id, revision: 1 })).toMatchObject({ ok: true });
  expect(manager.store.size).toBe(1);
});

it('retains captures when a window cannot load, then permits a real reopen attempt', async () => {
  const { manager } = await setup();
  native.windows.at(-1)!.destroy();
  native.windowLoad.mockRejectedValueOnce(new Error('Renderer unavailable'));
  await expect(manager.show()).rejects.toThrow('Renderer unavailable');
  expect(manager.store.size).toBe(1);
  await manager.show();
  expect(native.windows.at(-1)!.showInactive).toHaveBeenCalledTimes(1);
});

it('starts native drag only for its staged version and retains exact PNG bytes after Discard', async () => {
  const { call, id, manager, event, window } = await setup();
  expect(await call('quick-capture:prepare-drag', { id, revision: 1 })).toMatchObject({ ok: true });
  const target = manager.store.item(id, 1).dragPath!;
  expect(await fs.readFile(target)).toEqual(png());
  native.events.get('quick-capture:drag')!(event, { id, revision: 1 });
  expect(window.webContents.startDrag).toHaveBeenCalledWith(expect.objectContaining({ file: target }));
  await call('quick-capture:discard', { id, revision: 1 });
  expect(await fs.readFile(target)).toEqual(png());
  native.events.get('quick-capture:drag')!(event, { id, revision: 1 });
  expect(window.webContents.startDrag).toHaveBeenCalledTimes(1);
  expect(window.webContents.send).toHaveBeenCalledWith(
    'quick-capture:drag-error',
    expect.stringMatching(/no longer pending/),
  );
});

it('keeps the isolated preload and all invoke/send/event channel contracts in step', async () => {
  await setup();
  const invokes: string[] = [],
    sends: string[] = [],
    listened: string[] = [];
  let bridge: Record<string, Handler> = {};
  const source = await fs.readFile(
    fileURLToPath(new URL('./quick-capture-preload.cts', import.meta.url)),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: {},
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name: string, value: typeof bridge) => {
          bridge = value;
        },
      },
      ipcRenderer: {
        invoke: (name: string) => {
          invokes.push(name);
          return Promise.resolve();
        },
        send: (name: string) => sends.push(name),
        on: (name: string) => listened.push(name),
        removeListener: vi.fn(),
      },
    }),
  });
  for (const [name, method] of Object.entries(bridge)) {
    if (name.startsWith('on')) method(() => undefined);
    else if (name === 'state' || name === 'hide') await method();
    else await method({ id: 'capture', revision: 1 });
  }
  expect(invokes.sort()).toEqual([...native.handles.keys()].sort());
  expect(sends.sort()).toEqual([...native.events.keys()].sort());
  expect(listened.sort()).toEqual(['quick-capture:changed', 'quick-capture:drag-error']);
});

it('carries an explicit Annotate request until the compact editor acknowledges it', async () => {
  const { manager, call, window } = await setup();
  const id = await manager.add(png(), true);
  expect(await call('quick-capture:state')).toMatchObject({ ok: true, value: { editorCaptureId: id } });
  expect(window.show).toHaveBeenCalled();
  expect(await call('quick-capture:resize', true)).toMatchObject({ ok: true });
  expect(await call('quick-capture:state')).toMatchObject({
    ok: true,
    value: { editorCaptureId: undefined },
  });
  expect(manager.store.size).toBe(2);
});
