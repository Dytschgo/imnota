import { app, clipboard, nativeImage, type BrowserWindow } from 'electron';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Annotation, ProjectData, WorkspaceSettings } from '../src/shared/types.js';
import { exerciseMixedContent } from './mixed-content-smoke.js';
import {
  NativeUiDriver,
  SMOKE_VIEWPORTS,
  mapSourcePointToPromptPixel,
  pathIsWithin,
  sourceBoxInteriorPoint,
  validateCreatedSmokeDirectory,
  type SmokeCapture,
  type SmokeLocator,
  type SmokePoint,
} from './smoke-native-driver.js';

export type SmokeWorkflowMode = 'smoke' | 'stress';

export interface SmokeWorkflowHost {
  /** Update the in-memory production workspace without opening a native chooser. */
  setWorkspace(workspacePath: string): void | Promise<void>;
  /** Replace the app window through the production create/load path and return the ready window. */
  reopenWindow(): Promise<BrowserWindow>;
  /** Read through the production migration, validation, and description hydration path. */
  readProject(projectPath: string): Promise<ProjectData>;
  /** Run the production recovery path with "Restore edits" selected for this test fixture. */
  restoreRecovery(projectPath: string): Promise<ProjectData>;
  /** Read the persisted legacy update/workspace settings through production code. */
  readSettings(): Promise<WorkspaceSettings>;
}

export interface SmokeWorkflowOptions {
  fixtureRoot: string;
  artifactDirectory?: string;
  version: string;
  expectedVersion?: string;
  mode?: SmokeWorkflowMode;
}

export interface SmokeMemoryReading {
  mainResidentMegabytes: number;
  rendererResidentMegabytes: number;
  gpuResidentMegabytes: number;
}

export interface SmokeMemoryProfile {
  baseline: SmokeMemoryReading;
  peak: SmokeMemoryReading;
  post: SmokeMemoryReading;
  sampleCount: number;
  sampleIntervalMilliseconds: number;
}

export interface SmokeTiming extends SmokeMemoryReading {
  scenario: string;
  screenshotCount: number;
  importMs: number;
  reopenMs: number;
  renderMs?: number;
  bundleCount?: number;
  memoryProfile?: SmokeMemoryProfile;
}

export interface SmokeWorkflowReport {
  passed: true;
  version: string;
  mode: SmokeWorkflowMode;
  artifacts: SmokeCapture[];
  timings: SmokeTiming[];
  assertions: string[];
}

interface FixtureSource {
  path: string;
  width: number;
  height: number;
}

interface CanvasGeometry {
  stage: { x: number; y: number; width: number; height: number };
  image: { x: number; y: number; width: number; height: number; scale: number };
}

interface PromptCardState {
  title: string;
  text: string;
  copyLabel?: string;
}

type WorkflowFailureCode =
  | 'invalid-input'
  | 'permission-denied'
  | 'project-not-found'
  | 'collection-not-found'
  | 'project-changed'
  | 'session-not-found'
  | 'linked-path';

export const SMOKE_UI_CONTRACT = {
  onboardingDialog: [
    { selector: '[data-testid="onboarding-dialog"]' },
    { selector: '[role="dialog"]', text: 'Try the complete handoff' },
  ],
  newProject: [{ selector: '[data-testid="new-project-button"]' }, { text: 'New project', exact: true }],
  projectName: [{ selector: '[data-testid="project-name-input"]' }, { selector: '[role="dialog"] input' }],
  projectDescription: [
    { selector: '[data-testid="project-description-input"]' },
    { selector: '[role="dialog"] textarea' },
  ],
  createProject: [
    { selector: '[data-testid="create-project-submit"]' },
    { text: 'Create project', exact: true },
  ],
  canvas: [{ selector: '[data-testid="annotation-canvas"]' }, { selector: '.canvas-wrap' }],
  contextBuilder: [
    { selector: '[data-testid="context-builder-button"]' },
    { text: 'Context Builder', exact: true },
  ],
  shareBundles: [
    { selector: '[data-testid="share-prompt-bundles"]' },
    { text: 'Share prompt bundles', exact: true },
    { text: 'Copy AI context', exact: true },
  ],
  promptDialog: [
    { selector: '[data-testid="prompt-sharing-dialog"]' },
    { selector: '[role="dialog"]', text: 'Share prompt bundles' },
  ],
  settings: [{ selector: '[data-testid="settings-button"]' }, { text: 'Settings', exact: true }],
} as const satisfies Record<string, readonly SmokeLocator[]>;

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function bridgePrelude(): string {
  return `
    const workflow = window.imnotaWorkflow ?? window.imnota?.workflow ?? window.imnota;
    if (!workflow) throw new Error('Workflow bridge is missing');
    const unwrap = (result) => {
      if (!result?.ok) {
        const error = result?.error;
        throw new Error('[' + (error?.code ?? 'unknown') + '] ' + (error?.message ?? 'Workflow failed'));
      }
      return result.value;
    };
  `;
}

async function clickAny(driver: NativeUiDriver, locators: readonly SmokeLocator[]): Promise<SmokePoint> {
  return driver.clickAny(locators);
}

async function existsAny(driver: NativeUiDriver, locators: readonly SmokeLocator[]): Promise<boolean> {
  for (const locator of locators) if (await driver.exists(locator)) return true;
  return false;
}

async function fillAny(
  driver: NativeUiDriver,
  locators: readonly SmokeLocator[],
  value: string,
): Promise<void> {
  for (const locator of locators) {
    if (await driver.exists(locator)) {
      await driver.fill(locator, value);
      return;
    }
  }
  throw new Error(`Smoke field was not found: ${JSON.stringify(locators)}.`);
}

function dimensionsForIndex(index: number): { width: number; height: number } {
  return [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1600 },
    { width: 3840, height: 2160 },
  ][index % 3];
}

function bitmap(width: number, height: number, seed: number): Buffer {
  const value = Buffer.allocUnsafe(width * height * 4);
  const colors = [
    [0x36, 0x58, 0x7a, 0xff],
    [0x74, 0x91, 0x2c, 0xff],
    [0x2d, 0x42, 0xb0, 0xff],
    [0x9a, 0x48, 0x31, 0xff],
  ] as const;
  const stripeHeight = Math.max(1, Math.floor(height / colors.length));
  for (let y = 0; y < height; y += 1) {
    const color = colors[(Math.floor(y / stripeHeight) + seed) % colors.length];
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      value[offset] = color[0];
      value[offset + 1] = color[1];
      value[offset + 2] = color[2];
      value[offset + 3] = color[3];
    }
  }
  return value;
}

async function createFixtureSources(root: string): Promise<FixtureSource[]> {
  const directory = path.join(root, 'sources');
  await fs.mkdir(directory);
  const sources: FixtureSource[] = [];
  for (let index = 0; index < 3; index += 1) {
    const dimensions = dimensionsForIndex(index);
    const target = path.join(directory, `source-${dimensions.width}x${dimensions.height}.png`);
    const image = nativeImage.createFromBitmap(bitmap(dimensions.width, dimensions.height, index), {
      ...dimensions,
      scaleFactor: 1,
    });
    await fs.writeFile(target, image.toPNG(), { flag: 'wx' });
    sources.push({ path: target, ...dimensions });
  }
  return sources;
}

async function createProjectThroughUi(
  driver: NativeUiDriver,
  name: string,
  onboardingAwaitingProject: boolean,
): Promise<string> {
  if (onboardingAwaitingProject) {
    await clickAny(driver, [
      { selector: '[data-testid="onboarding-create-project"]' },
      { text: 'Create your first project', exact: true },
    ]);
  } else {
    await clickAny(driver, SMOKE_UI_CONTRACT.newProject);
  }
  await driver.waitFor({ selector: '[role="dialog"]', text: 'New project' });
  await fillAny(driver, SMOKE_UI_CONTRACT.projectName, name);
  await fillAny(
    driver,
    SMOKE_UI_CONTRACT.projectDescription,
    'Created through the real new-project prompt by native verification.',
  );
  await clickAny(driver, SMOKE_UI_CONTRACT.createProject);
  await driver.waitFor({ selector: '.workspace, [data-testid="workspace"]' });
  return driver.evaluate<string>(`(async () => {
    const projects = await window.imnota.listProjects();
    const project = projects.find((item) => item.name === ${JSON.stringify(name)});
    if (!project) throw new Error('UI-created project did not appear in the workspace');
    return project.projectPath;
  })()`);
}

async function exerciseOnboarding(
  driver: NativeUiDriver,
  artifactDirectory: string | undefined,
  artifacts: SmokeCapture[],
): Promise<boolean> {
  const present = await existsAny(driver, SMOKE_UI_CONTRACT.onboardingDialog);
  if (!present) return false;
  await driver.resize(SMOKE_VIEWPORTS[0]);
  if (artifactDirectory)
    artifacts.push(await driver.capture(artifactDirectory, '1280x800-onboarding-intro.png'));
  await clickAny(driver, [
    { selector: '[data-testid="onboarding-use-sample"]' },
    { text: 'Use sample screenshot', exact: true },
  ]);
  await clickAny(driver, [
    { selector: '[data-testid="onboarding-guided-note"]' },
    { text: 'Add guided note', exact: true },
  ]);
  if (artifactDirectory)
    artifacts.push(await driver.capture(artifactDirectory, '1280x800-onboarding-annotate.png'));
  await clickAny(driver, [
    { selector: '[data-testid="onboarding-continue"]' },
    { text: 'Continue to copy', exact: true },
  ]);
  await driver.waitFor({ text: 'Copy PNG + Markdown', exact: true });
  if (artifactDirectory)
    artifacts.push(await driver.capture(artifactDirectory, '1280x800-onboarding-copy.png'));
  await driver.click({ text: 'Copy PNG + Markdown', exact: true });
  await driver.waitFor({ text: 'PNG and Markdown copied together' });
  return true;
}

