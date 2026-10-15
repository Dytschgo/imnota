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

it.each(['drawing', 'text'] as const)(
  'captures mixed-content-%s.png with the selected rail entry and its canvas-free editor',
  async (kind) => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(directory);
    // Mirror exerciseMixedContent: drawing stays selected after editing, while
    // text is selected after reopening and switching to Markdown preview.
    document.body.innerHTML = `
      <section data-testid="workspace">
        <div class="shot-item active">
          <button class="shot-select" data-testid="screenshot-${kind}-fixture">${kind}</button>
        </div>
        <div class="canvas-column">${
          kind === 'drawing'
            ? '<div class="drawing-editor" data-testid="drawing-editor"><div data-testid="drawing-editor-canvas"><canvas width="800" height="600"></canvas></div></div>'
            : '<article class="markdown-preview"><h1>System overview</h1></article>'
        }</div>
      </section>`;
    expect(document.querySelector('.shot-item.active [data-testid^="screenshot-"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="annotation-canvas"]')).toBeNull();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.useFakeTimers();
    const png = Buffer.from(`mixed-content-${kind}`);
    const capturePage = vi.fn(async () => ({
      isEmpty: () => false,
      toPNG: () => png,
      getSize: () => ({ width: 1440, height: 900 }),
    }));
    const nativeWindow = {
      webContents: { capturePage, executeJavaScript: vi.fn(async (source: string) => eval(source)) },
    } as unknown as BrowserWindow;
    // The workflow passes no screenshot expectation for these two captures.
    const result = new NativeUiDriver(nativeWindow, 1_000).capture(directory, `mixed-content-${kind}.png`);
    void result.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    const capture = await result;
    expect(await fs.readFile(capture.path)).toEqual(png);
    expect(capturePage).toHaveBeenCalledTimes(3);
    expect(capture).not.toHaveProperty('readinessRestarts');
  },
);
