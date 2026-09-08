import type { BrowserWindow, Rectangle, WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SmokeLocator {
  selector?: string;
  text?: string;
  exact?: boolean;
}

export interface SmokePoint {
  x: number;
  y: number;
}

export interface SmokeViewport {
  width: number;
  height: number;
}

export interface SmokeCapture {
  path: string;
  cssViewport: SmokeViewport;
  pngPixels: SmokeViewport;
  devicePixelRatio: number;
}

export function sourceBoxInteriorPoint(
  origin: SmokePoint,
  sourceSize: SmokeViewport,
  scale: number,
): SmokePoint {
  return {
    x: Math.round(origin.x + sourceSize.width * scale * 0.35),
    y: Math.round(origin.y + sourceSize.height * scale * 0.5),
  };
}

export function mapSourcePointToPromptPixel(
  sourcePoint: SmokePoint,
  expandedSourceOrigin: SmokePoint,
  promptImageOrigin: SmokePoint,
): SmokePoint {
  return {
    x: promptImageOrigin.x + sourcePoint.x - expandedSourceOrigin.x,
    y: promptImageOrigin.y + sourcePoint.y - expandedSourceOrigin.y,
  };
}

export const SMOKE_VIEWPORTS: readonly SmokeViewport[] = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 3440, height: 1440 },
];

export const SMOKE_ARTIFACT_DIRECTORY_PATTERN = /^imnota-(?:smoke|verification)-artifacts-[a-z0-9_-]+$/i;

