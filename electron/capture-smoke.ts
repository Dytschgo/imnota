import { BrowserWindow, nativeImage, screen, type Display } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectData } from '../src/shared/types.js';
import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';
import { nativeClipboard } from './native-clipboard.js';
import {
  planCrossDisplaySmokeSelection,
  syntheticCaptureColor,
  type CrossDisplaySmokeSelection,
} from './capture-smoke-contract.js';
import { screenshotPath } from './collections.js';
import { NativeUiDriver, type SmokeCapture } from './smoke-native-driver.js';
import {
  createWindowsSmokePointer,
  sendWindowsSmokeCaptureShortcut,
  WINDOWS_SMOKE_CAPTURE_SHORTCUT,
} from './windows-smoke-input.js';

export interface CaptureSmokeHost {
  reopenWindow(): Promise<BrowserWindow>;
  captureFromTray(mode: 'region' | 'window' | 'display'): Promise<BrowserWindow>;
  trayAvailable(): boolean;
  globalCaptureShortcutRegistered(): boolean;
  readProject(projectPath: string): Promise<ProjectData>;
}

export interface CaptureSmokeResult {
  artifacts: SmokeCapture[];
  skipped: boolean;
  displays: CaptureDisplay[];
  crossDisplay: null | {
    input: 'native-pointer' | 'overlay-ipc';
    selection: CaptureRectangle;
    output: { width: number; height: number };
    repeatedPixelsEqual: true;
  };
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function smokeCaptureIsEnabled(): boolean {
  return process.env.IMNOTA_SMOKE === '1' && process.env.IMNOTA_SMOKE_CAPTURE_SOURCE === 'synthetic';
}

async function waitForPaint(driver: NativeUiDriver): Promise<void> {
  driver.browserWindow.show();
  driver.browserWindow.focus();
  await driver.evaluate(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
}

async function waitForCaptureOverlays(mainWindow: BrowserWindow): Promise<BrowserWindow[]> {
  const started = Date.now();
  do {
    const overlays = captureOverlayWindows(mainWindow);
    if (overlays.length === screen.getAllDisplays().length && overlays.every((window) => window.isVisible()))
      return overlays;
    await delay(50);
  } while (Date.now() - started < 15_000);
  throw new Error('Synthetic capture overlays did not open on every display.');
}

async function waitForCaptureOverlay(mainWindow: BrowserWindow): Promise<BrowserWindow> {
  const overlays = await waitForCaptureOverlays(mainWindow);
  const preferred = screen.getDisplayMatching(mainWindow.getBounds()).id;
  return (
    overlays.find((window) => screen.getDisplayMatching(window.getBounds()).id === preferred) ?? overlays[0]!
  );
}

async function waitForCaptureActionsOverlay(mainWindow: BrowserWindow): Promise<NativeUiDriver> {
  const started = Date.now();
  do {
    for (const window of captureOverlayWindows(mainWindow)) {
      if (window.isDestroyed()) continue;
      const driver = new NativeUiDriver(window);
      const visible = await driver.evaluate<boolean>(
        `document.querySelector('.capture-actions') instanceof HTMLElement && !document.querySelector('.capture-actions').hidden`,
      );
      if (visible) return driver;
    }
    await delay(50);
  } while (Date.now() - started < 15_000);
  throw new Error('No capture overlay displayed selection actions.');
}

async function waitForClosed(window: BrowserWindow, label: string): Promise<void> {
  const started = Date.now();
  do {
    if (window.isDestroyed() || !BrowserWindow.getAllWindows().includes(window)) return;
    await delay(50);
  } while (Date.now() - started < 15_000);
  throw new Error(`${label} remains active.`);
}

function captureOverlayWindows(mainWindow: BrowserWindow): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (window) =>
      window !== mainWindow &&
      !window.isDestroyed() &&
      window.webContents.getURL().includes('capture-overlay.html') &&
      !window.webContents.getURL().includes('countdown=1'),
  );
}

async function waitForAllCaptureOverlaysClosed(mainWindow: BrowserWindow, label: string): Promise<void> {
  const started = Date.now();
  do {
    if (captureOverlayWindows(mainWindow).length === 0) return;
    await delay(50);
  } while (Date.now() - started < 15_000);
  throw new Error(`${label} left another display overlay active.`);
}

async function screenshotFiles(projectPath: string): Promise<string[]> {
  const root = path.join(projectPath, 'collections');
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && target.includes(`${path.sep}screenshots${path.sep}`))
        files.push(path.relative(projectPath, target));
    }
  }
  await visit(root);
  return files.sort();
}