async function importImages(
  driver: NativeUiDriver,
  projectPath: string,
  sources: readonly FixtureSource[],
  count: number,
): Promise<void> {
  const paths = Array.from({ length: count }, (_, index) => sources[index % sources.length].path);
  for (let offset = 0; offset < paths.length; offset += 10) {
    const batch = paths.slice(offset, offset + 10);
    await driver.evaluate(`(async () => {
      const snapshot = await window.imnota.loadProject(${JSON.stringify(projectPath)});
      const collectionId = snapshot.project.collections.find((item) => !item.archived)?.id
        ?? snapshot.project.collections.at(-1)?.id;
      if (!collectionId) throw new Error('Fixture project has no collection');
      await window.imnota.importImageFiles({
        projectPath: ${JSON.stringify(projectPath)},
        collectionId,
        paths: ${JSON.stringify(batch)}
      });
      return true;
    })()`);
  }
}

function memoryMegabytes(window: BrowserWindow): SmokeMemoryReading {
  const main = process.memoryUsage().rss / (1024 * 1024);
  const rendererPid = window.webContents.getOSProcessId();
  const metrics = app.getAppMetrics();
  const renderer = metrics.find((item) => item.pid === rendererPid);
  const gpu = metrics
    .filter((item) => item.type === 'GPU')
    .reduce((total, item) => total + item.memory.workingSetSize / 1024, 0);
  return {
    mainResidentMegabytes: Math.round(main * 10) / 10,
    rendererResidentMegabytes: Math.round(((renderer?.memory.workingSetSize ?? 0) / 1024) * 10) / 10,
    gpuResidentMegabytes: Math.round(gpu * 10) / 10,
  };
}

function maximumMemory(left: SmokeMemoryReading, right: SmokeMemoryReading): SmokeMemoryReading {
  return {
    mainResidentMegabytes: Math.max(left.mainResidentMegabytes, right.mainResidentMegabytes),
    rendererResidentMegabytes: Math.max(left.rendererResidentMegabytes, right.rendererResidentMegabytes),
    gpuResidentMegabytes: Math.max(left.gpuResidentMegabytes, right.gpuResidentMegabytes),
  };
}

function startMemorySampler(window: BrowserWindow, sampleIntervalMilliseconds = 200) {
  const baseline = memoryMegabytes(window);
  let peak = baseline;
  let sampleCount = 1;
  let disposed = false;
  let samplingError: unknown;
  const sample = () => {
    const reading = memoryMegabytes(window);
    peak = maximumMemory(peak, reading);
    sampleCount += 1;
    return reading;
  };
  const timer = setInterval(() => {
    if (disposed || samplingError) return;
    try {
      sample();
    } catch (error) {
      samplingError = error;
    }
  }, sampleIntervalMilliseconds);
  return {
    finish(): SmokeMemoryProfile {
      if (disposed) throw new Error('Smoke memory sampler is already disposed.');
      if (samplingError) throw samplingError;
      const post = sample();
      return { baseline, peak, post, sampleCount, sampleIntervalMilliseconds };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
    },
  };
}

async function profileMemoryDuring<T>(
  window: BrowserWindow,
  action: () => Promise<T>,
): Promise<{ result: T; memoryProfile: SmokeMemoryProfile }> {
  const sampler = startMemorySampler(window);
  try {
    const result = await action();
    return { result, memoryProfile: sampler.finish() };
  } finally {
    sampler.dispose();
  }
}

async function createBenchmarkProject(
  driver: NativeUiDriver,
  sources: readonly FixtureSource[],
  count: number,
  projectName?: string,
): Promise<{ projectPath: string; importMs: number; reopenMs: number }> {
  const name = projectName ?? `Verification ${String(count).padStart(3, '0')}`;
  const projectPath = await driver.evaluate<string>(`(async () => {
    const snapshot = await window.imnota.createProject({ name: ${JSON.stringify(name)}, description: 'Synthetic native verification fixture' });
    return snapshot.projectPath;
  })()`);
  const importStarted = performance.now();
  await importImages(driver, projectPath, sources, count);
  const importMs = performance.now() - importStarted;
  const reopenStarted = performance.now();
  const reopenedCount = await driver.evaluate<number>(`(async () => {
    const snapshot = await window.imnota.loadProject(${JSON.stringify(projectPath)});
    if (Object.keys(snapshot.thumbnails).length !== ${count}) throw new Error('Thumbnail count changed');
    return snapshot.project.screenshots.length;
  })()`);
  if (reopenedCount !== count)
    throw new Error(`${count}-image fixture reopened with ${reopenedCount} images.`);
  return { projectPath, importMs, reopenMs: performance.now() - reopenStarted };
}

async function canvasGeometry(driver: NativeUiDriver): Promise<CanvasGeometry> {
  return driver.evaluate<CanvasGeometry>(`(() => {
    const wrap = document.querySelector('[data-testid="annotation-canvas"], .canvas-wrap');
    const stage = document.querySelector('.konvajs-content');
    if (!wrap || !stage) throw new Error('Annotation canvas geometry is unavailable');
    const bounds = stage.getBoundingClientRect();
    const scale = Number(wrap.dataset.imageScale);
    const x = bounds.x + Number(wrap.dataset.imageX) + Number(wrap.dataset.sourceX ?? 0) * scale;
    const y = bounds.y + Number(wrap.dataset.imageY) + Number(wrap.dataset.sourceY ?? 0) * scale;
    const meta = document.querySelector('.canvas-meta > span:first-child')?.textContent ?? '';
    const dimensions = meta.match(/(\\d+)\\s*[×x]\\s*(\\d+)/);
    if (!dimensions || !Number.isFinite(scale)) throw new Error('Canvas dimensions are unavailable');
    return {
      stage: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      image: { x, y, width: Number(wrap.dataset.sourceWidth ?? dimensions[1]) * scale, height: Number(wrap.dataset.sourceHeight ?? dimensions[2]) * scale, scale }
    };
  })()`);
}

async function selectTool(driver: NativeUiDriver, label: string): Promise<void> {
  const toolId = label.toLowerCase().replaceAll(' ', '-');
  const direct = {
    selector: `[data-testid="tool-${toolId}"],[aria-label^="${label}"]`,
  };
  if (await driver.exists(direct)) {
    await driver.click(direct);
    return;
  }
  await clickAny(driver, [
    { selector: '[data-testid="more-annotation-tools"]' },
    { text: 'More annotation tools', exact: true },
  ]);
  await clickAny(driver, [
    { selector: `[data-testid="tool-${toolId}"]` },
    { selector: '[role="menuitemradio"]', text: label },
  ]);
}

async function waitForStableCanvas(driver: NativeUiDriver): Promise<void> {
  let previous = '';
  let unchangedSince = Date.now();
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const current = JSON.stringify(await canvasGeometry(driver));
    if (current !== previous) {
      previous = current;
      unchangedSince = Date.now();
    } else if (Date.now() - unchangedSince >= 400) return;
    await delay(50);
  }
  throw new Error('Canvas layout did not settle before native interaction.');
}