function comparable(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function pathIsWithin(parent: string, target: string): boolean {
  const root = comparable(parent);
  const candidate = comparable(target);
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function validateCreatedSmokeDirectory(
  target: string,
  kind: 'fixture' | 'artifact',
): Promise<string> {
  if (!path.isAbsolute(target)) throw new Error(`${kind} directory must be absolute.`);
  const resolved = path.resolve(target);
  const real = await fs.realpath(resolved);
  if (comparable(real) !== comparable(resolved))
    throw new Error(`${kind} directory must not contain links or aliases.`);
  const name = path.basename(real);
  const validName =
    kind === 'fixture'
      ? /^imnota-smoke-[a-z0-9_-]+$/i.test(name)
      : SMOKE_ARTIFACT_DIRECTORY_PATTERN.test(name);
  if (!validName) throw new Error(`${kind} directory does not have an Imnota test-only name.`);
  const stat = await fs.lstat(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${kind} path must be a real directory.`);
  return real;
}

export function safeArtifactPath(directory: string, filename: string): string {
  if (!/^[a-z0-9][a-z0-9_.-]*\.png$/i.test(filename)) throw new Error('Smoke artifact filename is invalid.');
  const target = path.resolve(directory, filename);
  if (!pathIsWithin(directory, target)) throw new Error('Smoke artifact path escaped its directory.');
  return target;
}

function locatorScript(locator: SmokeLocator, scrollIntoView = false): string {
  return `(() => {
    const locator = ${JSON.stringify(locator)};
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const normalized = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const candidates = locator.selector
      ? [...document.querySelectorAll(locator.selector)]
      : [...document.querySelectorAll('button, input, textarea, select, label, [role="button"], [role="dialog"], h1, h2, h3')];
    const found = candidates.find((element) => {
      if (!visible(element)) return false;
      if (!locator.text) return true;
      const value = normalized(element.getAttribute('aria-label') || element.textContent || element.value);
      const expected = normalized(locator.text);
      return locator.exact ? value === expected : value.includes(expected);
    });
    if (!found) return null;
    if (${scrollIntoView}) found.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = found.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      text: normalized(found.getAttribute('aria-label') || found.textContent || found.value),
      disabled: Boolean(found.matches(':disabled') ||
        (found instanceof HTMLLabelElement && found.control?.matches(':disabled')) ||
        found.getAttribute('aria-disabled') === 'true')
    };
  })()`;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isTransientLocatorExecutionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Script failed to execute') ||
    message.includes('Execution context was destroyed') ||
    message.includes('Render frame was disposed')
  );
}

export class NativeUiDriver {
  constructor(
    private window: BrowserWindow,
    private readonly defaultTimeoutMs = 15_000,
  ) {}

  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  get browserWindow(): BrowserWindow {
    return this.window;
  }

  async evaluate<T>(source: string): Promise<T> {
    try {
      return (await this.window.webContents.executeJavaScript(source, true)) as T;
    } catch (error) {
      const summary = source.replace(/\s+/g, ' ').trim().slice(0, 180);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Renderer evaluation failed near ${JSON.stringify(summary)}: ${message}`, {
        cause: error,
      });
    }
  }

  async bounds(locator: SmokeLocator): Promise<(Rectangle & { text: string; disabled: boolean }) | null> {
    try {
      return await this.evaluate(locatorScript(locator));
    } catch (error) {
      if (isTransientLocatorExecutionError(error)) return null;
      throw error;
    }
  }

  async waitFor(
    locator: SmokeLocator,
    options: { timeoutMs?: number; absent?: boolean; enabled?: boolean } = {},
  ): Promise<Rectangle & { text: string; disabled: boolean }> {
    const timeout = options.timeoutMs ?? this.defaultTimeoutMs;
    const started = Date.now();
    do {
      const found = await this.bounds(locator);
      if (options.absent ? !found : found && (!options.enabled || !found.disabled)) {
        if (options.absent) return { x: 0, y: 0, width: 0, height: 0, text: '', disabled: false };
        return found!;
      }
      await wait(50);
    } while (Date.now() - started < timeout);
    throw new Error(
      `Timed out waiting for ${options.absent ? 'absence of ' : options.enabled ? 'enabled ' : ''}${JSON.stringify(locator)}.`,
    );
  }

  async exists(locator: SmokeLocator): Promise<boolean> {
    return Boolean(await this.bounds(locator));
  }

  async click(locator: SmokeLocator, clickCount = 1): Promise<SmokePoint> {
    await this.waitFor(locator, { enabled: true });
    await this.evaluate(locatorScript(locator, true));
    const bounds = await this.waitFor(locator, { enabled: true });
    const point = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    await this.clickPoint(point, clickCount);
    return point;
  }

  async clickAny(locators: readonly SmokeLocator[]): Promise<SmokePoint> {
    const started = Date.now();
    do {
      for (const locator of locators) {
        const found = await this.bounds(locator);
        if (found && !found.disabled) return this.click(locator);
      }
      await wait(50);
    } while (Date.now() - started < this.defaultTimeoutMs);
    throw new Error(`None of the smoke controls appeared: ${JSON.stringify(locators)}.`);
  }

  async clickPoint(point: SmokePoint, clickCount = 1): Promise<void> {
    const contents = this.window.webContents;
    contents.sendInputEvent({ type: 'mouseMove', ...point });
    contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount });
    contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount });
    await wait(40);
  }

  async fill(locator: SmokeLocator, value: string): Promise<void> {
    await this.click(locator);
    // macOS routes Cmd+A through the application menu, which synthetic renderer
    // key events do not invoke. Use Electron's native editing command instead.
    this.window.webContents.selectAll();
    await this.evaluate(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const field = document.activeElement;
        if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
            field.selectionStart === 0 && field.selectionEnd === field.value.length) return resolve(true);
        if (Date.now() >= deadline) return reject(new Error('Native Select All did not select the focused field.'));
        requestAnimationFrame(check);
      };
      check();
    })`);
    await this.window.webContents.insertText(value);
    await wait(40);
  }

  async typeText(value: string): Promise<void> {
    await this.window.webContents.insertText(value);
    await wait(40);
  }

  async press(keyCode: string, modifiers: Electron.InputEvent['modifiers'] = []): Promise<void> {
    this.window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    this.window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(40);
  }

  async drag(from: SmokePoint, to: SmokePoint, steps = 8): Promise<void> {
    const contents = this.window.webContents;
    contents.sendInputEvent({ type: 'mouseMove', ...from });
    contents.sendInputEvent({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 });
    for (let index = 1; index <= steps; index += 1) {
      const point = {
        x: Math.round(from.x + ((to.x - from.x) * index) / steps),
        y: Math.round(from.y + ((to.y - from.y) * index) / steps),
      };
      contents.sendInputEvent({ type: 'mouseMove', ...point, movementX: 1, movementY: 1 });
      await wait(16);
    }
    contents.sendInputEvent({ type: 'mouseUp', ...to, button: 'left', clickCount: 1 });
    await wait(80);
  }

  async doubleClick(point: SmokePoint): Promise<void> {
    // Queue the complete native gesture before yielding: runner scheduling between
    // clicks can otherwise exceed Konva's 400ms pointer-double-click window.
    const contents = this.window.webContents;
    contents.sendInputEvent({ type: 'mouseMove', ...point });
    for (const clickCount of [1, 2]) {
      contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount });
      contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount });
    }
    await wait(40);
  }

  async wheel(point: SmokePoint, deltaX: number, deltaY: number): Promise<void> {
    this.window.webContents.sendInputEvent({
      type: 'mouseWheel',
      ...point,
      deltaX,
      deltaY,
      canScroll: true,
    });
    await wait(80);
  }

  async resize(viewport: SmokeViewport): Promise<void> {
    this.window.setContentSize(viewport.width, viewport.height, false);
    await wait(200);
    const actual = await this.evaluate<SmokeViewport>(
      `({ width: window.innerWidth, height: window.innerHeight })`,
    );
    if (actual.width !== viewport.width || actual.height !== viewport.height)
      throw new Error(
        `OS clamped the requested ${viewport.width}x${viewport.height} CSS viewport to ${actual.width}x${actual.height}. Use an isolated compatible display/window host; this matrix entry was not verified.`,
      );
  }

  async capture(directory: string, filename: string): Promise<SmokeCapture> {
    const target = safeArtifactPath(directory, filename);
    // DOM assertions and animation frames can precede Chromium's compositor update.
    // Decode assets first, then require a stable sequence of actual captured pixels.
    await this.evaluate(`(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const deadline = Date.now() + this.defaultTimeoutMs;
    let previous: Buffer | undefined;
    let stableFrames = 0;
    let image;
    let png: Buffer;
    do {
      image = await this.window.webContents.capturePage();
      if (image.isEmpty()) throw new Error(`Captured artifact ${filename} is empty.`);
      png = image.toPNG();
      stableFrames = previous?.equals(png) ? stableFrames + 1 : 1;
      if (stableFrames >= 3) break;
      previous = png;
      if (Date.now() >= deadline)
        throw new Error(`Captured artifact ${filename} did not settle before the capture timeout.`);
      await wait(100);
    } while (stableFrames < 3);
    await fs.writeFile(target, png, { flag: 'wx' });
    const metrics = await this.evaluate<{ cssViewport: SmokeViewport; devicePixelRatio: number }>(
      `({
        cssViewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio
      })`,
    );
    const pngSize = image.getSize();
    return {
      path: target,
      cssViewport: metrics.cssViewport,
      pngPixels: { width: pngSize.width, height: pngSize.height },
      devicePixelRatio: metrics.devicePixelRatio,
    };
  }
}

export type SmokeWebContents = Pick<
  WebContents,
  'executeJavaScript' | 'sendInputEvent' | 'insertText' | 'capturePage'
>;