async function openScreenshotProject(driver: NativeUiDriver): Promise<string> {
  const target = await driver.evaluate<{
    projectPath: string;
    name: string;
    screenshotId: string;
  }>(`(async () => {
    const projects = await window.imnota.listProjects();
    const project = projects.find((item) => item.screenshots.length > 0);
    if (!project) throw new Error('Capture smoke needs a project containing a screenshot.');
    return { projectPath: project.projectPath, name: project.name, screenshotId: project.screenshots[0].id };
  })()`);
  await driver.click({ selector: '.nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.project-list' });
  await driver.click({ selector: '.project-row', text: target.name });
  await driver.click({ selector: `[data-testid="screenshot-${target.screenshotId}"]` });
  await driver.waitFor({ selector: '[data-testid="annotation-canvas"]' });
  return target.projectPath;
}

async function enableExperimentalCapture(
  driver: NativeUiDriver,
  host: CaptureSmokeHost,
): Promise<NativeUiDriver> {
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.waitFor({ selector: '[data-testid="settings-view"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Features', exact: true });
  const captureEnabled = await driver.evaluate<boolean>(`(() => {
    const checkbox = document.querySelector('[aria-label="Enable screen capture"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error('Capture preference checkbox is missing.');
    return checkbox.checked;
  })()`);
  if (!captureEnabled) await driver.click({ selector: '[aria-label="Enable screen capture"]' });
  await driver.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = async () => {
      try {
        const result = await window.imnota.getPreferenceSettings();
        if (result.ok && result.value.settings.capture.experimentalRegionCapture) return resolve(true);
        if (Date.now() - started > 10000) throw new Error('Experimental capture preference was not saved.');
        setTimeout(check, 50);
      } catch (error) { reject(error); }
    };
    check();
  })`);
  if (process.platform === 'win32')
    await driver.evaluate(`(async () => {
      const result = await window.imnota.setPreferenceSettings({
        shortcuts: { bindings: { 'capture.region': ${JSON.stringify(WINDOWS_SMOKE_CAPTURE_SHORTCUT)} } }
      });
      if (!result.ok) throw new Error(result.error.message);
      if (result.value.settings.shortcuts.bindings['capture.region'] !== ${JSON.stringify(WINDOWS_SMOKE_CAPTURE_SHORTCUT)})
        throw new Error('Windows smoke capture shortcut was not persisted.');
    })()`);
  const window = await host.reopenWindow();
  const next = new NativeUiDriver(window);
  await waitForPaint(next);
  return next;
}

async function selectRegion(driver: NativeUiDriver): Promise<void> {
  const viewport = await driver.evaluate<{ width: number; height: number }>(
    `({ width: window.innerWidth, height: window.innerHeight })`,
  );
  await driver.drag(
    { x: Math.round(viewport.width * 0.2), y: Math.round(viewport.height * 0.25) },
    { x: Math.round(viewport.width * 0.7), y: Math.round(viewport.height * 0.7) },
  );
  await driver.waitFor({ selector: '.capture-actions' });
  await driver.evaluate(`(() => {
    const actions = document.querySelector('.capture-actions');
    if (!(actions instanceof HTMLElement) || actions.hidden) throw new Error('Selection actions are hidden.');
  })()`);
}

async function waitForRetake(driver: NativeUiDriver): Promise<void> {
  const started = Date.now();
  do {
    const reset = await driver.evaluate<boolean>(
      `(() => {
        const selection = document.querySelector('.capture-selection');
        const actions = document.querySelector('.capture-actions');
        return selection instanceof HTMLElement && actions instanceof HTMLElement &&
          selection.style.cssText === '' && actions.hidden === true;
      })()`,
    );
    if (reset) return;
    await delay(50);
  } while (Date.now() - started < 15_000);
  throw new Error('Retake did not clear the capture selection.');
}

async function createWindowsHotkeyFocusTarget(mainWindow: BrowserWindow): Promise<BrowserWindow> {
  const focusTarget = new BrowserWindow({
    width: 360,
    height: 180,
    show: false,
    title: 'Imnota synthetic hotkey target',
    backgroundColor: '#12151a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await focusTarget.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><title>Synthetic hotkey target</title><body style="background:#12151a;color:#f4f4f5;font:16px sans-serif">Synthetic keyboard focus target</body>')}`,
    );
    mainWindow.minimize();
    focusTarget.show();
    focusTarget.focus();
    const started = Date.now();
    do {
      if (mainWindow.isMinimized() && focusTarget.isFocused()) return focusTarget;
      await delay(50);
    } while (Date.now() - started < 5_000);
    throw new Error('Windows synthetic focus target did not receive focus while Imnota was minimized.');
  } catch (error) {
    if (!focusTarget.isDestroyed()) focusTarget.destroy();
    throw error;
  }
}