async function exerciseNativeCanvas(
  driver: NativeUiDriver,
  artifactDirectory?: string,
  artifacts: SmokeCapture[] = [],
): Promise<void> {
  // Reopening creates a hidden local smoke window. Present the disposable window
  // so Konva's hit canvas is repainted before successive native double-clicks.
  driver.browserWindow.show();
  driver.browserWindow.focus();
  await driver.waitFor({ selector: '.konvajs-content' });
  // Hosted runners can finish their first ResizeObserver/layout pass after the stage mounts.
  await waitForStableCanvas(driver);
  let geometry = await canvasGeometry(driver);
  const panStart = {
    x: Math.round(geometry.stage.x + 20),
    y: Math.round(geometry.stage.y + Math.min(100, geometry.stage.height / 2)),
  };
  const beforePan = geometry.image.x;
  const panTarget = await driver.evaluate<string>(
    `document.elementFromPoint(${panStart.x}, ${panStart.y})?.outerHTML.slice(0, 300) ?? 'outside viewport'`,
  );
  await driver.drag(panStart, { x: panStart.x + 70, y: panStart.y - 30 });
  geometry = await canvasGeometry(driver);
  if (geometry.image.x <= beforePan + 40)
    throw new Error(
      `Default select-tool panning ignored native input: ${JSON.stringify({ panStart, panTarget, beforePan, afterPan: geometry.image.x, geometry })}`,
    );

  await driver.evaluate(`(() => {
    const stageContainer = document.querySelector('.konvajs-content')?.parentElement;
    if (!stageContainer) throw new Error('Canvas command target is unavailable');
    stageContainer.dispatchEvent(new CustomEvent('imnota:canvas-command', { detail: 'fit' }));
  })()`);
  await waitForStableCanvas(driver);
  geometry = await canvasGeometry(driver);
  const textPoint = {
    x: Math.round(geometry.image.x + geometry.image.width * 0.5),
    y: Math.round(geometry.image.y + geometry.image.height * 0.5),
  };
  if (
    textPoint.x < geometry.stage.x ||
    textPoint.x > geometry.stage.x + geometry.stage.width ||
    textPoint.y < geometry.stage.y ||
    textPoint.y > geometry.stage.y + geometry.stage.height
  )
    throw new Error(`Text test point escaped the visible canvas: ${JSON.stringify({ geometry, textPoint })}`);
  await driver.evaluate(`(() => {
    window.__imnotaPointerTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'lostpointercapture'])
      document.addEventListener(type, (event) => {
        window.__imnotaPointerTrace.push({ type, x: event.clientX, y: event.clientY, target: event.target?.className, detail: event.detail });
        if (window.__imnotaPointerTrace.length > 60) window.__imnotaPointerTrace.shift();
      }, true);
    window.__imnotaPointerGeometry = ${JSON.stringify({ geometry, textPoint })};
  })()`);
  await driver.doubleClick(textPoint);
  await driver.waitFor({ selector: '[aria-label="Edit annotation text"]' });
  await driver.fill({ selector: '[aria-label="Edit annotation text"]' }, 'Trusted pointer note');
  const filled = await driver.evaluate<string>(
    `document.querySelector('[aria-label="Edit annotation text"]')?.value ?? ''`,
  );
  if (filled !== 'Trusted pointer note')
    throw new Error('Native text input did not receive the expected value.');
  await driver.press('ENTER');
  await driver.waitFor({ selector: '[aria-label="Edit annotation text"]' }, { absent: true });
  const sourceOrigin = {
    x: (textPoint.x - geometry.image.x) / geometry.image.scale,
    y: (textPoint.y - geometry.image.y) / geometry.image.scale,
  };
  const currentReopenPoint = async () => {
    await waitForStableCanvas(driver);
    const current = await canvasGeometry(driver);
    return sourceBoxInteriorPoint(
      {
        x: current.image.x + sourceOrigin.x * current.image.scale,
        y: current.image.y + sourceOrigin.y * current.image.scale,
      },
      { width: 260, height: 42 },
      current.image.scale,
    );
  };
  let reopenPoint = await currentReopenPoint();
  await driver.evaluate(`window.__imnotaPointerGeometry.reopenPoint = ${JSON.stringify(reopenPoint)}`);
  await delay(600);
  await driver.clickPoint(reopenPoint);
  await driver.waitFor({ selector: '.annotation-properties' });
  const inspectorText = await driver.evaluate<string | null>(`(() => {
    const field = [...document.querySelectorAll('.annotation-properties label.field')]
      .find((label) => label.querySelector('.field-label')?.textContent?.trim() === 'Text');
    return field?.querySelector('input')?.value ?? null;
  })()`);
  if (inspectorText !== 'Trusted pointer note')
    throw new Error(
      `Committed annotation text did not reach the inspector: ${JSON.stringify(inspectorText)}.`,
    );
  await delay(600);
  reopenPoint = await currentReopenPoint();
  await driver.doubleClick(reopenPoint);
  await driver.waitFor({ selector: '[aria-label="Edit annotation text"]' });
  const reopened = await driver.evaluate<string>(
    `document.querySelector('[aria-label="Edit annotation text"]')?.value ?? ''`,
  );
  if (reopened !== 'Trusted pointer note') throw new Error('Double-click did not reopen the committed text.');
  await driver.press('END');
  await driver.typeText(' must be cancelled');
  const replacement = await driver.evaluate<string>(
    `document.querySelector('[aria-label="Edit annotation text"]')?.value ?? ''`,
  );
  if (replacement !== 'Trusted pointer note must be cancelled')
    throw new Error(`Native edit text was not entered: ${JSON.stringify(replacement)}.`);
  await driver.press('ESCAPE');
  await driver.waitFor({ selector: '[aria-label="Edit annotation text"]' }, { absent: true });
  await delay(150);
  const afterEscape = await driver.evaluate<string | null>(`(() => {
    const field = [...document.querySelectorAll('.annotation-properties label.field')]
      .find((label) => label.querySelector('.field-label')?.textContent?.trim() === 'Text');
    return field?.querySelector('input')?.value ?? null;
  })()`);
  if (afterEscape !== 'Trusted pointer note')
    throw new Error(`Escape changed the committed inspector text: ${JSON.stringify(afterEscape)}.`);
  reopenPoint = await currentReopenPoint();
  await driver.doubleClick(reopenPoint);
  await driver.waitFor({ selector: '[aria-label="Edit annotation text"]' });
  const cancelled = await driver.evaluate<string>(
    `document.querySelector('[aria-label="Edit annotation text"]')?.value ?? ''`,
  );
  if (cancelled !== 'Trusted pointer note')
    throw new Error(`Escape did not restore inline text: ${JSON.stringify(cancelled)}.`);
  await driver.press('ENTER');

  geometry = await canvasGeometry(driver);
  await selectTool(driver, 'Crop');
  await driver.drag(
    {
      x: Math.round(geometry.image.x + geometry.image.width * 0.15),
      y: Math.round(geometry.image.y + geometry.image.height * 0.15),
    },
    {
      x: Math.round(geometry.image.x + geometry.image.width * 0.72),
      y: Math.round(geometry.image.y + geometry.image.height * 0.72),
    },
  );
  await driver.waitFor({ selector: '[aria-label="Crop controls"]' });
  if (artifactDirectory) artifacts.push(await driver.capture(artifactDirectory, 'crop-preview.png'));
  await driver.click({ text: 'Apply crop', exact: true });
  await driver.waitFor({ selector: '[aria-label="Crop controls"]' }, { absent: true });
  await waitForStableCanvas(driver);
  const croppedWidth = await driver.evaluate<number>(
    `Number(document.querySelector('.canvas-wrap').dataset.sourceWidth)`,
  );
  if (!(croppedWidth > 0 && croppedWidth < 1920))
    throw new Error('Apply crop did not change visible source bounds.');
  await selectTool(driver, 'Crop');
  await driver.click({ text: 'Reset to full image', exact: true });
  const cancelUnobstructed = await driver.evaluate<boolean>(`(() => {
    const button = [...document.querySelectorAll('.crop-actions button')]
      .find((element) => element.textContent.trim() === 'Cancel crop');
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })()`);
  if (!cancelUnobstructed) throw new Error('Crop Cancel is covered by another surface.');
  await driver.click({ text: 'Cancel crop', exact: true });
  await driver.waitFor({ selector: '[aria-label="Crop controls"]' }, { absent: true });
  const cancelledWidth = await driver.evaluate<number>(
    `Number(document.querySelector('.canvas-wrap').dataset.sourceWidth)`,
  );
  if (cancelledWidth !== croppedWidth) throw new Error('Cancel crop changed committed bounds.');
  if (artifactDirectory) artifacts.push(await driver.capture(artifactDirectory, 'crop-applied.png'));
  geometry = await canvasGeometry(driver);
  await selectTool(driver, 'Redaction mask');
  await driver.drag(
    {
      x: Math.round(geometry.image.x + geometry.image.width * 0.3),
      y: Math.round(geometry.image.y + geometry.image.height * 0.3),
    },
    {
      x: Math.round(geometry.image.x + geometry.image.width * 0.4),
      y: Math.round(geometry.image.y + geometry.image.height * 0.4),
    },
  );
  await selectTool(driver, 'Arrow');
  await driver.drag(
    {
      x: Math.round(geometry.image.x + geometry.image.width * 0.9),
      y: Math.round(geometry.image.y + geometry.image.height * 0.8),
    },
    {
      x: Math.round(geometry.image.x + geometry.image.width + 80),
      y: Math.round(geometry.image.y + geometry.image.height + 50),
    },
  );
  await delay(900);
}

async function installDeterministicExportAnnotations(
  driver: NativeUiDriver,
  projectPath: string,
): Promise<{ screenshotId: string; annotations: Annotation[] }> {
  return driver.evaluate(`(async () => {
    const snapshot = await window.imnota.loadProject(${JSON.stringify(projectPath)});
    const screenshot = snapshot.project.screenshots[0];
    const content = await window.imnota.loadScreenshotContent({ projectPath: snapshot.projectPath, screenshot });
    const annotations = [
      { id: 'crop', kind: 'crop', x: 192, y: 108, width: 960, height: 540, zIndex: 0 },
      { id: 'redaction', kind: 'blur', x: 320, y: 220, width: 96, height: 80, opacity: 0.1, zIndex: 1 },
      { id: 'outside', kind: 'rectangle', x: 1080, y: 500, width: 220, height: 100, stroke: '#ef4444', strokeWidth: 8, zIndex: 2 }
    ];
    const saved = await window.imnota.saveScreenshotContent({
      projectPath: snapshot.projectPath,
      screenshot,
      annotations,
      contentRevision: content.contentRevision
    });
    if (saved.conflictCreated) throw new Error('Deterministic fixture unexpectedly conflicted');
    return { screenshotId: screenshot.id, annotations };
  })()`);
}

const DENSE_SCREENSHOT_COUNT = 20;
const DENSE_NOTES_PER_SCREENSHOT = 10;

