// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { BrowserWindow } from 'electron';
import {
  NativeUiDriver,
  createSmokeCheckpoint,
  boundedSmokeDiagnostic,
  withSmokeDeadline,
  SMOKE_CAPTURE_PREPARATION,
  mapSourcePointToPromptPixel,
  pathIsWithin,
  safeArtifactPath,
  sourceBoxInteriorPoint,
  validateCreatedSmokeDirectory,
} from './smoke-native-driver.js';

const temporary: string[] = [];
afterEach(async () => {
  for (const target of temporary.splice(0)) await fs.rm(target, { recursive: true, force: true });
});

describe('native smoke driver', () => {
  it('maps native source pixels through expanded bounds and prompt offsets', () => {
    expect(mapSourcePointToPromptPixel({ x: 1200, y: 400 }, { x: 160, y: 76 }, { x: 32, y: 80 })).toEqual({
      x: 1072,
      y: 404,
    });
  });

  it('chooses an interior annotation point away from transformer edge anchors', () => {
    expect(sourceBoxInteriorPoint({ x: 790, y: 501 }, { width: 260, height: 42 }, 0.31)).toEqual({
      x: 818,
      y: 508,
    });
  });

  it('accepts only dedicated real fixture/artifact directories and contained PNG names', async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(parent);
    const fixture = path.join(parent, 'imnota-smoke-fixture');
    const artifacts = path.join(parent, 'imnota-verification-artifacts-test');
    await fs.mkdir(fixture);
    await fs.mkdir(artifacts);
    expect(await validateCreatedSmokeDirectory(fixture, 'fixture')).toBe(fixture);
    expect(await validateCreatedSmokeDirectory(artifacts, 'artifact')).toBe(artifacts);
    expect(safeArtifactPath(artifacts, '1280x800-workspace-dark.png')).toBe(
      path.join(artifacts, '1280x800-workspace-dark.png'),
    );
    expect(() => safeArtifactPath(artifacts, '../escape.png')).toThrow();
    expect(pathIsWithin(artifacts, artifacts)).toBe(false);
  });

  it.each([
    { width: 20, height: 20 },
    { width: 20, height: 0 },
    { width: 0, height: 0 },
  ])(
    'awaits visible image decoding at initial size %j without waiting on hidden lazy images',
    async (size) => {
      let completeVisible: (() => void) | undefined;
      let visibleStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        visibleStarted = resolve;
      });
      const visibleDecode = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            completeVisible = resolve;
            visibleStarted!();
          }),
      );
      const lazyDecode = vi.fn(() => new Promise(() => undefined));
      const image = (overrides = {}) => ({
        getBoundingClientRect: () => ({ width: 20, height: 20, left: 0, top: 0, right: 20, bottom: 20 }),
        closest: () => null,
        parentElement: null,
        style: { display: 'block', visibility: 'visible' },
        decode: lazyDecode,
        ...overrides,
      });
      const frames = vi.fn((callback) => callback());
      const result = runInNewContext(SMOKE_CAPTURE_PREPARATION, {
        document: {
          fonts: { ready: Promise.resolve() },
          images: [
            image({
              decode: visibleDecode,
              getBoundingClientRect: () => ({
                ...size,
                left: 0,
                top: 0,
                right: size.width,
                bottom: size.height,
              }),
            }),
            image({ closest: () => ({ hidden: true }) }),
            image({ style: { display: 'none', visibility: 'visible' } }),
            image({ parentElement: { style: { display: 'none', visibility: 'visible' } } }),
            image({ style: { display: 'block', visibility: 'hidden' } }),
            image({
              getBoundingClientRect: () => ({
                width: 20,
                height: 20,
                left: 900,
                top: 0,
                right: 920,
                bottom: 20,
              }),
            }),
          ],
        },
        getComputedStyle: (element: { style: object }) => element.style,
        window: { innerWidth: 800, innerHeight: 600 },
        requestAnimationFrame: frames,
      });
      await started;
      expect(visibleDecode).toHaveBeenCalledOnce();
      expect(lazyDecode).not.toHaveBeenCalled();
      expect(frames).not.toHaveBeenCalled();
      completeVisible!();
      await result;
      expect(frames).toHaveBeenCalledTimes(2);
    },
  );

  it('enforces required operation deadlines and preserves operation errors', async () => {
    const failure = new Error('original operation failure');
    await expect(
      withSmokeDeadline(
        async () => {
          throw failure;
        },
        20,
        'test operation',
      ),
    ).rejects.toBe(failure);
    await expect(withSmokeDeadline(() => new Promise(() => undefined), 5, 'test operation')).rejects.toThrow(
      'test operation timed out after 5ms',
    );
  });

  it('preserves an explicit evaluation allowance longer than the driver default', async () => {
    const window = {
      webContents: {
        executeJavaScript: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('ready'), 20))),
      },
    } as unknown as BrowserWindow;
    await expect(new NativeUiDriver(window, 5).evaluate('existing longer prompt wait', 2_000)).resolves.toBe(
      'ready',
    );
  });

  it('times out a non-resolving renderer lookup and page capture', async () => {
    const window = {
      webContents: {
        executeJavaScript: vi.fn(() => new Promise(() => undefined)),
        capturePage: vi.fn(() => new Promise(() => undefined)),
      },
    } as unknown as BrowserWindow;
    const driver = new NativeUiDriver(window, 5);
    await expect(driver.waitFor({ selector: '.missing' })).rejects.toThrow('Renderer evaluation timed out');
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(parent);
    vi.mocked(window.webContents.executeJavaScript).mockResolvedValue(undefined);
    await expect(driver.capture(parent, 'hung.png')).rejects.toThrow('Page capture hung.png timed out');
    await expect(fs.stat(path.join(parent, 'hung.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bounds optional diagnostics without masking the original verification failure', async () => {
    await expect(boundedSmokeDiagnostic(async () => 'renderer state', 20)).resolves.toBe('renderer state');
    await expect(
      boundedSmokeDiagnostic(async () => {
        throw new Error('renderer gone');
      }, 20),
    ).resolves.toBeUndefined();
    await expect(boundedSmokeDiagnostic(() => new Promise(() => undefined), 5)).resolves.toBeUndefined();
  });

  it('persists fixture progress without replacing an existing artifact', async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(parent);
    const artifacts = path.join(parent, 'imnota-verification-artifacts-progress');
    await fs.mkdir(artifacts);
    let time = 100;
    const checkpoint = await createSmokeCheckpoint(artifacts, () => time);
    time = 150;
    await checkpoint('history: before clipboard');
    time = 180;
    await checkpoint('history: clipboard complete');
    const target = path.join(artifacts, 'verification-progress.json');
    const recorded = await fs.readFile(target, 'utf8');
    expect(JSON.parse(recorded)).toEqual([
      { elapsedMs: 50, phase: 'history: before clipboard' },
      { elapsedMs: 80, phase: 'history: clipboard complete' },
    ]);
    await expect(createSmokeCheckpoint(artifacts)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(target, 'utf8')).toBe(recorded);
    await expect(createSmokeCheckpoint(parent)).rejects.toThrow('test-only name');
  });

  it('uses trusted webContents input events for click, drag, wheel, and keyboard actions', async () => {
    const sendInputEvent = vi.fn();
    const executeJavaScript = vi.fn(async () => ({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      text: 'Target',
      disabled: false,
    }));
    const window = {
      webContents: {
        executeJavaScript,
        sendInputEvent,
        insertText: vi.fn(async () => {}),
        capturePage: vi.fn(async () => ({ isEmpty: () => false })),
      },
    } as unknown as BrowserWindow;
    const driver = new NativeUiDriver(window, 100);
    await driver.click({ text: 'Target' });
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('if (true) found.scrollIntoView'),
      true,
    );
    await driver.drag({ x: 1, y: 2 }, { x: 9, y: 10 }, 2);
    await driver.wheel({ x: 5, y: 6 }, 20, -10);
    await driver.press('ENTER');
    await driver.typeText('Typed text');

    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseDown', button: 'left', x: 60, y: 40 }),
    );
    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseWheel', deltaX: 20, deltaY: -10 }),
    );
    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keyDown', keyCode: 'ENTER' }),
    );
    expect(window.webContents.insertText).toHaveBeenCalledWith('Typed text');
  });

  it.each([true, false])(
    'requires the trusted drag endpoint before release and fails closed when absent (delivered: %s)',
    async (delivered) => {
      type Move = { isTrusted: boolean; buttons: number; clientX: number; clientY: number };
      const listeners = new Set<(event: Move) => void>();
      const frames: Array<() => void> = [];
      const renderer: Record<string, unknown> = {};
      const executeJavaScript = vi.fn(async (source: string) =>
        runInNewContext(source, {
          window: renderer,
          document: {
            addEventListener: (_type: string, listener: (event: Move) => void) => listeners.add(listener),
            removeEventListener: (_type: string, listener: (event: Move) => void) =>
              listeners.delete(listener),
          },
          requestAnimationFrame: (callback: () => void) => frames.push(callback),
          cancelAnimationFrame: () => frames.splice(0),
        }),
      );
      const sendInputEvent = vi.fn();
      const window = { webContents: { executeJavaScript, sendInputEvent } } as unknown as BrowserWindow;
      const action = new NativeUiDriver(window, delivered ? 2_000 : 100).drag(
        { x: 1, y: 2 },
        { x: 9, y: 10 },
        1,
      );
      const result = delivered ? action : expect(action).rejects.toThrow('Renderer evaluation timed out');
      await vi.waitFor(() =>
        expect(executeJavaScript).toHaveBeenCalledWith('window.__imnotaSmokeDrag.ready', true),
      );
      const emit = (event: Move) => {
        for (const listener of listeners) listener(event);
      };
      emit({ isTrusted: false, buttons: 1, clientX: 9, clientY: 10 });
      emit({ isTrusted: true, buttons: 1, clientX: 8, clientY: 10 });
      emit({ isTrusted: true, buttons: 0, clientX: 9, clientY: 10 });
      expect(frames).toHaveLength(0);
      expect(sendInputEvent.mock.calls.some(([event]) => event.type === 'mouseUp')).toBe(false);
      if (delivered) {
        emit({ isTrusted: true, buttons: 1, clientX: 9, clientY: 10 });
        expect(frames).toHaveLength(1);
        frames.shift()!();
        expect(sendInputEvent.mock.calls.some(([event]) => event.type === 'mouseUp')).toBe(false);
        frames.shift()!();
      }
      await result;
      expect(sendInputEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseUp', x: 9, y: 10 }));
      expect(listeners.size).toBe(0);
      expect(renderer).not.toHaveProperty('__imnotaSmokeDrag');
    },
  );

  it('waits for a temporarily disabled control before sending native mouse input', async () => {
    let reads = 0;
    const sendInputEvent = vi.fn(() => {
      expect(reads).toBeGreaterThan(1);
    });
    const window = {
      webContents: {
        executeJavaScript: vi.fn(async () => ({
          x: 10,
          y: 20,
          width: 100,
          height: 40,
          text: 'Save',
          disabled: ++reads === 1,
        })),
        sendInputEvent,
        capturePage: vi.fn(async () => ({ isEmpty: () => false })),
      },
    } as unknown as BrowserWindow;
    await new NativeUiDriver(window, 1_000).click({ text: 'Save' });
    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseDown', button: 'left' }),
    );
  });

  it('waits for the presented frame and uses its updated bounds for a single native click', async () => {
    let presented = false;
    let completeFrame!: () => void;
    let startedFrame!: () => void;
    const started = new Promise<void>((resolve) => {
      startedFrame = resolve;
    });
    const sendInputEvent = vi.fn();
    const executeJavaScript = vi.fn(async () => ({
      x: presented ? 100 : 10,
      y: 20,
      width: 40,
      height: 20,
      disabled: false,
    }));
    const window = {
      webContents: {
        executeJavaScript,
        sendInputEvent,
        capturePage: vi.fn(
          () =>
            new Promise((resolve) => {
              completeFrame = () => {
                presented = true;
                resolve({ isEmpty: () => false });
              };
              startedFrame();
            }),
        ),
      },
    } as unknown as BrowserWindow;
    const click = new NativeUiDriver(window, 1_000).click({ text: 'Create project' });
    await started;
    expect(executeJavaScript).toHaveBeenLastCalledWith(SMOKE_CAPTURE_PREPARATION, true);
    expect(sendInputEvent).not.toHaveBeenCalled();
    completeFrame();
    await click;
    expect(sendInputEvent.mock.calls.map(([event]) => event.type)).toEqual([
      'mouseMove',
      'mouseDown',
      'mouseUp',
    ]);
    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseDown', x: 120, y: 30 }),
    );
  });

  it.each(['empty', 'hung'])('refuses native input when the presented frame is %s', async (state) => {
    const sendInputEvent = vi.fn();
    const window = {
      webContents: {
        executeJavaScript: vi.fn(async () => ({ x: 0, y: 0, width: 10, height: 10, disabled: false })),
        sendInputEvent,
        capturePage: vi.fn(() =>
          state === 'empty' ? Promise.resolve({ isEmpty: () => true }) : new Promise(() => undefined),
        ),
      },
    } as unknown as BrowserWindow;
    await expect(new NativeUiDriver(window, 20).click({ text: 'Create project' })).rejects.toThrow(
      state === 'empty' ? 'Native click frame is empty' : 'Native click frame timed out',
    );
    expect(sendInputEvent).not.toHaveBeenCalled();
  });

  it('queues both native clicks before a delayed scheduler can split the gesture', async () => {
    const sendInputEvent = vi.fn();
    const window = { webContents: { sendInputEvent } } as unknown as BrowserWindow;
    const action = new NativeUiDriver(window, 100).doubleClick({ x: 20, y: 30 });
    // No timers or promise continuations have run yet: all input must be queued.
    expect(sendInputEvent.mock.calls.map(([event]) => [event.type, event.clickCount])).toEqual([
      ['mouseMove', undefined],
      ['mouseDown', 1],
      ['mouseUp', 1],
      ['mouseDown', 2],
      ['mouseUp', 2],
    ]);
    await action;
  });

  it('sizes and verifies the renderer CSS viewport instead of the outer window frame', async () => {
    const setContentSize = vi.fn();
    const executeJavaScript = vi.fn(async () => ({ width: 1280, height: 800 }));
    const window = {
      setContentSize,
      webContents: { executeJavaScript },
    } as unknown as BrowserWindow;

    await new NativeUiDriver(window, 100).resize({ width: 1280, height: 800 });

    expect(setContentSize).toHaveBeenCalledWith(1280, 800, false);
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('window.innerWidth'), true);
  });

  it('retries locator polling when navigation replaces the renderer execution context', async () => {
    const executeJavaScript = vi
      .fn()
      .mockRejectedValueOnce(new Error('Script failed to execute'))
      .mockResolvedValueOnce({ x: 4, y: 8, width: 20, height: 10, text: 'Ready', disabled: false });
    const window = { webContents: { executeJavaScript } } as unknown as BrowserWindow;

    await expect(new NativeUiDriver(window, 200).waitFor({ text: 'Ready' })).resolves.toEqual(
      expect.objectContaining({ text: 'Ready' }),
    );
    expect(executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('fails a viewport matrix entry when the OS clamps its content size', async () => {
    const window = {
      setContentSize: vi.fn(),
      webContents: {
        executeJavaScript: vi.fn(async () => ({ width: 1920, height: 1040 })),
      },
    } as unknown as BrowserWindow;

    await expect(new NativeUiDriver(window, 100).resize({ width: 3440, height: 1440 })).rejects.toThrow(
      'OS clamped the requested 3440x1440 CSS viewport to 1920x1040',
    );
  });

  it('records CSS viewport, PNG pixels, and device-pixel ratio separately', async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(parent);
    const artifacts = path.join(parent, 'imnota-verification-artifacts-capture');
    await fs.mkdir(artifacts);
    const png = Buffer.from('captured-png');
    const window = {
      webContents: {
        capturePage: vi.fn(async () => ({
          isEmpty: () => false,
          toPNG: () => png,
          getSize: () => ({ width: 2560, height: 1600 }),
        })),
        executeJavaScript: vi.fn(async () => ({
          cssViewport: { width: 1280, height: 800 },
          devicePixelRatio: 2,
        })),
      },
    } as unknown as BrowserWindow;

    const capture = await new NativeUiDriver(window, 1_000).capture(artifacts, 'matrix.png');

    expect(capture).toEqual({
      path: path.join(artifacts, 'matrix.png'),
      cssViewport: { width: 1280, height: 800 },
      pngPixels: { width: 2560, height: 1600 },
      devicePixelRatio: 2,
    });
    expect(await fs.readFile(capture.path)).toEqual(png);
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(3);
  });

  it('discards partial compositor frames and requires three consecutive settled captures', async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(parent);
    const artifacts = path.join(parent, 'imnota-verification-artifacts-settled');
    await fs.mkdir(artifacts);
    const frame = (value: string) => ({
      isEmpty: () => false,
      toPNG: () => Buffer.from(value),
      getSize: () => ({ width: 1280, height: 800 }),
    });
    const capturePage = vi
      .fn()
      .mockResolvedValueOnce(frame('partial'))
      .mockResolvedValueOnce(frame('partial'))
      .mockResolvedValue(frame('settled'));
    const window = {
      webContents: {
        capturePage,
        executeJavaScript: vi.fn(async () => ({
          cssViewport: { width: 1280, height: 800 },
          devicePixelRatio: 1,
        })),
      },
    } as unknown as BrowserWindow;
    const result = await new NativeUiDriver(window, 1_000).capture(artifacts, 'settled.png');
    expect(await fs.readFile(result.path)).toEqual(Buffer.from('settled'));
    expect(capturePage).toHaveBeenCalledTimes(5);

    capturePage.mockImplementation(async () => frame(String(capturePage.mock.calls.length)));
    await expect(new NativeUiDriver(window, 100).capture(artifacts, 'moving.png')).rejects.toThrow(
      'did not settle',
    );
    await expect(fs.stat(path.join(artifacts, 'moving.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