async function startCapture(
  driver: NativeUiDriver,
  trigger: 'toolbar' | 'global-shortcut' = 'toolbar',
): Promise<NativeUiDriver> {
  let focusTarget: BrowserWindow | null = null;
  let overlay: BrowserWindow;
  try {
    if (trigger === 'global-shortcut') {
      const registered = await driver.evaluate<boolean>(`(async () => {
        const result = await window.imnota.getNativeCapabilities();
        return result.ok && result.value.globalCaptureShortcutRegistered;
      })()`);
      if (!registered) throw new Error('Windows global capture shortcut is not registered.');
      focusTarget = await createWindowsHotkeyFocusTarget(driver.browserWindow);
      sendWindowsSmokeCaptureShortcut();
    } else await driver.click({ selector: 'button[aria-label^="Capture area"]' });
    overlay = await waitForCaptureOverlay(driver.browserWindow);
  } finally {
    if (focusTarget && !focusTarget.isDestroyed()) focusTarget.destroy();
  }
  const overlayDriver = new NativeUiDriver(overlay);
  await overlayDriver.waitFor({ selector: '.capture-overlay' });
  await overlayDriver.evaluate(`(() => {
    const still = document.querySelector('.capture-freeze-frame');
    if (!(still instanceof HTMLImageElement) || !still.src.startsWith('data:image/png'))
      throw new Error('Capture overlay did not present the captured still.');
  })()`);
  const display = screen.getDisplayMatching(overlay.getBounds());
  await overlayDriver.evaluate(`new Promise((resolve, reject) => {
    const start = Date.now();
    const expected = ${JSON.stringify(display.bounds)};
    const check = () => {
      if (window.innerWidth === expected.width && window.innerHeight === expected.height) return resolve(true);
      if (Date.now() - start > 5000) return reject(new Error('Overlay is constrained to the work area instead of the complete display.'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  return overlayDriver;
}

async function selectCrossDisplayRegion(
  overlays: readonly NativeUiDriver[],
  displays: readonly Display[],
  plan: CrossDisplaySmokeSelection,
): Promise<NativeUiDriver> {
  const overlayFor = (displayId: number) =>
    overlays.find((overlay) => screen.getDisplayMatching(overlay.browserWindow.getBounds()).id === displayId);
  const origin = overlayFor(plan.origin.id);
  const destination = overlayFor(plan.destination.id);
  if (!origin || !destination)
    throw new Error('Cross-display capture overlays do not match the display plan.');
  const local = (display: Display, point: { x: number; y: number }) => ({
    x: point.x - display.bounds.x,
    y: point.y - display.bounds.y,
  });
  const originDisplay = displays.find((display) => display.id === plan.origin.id)!;
  const destinationDisplay = displays.find((display) => display.id === plan.destination.id)!;
  const probe = {
    x: plan.start.x + Math.sign(plan.end.x - plan.start.x) * 8,
    y: plan.start.y + Math.sign(plan.end.y - plan.start.y) * 8,
  };

  // Use the isolated overlay preload bridge rather than OS pointer injection.
  // Waiting for the renderer's selection paint acknowledges the main-process
  // coordinator before the destination overlay sends the final endpoint.
  await origin.evaluate(
    `window.imnotaCapture.pointer(${JSON.stringify({ phase: 'begin', point: local(originDisplay, plan.start) })})`,
  );
  await origin.evaluate(
    `window.imnotaCapture.pointer(${JSON.stringify({ phase: 'move', point: local(originDisplay, probe) })})`,
  );
  await origin.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const selection = document.querySelector('.capture-selection');
      if (selection instanceof HTMLElement && !selection.hidden) return resolve(true);
      if (Date.now() - started > 5000) return reject(new Error('Origin overlay did not paint the coordinated selection.'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  await destination.evaluate(
    `window.imnotaCapture.pointer(${JSON.stringify({ phase: 'end', point: local(destinationDisplay, plan.end) })})`,
  );
  await destination.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const actions = document.querySelector('.capture-actions');
      if (actions instanceof HTMLElement && !actions.hidden) return resolve(true);
      if (Date.now() - started > 5000) return reject(new Error('Destination overlay did not receive the coordinated selection.'));
      requestAnimationFrame(check);
    };
    check();
  })`);

  const expectedDimensions = `${Math.round(plan.selection.width)} × ${Math.round(plan.selection.height)} points`;
  for (const [label, overlay] of [
    ['origin', origin],
    ['destination', destination],
  ] as const) {
    const state = await overlay.evaluate<{
      selectionHidden: boolean;
      actionsHidden: boolean;
      dimensions: string;
    }>(
      `(() => ({
        selectionHidden: document.querySelector('.capture-selection')?.hidden !== false,
        actionsHidden: document.querySelector('.capture-actions')?.hidden !== false,
        dimensions: document.querySelector('.capture-dimensions')?.textContent ?? ''
      }))()`,
    );
    if (state.selectionHidden || state.dimensions !== expectedDimensions)
      throw new Error(`${label} overlay did not render the complete cross-display selection.`);
    if (state.actionsHidden !== (label === 'origin'))
      throw new Error('Cross-display actions were not assigned to the destination overlay.');
  }
  return destination;
}