async function installDenseTextAnnotations(driver: NativeUiDriver, projectPath: string): Promise<void> {
  const installed = await driver.evaluate<{
    screenshots: number;
    notes: number;
    outsideNotes: number;
  }>(`(async () => {
    const snapshot = await window.imnota.loadProject(${JSON.stringify(projectPath)});
    const collection = snapshot.project.collections.find((item) => !item.archived)
      ?? snapshot.project.collections.at(-1);
    if (!collection) throw new Error('Dense fixture has no collection');
    const screenshots = snapshot.project.screenshots
      .filter((item) => item.collectionId === collection.id)
      .sort((left, right) => left.position - right.position);
    if (screenshots.length !== ${DENSE_SCREENSHOT_COUNT})
      throw new Error('Dense fixture screenshot count changed');
    let noteCount = 0;
    let outsideNoteCount = 0;
    for (let pictureIndex = 0; pictureIndex < screenshots.length; pictureIndex += 1) {
      const screenshot = screenshots[pictureIndex];
      const content = await window.imnota.loadScreenshotContent({ projectPath: snapshot.projectPath, screenshot });
      const annotations = Array.from({ length: ${DENSE_NOTES_PER_SCREENSHOT} }, (_, noteIndex) => {
        const pictureNumber = pictureIndex + 1;
        const noteNumber = noteIndex + 1;
        const marker = 'DENSE_P' + String(pictureNumber).padStart(2, '0')
          + '_N' + String(noteNumber).padStart(2, '0');
        const inside = noteIndex < 8;
        if (!inside) outsideNoteCount += 1;
        const x = inside
          ? 120 + (noteIndex % 4) * Math.max(400, Math.floor((content.image.width - 600) / 4))
          : noteIndex === 8 ? -400 : content.image.width + 96;
        const y = inside
          ? 100 + Math.floor(noteIndex / 4) * 240
          : noteIndex === 8 ? 96 : content.image.height + 96;
        return {
          id: 'dense-' + pictureNumber + '-' + noteNumber,
          kind: 'text',
          x,
          y,
          width: 360,
          height: 72,
          text: marker + '\\nSynthetic dense export note ' + noteNumber + ' for Picture ' + pictureNumber + '.',
          stroke: '#111827',
          fontSize: 24,
          zIndex: noteIndex
        };
      });
      const saved = await window.imnota.saveScreenshotContent({
        projectPath: snapshot.projectPath,
        screenshot,
        annotations,
        contentRevision: content.contentRevision
      });
      if (saved.conflictCreated) throw new Error('Dense fixture unexpectedly created a conflict copy');
      noteCount += annotations.length;
    }
    return { screenshots: screenshots.length, notes: noteCount, outsideNotes: outsideNoteCount };
  })()`);
  if (
    installed.screenshots !== DENSE_SCREENSHOT_COUNT ||
    installed.notes !== DENSE_SCREENSHOT_COUNT * DENSE_NOTES_PER_SCREENSHOT ||
    installed.outsideNotes !== DENSE_SCREENSHOT_COUNT * 2
  )
    throw new Error(
      `Dense fixture installed ${installed.notes} notes (${installed.outsideNotes} outside) across ${installed.screenshots} screenshots.`,
    );
}

function pixelAt(image: Electron.NativeImage, x: number, y: number): Buffer {
  const size = image.getSize();
  if (x < 0 || y < 0 || x >= size.width || y >= size.height)
    throw new Error(`Pixel ${x},${y} is outside ${size.width}x${size.height}.`);
  const bitmapData = image.toBitmap();
  const offset = (y * size.width + x) * 4;
  return bitmapData.subarray(offset, offset + 4);
}

async function verifyOneImagePromptBundle(
  projectPath: string,
  setDirectory: string,
  annotations: readonly Annotation[],
): Promise<void> {
  const files = (await fs.readdir(setDirectory)).sort();
  const pngFiles = files.filter((name) => name.endsWith('.png'));
  const bundleMarkdownFiles = files.filter(
    (name) => name.endsWith('.md') && !name.endsWith(' - overview.md'),
  );
  const overviewFiles = files.filter((name) => name.endsWith(' - overview.md'));
  const expectedFileCount = pngFiles.length + bundleMarkdownFiles.length + overviewFiles.length;
  if (
    pngFiles.length !== 1 ||
    bundleMarkdownFiles.length !== 1 ||
    overviewFiles.length > 1 ||
    files.length !== expectedFileCount
  )
    throw new Error(
      `One-image prompt must publish one PNG/Markdown bundle pair and at most its collection overview: ${files.join(', ')}.`,
    );
  if (path.basename(pngFiles[0], '.png') !== path.basename(bundleMarkdownFiles[0], '.md'))
    throw new Error('One-image prompt PNG and Markdown filenames do not match.');
  const exportedPath = path.join(setDirectory, pngFiles[0]);
  if (!pathIsWithin(projectPath, exportedPath)) throw new Error('PNG export escaped its fixture project.');
  const exported = nativeImage.createFromPath(exportedPath);
  if (exported.isEmpty()) throw new Error('Prompt bundle PNG could not be decoded.');
  if (annotations.length !== 3) throw new Error('Deterministic export annotations changed.');
  const expandedScreenshot = { x: 160, y: 76, width: 1176, height: 604 };
  const expected = {
    width: expandedScreenshot.width + 64,
    height: 32 + 36 + 12 + expandedScreenshot.height + 32,
  };
  const size = exported.getSize();
  if (size.width !== expected.width || size.height !== expected.height)
    throw new Error(
      `Prompt header/margins changed deterministic dimensions: expected ${expected.width}x${expected.height}, got ${size.width}x${size.height}.`,
    );
  const imageX = 32;
  const imageY = 32 + 36 + 12;
  const promptImageOrigin = { x: imageX, y: imageY };
  const expandedSourceOrigin = { x: expandedScreenshot.x, y: expandedScreenshot.y };
  const maskPixel = mapSourcePointToPromptPixel(
    { x: 320 + 48, y: 220 + 40 },
    expandedSourceOrigin,
    promptImageOrigin,
  );
  const pixel = pixelAt(exported, maskPixel.x, maskPixel.y);
  if (!pixel.equals(Buffer.from([18, 13, 11, 255])))
    throw new Error(`Redaction pixel was not opaque: ${pixel.toString('hex')}.`);

  // This point is inside the original source and the annotation-expanded output,
  // but beyond the crop's right edge. It must be neutral canvas, never source data.
  const privacyPoint = mapSourcePointToPromptPixel(
    { x: 1200, y: 400 },
    expandedSourceOrigin,
    promptImageOrigin,
  );
  const privacyPixel = pixelAt(exported, privacyPoint.x, privacyPoint.y);
  if (!privacyPixel.equals(Buffer.from([255, 255, 255, 255])))
    throw new Error(
      `Cropped source pixels leaked into the expanded prompt area: ${privacyPixel.toString('hex')}.`,
    );
}

async function excludeScreenshotThroughUi(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  projectPath: string,
): Promise<number> {
  await driver.click({
    selector:
      '[data-testid^="screenshot-export-toggle-"][aria-pressed="true"], button[aria-label^="Exclude "]',
  });
  const started = Date.now();
  do {
    const project = await host.readProject(projectPath);
    const ordered = project.screenshots
      .filter(
        (screenshot) => screenshot.collectionId === project.collections.find((item) => !item.archived)?.id,
      )
      .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
    const excludedIndex = ordered.findIndex((screenshot) => !screenshot.includeInExport);
    if (excludedIndex >= 0) return excludedIndex + 1;
    await delay(50);
  } while (Date.now() - started < 10_000);
  throw new Error('Eye-row export exclusion was not persisted.');
}

async function captureWorkspaceMatrix(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  artifactDirectory: string | undefined,
  artifacts: SmokeCapture[],
): Promise<void> {
  if (!artifactDirectory) return;
  for (const theme of ['light', 'dark'] as const) {
    if (!(await driver.exists({ selector: '.settings-view, [data-testid="settings-view"]' })))
      await clickAny(driver, SMOKE_UI_CONTRACT.settings);
    await driver.waitFor({ selector: '.settings-view, [data-testid="settings-view"]' });
    await driver.click({
      selector: `[role="radiogroup"][aria-label="Application theme"] label:has(input[name="appearance-mode"][value="${theme}"])`,
    });
    await driver.evaluate(`new Promise((resolve, reject) => {
      const theme = ${JSON.stringify(theme)};
      const started = Date.now();
      const check = () => {
        const input = document.querySelector(
          '[role="radiogroup"][aria-label="Application theme"] input[name="appearance-mode"][value="' + theme + '"]'
        );
        if (input?.checked && !input.disabled && document.documentElement.dataset.theme === theme)
          return resolve(true);
        if (Date.now() - started > 10000)
          return reject(new Error('Theme UI did not save and apply ' + theme));
        setTimeout(check, 50);
      };
      check();
    })`);
    const persistedTheme = await driver.evaluate<string>(`(async () => {
      ${bridgePrelude()}
      return unwrap(await workflow.getPreferenceSettings()).settings.appearance.mode;
    })()`);
    if (persistedTheme !== theme)
      throw new Error(`Settings UI displayed ${theme}, but native preferences retained ${persistedTheme}.`);

    driver.setWindow(await host.reopenWindow());
    driver.browserWindow.show();
    driver.browserWindow.focus();
    await driver.waitFor({ selector: '.workspace, [data-testid="workspace"]' });
    await driver.waitFor({ selector: `:root[data-theme="${theme}"]` }, { timeoutMs: 10_000 });
    for (const viewport of SMOKE_VIEWPORTS) {
      await driver.resize(viewport);
      artifacts.push(
        await driver.capture(
          artifactDirectory,
          `${viewport.width}x${viewport.height}-workspace-${theme}.png`,
        ),
      );
    }
  }
  await clickAny(driver, SMOKE_UI_CONTRACT.settings);
  await driver.resize(SMOKE_VIEWPORTS[1]);
  artifacts.push(await driver.capture(artifactDirectory, '1440x900-settings.png'));
}

