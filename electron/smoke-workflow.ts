import { app, clipboard, nativeImage, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Annotation, ProjectData, WorkspaceSettings } from '../src/shared/types.js';
import {
  NativeUiDriver,
  SMOKE_VIEWPORTS,
  mapSourcePointToPromptPixel,
  pathIsWithin,
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

export interface SmokeTiming {
  scenario: string;
  screenshotCount: number;
  importMs: number;
  reopenMs: number;
  renderMs?: number;
  bundleCount?: number;
  mainResidentMegabytes: number;
  rendererResidentMegabytes: number;
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

async function memoryMegabytes(window: BrowserWindow): Promise<{
  mainResidentMegabytes: number;
  rendererResidentMegabytes: number;
}> {
  const main = process.memoryUsage().rss / (1024 * 1024);
  const rendererPid = window.webContents.getOSProcessId();
  const metric = app.getAppMetrics().find((item) => item.pid === rendererPid);
  return {
    mainResidentMegabytes: Math.round(main * 10) / 10,
    rendererResidentMegabytes: Math.round(((metric?.memory.workingSetSize ?? 0) / 1024) * 10) / 10,
  };
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
    const x = bounds.x + Number(wrap.dataset.imageX);
    const y = bounds.y + Number(wrap.dataset.imageY);
    const meta = document.querySelector('.canvas-meta')?.textContent ?? '';
    const dimensions = meta.match(/(\\d+)\\s*[×x]\\s*(\\d+)/);
    if (!dimensions || !Number.isFinite(scale)) throw new Error('Canvas dimensions are unavailable');
    return {
      stage: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      image: { x, y, width: Number(dimensions[1]) * scale, height: Number(dimensions[2]) * scale, scale }
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

async function exerciseNativeCanvas(driver: NativeUiDriver): Promise<void> {
  await driver.waitFor({ selector: '.konvajs-content' });
  let geometry = await canvasGeometry(driver);
  const panStart = {
    x: Math.round(geometry.stage.x + 20),
    y: Math.round(geometry.stage.y + geometry.stage.height - 20),
  };
  const beforePan = geometry.image.x;
  await driver.drag(panStart, { x: panStart.x + 70, y: panStart.y - 30 });
  geometry = await canvasGeometry(driver);
  if (geometry.image.x <= beforePan + 40)
    throw new Error('Default select-tool panning ignored native input.');

  await driver.press('0');
  geometry = await canvasGeometry(driver);
  const textPoint = {
    x: Math.round(geometry.image.x + geometry.image.width * 0.5),
    y: Math.round(geometry.image.y + geometry.image.height * 0.5),
  };
  await driver.doubleClick(textPoint);
  await driver.waitFor({ selector: '[aria-label="Edit annotation text"]' });
  await driver.fill({ selector: '[aria-label="Edit annotation text"]' }, 'Trusted pointer note');
  await driver.press('ENTER');
  await delay(150);
  await driver.doubleClick(textPoint);
  await driver.waitFor({ selector: '[aria-label="Edit annotation text"]' });
  await driver.fill({ selector: '[aria-label="Edit annotation text"]' }, 'Must be cancelled');
  await driver.press('ESCAPE');
  await delay(150);
  await driver.doubleClick(textPoint);
  const cancelled = await driver.evaluate<string>(
    `document.querySelector('[aria-label="Edit annotation text"]')?.value ?? ''`,
  );
  if (cancelled !== 'Trusted pointer note') throw new Error('Escape did not restore inline text.');
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
    await driver.waitFor({ selector: '.workspace, [data-testid="workspace"]' });
    await driver.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (document.documentElement.dataset.theme === ${JSON.stringify(theme)})
          return resolve(true);
        if (Date.now() - started > 10000)
          return reject(new Error('Reopened renderer did not load the saved ${theme} theme'));
        setTimeout(check, 25);
      };
      check();
    })()`);
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

async function exercisePreferencesAndChannel(driver: NativeUiDriver, host: SmokeWorkflowHost): Promise<void> {
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
  const channelSelect = { selector: '[data-testid="update-channel"], .update-settings select' };
  await driver.click(channelSelect);
  await driver.press('END');
  await driver.press('ENTER');
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Switch to Nightly?' });
  if ((await host.readSettings()).updateChannel !== 'stable')
    throw new Error('Update channel changed before Nightly confirmation.');
  await driver.click({ text: 'Keep Stable', exact: true });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Switch to Nightly?' }, { absent: true });

  await driver.click(channelSelect);
  await driver.press('END');
  await driver.press('ENTER');
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
      text: card.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
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

async function promptSets(host: SmokeWorkflowHost, projectPath: string): Promise<PromptSet[]> {
  const project = await host.readProject(projectPath);
  const collection = project.collections.find((item) => !item.archived) ?? project.collections.at(-1);
  if (!collection) throw new Error('Prompt fixture lost its collection.');
  const exportsDirectory = path.join(projectPath, 'collections', collection.id, 'exports');
  const entries = await fs.readdir(exportsDirectory, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.name.includes('.prompt-staging-') || entry.name.endsWith('.reservation')))
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
): Promise<PromptSet> {
  const started = Date.now();
  do {
    const added = (await promptSets(host, projectPath)).find((set) => !previousNames.has(set.name));
    if (added) return added;
    await delay(50);
  } while (Date.now() - started < 30_000);
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
    latestSet = await waitForNewPromptSet(host, projectPath, existingNames);
    existingNames.add(latestSet.name);
    await waitForPromptGrants(driver, cards.length);
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
  await importImages(driver, projectPath, sources, 10);
  assertions.push('real new-project prompt and collection import');

  let activeWindow = await host.reopenWindow();
  driver.setWindow(activeWindow);
  await driver.waitFor({ selector: '.konvajs-content' });
  await exerciseNativeCanvas(driver);
  assertions.push('trusted pan, crop, redaction, outside-bound drag, double-click, Enter and Escape');
  const excludedPicture = await excludeScreenshotThroughUi(driver, host, projectPath);
  assertions.push('eye-row exclusion with stable pre-filter Picture number');

  await captureWorkspaceMatrix(driver, host, artifactDirectory, artifacts);
  await exercisePreferencesAndChannel(driver, host);
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
    assertions.push(
      'mixed-resolution 1/10/20/100 fixtures with one complete 20-image and one complete 100-image prompt render action',
    );
  } else assertions.push('mixed-resolution 1/10 smoke benchmark; 20/100 reserved for stress mode');

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