async function selectCrossDisplayRegionWithNativePointer(
  overlays: readonly NativeUiDriver[],
  plan: CrossDisplaySmokeSelection,
): Promise<NativeUiDriver> {
  const origin = overlays.find(
    (overlay) => screen.getDisplayMatching(overlay.browserWindow.getBounds()).id === plan.origin.id,
  );
  const destination = overlays.find(
    (overlay) => screen.getDisplayMatching(overlay.browserWindow.getBounds()).id === plan.destination.id,
  );
  if (!origin || !destination)
    throw new Error('Cross-display overlays do not match the native pointer plan.');
  const pointer = createWindowsSmokePointer();
  const restore = screen.getCursorScreenPoint();
  let pressed = false;
  try {
    pointer.move(screen.dipToScreenPoint(plan.start));
    const atStart = screen.getCursorScreenPoint();
    if (Math.abs(atStart.x - plan.start.x) > 1 || Math.abs(atStart.y - plan.start.y) > 1)
      throw new Error('Native pointer did not reach the cross-display origin.');
    pointer.down();
    pressed = true;
    const probe = {
      x: plan.start.x + Math.sign(plan.end.x - plan.start.x) * 8,
      y: plan.start.y + Math.sign(plan.end.y - plan.start.y) * 8,
    };
    pointer.move(screen.dipToScreenPoint(probe));
    await origin.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const selection = document.querySelector('.capture-selection');
        if (selection instanceof HTMLElement && !selection.hidden) return resolve(true);
        if (Date.now() - started > 5000) return reject(new Error('Native drag did not start on origin overlay.'));
        requestAnimationFrame(check);
      }; check();
    })`);
    pointer.move(screen.dipToScreenPoint(plan.end));
    const atEnd = screen.getCursorScreenPoint();
    if (Math.abs(atEnd.x - plan.end.x) > 1 || Math.abs(atEnd.y - plan.end.y) > 1)
      throw new Error('Native pointer did not cross to the destination display.');
    pointer.up();
    pressed = false;
    await destination.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const actions = document.querySelector('.capture-actions');
        if (actions instanceof HTMLElement && !actions.hidden) return resolve(true);
        if (Date.now() - started > 5000) return reject(new Error('Native cross-display drag did not finish.'));
        requestAnimationFrame(check);
      }; check();
    })`);
    const expectedDimensions = `${Math.round(plan.selection.width)} × ${Math.round(plan.selection.height)} points`;
    for (const overlay of [origin, destination]) {
      const dimensions = await overlay.evaluate<string>(
        `document.querySelector('.capture-dimensions')?.textContent ?? ''`,
      );
      if (dimensions !== expectedDimensions)
        throw new Error('Native drag did not select the complete cross-display area.');
    }
    return destination;
  } finally {
    if (pressed) pointer.up();
    pointer.move(screen.dipToScreenPoint(restore));
  }
}

function intersect(left: CaptureRectangle, right: CaptureRectangle): CaptureRectangle | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const edgeX = Math.min(left.x + left.width, right.x + right.width);
  const edgeY = Math.min(left.y + left.height, right.y + right.height);
  return edgeX > x && edgeY > y ? { x, y, width: edgeX - x, height: edgeY - y } : null;
}

async function verifySyntheticCrossDisplayPng(
  projectPath: string,
  relativeFile: string,
  captured: ProjectData['screenshots'][number],
  displays: readonly Display[],
  plan: CrossDisplaySmokeSelection,
): Promise<void> {
  const intersected = displays.flatMap((display) => {
    const area = intersect(plan.selection, display.bounds);
    if (!area) return [];
    const physical =
      process.platform === 'win32'
        ? screen.dipToScreenRect(null, display.bounds)
        : {
            width: Math.round(display.bounds.width * display.scaleFactor),
            height: Math.round(display.bounds.height * display.scaleFactor),
          };
    return [
      {
        display,
        area,
        scaleX: physical.width / display.bounds.width,
        scaleY: physical.height / display.bounds.height,
      },
    ];
  });
  const scaleX = Math.max(...intersected.map((part) => part.scaleX));
  const scaleY = Math.max(...intersected.map((part) => part.scaleY));
  const expected = {
    width: Math.ceil(plan.selection.width * scaleX),
    height: Math.ceil(plan.selection.height * scaleY),
  };
  const png = await fs.readFile(path.join(projectPath, relativeFile));
  const image = nativeImage.createFromBuffer(png);
  const size = image.getSize();
  if (
    image.isEmpty() ||
    size.width !== expected.width ||
    size.height !== expected.height ||
    captured.originalWidth !== expected.width ||
    captured.originalHeight !== expected.height
  )
    throw new Error(
      `Cross-display PNG dimensions are ${size.width}x${size.height}; expected ${expected.width}x${expected.height}.`,
    );
  const bitmap = image.toBitmap();
  for (const target of [plan.origin, plan.destination]) {
    const part = intersected.find(({ display }) => display.id === target.id);
    if (!part) throw new Error('Cross-display PNG is missing one selected display.');
    const sample = {
      x: part.area.x + part.area.width / 2,
      y: part.area.y + part.area.height / 2,
    };
    const pixel = {
      x: Math.min(size.width - 1, Math.max(0, Math.floor((sample.x - plan.selection.x) * scaleX))),
      y: Math.min(size.height - 1, Math.max(0, Math.floor((sample.y - plan.selection.y) * scaleY))),
    };
    const offset = (pixel.y * size.width + pixel.x) * 4;
    const actual = [...bitmap.subarray(offset, offset + 4)];
    const displayIndex = [...displays]
      .sort((left, right) => left.id - right.id)
      .findIndex((display) => display.id === target.id);
    const color = syntheticCaptureColor(displayIndex);
    const expectedColor = [color.blue, color.green, color.red, color.alpha];
    if (actual.some((channel, index) => Math.abs(channel! - expectedColor[index]!) > 1))
      throw new Error(
        `Cross-display PNG color mismatch for display ${target.id}: ${actual.join(',')} instead of ${expectedColor.join(',')}.`,
      );
  }
}