async function exercisePreferencesAndChannel(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  artifactDirectory?: string,
  artifacts: SmokeCapture[] = [],
): Promise<void> {
  // Reopened local smoke windows may be hidden. Present this isolated fixture so
  // native focus and screenshot paint reflect the same settings state as the DOM.
  driver.browserWindow.show();
  driver.browserWindow.focus();
  const profile = await driver.evaluate<{
    performanceClass: string;
    platform: string;
    appearanceMode: string;
  }>(`(async () => {
    ${bridgePrelude()}
    const nativeProfile = unwrap(await workflow.getNativePerformanceProfile());
    const preferences = unwrap(await workflow.getPreferenceSettings());
    return {
      performanceClass: nativeProfile.performanceClass,
      platform: nativeProfile.platform,
      appearanceMode: preferences.settings.appearance.mode
    };
  })()`);
  if (!['constrained', 'standard'].includes(profile.performanceClass) || !profile.appearanceMode)
    throw new Error(`Native preference/performance profile is malformed: ${JSON.stringify(profile)}.`);

  if (!(await driver.exists({ selector: '.settings-view, [data-testid="settings-view"]' })))
    await clickAny(driver, SMOKE_UI_CONTRACT.settings);
  await driver.waitFor({ selector: '.settings-view, [data-testid="settings-view"]' });
  for (const preset of ['graphite', 'indigo', 'emerald', 'amber']) {
    await driver.click({ selector: `[data-testid="backdrop-preset-${preset}"]` });
    await driver.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = async () => {
        try {
          ${bridgePrelude()}
          const settings = unwrap(await workflow.getPreferenceSettings()).settings;
          const button = document.querySelector('[data-testid="backdrop-preset-${preset}"]');
          const image = button?.querySelector('img');
          if (settings.appearance.backgroundImage === 'preset:${preset}' &&
              button?.getAttribute('aria-pressed') === 'true' && !button.disabled &&
              image?.complete && image.naturalWidth > 0) return resolve(true);
          if (Date.now() - started > 10000) throw new Error('Backdrop ${preset} did not load and persist');
          setTimeout(check, 50);
        } catch (error) { reject(error); }
      };
      check();
    })`);
  }
  await driver.evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); context.fillStyle = '#3284bd'; context.fillRect(0, 0, 320, 180);
    context.fillStyle = '#eda737'; context.fillRect(160, 0, 160, 180);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'Verification backdrop.png', { type: 'image/png' }));
    const input = document.querySelector('.imnota-background-settings input[type="file"]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const uploaded = { selector: '[aria-label="Uploaded backdrops"] .imnota-backdrop-preset' };
  await driver.waitFor({
    selector: '[aria-label="Uploaded backdrops"] .imnota-backdrop-preset[aria-pressed="true"]:not(:disabled)',
  });
  await driver.click({ selector: '[data-testid="backdrop-preset-emerald"]' });
  await driver.waitFor({
    selector: '[data-testid="backdrop-preset-emerald"][aria-pressed="true"]:not(:disabled)',
  });
  await driver.click(uploaded);
  await driver.waitFor({
    selector: '[aria-label="Uploaded backdrops"] .imnota-backdrop-preset[aria-pressed="true"]:not(:disabled)',
  });
  await driver.click({ selector: '.nav-submenu-item' });
  await driver.waitFor({ selector: '.workspace' });
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.waitFor(uploaded);
  await driver.click({ selector: '[data-testid="backdrop-preset-amber"]' });
  await driver.waitFor({
    selector: '[data-testid="backdrop-preset-amber"][aria-pressed="true"]:not(:disabled)',
  });
  await driver.click({ selector: 'label:has(input[name="glass-level"][value="balanced"])' });
  await driver.waitFor({ selector: ':root[data-glass-requested="balanced"]' });
  await driver.evaluate(`(async () => {
    if (document.documentElement.dataset.glassLevel === 'off') return;
    const cssImage = getComputedStyle(document.querySelector('.app-shell'), '::after').backgroundImage;
    if (!cssImage.startsWith('url("')) throw new Error('Backdrop surface did not receive its image');
    const image = new Image();
    image.src = cssImage.slice(5, -2);
    await image.decode();
    if (!image.naturalWidth) throw new Error('Backdrop surface URL did not load');
    for (const panel of document.querySelectorAll('.sidebar, .topbar, .settings-navigation')) {
      if (getComputedStyle(panel).backgroundImage !== 'none')
        throw new Error('Chrome duplicates the app-wide wallpaper');
    }
  })()`);
  if (artifactDirectory) {
    await driver.evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
    artifacts.push(await driver.capture(artifactDirectory, 'backdrop-settings.png'));
    await driver.click({ selector: '.nav-submenu-item' });
    await driver.waitFor({ selector: '.workspace' });
    await driver.resize(SMOKE_VIEWPORTS[0]);
    await waitForStableCanvas(driver);
    await driver.evaluate(`(() => {
      for (const panel of document.querySelectorAll('.sidebar, .topbar, .shot-rail, .inspector')) {
        if (getComputedStyle(panel).backgroundImage !== 'none')
          throw new Error('Workspace panel duplicates the app-wide wallpaper');
      }
    })()`);
    artifacts.push(await driver.capture(artifactDirectory, 'backdrop-workspace.png'));
    await driver.click({ selector: '.sidebar-toggle' });
    await driver.waitFor({ selector: '.navigation-restore' });
    artifacts.push(await driver.capture(artifactDirectory, 'backdrop-collapsed.png'));
    await driver.click({ selector: '.navigation-restore' });
    await driver.click({ selector: '[data-testid="settings-button"]' });
    await driver.waitFor({ selector: '.settings-view' });
  }
  await driver.click({ selector: 'label:has(input[name="glass-level"][value="off"])' });
  await driver.waitFor({ selector: ':root[data-glass-level="off"]' });
  const solidBackdrop = await driver.evaluate<string>(
    `getComputedStyle(document.documentElement).getPropertyValue('--imnota-background-image').trim()`,
  );
  if (solidBackdrop !== 'none') throw new Error('Solid surfaces did not suppress the cosmetic backdrop.');
  await driver.click({ selector: '[data-testid="backdrop-remove"]' });
  await driver.waitFor({ selector: '[data-testid="backdrop-remove"]' }, { absent: true });
  await driver.click({ text: 'Desktop glass (Beta)', exact: true });
  await driver.waitFor({ selector: ':root[data-glass-requested="balanced"]' });
  const desktopResult = await driver.evaluate<{ ok: boolean; value?: { active: boolean } }>(
    `window.imnota.setDesktopGlass({ enabled: true })`,
  );
  if (!desktopResult.ok) throw new Error('Native desktop material bridge rejected its validated request.');
  await driver.waitFor({
    selector: ':root[data-desktop-glass="' + (desktopResult.value?.active ? 'active' : 'fallback') + '"]',
  });
  await driver.click({ text: 'No image', exact: true });
  await driver.waitFor({ selector: ':root[data-desktop-glass="off"][data-background="none"]' });
  const channelSelect = { selector: '[data-testid="update-channel"], .update-settings select' };
  await driver.click({ text: 'Updates & help', exact: true });
  const chooseNightly = async () => {
    await driver.waitFor(channelSelect);
    // Standard DOM option selection avoids OS-owned popup menus outside webContents.
    // Keep the real React change handler, confirmation dialog and persistence checks.
    await driver.evaluate(`(() => {
      const select = document.querySelector('[data-testid="update-channel"], .update-settings select');
      select.scrollIntoView({ block: 'center' });
      select.focus();
      select.value = 'nightly';
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  };
  await chooseNightly();
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Switch to Nightly?' });
  if ((await host.readSettings()).updateChannel !== 'stable')
    throw new Error('Update channel changed before Nightly confirmation.');
  await driver.click({ text: 'Keep Stable', exact: true });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Switch to Nightly?' }, { absent: true });

  await chooseNightly();
  await driver.click({ text: 'Use Nightly', exact: true });
  const started = Date.now();
  while ((await host.readSettings()).updateChannel !== 'nightly') {
    if (Date.now() - started > 10_000) throw new Error('Nightly channel was not persisted.');
    await delay(50);
  }
  const checkedChannel = await driver.evaluate<string | undefined>(`(async () => {
    await window.imnota.checkForUpdates();
    return (await window.imnota.getUpdateStatus()).channel;
  })()`);
  if (checkedChannel !== 'nightly') throw new Error('Manual refresh did not use the selected channel.');
  const invalidRejected = await driver.evaluate<boolean>(`(async () => {
    try {
      await window.imnota.setSettings({ updateChannel: 'invalid' });
      return false;
    } catch {
      return true;
    }
  })()`);
  if (!invalidRejected) throw new Error('Settings IPC accepted an invalid update channel.');
  const workspaceRejected = await driver.evaluate<boolean>(`(async () => {
    try {
      await window.imnota.setSettings({ workspacePath: 'not-an-absolute-workspace' });
      return false;
    } catch {
      return true;
    }
  })()`);
  if (!workspaceRejected) throw new Error('Settings IPC accepted an untrusted workspace replacement.');
}

async function promptCards(driver: NativeUiDriver): Promise<PromptCardState[]> {
  return driver.evaluate<PromptCardState[]>(`(() => [...document.querySelectorAll(
    '[data-testid="prompt-bundle-card"], .prompt-bundle-card'
  )].map((card) => {
    const buttons = [...card.querySelectorAll('button')];
    return {
      title: card.querySelector('h3')?.textContent?.trim() ?? '',
      text: card.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
      copyLabel: buttons.find((button) => /Copy (?:fresh prompt|Prompt \\d+)/i.test(button.textContent ?? ''))?.textContent?.trim()
    };
  }))()`);
}

async function promptActionPoint(driver: NativeUiDriver, cardIndex: number): Promise<SmokePoint> {
  return driver.evaluate<SmokePoint>(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="prompt-bundle-card"], .prompt-bundle-card')];
    const card = cards[${cardIndex}];
    if (!card) throw new Error('Prompt card ${cardIndex + 1} disappeared');
    const pattern = /Copy (?:fresh prompt|Prompt \\d+)/i;
    const button = [...card.querySelectorAll('button')].find((candidate) => pattern.test(candidate.textContent ?? ''));
    if (!button || button.disabled) throw new Error('Prompt ${cardIndex + 1} action is unavailable');
    const bounds = button.getBoundingClientRect();
    return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
  })()`);
}

async function waitForPromptGrants(driver: NativeUiDriver, bundleCount: number): Promise<void> {
  await driver.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const cards = [...document.querySelectorAll('[data-testid="prompt-bundle-card"], .prompt-bundle-card')];
      const complete = cards.length === ${bundleCount} && cards.every((card) => {
        const busy = card.getAttribute('aria-busy') === 'true';
        const fallbacks = [...card.querySelectorAll('.prompt-bundle-fallbacks button')];
        return !busy && fallbacks.length >= 2 && fallbacks.every((button) => !button.disabled);
      });
      if (complete) return resolve(true);
      if (Date.now() - started > 30000) return reject(new Error('Prompt bundle grants timed out'));
      setTimeout(check, 50);
    };
    check();
  })`);
}

