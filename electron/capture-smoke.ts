import { BrowserWindow, nativeImage, screen, type Display } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectData } from '../src/shared/types.js';
import type { CaptureRectangle } from '../src/shared/capture.js';
import {
  planCrossDisplaySmokeSelection,
  syntheticCaptureColor,
  type CrossDisplaySmokeSelection,
} from './capture-smoke-contract.js';
import { NativeUiDriver, type SmokeCapture } from './smoke-native-driver.js';

export interface CaptureSmokeHost {
  reopenWindow(): Promise<BrowserWindow>;
  readProject(projectPath: string): Promise<ProjectData>;
}

export interface CaptureSmokeResult {
  artifacts: SmokeCapture[];
  skipped: boolean;
  crossDisplayVerified: boolean;
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
    const expected = process.platform === 'win32' ? screen.getAllDisplays().length : 1;
    if (overlays.length === expected && overlays.every((window) => window.isVisible())) return overlays;
    await delay(50);
  } while (Date.now() - started < 15_000);
  throw new Error('Synthetic capture overlay did not open.');
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
      window.webContents.getURL().includes('capture-overlay.html'),
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
  await driver.click({ selector: '.settings-navigation button', text: 'Shortcuts', exact: true });
  await driver.click({ selector: '#capture-settings-title + label input[type="checkbox"]' });
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

async function startCaptureGroup(
  driver: NativeUiDriver,
  trigger: 'toolbar' | 'shortcut' = 'toolbar',
): Promise<NativeUiDriver[]> {
  if (trigger === 'shortcut') await driver.press('5', ['control', 'shift']);
  else await driver.click({ selector: 'button[aria-label^="Capture screen region"]' });
  const overlays = await waitForCaptureOverlays(driver.browserWindow);
  const overlayDrivers = overlays.map((overlay) => new NativeUiDriver(overlay));
  for (const overlayDriver of overlayDrivers) {
    await overlayDriver.waitFor({ selector: '.capture-overlay' });
    const display = screen.getDisplayMatching(overlayDriver.browserWindow.getBounds());
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
  }
  return overlayDrivers;
}

async function startCapture(
  driver: NativeUiDriver,
  trigger: 'toolbar' | 'shortcut' = 'toolbar',
): Promise<NativeUiDriver> {
  const overlayDrivers = await startCaptureGroup(driver, trigger);
  const display = screen.getDisplayMatching(driver.browserWindow.getBounds());
  return (
    overlayDrivers.find(
      (overlay) => screen.getDisplayMatching(overlay.browserWindow.getBounds()).id === display.id,
    ) ?? overlayDrivers[0]!
  );
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
  if (!smokeCaptureIsEnabled()) return { artifacts: [], skipped: true, crossDisplayVerified: false };
  if (!['win32', 'darwin'].includes(process.platform))
    throw new Error('Synthetic region capture smoke is only applicable on Windows and macOS.');

  const artifacts: SmokeCapture[] = [];
  const driver = await enableExperimentalCapture(initialDriver, host);
  const projectPath = await openScreenshotProject(driver);
  const baseline = await host.readProject(projectPath);
  const baselineFiles = await screenshotFiles(projectPath);

  let overlay = await startCapture(driver);
  await selectRegion(overlay);
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

  const displays = screen.getAllDisplays();
  const crossDisplayPlan = process.platform === 'win32' ? planCrossDisplaySmokeSelection(displays) : null;
  if (crossDisplayPlan) {
    const overlays = await startCaptureGroup(driver, 'shortcut');
    overlay = await selectCrossDisplayRegion(overlays, displays, crossDisplayPlan);
  } else {
    overlay = await startCapture(driver, process.platform === 'win32' ? 'shortcut' : 'toolbar');
    await selectRegion(overlay);
  }
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
  if (crossDisplayPlan) {
    const afterSaveFiles = await screenshotFiles(projectPath);
    const addedFiles = afterSaveFiles.filter((file) => !baselineFiles.includes(file));
    if (addedFiles.length !== 1)
      throw new Error('Cross-display capture did not create exactly one screenshot PNG.');
    await verifySyntheticCrossDisplayPng(projectPath, addedFiles[0]!, captured, displays, crossDisplayPlan);
  }
  await driver.waitFor({ selector: `[data-testid="screenshot-${captured.id}"]` });
  const selected = await driver.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(`[data-testid="screenshot-${captured.id}"]`)})?.closest('.shot-item')?.classList.contains('active') === true`,
  );
  if (!selected) throw new Error('Saved capture was not selected in the screenshot rail.');

  await driver.click({ selector: '[data-testid="tool-rectangle"]' });
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

  return { artifacts, skipped: false, crossDisplayVerified: Boolean(crossDisplayPlan) };
}