async function verifySyntheticDisplayPng(
  projectPath: string,
  captured: ProjectData['screenshots'][number],
  display: Display,
  displays: readonly Display[],
): Promise<void> {
  const png = await fs.readFile(screenshotPath(projectPath, captured));
  const image = nativeImage.createFromBuffer(png);
  const expected =
    process.platform === 'win32'
      ? screen.dipToScreenRect(null, display.bounds)
      : {
          width: Math.round(display.bounds.width * display.scaleFactor),
          height: Math.round(display.bounds.height * display.scaleFactor),
        };
  const size = image.getSize();
  if (
    image.isEmpty() ||
    size.width !== expected.width ||
    size.height !== expected.height ||
    captured.originalWidth !== expected.width ||
    captured.originalHeight !== expected.height
  )
    throw new Error(
      `Display mode saved ${size.width}x${size.height} instead of clicked display ${display.id} at ${expected.width}x${expected.height}.`,
    );
  const displayIndex = [...displays]
    .sort((left, right) => left.id - right.id)
    .findIndex((candidate) => candidate.id === display.id);
  const color = syntheticCaptureColor(displayIndex);
  const bitmap = image.toBitmap();
  const offset = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;
  const actual = [...bitmap.subarray(offset, offset + 4)];
  const expectedColor = [color.blue, color.green, color.red, color.alpha];
  if (actual.some((channel, index) => Math.abs(channel! - expectedColor[index]!) > 1))
    throw new Error(
      `Display mode saved pixels from another display: ${actual.join(',')} instead of ${expectedColor.join(',')}.`,
    );
}

async function waitForScreenshotCount(
  host: CaptureSmokeHost,
  projectPath: string,
  expected: number,
): Promise<ProjectData> {
  const started = Date.now();
  do {
    const project = await host.readProject(projectPath);
    if (project.screenshots.length === expected) return project;
    await delay(50);
  } while (Date.now() - started < 15_000);
  throw new Error(`Capture smoke expected ${expected} screenshots.`);
}

/**
 * Native-only region-capture exercise. It refuses to run unless main injects its
 * synthetic display source, so screenshots produced by this helper cannot contain
 * a real desktop image.
 */