interface PromptSet {
  directory: string;
  name: string;
}

async function promptSets(
  host: SmokeWorkflowHost,
  projectPath: string,
  allowInProgress = false,
): Promise<PromptSet[]> {
  const project = await host.readProject(projectPath);
  const collection = project.collections.find((item) => !item.archived) ?? project.collections.at(-1);
  if (!collection) throw new Error('Prompt fixture lost its collection.');
  const exportsDirectory = path.join(projectPath, 'collections', collection.id, 'exports');
  const entries = await fs.readdir(exportsDirectory, { withFileTypes: true }).catch(() => []);
  if (
    !allowInProgress &&
    entries.some((entry) => entry.name.includes('.prompt-staging-') || entry.name.endsWith('.reservation'))
  )
    throw new Error('Completed prompt workflow left staging or reservation artifacts.');
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, directory: path.join(exportsDirectory, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function waitForNewPromptSet(
  host: SmokeWorkflowHost,
  projectPath: string,
  previousNames: ReadonlySet<string>,
  timeoutMs = 30_000,
): Promise<PromptSet> {
  const started = Date.now();
  do {
    const added = (await promptSets(host, projectPath, true)).find((set) => !previousNames.has(set.name));
    if (added) return added;
    await delay(50);
  } while (Date.now() - started < timeoutMs);
  throw new Error('Fresh prompt action did not publish a new export set.');
}

async function verifyPromptSet(projectPath: string, set: PromptSet, bundleCount: number): Promise<void> {
  if (!pathIsWithin(projectPath, set.directory)) throw new Error('Prompt export set escaped its project.');
  const files = await fs.readdir(set.directory);
  if (files.some((name) => name.endsWith('.zip')))
    throw new Error('Legacy ZIP output appeared in the prompt bundle workflow.');
  const pngStems = files
    .filter((name) => name.endsWith('.png'))
    .map((name) => path.basename(name, '.png'))
    .sort();
  const markdownStems = files
    .filter((name) => name.endsWith('.md') && !name.endsWith(' - overview.md'))
    .map((name) => path.basename(name, '.md'))
    .sort();
  if (pngStems.length !== bundleCount || markdownStems.length !== bundleCount)
    throw new Error(
      `Prompt set contains ${pngStems.length} PNG and ${markdownStems.length} Markdown bundles; expected ${bundleCount} pairs.`,
    );
  if (JSON.stringify(pngStems) !== JSON.stringify(markdownStems))
    throw new Error('Prompt PNG and Markdown grants are not complete matching pairs.');
}

async function verifyDensePromptMarkdown(set: PromptSet): Promise<void> {
  const markdownFiles = (await fs.readdir(set.directory))
    .filter((name) => name.endsWith('.md') && !name.endsWith(' - overview.md'))
    .sort();
  const markdown = (
    await Promise.all(markdownFiles.map((name) => fs.readFile(path.join(set.directory, name), 'utf8')))
  ).join('\n');
  const markerOccurrences = markdown.match(/DENSE_P\d{2}_N\d{2}/g) ?? [];
  const markerCounts = new Map<string, number>();
  for (const marker of markerOccurrences) markerCounts.set(marker, (markerCounts.get(marker) ?? 0) + 1);
  const headingCounts = new Map<string, number>();
  for (const match of markdown.matchAll(/^### Picture (\d+) \/ Note (\d+)\s*$/gm)) {
    const heading = `${match[1]}/${match[2]}`;
    headingCounts.set(heading, (headingCounts.get(heading) ?? 0) + 1);
  }
  for (let pictureNumber = 1; pictureNumber <= DENSE_SCREENSHOT_COUNT; pictureNumber += 1) {
    for (let noteNumber = 1; noteNumber <= DENSE_NOTES_PER_SCREENSHOT; noteNumber += 1) {
      const marker = `DENSE_P${String(pictureNumber).padStart(2, '0')}_N${String(noteNumber).padStart(2, '0')}`;
      if (markerCounts.get(marker) !== 1)
        throw new Error(
          `Dense prompt Markdown contains ${markerCounts.get(marker) ?? 0} copies of ${marker}.`,
        );
      const heading = `${pictureNumber}/${noteNumber}`;
      if (headingCounts.get(heading) !== 1)
        throw new Error(
          `Dense prompt Markdown contains ${headingCounts.get(heading) ?? 0} Picture ${pictureNumber} / Note ${noteNumber} references.`,
        );
    }
  }
  if (markerOccurrences.length !== DENSE_SCREENSHOT_COUNT * DENSE_NOTES_PER_SCREENSHOT)
    throw new Error(
      `Dense prompt Markdown contains ${markerOccurrences.length} note markers instead of 200.`,
    );
}

async function preserveFirstDensePromptPair(set: PromptSet, artifactDirectory: string): Promise<void> {
  const files = await fs.readdir(set.directory);
  const pngFilename = files.filter((name) => name.endsWith('.png')).sort()[0];
  const markdownFilename = pngFilename ? `${path.basename(pngFilename, '.png')}.md` : undefined;
  if (!pngFilename || !markdownFilename || !files.includes(markdownFilename))
    throw new Error('Dense prompt artifact does not contain a matching first PNG/Markdown pair.');
  const copies = [
    [pngFilename, 'verified-dense-prompt1.png'],
    [markdownFilename, 'verified-dense-prompt1.md'],
  ] as const;
  for (const [sourceName, targetName] of copies) {
    const source = path.join(set.directory, sourceName);
    const target = path.join(artifactDirectory, targetName);
    if (!pathIsWithin(set.directory, source) || !pathIsWithin(artifactDirectory, target))
      throw new Error('Dense prompt inspection artifact escaped its verified directory.');
    await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
  }
}

interface PromptWorkflowOptions {
  artifactDirectory?: string;
  artifacts: SmokeCapture[];
  expectedExcludedPicture?: number;
  freshActions: number;
  requireSplit: boolean;
}

async function exercisePromptWorkflow(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  projectPath: string,
  options: PromptWorkflowOptions,
): Promise<{ bundleCount: number; renderMs: number; latestSet: PromptSet }> {
  const renderStarted = performance.now();
  const existingNames = new Set((await promptSets(host, projectPath)).map((set) => set.name));
  if (!(await existsAny(driver, SMOKE_UI_CONTRACT.shareBundles)))
    await clickAny(driver, SMOKE_UI_CONTRACT.contextBuilder);
  await clickAny(driver, SMOKE_UI_CONTRACT.shareBundles);
  await driver.waitFor(SMOKE_UI_CONTRACT.promptDialog[1]);
  await driver.waitFor(
    {
      selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="prompt-bundle-card"]',
    },
    { timeoutMs: 60_000 },
  );
  const cards = await promptCards(driver);
  if (!cards.length) throw new Error('Share prompt bundles dialog contains no real bundle cards.');
  if (options.requireSplit && cards.length < 2)
    throw new Error('Mixed native-resolution fixture did not split into prompt bundles.');
  if (options.artifactDirectory) {
    await driver.resize(SMOKE_VIEWPORTS[2]);
    options.artifacts.push(await driver.capture(options.artifactDirectory, '1920x1080-sharing.png'));
    await driver.resize(SMOKE_VIEWPORTS[3]);
    options.artifacts.push(await driver.capture(options.artifactDirectory, '3440x1440-sharing.png'));
  }
  const copiedIndex = cards.findIndex((card) => card.copyLabel);
  if (copiedIndex < 0)
    throw new Error('Every prompt bundle was file-only; native clipboard was not exercised.');
  let latestSet: PromptSet | undefined;
  for (let action = 0; action < options.freshActions; action += 1) {
    await driver.clickPoint(await promptActionPoint(driver, copiedIndex));
    // A stress collection renders every native-resolution bundle twice (preflight and publication).
    // Keep a bounded deadline proportional to work, rather than the small-fixture UI timeout.
    latestSet = await waitForNewPromptSet(
      host,
      projectPath,
      existingNames,
      Math.max(30_000, cards.length * 3_000),
    );
    existingNames.add(latestSet.name);
    await waitForPromptGrants(driver, cards.length);
    await promptSets(host, projectPath);
    await verifyPromptSet(projectPath, latestSet, cards.length);
  }
  if (!latestSet) throw new Error('Prompt workflow did not execute a fresh action.');
  const text = clipboard.readText();
  const html = clipboard.readHTML();
  const image = clipboard.readImage();
  if (!text.includes('Picture ') || !html || image.isEmpty())
    throw new Error('Prompt copy did not place Markdown, HTML, and PNG on the native clipboard.');
  if (
    options.expectedExcludedPicture !== undefined &&
    !text.includes(`Picture ${options.expectedExcludedPicture} was intentionally excluded`)
  )
    throw new Error('Prompt Markdown lost the eye-row exclusion or pre-filter Picture number.');
  const canvasDimensions = cards[copiedIndex].text.match(/Canvas\s+(\d+)\s*[×x]\s*(\d+)/i);
  if (!canvasDimensions) throw new Error('Copied prompt card did not expose verifiable canvas dimensions.');
  const clipboardSize = image.getSize();
  if (
    clipboardSize.width !== Number(canvasDimensions[1]) ||
    clipboardSize.height !== Number(canvasDimensions[2])
  )
    throw new Error(
      `Clipboard prompt changed native bundle dimensions: ${clipboardSize.width}x${clipboardSize.height}.`,
    );
  const clipboardPng = image.toPNG();
  await assertWorkflowFailure(
    driver,
    `workflow.copyPromptExportBundle({ sessionId: 'missing-smoke-session', bundleNumber: 1, target: 'context' })`,
    ['session-not-found'],
  );
  if (clipboard.readText() !== text || !clipboard.readImage().toPNG().equals(clipboardPng))
    throw new Error('Rejected prompt copy changed the native clipboard.');
  return {
    bundleCount: cards.length,
    renderMs: Math.round(performance.now() - renderStarted),
    latestSet,
  };
}

async function closePromptDialog(driver: NativeUiDriver): Promise<void> {
  await clickAny(driver, [
    { selector: '[data-testid="prompt-sharing-close"]' },
    { selector: '[role="dialog"] [aria-label="Close"]' },
  ]);
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Share prompt bundles' }, { absent: true });
}

async function assertWorkflowFailure(
  driver: NativeUiDriver,
  source: string,
  allowedCodes: readonly WorkflowFailureCode[],
): Promise<void> {
  const result = await driver.evaluate<{ ok: boolean; code?: WorkflowFailureCode }>(`(async () => {
    ${bridgePrelude()}
    const result = await (${source});
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  })()`);
  if (result.ok || !result.code || !allowedCodes.includes(result.code))
    throw new Error(`Unsafe workflow call was not rejected correctly: ${JSON.stringify(result)}.`);
}

async function exerciseWatchAndConflict(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  projectPath: string,
): Promise<void> {
  const watch = await driver.evaluate<{ watchId: string; projectRevision: string }>(`(async () => {
    ${bridgePrelude()}
    window.__imnotaSmokeWatchEvents = [];
    window.__imnotaSmokeStopWatchEvents?.();
    window.__imnotaSmokeStopWatchEvents = workflow.onProjectWatchEvent((event) => {
      window.__imnotaSmokeWatchEvents.push(event);
    });
    return unwrap(await workflow.startProjectWatch({ projectPath: ${JSON.stringify(projectPath)} }));
  })()`);
  const project = await host.readProject(projectPath);
  const descriptionPath = path.join(projectPath, project.screenshots[0].descriptionFile);
  await fs.writeFile(descriptionPath, 'External watcher edit', 'utf8');
  await driver.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if ((window.__imnotaSmokeWatchEvents ?? []).some((event) => event.kind === 'external-change')) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error('Project watch event timed out'));
      setTimeout(check, 50);
    };
    check();
  })`);
  await driver.evaluate(`(async () => {
    ${bridgePrelude()}
    const reloaded = unwrap(await workflow.reloadWatchedProject({ watchId: ${JSON.stringify(watch.watchId)} }));
    if (reloaded.snapshot.project.screenshots[0].description !== 'External watcher edit') {
      throw new Error('Watched description reload stayed stale');
    }
  })()`);

  const projectFile = path.join(projectPath, 'project.json');
  const externalMetadata = JSON.parse(await fs.readFile(projectFile, 'utf8')) as ProjectData;
  externalMetadata.description = 'External project metadata edit for stale CAS';
  await fs.writeFile(projectFile, JSON.stringify(externalMetadata, null, 2), 'utf8');
  await driver.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if ((window.__imnotaSmokeWatchEvents ?? []).some((event) =>
        event.changedPaths?.some((changedPath) => changedPath.toLowerCase() === 'project.json')
      )) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error('Project metadata watch event timed out'));
      setTimeout(check, 50);
    };
    check();
  })`);
  await assertWorkflowFailure(
    driver,
    `workflow.saveProjectCompareAndSwap({
      watchId: ${JSON.stringify(watch.watchId)},
      expectedRevision: ${JSON.stringify(watch.projectRevision)},
      project: ${JSON.stringify(project)}
    })`,
    ['project-changed'],
  );
  await driver.evaluate(`(async () => {
    ${bridgePrelude()}
    unwrap(await workflow.stopProjectWatch({ watchId: ${JSON.stringify(watch.watchId)} }));
    window.__imnotaSmokeStopWatchEvents?.();
  })()`);
}

