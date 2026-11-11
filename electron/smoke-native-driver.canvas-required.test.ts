import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { NativeUiDriver } from './smoke-native-driver.js';

const temporary: string[] = [];
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

it.each(['selected-screenshot', 'onboarding', 'crop-applied'] as const)(
  'waits through an initial canvas gap and rejects loading frames: %s',
  async (scenario) => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(directory);
    const expected = { id: 'fixture', originalWidth: 1920, originalHeight: 1080 };
    document.body.innerHTML =
      scenario === 'onboarding'
        ? ''
        : `
      <div class="shot-item active"><button data-testid="screenshot-fixture"></button></div>`;
    const mount = (loading: boolean, dimensions = '1920 × 1080') => {
      document.querySelector('[data-testid="annotation-canvas"]')?.remove();
      document.body.insertAdjacentHTML(
        'beforeend',
        `
        <div data-testid="annotation-canvas">
          <div class="canvas-meta"><span>${dimensions}</span></div>
          ${loading ? '<div data-testid="canvas-load-state" data-state="loading"></div>' : ''}
          <div class="konvajs-content"><canvas width="800" height="600"></canvas></div>
        </div>`,
      );
    };
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const capturePage = vi.fn(async () => {
      // A second reload after readiness must invalidate the first frame sequence.
      if (capturePage.mock.calls.length === 1) mount(true);
      const loading = Boolean(document.querySelector('[data-testid="canvas-load-state"]'));
      return {
        isEmpty: () => false,
        toPNG: () => Buffer.from(loading ? 'loading-frame' : 'loaded-frame'),
        getSize: () => ({ width: 1280, height: 800 }),
      };
    });
    const nativeWindow = {
      webContents: {
        capturePage,
        executeJavaScript: vi.fn(async (source: string) => eval(source)),
      },
    } as unknown as BrowserWindow;
    const driver = new NativeUiDriver(nativeWindow, 1_000);
    mount(false);
    await driver.waitForScreenshotCanvas(scenario === 'onboarding' ? undefined : expected);
    document.querySelector('[data-testid="annotation-canvas"]')!.remove();
    const dimensions = scenario === 'crop-applied' ? '1094 × 616' : '1920 × 1080';
    const result = driver.capture(directory, `${scenario}.png`, 'annotation-canvas');
    void result.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(capturePage).not.toHaveBeenCalled();
    mount(true, dimensions);
    await vi.advanceTimersByTimeAsync(0);
    expect(capturePage).not.toHaveBeenCalled();
    if (scenario === 'selected-screenshot') {
      const selected = document.querySelector('.shot-item.active button')!;
      selected.setAttribute('data-testid', 'screenshot-other');
      mount(false, dimensions);
      await vi.advanceTimersByTimeAsync(0);
      expect(capturePage).not.toHaveBeenCalled();
      selected.setAttribute('data-testid', 'screenshot-fixture');
    }
    mount(false, dimensions);
    await vi.advanceTimersByTimeAsync(0);
    expect(capturePage).toHaveBeenCalledOnce();
    await expect(fs.stat(path.join(directory, `${scenario}.png`))).rejects.toMatchObject({ code: 'ENOENT' });
    mount(false, dimensions);
    await vi.advanceTimersByTimeAsync(200);
    const capture = await result;
    expect(await fs.readFile(capture.path, 'utf8')).toBe('loaded-frame');
    expect(capturePage).toHaveBeenCalledTimes(4);
    expect(capture.readinessRestarts).toMatchObject({ count: 1, reasons: { loading: 1 } });
    expect(window).not.toHaveProperty('__imnotaSmokeCanvasCapture');
  },
);

it.each(['absent', 'loading', 'failed'] as const)(
  'fails within the capture deadline when the required canvas stays %s',
  async (state) => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(directory);
    document.body.innerHTML =
      state === 'absent'
        ? ''
        : `
      <div data-testid="annotation-canvas">
        <div data-testid="canvas-load-state" data-state="${state}"></div>
      </div>`;
    vi.useFakeTimers();
    const capturePage = vi.fn();
    const nativeWindow = {
      webContents: {
        capturePage,
        executeJavaScript: vi.fn(async (source: string) => eval(source)),
      },
    } as unknown as BrowserWindow;
    const result = new NativeUiDriver(nativeWindow, 100).capture(
      directory,
      'stalled.png',
      'annotation-canvas',
    );
    const failure = expect(result).rejects.toThrow(
      state === 'failed' ? 'selected screenshot failed to load' : 'Renderer evaluation timed out after 100ms',
    );
    await vi.advanceTimersByTimeAsync(100);
    await failure;
    expect(capturePage).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(directory, 'stalled.png'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(window).not.toHaveProperty('__imnotaSmokeCanvasCapture');
  },
);