export async function exerciseRegionCapture(
  initialDriver: NativeUiDriver,
  host: CaptureSmokeHost,
  artifactDirectory?: string,
): Promise<CaptureSmokeResult> {
  if (!smokeCaptureIsEnabled()) return { artifacts: [], skipped: true, displays: [], crossDisplay: null };
  if (!['win32', 'darwin'].includes(process.platform))
    throw new Error('Synthetic region capture smoke is only applicable on Windows and macOS.');

  const artifacts: SmokeCapture[] = [];
  const driver = await enableExperimentalCapture(initialDriver, host);
  const projectPath = await openScreenshotProject(driver);
  const baseline = await host.readProject(projectPath);
  const baselineFiles = await screenshotFiles(projectPath);

  if (!host.trayAvailable()) throw new Error('Native smoke did not create the tray icon.');
  if (!host.globalCaptureShortcutRegistered())
    throw new Error('Tray lifecycle did not retain the configured global capture shortcut.');

  // Exercise the actual countdown window and IPC in packaged Windows/macOS runs.
  for (const seconds of [3, 5] as const) {
    for (const cancel of [true, false]) {
      await driver.click({ selector: 'button[aria-label="Capture delay"]' });
      const started = Date.now();
      await driver.click({
        selector: '[role="menuitem"]',
        text: `Capture in ${seconds} seconds`,
        exact: true,
      });
      let hud: BrowserWindow | undefined;
      while (Date.now() - started < 5000) {
        hud = BrowserWindow.getAllWindows().find(
          (window) =>
            !window.isDestroyed() &&
            window.webContents.getURL().includes('countdown=1') &&
            window.isVisible(),
        );
        if (hud) break;
        await delay(25);
      }
      if (!hud) throw new Error('Capture countdown did not become visible.');
      const hudDriver = new NativeUiDriver(hud);
      await hudDriver.waitFor({ selector: '.capture-countdown' });
      if (captureOverlayWindows(driver.browserWindow).length)
        throw new Error('Selection opened before the countdown elapsed.');
      if (cancel) {
        if (seconds === 3) await hudDriver.click({ selector: '[data-action="cancel"]' });
        else await hudDriver.press('Escape');
        await waitForClosed(hud, 'Cancelled countdown');
      } else {
        const selectedOverlay = await waitForCaptureOverlay(driver.browserWindow);
        if (Date.now() - started < seconds * 1000) throw new Error('Capture countdown elapsed too early.');
        await waitForClosed(hud, 'Elapsed countdown');
        const selectedDriver = new NativeUiDriver(selectedOverlay);
        await selectedDriver.press('Escape');
        await waitForClosed(selectedOverlay, 'Delayed capture selection');
      }
      await driver.waitFor({ selector: 'button[aria-label="Capture delay"]' }, { enabled: true });
      await waitForAllCaptureOverlaysClosed(driver.browserWindow, 'Delayed capture cancellation');
      await waitForScreenshotCount(host, projectPath, baseline.screenshots.length);
      if ((await screenshotFiles(projectPath)).join('\n') !== baselineFiles.join('\n'))
        throw new Error('Cancelled delayed capture wrote screenshot files.');
    }
  }

  let overlay = await startCapture(driver, process.platform === 'win32' ? 'global-shortcut' : 'toolbar');
  const defaultRegion = await overlay.evaluate<boolean>(
    `document.querySelector('[data-mode="region"]')?.getAttribute('aria-checked') === 'true'`,
  );
  if (!defaultRegion) throw new Error('Capture overlay did not default to Region mode.');
  await overlay.click({ selector: '[data-mode="window"]' });
  await overlay.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const instruction = document.querySelector('.capture-instruction');
    const check = () => {
      if (instruction?.textContent !== 'Drag to select a region') return resolve(true);
      if (Date.now() - started > 5000) return reject(new Error('Window mode did not receive the native window list.'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  await overlay.click({ selector: '[data-mode="region"]' });
  await selectRegion(overlay);
  await overlay.click({ selector: '[data-action="copy"]' });
  await overlay.waitFor({ selector: '.capture-dimensions', text: 'Image copied', exact: true });
  const copiedImage = await nativeClipboard.readImage();
  if (copiedImage.isEmpty() || copiedImage.getSize().width < 1 || copiedImage.getSize().height < 1)
    throw new Error('Copy image did not leave a readable image on the native clipboard.');
  if (overlay.browserWindow.isDestroyed() || !overlay.browserWindow.isVisible())
    throw new Error('Copy image closed the capture overlay.');
  await overlay.evaluate(`(() => {
    const actions = document.querySelector('.capture-actions');
    if (!(actions instanceof HTMLElement) || actions.hidden) throw new Error('Copy image hid capture actions.');
  })()`);
  await overlay.click({ selector: '[data-action="retake"]' });
  await waitForRetake(overlay);
  await selectRegion(overlay);
  const cancelledWindow = overlay.browserWindow;
  await overlay.click({ selector: '[data-action="cancel"]' });
  await waitForClosed(cancelledWindow, 'Cancelled capture overlay');
  await waitForAllCaptureOverlaysClosed(driver.browserWindow, 'Cancelled capture');
  await waitForPaint(driver);
  await driver.waitFor({ selector: '[data-testid="annotation-canvas"]' });
  const afterCancel = await waitForScreenshotCount(host, projectPath, baseline.screenshots.length);
  const afterCancelFiles = await screenshotFiles(projectPath);
  if (afterCancelFiles.join('\n') !== baselineFiles.join('\n'))
    throw new Error('Cancelled capture created screenshot files.');
  if (
    afterCancel.screenshots.map((shot) => shot.id).join('|') !==
    baseline.screenshots.map((shot) => shot.id).join('|')
  )
    throw new Error('Cancelled capture changed the project screenshot records.');

  overlay = await startCapture(driver);
  await selectRegion(overlay);
  if (artifactDirectory)
    artifacts.push(await overlay.capture(artifactDirectory, 'capture-overlay-synthetic.png'));
  const savedOverlay = overlay.browserWindow;
  await overlay.click({ selector: '[data-action="save"]' });
  await waitForClosed(savedOverlay, 'Saved capture overlay');
  await waitForAllCaptureOverlaysClosed(driver.browserWindow, 'Saved capture');
  await waitForPaint(driver);
  await driver.waitFor({ selector: '[data-testid="annotation-canvas"]' });
  const afterSave = await waitForScreenshotCount(host, projectPath, baseline.screenshots.length + 1);
  const captured = afterSave.screenshots.find(
    (screenshot) => !baseline.screenshots.some((previous) => previous.id === screenshot.id),
  );
  if (!captured) throw new Error('Saved capture did not create a screenshot record.');
  await driver.waitFor({ selector: `[data-testid="screenshot-${captured.id}"]` });
  const selected = await driver.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(`[data-testid="screenshot-${captured.id}"]`)})?.closest('.shot-item')?.classList.contains('active') === true`,
  );
  if (!selected) throw new Error('Saved capture was not selected in the screenshot rail.');

  // The restored window can put Rectangle in the toolbar overflow menu.
  await driver.click({ selector: '[data-testid="annotation-canvas"]' });
  await driver.press('R');
  await driver.waitFor({ selector: '.canvas-meta', text: 'Tool: rectangle' });
  const canvas = await driver.waitFor({ selector: '[data-testid="annotation-canvas"]' });
  await driver.drag(
    { x: Math.round(canvas.x + canvas.width * 0.4), y: Math.round(canvas.y + canvas.height * 0.4) },
    { x: Math.round(canvas.x + canvas.width * 0.6), y: Math.round(canvas.y + canvas.height * 0.58) },
  );
  await driver.press('S', [process.platform === 'darwin' ? 'meta' : 'control']);
  await driver.waitFor({ selector: '[data-testid="save-state"]', text: 'Saved', exact: true });
  await waitForPaint(driver);
  if (artifactDirectory)
    artifacts.push(await driver.capture(artifactDirectory, 'capture-annotation-synthetic.png'));

  const exportPath = await driver.evaluate<string>(`(async () => {
    const canvas = document.querySelector('.konvajs-content canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Annotation canvas was not rendered.');
    return window.imnota.exportAnnotatedImage({
      projectPath: ${JSON.stringify(projectPath)},
      collectionId: ${JSON.stringify(captured.collectionId)},
      filename: 'synthetic-capture-annotation.png',
      dataUrl: canvas.toDataURL('image/png')
    });
  })()`);
  const exported = await fs.stat(exportPath);
  if (exported.size === 0) throw new Error('Synthetic capture annotation export is empty.');

  overlay = await startCapture(driver);
  await selectRegion(overlay);
  const annotateOverlay = overlay.browserWindow;
  await overlay.click({ selector: '[data-action="annotate"]' });
  await waitForClosed(annotateOverlay, 'Annotated capture overlay');
  await waitForAllCaptureOverlaysClosed(driver.browserWindow, 'Annotated capture');
  await waitForPaint(driver);
  const afterAnnotate = await waitForScreenshotCount(host, projectPath, baseline.screenshots.length + 2);
  const annotated = afterAnnotate.screenshots.find(
    (screenshot) =>
      !baseline.screenshots.some((previous) => previous.id === screenshot.id) &&
      screenshot.id !== captured.id,
  );
  if (!annotated) throw new Error('Annotated capture did not create a screenshot record.');
  await driver.waitFor({
    selector: '.toast',
    text: 'Screen capture added — annotate',
    exact: true,
  });
  await driver.waitFor({
    selector: `.shot-item.active [data-testid="screenshot-${annotated.id}"]`,
  });
  await driver.waitFor({ selector: '.canvas-meta', text: 'Tool: rectangle' });

  await startCapture(driver);
  const availableDisplays = screen.getAllDisplays();
  const clickedDisplay = availableDisplays[1] ?? availableDisplays[0]!;
  const clickedWindow = (await waitForCaptureOverlays(driver.browserWindow)).find(
    (window) => screen.getDisplayMatching(window.getBounds()).id === clickedDisplay.id,
  );
  if (!clickedWindow) throw new Error('Display-mode target overlay did not open.');
  overlay = new NativeUiDriver(clickedWindow);
  await overlay.click({ selector: '[data-mode="display"]' });
  await overlay.waitFor({ selector: '.capture-actions' });
  const displayOverlay = overlay.browserWindow;
  await overlay.click({ selector: '[data-action="save"]' });
  await waitForClosed(displayOverlay, 'Saved display capture overlay');
  await waitForAllCaptureOverlaysClosed(driver.browserWindow, 'Saved display capture');
  await waitForPaint(driver);
  const afterDisplay = await waitForScreenshotCount(host, projectPath, baseline.screenshots.length + 3);
  const displayScreenshot = afterDisplay.screenshots.find(
    (shot) => !afterAnnotate.screenshots.some((previous) => previous.id === shot.id),
  );
  if (!displayScreenshot) throw new Error('Display mode did not save a screenshot.');
  await verifySyntheticDisplayPng(projectPath, displayScreenshot, clickedDisplay, screen.getAllDisplays());
  await driver.waitFor({ selector: 'button[aria-label^="Capture area"]:not(:disabled)' });

  // Full-display capture must not replace the remembered region. Repeat uses the
  // same source pixels and crop through the normal renderer/native IPC path.
  await driver.press('6', [process.platform === 'darwin' ? 'meta' : 'control', 'shift']);
  const afterRepeat = await waitForScreenshotCount(host, projectPath, baseline.screenshots.length + 4);
  const repeated = afterRepeat.screenshots.at(-1);
  if (
    !repeated ||
    repeated.id === captured.id ||
    repeated.originalWidth !== captured.originalWidth ||
    repeated.originalHeight !== captured.originalHeight
  )
    throw new Error('Repeat capture did not preserve the original crop dimensions.');
  const [originalBytes, repeatedBytes] = await Promise.all([
    fs.readFile(screenshotPath(projectPath, captured)),
    fs.readFile(screenshotPath(projectPath, repeated)),
  ]);
  if (!originalBytes.equals(repeatedBytes))
    throw new Error('Repeat capture changed the synthetic region pixels.');
  await driver.waitFor({ selector: `[data-testid="screenshot-${repeated.id}"]` });

  overlay = await startCapture(driver);
  await overlay.click({ selector: '[data-action="last-region"]' });
  overlay = await waitForCaptureActionsOverlay(driver.browserWindow);
  const repeatOverlay = overlay.browserWindow;
  await overlay.click({ selector: '[data-action="cancel"]' });
  await waitForClosed(repeatOverlay, 'Cancelled remembered-region preview');
  await waitForScreenshotCount(host, projectPath, baseline.screenshots.length + 4);

  const displays = screen.getAllDisplays();
  const crossDisplayPlan = planCrossDisplaySmokeSelection(displays);
  let crossDisplay: CaptureSmokeResult['crossDisplay'] = null;
  if (crossDisplayPlan) {
    const beforeCross = await host.readProject(projectPath);
    await startCapture(driver);
    const overlayDrivers = (await waitForCaptureOverlays(driver.browserWindow)).map(
      (window) => new NativeUiDriver(window),
    );
    const crossOverlay =
      process.platform === 'win32'
        ? await selectCrossDisplayRegionWithNativePointer(overlayDrivers, crossDisplayPlan)
        : await selectCrossDisplayRegion(overlayDrivers, displays, crossDisplayPlan);
    if (artifactDirectory)
      artifacts.push(await crossOverlay.capture(artifactDirectory, 'capture-cross-display-synthetic.png'));
    await crossOverlay.click({ selector: '[data-action="save"]' });
    await waitForAllCaptureOverlaysClosed(driver.browserWindow, 'Cross-display capture');
    const afterCross = await waitForScreenshotCount(host, projectPath, beforeCross.screenshots.length + 1);
    const crossScreenshot = afterCross.screenshots.find(
      (shot) => !beforeCross.screenshots.some((previous) => previous.id === shot.id),
    );
    if (!crossScreenshot) throw new Error('Cross-display capture did not save a screenshot.');
    const crossFile = path.relative(projectPath, screenshotPath(projectPath, crossScreenshot));
    await verifySyntheticCrossDisplayPng(projectPath, crossFile, crossScreenshot, displays, crossDisplayPlan);
    await waitForPaint(driver);
    await driver.press('6', [process.platform === 'darwin' ? 'meta' : 'control', 'shift']);
    const afterCrossRepeat = await waitForScreenshotCount(
      host,
      projectPath,
      beforeCross.screenshots.length + 2,
    );
    const repeatedCross = afterCrossRepeat.screenshots.find(
      (shot) => !afterCross.screenshots.some((previous) => previous.id === shot.id),
    );
    if (!repeatedCross) throw new Error('Cross-display repeat did not save a screenshot.');
    const [firstPng, repeatedPng] = await Promise.all([
      fs.readFile(screenshotPath(projectPath, crossScreenshot)),
      fs.readFile(screenshotPath(projectPath, repeatedCross)),
    ]);
    if (!firstPng.equals(repeatedPng)) throw new Error('Cross-display repeat changed the captured pixels.');
    crossDisplay = {
      input: process.platform === 'win32' ? 'native-pointer' : 'overlay-ipc',
      selection: crossDisplayPlan.selection,
      output: { width: crossScreenshot.originalWidth, height: crossScreenshot.originalHeight },
      repeatedPixelsEqual: true,
    };
  }

  const reopenedFromTray = await host.captureFromTray('display');
  const trayOverlayDriver = await waitForCaptureActionsOverlay(reopenedFromTray);
  const trayOverlay = trayOverlayDriver.browserWindow;
  await trayOverlayDriver.waitFor({ selector: '[data-mode="display"][aria-checked="true"]' });
  await trayOverlayDriver.click({ selector: '[data-action="cancel"]' });
  await waitForClosed(trayOverlay, 'Queued tray capture overlay');
  await waitForAllCaptureOverlaysClosed(reopenedFromTray, 'Queued tray capture');

  return { artifacts, skipped: false, displays, crossDisplay };
}