async function exerciseRecovery(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  projectPath: string,
): Promise<void> {
  await driver.evaluate(`(async () => {
    const snapshot = await window.imnota.loadProject(${JSON.stringify(projectPath)});
    const recovered = structuredClone(snapshot.project);
    recovered.screenshots[0].title = 'Recovered native title';
    recovered.screenshots[0].description = 'Recovered native description';
    recovered.screenshots[0].priority = 'high';
    recovered.screenshots[0].includeInExport = false;
    await window.imnota.saveRecovery({ projectPath: snapshot.projectPath, project: recovered, annotations: {} });
  })()`);
  const recovered = await host.restoreRecovery(projectPath);
  const screenshot = recovered.screenshots[0];
  if (
    screenshot.title !== 'Recovered native title' ||
    screenshot.description !== 'Recovered native description' ||
    screenshot.priority !== 'high' ||
    screenshot.includeInExport
  )
    throw new Error('Recovery did not restore screenshot metadata through production code.');
  if (await fs.stat(path.join(projectPath, '.imnota-recovery.json')).catch(() => null))
    throw new Error('Recovery journal remained after a successful restore.');
}

async function exerciseFixtureTrash(driver: NativeUiDriver, projectPath: string): Promise<void> {
  await driver.evaluate(`(async () => {
    const before = await window.imnota.loadProject(${JSON.stringify(projectPath)});
    const screenshot = before.project.screenshots.at(-1);
    if (!screenshot) throw new Error('Trash fixture has no screenshot');
    const deleted = await window.imnota.deleteScreenshot({ projectPath: before.projectPath, screenshotId: screenshot.id });
    if (deleted.snapshot.project.screenshots.some((item) => item.id === screenshot.id)) throw new Error('Fixture screenshot was not deleted');
    const restored = await window.imnota.undoDeleteScreenshot({ projectPath: before.projectPath, undoToken: deleted.undoToken });
    if (!restored.project.screenshots.some((item) => item.id === screenshot.id)) throw new Error('Fixture screenshot Undo failed');
  })()`);
}

async function writeReportArtifact(
  directory: string | undefined,
  report: Omit<SmokeWorkflowReport, 'passed'>,
): Promise<void> {
  if (!directory) return;
  const target = path.join(directory, 'verification-report.json');
  if (!pathIsWithin(directory, target)) throw new Error('Report artifact escaped its directory.');
  await fs.writeFile(target, JSON.stringify({ passed: true, ...report }, null, 2), { flag: 'wx' });
}

