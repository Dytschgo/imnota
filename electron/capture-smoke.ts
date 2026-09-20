import { BrowserWindow, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectData } from '../src/shared/types.js';
import { NativeUiDriver, type SmokeCapture } from './smoke-native-driver.js';

export interface CaptureSmokeHost {
  reopenWindow(): Promise<BrowserWindow>;
  readProject(projectPath: string): Promise<ProjectData>;
}

export interface CaptureSmokeResult {
  artifacts: SmokeCapture[];
  skipped: boolean;
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

async function waitForCaptureOverlay(mainWindow: BrowserWindow): Promise<BrowserWindow> {
  const started = Date.now();
  do {
    const overlays = captureOverlayWindows(mainWindow);
    if (overlays.length === 1 && overlays[0] && overlays[0].isVisible()) return overlays[0];
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

async function startCapture(
  driver: NativeUiDriver,
  trigger: 'toolbar' | 'shortcut' = 'toolbar',
): Promise<NativeUiDriver> {
  if (trigger === 'shortcut') await driver.press('5', ['control', 'shift']);
  else await driver.click({ selector: 'button[aria-label^="Capture screen region"]' });
  if (process.platform === 'win32' && screen.getAllDisplays().length > 1) {
    await driver.waitFor({ selector: '[data-testid="capture-display-dialog"]' });
    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;
    const chosen = displays.find((display) => display.id !== primaryId) ?? displays[0]!;
    await driver.click({ selector: `[data-display-id="${chosen.id}"]` });
  }
  const overlay = await waitForCaptureOverlay(driver.browserWindow);
  const overlayDriver = new NativeUiDriver(overlay);
  await overlayDriver.waitFor({ selector: '.capture-overlay' });
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
  if (!smokeCaptureIsEnabled()) return { artifacts: [], skipped: true };
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

  overlay = await startCapture(driver, process.platform === 'win32' ? 'shortcut' : 'toolbar');
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

  return { artifacts, skipped: false };
}