export async function runSmokeWorkflow(
  initialWindow: BrowserWindow,
  host: SmokeWorkflowHost,
  options: SmokeWorkflowOptions,
): Promise<SmokeWorkflowReport> {
  const mode = options.mode ?? 'smoke';
  if (options.expectedVersion && options.version !== options.expectedVersion)
    throw new Error(
      `Packaged application version ${options.version} does not match ${options.expectedVersion}.`,
    );
  const fixtureRoot = await validateCreatedSmokeDirectory(options.fixtureRoot, 'fixture');
  const artifactDirectory = options.artifactDirectory
    ? await validateCreatedSmokeDirectory(options.artifactDirectory, 'artifact')
    : undefined;
  if (
    artifactDirectory &&
    (pathIsWithin(fixtureRoot, artifactDirectory) || pathIsWithin(artifactDirectory, fixtureRoot))
  )
    throw new Error('Artifact directory must be outside the disposable smoke fixture.');
  await host.setWorkspace(fixtureRoot);
  const artifacts: SmokeCapture[] = [];
  const assertions: string[] = [];
  const timings: SmokeTiming[] = [];
  const sources = await createFixtureSources(fixtureRoot);
  const driver = new NativeUiDriver(initialWindow, mode === 'stress' ? 30_000 : 15_000);
  if (!initialWindow.isVisible()) initialWindow.show();
  initialWindow.focus();

  const updateState = await driver.evaluate<{ state: string; currentVersion?: string }>(`(async () => {
    if (!window.imnota) throw new Error('Preload bridge is missing');
    await window.imnota.checkForUpdates();
    return window.imnota.getUpdateStatus();
  })()`);
  if (!updateState.currentVersion || updateState.state !== 'idle')
    throw new Error('Updater/channel bridge did not remain offline and idle during smoke.');
  assertions.push('updater bridge and offline smoke state');

  const onboardingPresent = await exerciseOnboarding(driver, artifactDirectory, artifacts);
  if (onboardingPresent) assertions.push('onboarding sample and native clipboard action');
  const projectPath = await createProjectThroughUi(driver, 'Native Verification', onboardingPresent);
  // Use a stable user-facing name while retaining random, isolated filesystem paths.
  // This keeps approved visual captures independent of the temporary workspace name.
  await driver.click({ selector: 'button[aria-label="Rename"]' });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Rename collection' });
  await driver.fill({ selector: '[role="dialog"] input' }, 'Verification collection');
  await driver.click({ selector: '[role="dialog"] button[type="submit"]' });
  await driver.waitFor({ selector: '[role="dialog"]' }, { absent: true });
  await importImages(driver, projectPath, sources, 10);
  assertions.push('real new-project prompt and collection import');

  let activeWindow = await host.reopenWindow();
  driver.setWindow(activeWindow);
  await driver.waitFor({ selector: '.konvajs-content' });
  await exerciseNativeCanvas(driver, artifactDirectory, artifacts);
  assertions.push(
    'trusted pan, crop, redaction, outside-bound arrow creation, double-click, Enter and Escape',
  );
  const excludedPicture = await excludeScreenshotThroughUi(driver, host, projectPath);
  assertions.push('eye-row exclusion with stable pre-filter Picture number');

  await driver.click({ selector: '[data-testid="collection-picker"]' });
  await driver.waitFor({ selector: '[role="listbox"][aria-label="Collections"]' });
  await driver.press('End');
  await driver.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (document.activeElement?.getAttribute('role') === 'option') return resolve(true);
      if (Date.now() - started > 10000) return reject(new Error('Collection option did not receive focus'));
      setTimeout(check, 50);
    };
    check();
  })`);
  const focusedCollection = await driver.evaluate<boolean>(
    `document.activeElement?.getAttribute('role') === 'option'`,
  );
  if (!focusedCollection) throw new Error('Collection picker did not focus an option with native keys.');
  await driver.press('Escape');
  await driver.waitFor({ selector: '[role="listbox"][aria-label="Collections"]' }, { absent: true });
  await driver.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (document.activeElement?.getAttribute('data-testid') === 'collection-picker') return resolve(true);
      if (Date.now() - started > 10000) return reject(new Error('Collection trigger did not regain focus'));
      setTimeout(check, 50);
    };
    check();
  })`);
  const pickerFocusRestored = await driver.evaluate<boolean>(
    `document.activeElement?.getAttribute('data-testid') === 'collection-picker'`,
  );
  if (!pickerFocusRestored) throw new Error('Collection picker did not restore focus after Escape.');
  assertions.push('native collection picker keyboard focus and Escape restoration');

  await captureWorkspaceMatrix(driver, host, artifactDirectory, artifacts);
  await exercisePreferencesAndChannel(driver, host, artifactDirectory, artifacts);
  assertions.push('preferences, performance profile, update channel confirmation and persistence');
  activeWindow = await host.reopenWindow();
  driver.setWindow(activeWindow);
  await driver.waitFor({ selector: '.konvajs-content' });
  const promptTiming = await exercisePromptWorkflow(driver, host, projectPath, {
    artifactDirectory,
    artifacts,
    expectedExcludedPicture: excludedPicture,
    freshActions: 2,
    requireSplit: true,
  });
  const promptMemory = await memoryMegabytes(driver.browserWindow);
  timings.push({
    scenario: 'mixed-native-10-prompt-render',
    screenshotCount: 10,
    importMs: 0,
    reopenMs: 0,
    ...promptTiming,
    ...promptMemory,
  });
  assertions.push(
    'two fresh collection prompt actions, complete PNG/Markdown grants, split layout, and text/HTML/PNG clipboard',
  );
  await closePromptDialog(driver);

  const pixelFixture = await createBenchmarkProject(driver, sources, 1, 'Verification Pixel Bundle');
  const deterministic = await installDeterministicExportAnnotations(driver, pixelFixture.projectPath);
  activeWindow = await host.reopenWindow();
  driver.setWindow(activeWindow);
  await driver.waitFor({ selector: '.konvajs-content' });
  const pixelPrompt = await exercisePromptWorkflow(driver, host, pixelFixture.projectPath, {
    artifacts,
    freshActions: 1,
    requireSplit: false,
  });
  if (pixelPrompt.bundleCount !== 1)
    throw new Error(`One-image pixel fixture unexpectedly split into ${pixelPrompt.bundleCount} bundles.`);
  await verifyOneImagePromptBundle(
    pixelFixture.projectPath,
    pixelPrompt.latestSet.directory,
    deterministic.annotations,
  );
  if (artifactDirectory) {
    const exportedFiles = await fs.readdir(pixelPrompt.latestSet.directory);
    for (const extension of ['.png', '.md']) {
      const name = exportedFiles.find(
        (entry) => entry.endsWith(extension) && !entry.endsWith(' - overview.md'),
      );
      if (!name) throw new Error(`Verified pixel bundle lost its ${extension} artifact.`);
      await fs.copyFile(
        path.join(pixelPrompt.latestSet.directory, name),
        path.join(artifactDirectory, `verified-pixel-prompt${extension}`),
      );
    }
  }
  assertions.push(
    'one-image prompt header/margins, expanded crop/outside bounds, cropped-source privacy, opaque redaction pixels, and one PNG/Markdown pair',
  );
  await closePromptDialog(driver);

  await exerciseWatchAndConflict(driver, host, projectPath);
  assertions.push('filesystem watcher reload and stale compare-and-swap rejection');
  await exerciseRecovery(driver, host, projectPath);
  assertions.push('interrupted-edit recovery metadata');
  await exerciseFixtureTrash(driver, projectPath);
  assertions.push('fixture-only native trash and Undo');

  await assertWorkflowFailure(
    driver,
    `workflow.startPromptExport({
      projectPath: ${JSON.stringify(path.join(fixtureRoot, 'outside'))},
      collectionId: 'missing',
      bundles: [{ bundleNumber: 1, width: 100, height: 100 }]
    })`,
    ['invalid-input', 'permission-denied', 'project-not-found', 'collection-not-found', 'linked-path'],
  );
  assertions.push('prompt workflow path and collection rejection');

  const counts = mode === 'stress' ? [1, 10, 20, 100] : [1, 10];
  const benchmarkProjects = new Map<number, string>();
  for (const count of counts) {
    const benchmark = await createBenchmarkProject(driver, sources, count);
    benchmarkProjects.set(count, benchmark.projectPath);
    const memory = await memoryMegabytes(driver.browserWindow);
    timings.push({
      scenario: `mixed-native-${count}`,
      screenshotCount: count,
      importMs: Math.round(benchmark.importMs),
      reopenMs: Math.round(benchmark.reopenMs),
      ...memory,
    });
    if (mode === 'stress' && count === 20) {
      activeWindow = await host.reopenWindow();
      driver.setWindow(activeWindow);
      await driver.waitFor({ selector: '.konvajs-content' });
      const openedTitle = await driver.evaluate<string>(
        `document.querySelector('.topbar, [data-testid="topbar"]')?.textContent ?? ''`,
      );
      if (!openedTitle.includes('Verification 020'))
        throw new Error('Stress reopen did not activate the latest 20-image fixture.');
      const promptRender = await exercisePromptWorkflow(driver, host, benchmark.projectPath, {
        artifacts,
        freshActions: 1,
        requireSplit: true,
      });
      const promptMemory = await memoryMegabytes(driver.browserWindow);
      timings.push({
        scenario: 'mixed-native-20-prompt-render',
        screenshotCount: 20,
        importMs: 0,
        reopenMs: 0,
        ...promptRender,
        ...promptMemory,
      });
      await closePromptDialog(driver);
    }
  }
  if (mode === 'stress') {
    const stressProject = benchmarkProjects.get(100)!;
    await driver.evaluate(`window.imnota.loadProject(${JSON.stringify(stressProject)}).then(() => true)`);
    activeWindow = await host.reopenWindow();
    driver.setWindow(activeWindow);
    await driver.waitFor({ selector: '.konvajs-content' });
    const openedTitle = await driver.evaluate<string>(
      `document.querySelector('.topbar, [data-testid="topbar"]')?.textContent ?? ''`,
    );
    if (!openedTitle.includes('Verification 100'))
      throw new Error('Stress reopen did not activate the latest 100-image fixture.');
    const stressPromptTiming = await exercisePromptWorkflow(driver, host, stressProject, {
      artifacts,
      freshActions: 1,
      requireSplit: true,
    });
    const stressMemory = await memoryMegabytes(driver.browserWindow);
    timings.push({
      scenario: 'mixed-native-100-prompt-render',
      screenshotCount: 100,
      importMs: 0,
      reopenMs: 0,
      ...stressPromptTiming,
      ...stressMemory,
    });
    await closePromptDialog(driver);

    const denseBenchmark = await createBenchmarkProject(
      driver,
      sources,
      DENSE_SCREENSHOT_COUNT,
      'Verification Dense 020',
    );
    await installDenseTextAnnotations(driver, denseBenchmark.projectPath);
    activeWindow = await host.reopenWindow();
    driver.setWindow(activeWindow);
    await driver.waitFor({ selector: '.konvajs-content' });
    const denseTitle = await driver.evaluate<string>(
      `document.querySelector('.topbar, [data-testid="topbar"]')?.textContent ?? ''`,
    );
    if (!denseTitle.includes('Verification Dense 020'))
      throw new Error('Stress reopen did not activate the dense 20-image fixture.');
    const denseProfile = await profileMemoryDuring(driver.browserWindow, () =>
      exercisePromptWorkflow(driver, host, denseBenchmark.projectPath, {
        artifacts,
        freshActions: 1,
        requireSplit: true,
      }),
    );
    await verifyDensePromptMarkdown(denseProfile.result.latestSet);
    if (artifactDirectory)
      await preserveFirstDensePromptPair(denseProfile.result.latestSet, artifactDirectory);
    timings.push({
      scenario: 'dense-native-20-prompt-render',
      screenshotCount: DENSE_SCREENSHOT_COUNT,
      importMs: Math.round(denseBenchmark.importMs),
      reopenMs: Math.round(denseBenchmark.reopenMs),
      ...denseProfile.result,
      ...denseProfile.memoryProfile.post,
      memoryProfile: denseProfile.memoryProfile,
    });
    await closePromptDialog(driver);
    assertions.push(
      'one fresh dense 20-image prompt action with 200 unique Markdown notes, outside-source bounds, complete pairs, and sampled main/renderer/GPU memory',
    );
    assertions.push(
      'mixed-resolution 1/10/20/100 fixtures with one complete 20-image and one complete 100-image prompt render action',
    );
  } else assertions.push('mixed-resolution 1/10 smoke benchmark; 20/100 reserved for stress mode');

  artifacts.push(...(await exerciseMixedContent(driver, host, artifactDirectory)));
  assertions.push(
    'mixed text/drawing UI, Markdown preview, autosave before navigation, editable scene and white PNG, duplicate/trash/Undo and reopen',
  );

  const report: SmokeWorkflowReport = {
    passed: true,
    version: options.version,
    mode,
    artifacts,
    timings,
    assertions,
  };
  await writeReportArtifact(artifactDirectory, report);
  return report;
}
