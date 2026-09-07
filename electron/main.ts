import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { z } from 'zod';
import updater from 'electron-updater';
const { autoUpdater } = updater;
import type {
  ExportRequest,
  ImagePayload,
  ProjectData,
  ProjectListItem,
  ProjectSnapshot,
  ScreenshotRecord,
  WorkspaceSettings,
} from '../src/shared/types.js';
import type { PreferenceSettingsResult } from '../src/shared/preferences.js';
import {
  mergePreferenceSettings,
  preferenceSettingsEnvelope,
  preferenceSettingsUpdateSchema,
  resolvePreferenceSettings,
} from '../src/shared/preference-settings.js';
import type { PreferenceSettingsUpdate, ProjectWatchEvent } from '../src/shared/workflow-bridge.js';
import {
  DEFAULT_EXPORT_PREFERENCES,
  emptyProject,
  nowIso,
  sanitizeFilename,
  slugify,
} from '../src/shared/utils.js';
import {
  validateProject,
  parseProjectFile,
  projectSchema,
  screenshotSchema,
  annotationSchema,
  notesSchema,
  settingsPatchSchema,
  filenameSchema,
} from '../src/shared/schema.js';
import { assertNoLinks, atomicWrite as writeAtomically, isWithin } from './files.js';
import { ensureCollection, addEmptyCollection, migrateProject, screenshotPath } from './collections.js';
import {
  deleteScreenshotToTrash,
  recoverScreenshotTrashTransactions,
  undoScreenshotDelete,
  type ScreenshotTrashOperations,
} from './screenshot-trash.js';
import {
  discardScreenshotTransaction,
  recoverScreenshotTransactions,
  replayScreenshotTransaction,
  type ScreenshotTransactionKind,
  type ScreenshotTransactionOperations,
  type ScreenshotTransactionWrite,
} from './screenshot-transactions.js';
import {
  commitScreenshotFileTransaction,
  nextProjectMutationTimestamp,
} from './screenshot-transaction-adapter.js';
import { normalizeRecoveredProject } from './recovery.js';
import {
  clipboardContextHtml,
  clipboardPngDimensions,
  MAX_CLIPBOARD_PNG_LENGTH,
} from '../src/shared/clipboard-context.js';
import { UpdateController } from './update-controller.js';
import { discoverRelease } from './releases.js';
import { prepareNativeUpdate } from './native-update.js';
import { prepareTerminalUpdate } from './terminal-update.js';
import { PromptBundleWorkflow } from './prompt-bundle-workflow.js';
import { PromptBundleStore, type PromptBundleManifestItem } from './prompt-bundle-store.js';
import { nativePerformanceProfile } from './native-performance.js';
import { ProjectWatchManager, projectRevisionForSource } from './project-watch.js';
import { workflowOutcome } from './workflow-errors.js';

// Smoke never reads or writes the installed application's profile or caches.
if (process.env.IMNOTA_SMOKE === '1') {
  const profile = process.env.IMNOTA_SMOKE_USER_DATA;
  if (!profile || !path.isAbsolute(profile) || !existsSync(profile))
    throw new Error('Run smoke tests through scripts/smoke.mjs with an isolated profile.');
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let updateController: UpdateController;
let projectWatchManager: ProjectWatchManager | undefined;
let promptBundleWorkflow: PromptBundleWorkflow | undefined;
let settings: WorkspaceSettings = {
  workspacePath: null,
  theme: 'system',
  interfaceScale: 1,
  openRecentOnLaunch: true,
  confirmBeforeDeletion: true,
  updateChannel: 'stable',
};
let preferenceSettingsResult: PreferenceSettingsResult = resolvePreferenceSettings(undefined, false);

async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await writeAtomically(filePath, content);
  projectWatchManager?.recordSelfWrite(filePath, content);
}

async function copyFile(filePath: string, targetPath: string): Promise<void> {
  await fs.copyFile(filePath, targetPath);
  projectWatchManager?.recordSelfWrite(targetPath, await fs.readFile(targetPath));
}

async function unlinkTracked(filePath: string): Promise<void> {
  await fs.unlink(filePath);
  projectWatchManager?.recordSelfDelete(filePath);
}

const screenshotTransactionOperations: ScreenshotTransactionOperations = {
  write: atomicWrite,
  unlink: unlinkTracked,
  removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
};

const screenshotTrashOperations: ScreenshotTrashOperations = {
  write: atomicWrite,
  unlink: unlinkTracked,
  removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
};

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function persistApplicationSettings(
  nextSettings: WorkspaceSettings,
  nextPreferences = preferenceSettingsResult.settings,
): Promise<void> {
  const persisted = preferenceSettingsEnvelope(
    nextSettings as unknown as Record<string, unknown>,
    nextPreferences,
    preferenceSettingsResult.profile,
  );
  await atomicWrite(settingsFile(), JSON.stringify(persisted, null, 2));
  settings = { ...nextSettings, theme: nextPreferences.appearance.mode };
  preferenceSettingsResult = { ...preferenceSettingsResult, settings: nextPreferences };
}
const projectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(3000),
});
const pathInput = z.string().min(1).max(2000);

function workspaceOrThrow(): string {
  if (!settings.workspacePath) throw new Error('Choose a workspace folder before opening a project.');
  return settings.workspacePath;
}

async function assertProjectPath(projectPath: string): Promise<string> {
  pathInput.parse(projectPath);
  const workspace = workspaceOrThrow();
  const resolved = path.resolve(projectPath);
  await assertNoLinks(resolved);
  if (!isWithin(workspace, resolved) || resolved === path.resolve(workspace))
    throw new Error('Project path is outside the selected workspace.');
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('The selected project folder is unavailable.');
  for (const name of [
    'project.json',
    'screenshots',
    'annotations',
    'notes',
    'exports',
    'rounds',
    'collections',
    '.imnota-undo',
    '.imnota-transactions',
    '.imnota-recovery.json',
    '.imnota-recovery-backup.json',
  ])
    await assertNoLinks(path.join(resolved, name));
  return resolved;
}

async function readProjectMetadata(projectPath: string): Promise<ProjectData> {
  await assertNoLinks(path.join(projectPath, 'project.json'));
  const raw = await fs.readFile(path.join(projectPath, 'project.json'), 'utf8');
  const parsed = await migrateProject(projectPath, parseProjectFile(JSON.parse(raw)));
  return {
    ...parsed,
    schemaVersion: 3,
    exportPreferences: { ...DEFAULT_EXPORT_PREFERENCES, ...parsed.exportPreferences },
  };
}

async function readProject(projectPath: string): Promise<ProjectData> {
  const parsed = await readProjectMetadata(projectPath);
  const screenshots = await Promise.all(
    parsed.screenshots.map(async (shot) => {
      const descriptionPath = path.join(projectPath, shot.descriptionFile);
      await assertNoLinks(descriptionPath);
      const description = await fs.readFile(descriptionPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return shot.description;
        throw error;
      });
      return description === shot.description ? shot : { ...shot, description };
    }),
  );
  return {
    ...parsed,
    schemaVersion: 3,
    exportPreferences: { ...DEFAULT_EXPORT_PREFERENCES, ...parsed.exportPreferences },
    screenshots,
  };
}

async function readProjectMutationBaseline(projectPath: string): Promise<{
  project: ProjectData;
  projectRevision: string;
}> {
  const projectFile = path.join(projectPath, 'project.json');
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await fs.readFile(projectFile, 'utf8');
    const project = await readProject(projectPath);
    const after = await fs.readFile(projectFile, 'utf8');
    const beforeRevision = projectRevisionForSource(before);
    const projectRevision = projectRevisionForSource(after);
    if (beforeRevision === projectRevision) return { project, projectRevision };
  }
  throw new Error('The project kept changing while the save was prepared. Wait for changes to settle.');
}

async function assertProjectRevision(projectPath: string, expectedRevision: string): Promise<void> {
  const currentRevision = projectRevisionForSource(
    await fs.readFile(path.join(projectPath, 'project.json'), 'utf8'),
  );
  if (currentRevision !== expectedRevision)
    throw new Error('The project changed while the save was prepared. Reload it before saving again.');
}

function withSnapshotWarnings(snapshot: ProjectSnapshot, warnings: readonly string[]): ProjectSnapshot {
  const combined = [...(snapshot.warnings ?? []), ...warnings].filter(
    (warning, index, values) => values.indexOf(warning) === index,
  );
  return combined.length ? { ...snapshot, warnings: combined } : snapshot;
}

async function commitFileTransaction(
  projectPath: string,
  kind: ScreenshotTransactionKind,
  writes: ScreenshotTransactionWrite[],
  assertBaseline: () => Promise<void>,
): Promise<string[]> {
  const committed = await commitScreenshotFileTransaction(projectPath, {
    kind,
    writes,
    assertBaseline,
    operations: screenshotTransactionOperations,
  });
  return committed.warning ? [committed.warning] : [];
}

async function recoverNativeProjectTransactions(projectPath: string): Promise<{
  warnings: string[];
  recoveredDeletes: Array<{ undoToken: string; screenshotId: string }>;
}> {
  const warnings: string[] = [];
  const recoveredDeletes: Array<{ undoToken: string; screenshotId: string }> = [];
  const transactions = await recoverScreenshotTransactions(projectPath, screenshotTransactionOperations);
  for (const transaction of transactions) {
    if (transaction.warning) warnings.push(transaction.warning);
    if (!transaction.candidateAvailable) continue;
    const choice = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      title: 'Recover interrupted save',
      message: 'An interrupted screenshot save was restored to its previous safe state.',
      detail:
        'Restore replays the saved candidate. Keep saved project discards that candidate without replacing the current files.',
      buttons: ['Restore', 'Keep saved project', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice.response === 2)
      throw new Error('Opening cancelled. The interrupted save remains recoverable.');
    if (choice.response === 0) {
      const replayed = await replayScreenshotTransaction(
        projectPath,
        transaction.token,
        screenshotTransactionOperations,
      );
      if (replayed.warning) warnings.push(replayed.warning);
    } else {
      await discardScreenshotTransaction(projectPath, transaction.token, screenshotTransactionOperations);
    }
  }

  const trash = await recoverScreenshotTrashTransactions(projectPath, screenshotTrashOperations);
  for (const transaction of trash) {
    if (transaction.warning) warnings.push(transaction.warning);
    if (transaction.undoAvailable)
      recoveredDeletes.push({
        undoToken: transaction.undoToken,
        screenshotId: transaction.screenshotId,
      });
  }
  return { warnings, recoveredDeletes };
}

function imageType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
}

function dataUrlFromBuffer(buffer: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

const thumbnailCache = new Map<string, { mtime: number; dataUrl: string }>();
async function makeSnapshotAttempt(projectPath: string): Promise<ProjectSnapshot> {
  const project = await readProject(projectPath);
  const thumbnails: Record<string, string> = {};
  const warnings: string[] = [];
  await Promise.all(
    project.screenshots.map(async (shot) => {
      try {
        const filePath = screenshotPath(projectPath, shot);
        await assertNoLinks(filePath);
        const stat = await fs.stat(filePath);
        const cached = thumbnailCache.get(filePath);
        if (cached?.mtime === stat.mtimeMs) thumbnails[shot.id] = cached.dataUrl;
        else {
          const image = nativeImage.createFromPath(filePath);
          if (!image.isEmpty()) {
            const dataUrl = image.resize({ width: 220, quality: 'good' }).toDataURL();
            thumbnails[shot.id] = dataUrl;
            if (thumbnailCache.size >= 300) thumbnailCache.delete(thumbnailCache.keys().next().value!);
            thumbnailCache.set(filePath, { mtime: stat.mtimeMs, dataUrl });
          } else warnings.push(`Preview unavailable for ${shot.originalFilename}.`);
        }
      } catch {
        warnings.push(`Preview unavailable for ${shot.originalFilename}.`);
      }
    }),
  );
  const recoveryPath = path.join(projectPath, '.imnota-recovery.json');
  const recoveryStat = await fs.stat(recoveryPath).catch(() => null);
  return {
    projectPath,
    project,
    thumbnails,
    recoveryFound: Boolean(recoveryStat),
    warnings: warnings.length ? warnings : undefined,
  };
}

async function makeSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  const projectFile = path.join(projectPath, 'project.json');
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await fs.readFile(projectFile, 'utf8');
    const snapshot = await makeSnapshotAttempt(projectPath);
    const after = await fs.readFile(projectFile, 'utf8');
    const beforeRevision = projectRevisionForSource(before);
    const projectRevision = projectRevisionForSource(after);
    if (beforeRevision === projectRevision) return { ...snapshot, projectRevision };
  }
  throw new Error('The project kept changing while its snapshot was prepared. Wait and try again.');
}

async function openWithRecovery(projectPath: string): Promise<ProjectSnapshot> {
  const nativeRecovery = await recoverNativeProjectTransactions(projectPath);
  const decorateSnapshot = (snapshot: ProjectSnapshot, warnings: readonly string[] = []) => {
    const withWarnings = withSnapshotWarnings(snapshot, [...nativeRecovery.warnings, ...warnings]);
    return nativeRecovery.recoveredDeletes.length
      ? { ...withWarnings, recoveredDeletes: nativeRecovery.recoveredDeletes }
      : withWarnings;
  };
  const snapshot = decorateSnapshot(await makeSnapshot(projectPath));
  const recoveryPath = path.join(projectPath, '.imnota-recovery.json');
  if (!snapshot.recoveryFound) return snapshot;
  await assertNoLinks(recoveryPath);
  const recoverySource = await fs.readFile(recoveryPath, 'utf8');
  const recovery = z
    .object({
      project: z.unknown(),
      annotations: z.record(z.array(annotationSchema)),
      notes: z.record(notesSchema).optional(),
    })
    .parse(JSON.parse(recoverySource));
  const recoveryProject = parseProjectFile(recovery.project);
  if (recoveryProject.id !== snapshot.project.id)
    throw new Error('Recovery belongs to a different project. Your files were not changed.');
  const choice = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    title: 'Recover interrupted work',
    message: 'An interrupted editing session was found.',
    detail:
      'Restore its descriptions and annotations, or keep the last saved project. Recovery data will be preserved as .imnota-recovery-backup.json.',
    buttons: ['Restore edits', 'Keep saved project', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  if (choice.response === 2) throw new Error('Opening cancelled. Recovery data is unchanged.');
  const recoveryBackupPath = path.join(projectPath, '.imnota-recovery-backup.json');
  await assertNoLinks(recoveryBackupPath);
  const warnings: string[] = [];
  if (choice.response === 0) {
    const recoveredProject = validateProject({
      ...normalizeRecoveredProject(snapshot.project, recoveryProject, recovery.notes),
      updatedAt: nextProjectMutationTimestamp(snapshot.project.updatedAt),
    });
    const currentById = new Map(snapshot.project.screenshots.map((shot) => [shot.id, shot]));
    const writes: ScreenshotTransactionWrite[] = [
      {
        relativePath: '.imnota-recovery-backup.json',
        after: Buffer.from(recoverySource),
      },
      {
        relativePath: '.imnota-recovery.json',
        after: null,
        expectedBefore: 'present',
      },
    ];
    // Use trusted current file references, not file references from recovery data.
    for (const shot of recoveredProject.screenshots) {
      if (recovery.annotations[shot.id])
        writes.push({
          relativePath: shot.annotationFile,
          after: Buffer.from(JSON.stringify(recovery.annotations[shot.id], null, 2)),
        });
      if (currentById.get(shot.id)?.description !== shot.description)
        writes.push({ relativePath: shot.descriptionFile, after: Buffer.from(shot.description) });
    }
    writes.push({
      relativePath: 'project.json',
      after: Buffer.from(JSON.stringify(recoveredProject, null, 2)),
      expectedBefore: 'present',
    });
    const expectedProjectRevision = snapshot.projectRevision;
    if (!expectedProjectRevision) throw new Error('Recovery snapshot has no project revision.');
    const expectedRecoveryRevision = projectRevisionForSource(recoverySource);
    warnings.push(
      ...(await commitFileTransaction(projectPath, 'recovery-restore', writes, async () => {
        await assertProjectRevision(projectPath, expectedProjectRevision);
        const currentRecovery = await fs.readFile(recoveryPath, 'utf8');
        if (projectRevisionForSource(currentRecovery) !== expectedRecoveryRevision)
          throw new Error(
            'Recovery data changed while restore was prepared. Reopen the project and try again.',
          );
      })),
    );
  } else {
    await atomicWrite(recoveryBackupPath, recoverySource);
    await unlinkTracked(recoveryPath);
  }
  return decorateSnapshot(await makeSnapshot(projectPath), warnings);
}

async function uniqueProjectFolder(workspace: string, name: string): Promise<string> {
  const base = slugify(name);
  let folder = path.join(workspace, base);
  let n = 2;
  while (existsSync(folder)) folder = path.join(workspace, `${base}-${n++}`);
  return folder;
}

async function uniqueStoredName(projectPath: string, original: string): Promise<string> {
  const ext = path.extname(original).toLowerCase() || '.png';
  const base = sanitizeFilename(path.basename(original, ext), 'screenshot');
  const project = await readProject(projectPath);
  const existing = new Set(project.screenshots.map((s) => s.storedFilename));
  const occupied = (candidate: string) =>
    existing.has(candidate) ||
    project.collections.some((collection) =>
      existsSync(path.join(projectPath, 'collections', collection.id, 'screenshots', candidate)),
    );
  let candidate = `${String(existing.size + 1).padStart(3, '0')}-${base}${ext}`;
  let n = 2;
  while (occupied(candidate))
    candidate = `${String(existing.size + 1).padStart(3, '0')}-${base}-${n++}${ext}`;
  return candidate;
}

function contentRevision(description: string, annotationsJson: string): string {
  return createHash('sha256').update(description).update('\0').update(annotationsJson).digest('hex');
}

function nextScreenshotPosition(project: ProjectData, collectionId: string): number {
  return (
    Math.max(
      -1,
      ...project.screenshots
        .filter((screenshot) => screenshot.collectionId === collectionId)
        .map((screenshot) => screenshot.position),
    ) + 1
  );
}

async function readScreenshotFiles(projectPath: string, screenshot: ScreenshotRecord) {
  const annotationPath = path.join(projectPath, screenshot.annotationFile);
  const descriptionPath = path.join(projectPath, screenshot.descriptionFile);
  await assertNoLinks(annotationPath);
  await assertNoLinks(descriptionPath);
  const [annotationsJson, description] = await Promise.all([
    fs.readFile(annotationPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    }),
    fs.readFile(descriptionPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return screenshot.description;
      throw error;
    }),
  ]);
  return { annotationsJson, description, revision: contentRevision(description, annotationsJson) };
}

async function importOne(
  projectPath: string,
  sourcePath: string,
  originalFilename = path.basename(sourcePath),
  collectionId?: string,
): Promise<void> {
  const ext = path.extname(originalFilename).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext))
    throw new Error(`Unsupported screenshot format: ${originalFilename}. Use PNG, JPEG or WebP.`);
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error(`Imnota could not read ${originalFilename}. The file may be damaged.`);
  const project = await readProject(projectPath);
  const collection = project.collections.find(
    (item) => item.id === (collectionId ?? project.collections.find((candidate) => !candidate.archived)?.id),
  );
  if (!collection || collection.archived) throw new Error('Choose a current collection before importing.');
  await ensureCollection(projectPath, collection.id);
  const storedFilename = await uniqueStoredName(projectPath, originalFilename);
  await atomicWrite(
    path.join(projectPath, 'collections', collection.id, 'screenshots', storedFilename),
    await fs.readFile(sourcePath),
  );
  const timestamp = nowIso();
  project.screenshots.push({
    collectionId: collection.id,
    id: `shot_${crypto.randomUUID()}`,
    originalFilename,
    storedFilename,
    title: originalFilename,
    description: '',
    position: nextScreenshotPosition(project, collection.id),
    createdAt: timestamp,
    updatedAt: timestamp,
    priority: 'medium',
    annotationFile: `collections/${collection.id}/annotations/${storedFilename}.json`,
    descriptionFile: `collections/${collection.id}/descriptions/${storedFilename}.md`,
    originalWidth: image.getSize().width,
    originalHeight: image.getSize().height,
    includeInExport: true,
  });
  const added = project.screenshots.at(-1)!;
  await atomicWrite(path.join(projectPath, added.annotationFile), '[]');
  await atomicWrite(path.join(projectPath, added.descriptionFile), '');
  project.updatedAt = timestamp;
  await atomicWrite(path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2));
}

async function loadImage(projectPath: string, screenshot: ScreenshotRecord): Promise<ImagePayload> {
  const filePath = screenshotPath(projectPath, screenshot);
  await assertNoLinks(filePath);
  if (!isWithin(projectPath, filePath)) throw new Error('Image path is outside the project.');
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error('The screenshot could not be loaded.');
  const buffer = await fs.readFile(filePath);
  return {
    filename: screenshot.storedFilename,
    dataUrl: dataUrlFromBuffer(buffer, imageType(screenshot.storedFilename)),
    width: image.getSize().width,
    height: image.getSize().height,
  };
}

function copyTextToClipboard(text: string): void {
  if (typeof text !== 'string' || text.length > 2_000_000)
    throw new Error('Context is too large to copy. Export the Markdown file instead.');
  clipboard.writeText(text);
}

function clipboardImage(imageDataUrl: string) {
  const size = clipboardPngDimensions(imageDataUrl);
  const image = nativeImage.createFromDataURL(imageDataUrl);
  if (image.isEmpty() || image.getSize().width !== size.width || image.getSize().height !== size.height)
    throw new Error('The annotated image could not be decoded. Use the exported PNG instead.');
  return image;
}

function validateDecodedPromptPng(
  png: Uint8Array,
  expected: Pick<PromptBundleManifestItem, 'width' | 'height'>,
): void {
  const image = nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  const size = image.getSize();
  if (image.isEmpty() || size.width !== expected.width || size.height !== expected.height)
    throw new Error('Prompt PNG could not be fully decoded at its reserved dimensions.');
}

function copyImageToClipboard(imageDataUrl: string): void {
  clipboard.writeImage(clipboardImage(imageDataUrl));
}

function copyContextToClipboard(markdown: string, imageDataUrl: string): void {
  const image = clipboardImage(imageDataUrl);
  const html = clipboardContextHtml(markdown);
  clipboard.write({ text: markdown, html, image });
}

function registerIpc(): void {
  // One queue prevents concurrent read/modify/write handlers from losing updates.
  let pending: Promise<unknown> = Promise.resolve();
  const screenshotInput = z.object({ projectPath: pathInput, screenshot: screenshotSchema });
  const png = z
    .string()
    .max(100_000_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  const imageExport = z.object({ filename: filenameSchema, dataUrl: png });
  const workflowSessionId = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(200);
  const workflowBundleNumber = z.number().int().min(1).max(999);
  const workflowManifest = z
    .array(
      z
        .object({
          bundleNumber: workflowBundleNumber,
          width: z.number().int().min(1).max(16_384),
          height: z.number().int().min(1).max(16_384),
        })
        .strict(),
    )
    .min(1)
    .max(999);
  const contracts: Record<string, z.ZodTypeAny> = {
    'settings:get': z.tuple([]),
    'settings:choose-workspace': z.tuple([]),
    'settings:set': z.tuple([settingsPatchSchema]),
    'projects:list': z.tuple([]),
    'projects:create': z.tuple([projectInput]),
    'projects:open-dialog': z.tuple([]),
    'projects:save': z.tuple([pathInput, projectSchema]),
    'projects:save-screenshot': z.tuple([
      screenshotInput.extend({
        annotations: z.array(annotationSchema).max(10000),
        contentRevision: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ]),
    'screenshots:load-content': z.tuple([screenshotInput]),
    'screenshots:duplicate': z.tuple([screenshotInput]),
    'screenshots:import-files': z.tuple([
      z.object({
        projectPath: pathInput,
        paths: z.array(pathInput).min(1).max(50),
        collectionId: filenameSchema.optional(),
      }),
    ]),
    'screenshots:paste': z.tuple([pathInput, filenameSchema.optional()]),
    'collections:edit': z.tuple([
      z.object({
        projectPath: pathInput,
        action: z.enum(['create', 'rename', 'archive', 'restore']),
        collectionId: filenameSchema.optional(),
        name: z.string().trim().min(1).max(120).optional(),
      }),
    ]),
    'screenshots:delete': z.tuple([
      z.object({ projectPath: pathInput, screenshotId: z.string().min(1).max(200) }),
    ]),
    'screenshots:undo-delete': z.tuple([z.object({ projectPath: pathInput, undoToken: filenameSchema })]),
    'exports:annotated-image': z.tuple([
      imageExport.extend({ projectPath: pathInput, collectionId: filenameSchema.optional() }),
    ]),
    'exports:package': z.tuple([
      z.object({
        projectPath: pathInput,
        markdown: z.string().max(2_000_000),
        annotatedImages: z.array(imageExport).max(1000),
        includeOriginal: z.boolean(),
        includeAnnotations: z.boolean(),
        collectionId: filenameSchema.optional(),
      }),
    ]),
    'system:copy-text': z.tuple([z.string().max(2_000_000)]),
    'system:copy-context': z.tuple([
      z
        .object({ markdown: z.string().max(2_000_000), imageDataUrl: png.max(MAX_CLIPBOARD_PNG_LENGTH) })
        .strict(),
    ]),
    'system:copy-image': z.tuple([png]),
    'recovery:save': z.tuple([
      z.object({
        projectPath: pathInput,
        project: projectSchema,
        annotations: z.record(z.array(annotationSchema)),
      }),
    ]),
    'update:download': z.tuple([]),
    'update:check': z.tuple([]),
    'update:status': z.tuple([]),
    'update:install': z.tuple([]),
  };
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error('Untrusted IPC sender.');
      const validated = (contracts[channel] ?? z.tuple([pathInput])).parse(args);
      if (channel.startsWith('update:')) return listener(event, ...validated);
      if (updateInstallPending) throw new Error('Imnota is restarting to install an update.');
      const result = pending.then(() => listener(event, ...validated));
      pending = result.catch(() => undefined);
      return result;
    });
  };
  const handleWorkflow = (
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown,
    queued = false,
  ) => {
    ipcMain.handle(channel, (event, ...args) =>
      workflowOutcome(async () => {
        if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
          throw new Error('Untrusted IPC sender.');
        if (updateInstallPending) throw new Error('Imnota is restarting to install an update.');
        if (!queued) return listener(event, ...args);
        const result = pending.then(() => listener(event, ...args));
        pending = result.catch(() => undefined);
        return result;
      }),
    );
  };

  projectWatchManager = new ProjectWatchManager({
    loadSnapshot: (projectPath) => makeSnapshot(projectPath),
    saveProject: async (projectPath, project) => {
      const current = await readProject(projectPath);
      if (current.id !== project.id) throw new Error('Project identity does not match its watch grant.');
      const next = validateProject({ ...project, id: current.id, schemaVersion: 3, updatedAt: nowIso() });
      await atomicWrite(path.join(projectPath, 'project.json'), JSON.stringify(next, null, 2));
      return makeSnapshot(projectPath);
    },
    emit: (event: ProjectWatchEvent) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send('workflow:project-watch-event', event);
    },
  });
  promptBundleWorkflow = new PromptBundleWorkflow(
    {
      authorize: async (projectPath, collectionId) => {
        const safePath = await assertProjectPath(projectPath);
        const project = await readProjectMetadata(safePath);
        const collection = project.collections.find((candidate) => candidate.id === collectionId);
        if (!collection) throw new Error('Collection does not belong to this project.');
        return {
          projectPath: safePath,
          collectionId: collection.id,
          collectionName: collection.name,
        };
      },
      copyContext: (markdown, imageDataUrl) => copyContextToClipboard(markdown, imageDataUrl),
      copyText: (markdown) => copyTextToClipboard(markdown),
      copyImage: (imageDataUrl) => copyImageToClipboard(imageDataUrl),
      openPath: async (targetPath) => {
        const error = await shell.openPath(targetPath);
        if (error) throw new Error(error);
      },
    },
    new PromptBundleStore({ validateDecodedPng: validateDecodedPromptPng }),
  );
  handle('settings:get', () => settings);
  handle('settings:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose Imnota workspace',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.workspacePath = result.filePaths[0];
    await persistApplicationSettings(settings);
    return settings;
  });
  handle('settings:set', async (_event, input: Partial<WorkspaceSettings>) => {
    const nextPreferences = input.theme
      ? mergePreferenceSettings(preferenceSettingsResult.settings, {
          appearance: { mode: input.theme },
        })
      : preferenceSettingsResult.settings;
    const next = { ...settings, ...input, theme: nextPreferences.appearance.mode };
    const persist = async () => {
      await persistApplicationSettings(next, nextPreferences);
    };
    if (next.updateChannel !== settings.updateChannel)
      await updateController.switchChannel(next.updateChannel, persist);
    else await persist();
    return settings;
  });
  handleWorkflow('workflow:preferences:get', (_event, ...args) => {
    z.tuple([]).parse(args);
    return preferenceSettingsResult;
  });
  handleWorkflow(
    'workflow:preferences:set',
    async (_event, ...args) => {
      const [input] = z.tuple([preferenceSettingsUpdateSchema]).parse(args);
      const next = mergePreferenceSettings(
        preferenceSettingsResult.settings,
        input as PreferenceSettingsUpdate,
      );
      await persistApplicationSettings({ ...settings, theme: next.appearance.mode }, next);
      return preferenceSettingsResult;
    },
    true,
  );
  handleWorkflow('workflow:performance:get', (_event, ...args) => {
    z.tuple([]).parse(args);
    return nativePerformanceProfile();
  });
  handleWorkflow(
    'workflow:prompt-export:start',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              projectPath: pathInput,
              collectionId: filenameSchema,
              bundles: workflowManifest,
            })
            .strict(),
        ])
        .parse(args);
      return promptBundleWorkflow!.start(input.projectPath, input.collectionId, input.bundles);
    },
    true,
  );
  handleWorkflow(
    'workflow:prompt-export:write',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              sessionId: workflowSessionId,
              bundleNumber: workflowBundleNumber,
              pngDataUrl: z
                .string()
                .max(134_000_000)
                .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
              markdown: z.string().min(1).max(2_000_000),
            })
            .strict(),
        ])
        .parse(args);
      return promptBundleWorkflow!.write(
        input.sessionId,
        input.bundleNumber,
        input.pngDataUrl,
        input.markdown,
      );
    },
    true,
  );
  handleWorkflow(
    'workflow:prompt-export:finish',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              sessionId: workflowSessionId,
              masterMarkdown: z.string().max(2_000_000).optional(),
            })
            .strict(),
        ])
        .parse(args);
      return promptBundleWorkflow!.finish(input.sessionId, input.masterMarkdown);
    },
    true,
  );
  handleWorkflow('workflow:prompt-export:cancel', async (_event, ...args) => {
    const [input] = z.tuple([z.object({ sessionId: workflowSessionId }).strict()]).parse(args);
    return promptBundleWorkflow!.cancel(input.sessionId);
  });
  handleWorkflow('workflow:prompt-export:read', async (_event, ...args) => {
    const [input] = z
      .tuple([z.object({ sessionId: workflowSessionId, bundleNumber: workflowBundleNumber }).strict()])
      .parse(args);
    return promptBundleWorkflow!.read(input.sessionId, input.bundleNumber);
  });
  handleWorkflow('workflow:prompt-export:copy', async (_event, ...args) => {
    const [input] = z
      .tuple([
        z
          .object({
            sessionId: workflowSessionId,
            bundleNumber: workflowBundleNumber,
            target: z.enum(['context', 'markdown', 'image']),
          })
          .strict(),
      ])
      .parse(args);
    await promptBundleWorkflow!.copy(input.sessionId, input.bundleNumber, input.target);
  });
  handleWorkflow('workflow:prompt-export:open', async (_event, ...args) => {
    const [input] = z
      .tuple([
        z
          .object({
            sessionId: workflowSessionId,
            bundleNumber: workflowBundleNumber,
            target: z.enum(['folder', 'png', 'markdown', 'master']),
          })
          .strict(),
      ])
      .parse(args);
    await promptBundleWorkflow!.open(input.sessionId, input.bundleNumber, input.target);
  });
  handleWorkflow(
    'workflow:project-watch:start',
    async (_event, ...args) => {
      const [input] = z.tuple([z.object({ projectPath: pathInput }).strict()]).parse(args);
      return projectWatchManager!.start(await assertProjectPath(input.projectPath));
    },
    true,
  );
  handleWorkflow('workflow:project-watch:stop', (_event, ...args) => {
    const [input] = z.tuple([z.object({ watchId: workflowSessionId }).strict()]).parse(args);
    projectWatchManager!.stop(input.watchId);
  });
  handleWorkflow('workflow:project-watch:reload', async (_event, ...args) => {
    const [input] = z.tuple([z.object({ watchId: workflowSessionId }).strict()]).parse(args);
    return projectWatchManager!.reload(input.watchId);
  });
  handleWorkflow(
    'workflow:project-watch:cas',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              watchId: workflowSessionId,
              expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
              project: projectSchema,
            })
            .strict(),
        ])
        .parse(args);
      return projectWatchManager!.compareAndSwap(
        input.watchId,
        input.expectedRevision,
        validateProject(input.project),
      );
    },
    true,
  );
  handle('projects:list', async () => {
    if (!settings.workspacePath) return [];
    const entries = await fs.readdir(settings.workspacePath, { withFileTypes: true }).catch(() => []);
    const projects: ProjectListItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const projectPath = path.join(settings.workspacePath, entry.name);
        if (existsSync(path.join(projectPath, 'project.json'))) {
          const project = await readProject(projectPath);
          const searchable = [project.name, project.description, project.status];
          for (const shot of project.screenshots) {
            searchable.push(shot.title, shot.description, shot.priority);
          }
          projects.push({ ...project, projectPath, searchText: searchable.join(' ').toLowerCase() });
        }
      } catch {
        /* corrupt projects stay discoverable through open */
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  handle('projects:create', async (_event, raw) => {
    const input = projectInput.parse(raw);
    const workspace = workspaceOrThrow();
    await fs.mkdir(workspace, { recursive: true });
    const folder = await uniqueProjectFolder(workspace, input.name);
    await fs.mkdir(path.join(folder, 'exports'), { recursive: true });
    await ensureCollection(folder, '001-collection');
    await atomicWrite(
      path.join(folder, 'project.json'),
      JSON.stringify(emptyProject(input.name, input.description, path.basename(workspace)), null, 2),
    );
    return makeSnapshot(folder);
  });
  handle('projects:open-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open Imnota project',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const projectPath = await assertProjectPath(result.filePaths[0]);
    return openWithRecovery(projectPath);
  });
  handle('projects:load', async (_event, projectPath: string) =>
    openWithRecovery(await assertProjectPath(projectPath)),
  );
  handle('projects:save', async (_event, projectPath: string, project: ProjectData) => {
    const safePath = await assertProjectPath(projectPath);
    validateProject(project);
    await atomicWrite(
      path.join(safePath, 'project.json'),
      JSON.stringify({ ...project, schemaVersion: 3, updatedAt: nowIso() }, null, 2),
    );
  });
  handle('projects:save-screenshot', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const baseline = await readProjectMutationBaseline(safePath);
    const project = baseline.project;
    const trustedShot = project.screenshots.find((s) => s.id === input.screenshot.id);
    if (!trustedShot) throw new Error('Screenshot does not belong to this project.');
    const currentContent = await readScreenshotFiles(safePath, trustedShot);
    if (currentContent.revision !== input.contentRevision) {
      const ext = path.extname(trustedShot.storedFilename);
      const storedFilename = await uniqueStoredName(
        safePath,
        `${path.basename(trustedShot.storedFilename, ext)}-copy-conflict${ext}`,
      );
      const timestamp = nextProjectMutationTimestamp(project.updatedAt);
      const conflict: ScreenshotRecord = {
        ...input.screenshot,
        id: `shot_${crypto.randomUUID()}`,
        collectionId: trustedShot.collectionId,
        originalFilename: `${trustedShot.originalFilename} Copy conflict`,
        storedFilename,
        title: `${input.screenshot.title || trustedShot.title} — Copy conflict`,
        position: nextScreenshotPosition(project, trustedShot.collectionId),
        createdAt: timestamp,
        updatedAt: timestamp,
        annotationFile: `collections/${trustedShot.collectionId}/annotations/${storedFilename}.json`,
        descriptionFile: `collections/${trustedShot.collectionId}/descriptions/${storedFilename}.md`,
        includeInExport: false,
        conflict: true,
      };
      const trustedImagePath = screenshotPath(safePath, trustedShot);
      await assertNoLinks(trustedImagePath);
      const conflictImage = await fs.readFile(trustedImagePath);
      const conflictAnnotations = JSON.stringify(input.annotations, null, 2);
      project.screenshots.push(conflict);
      project.updatedAt = timestamp;
      const savedProject = validateProject(project);
      const projectSource = JSON.stringify(savedProject, null, 2);
      const warnings = await commitFileTransaction(
        safePath,
        'conflict',
        [
          {
            relativePath: `collections/${conflict.collectionId}/screenshots/${conflict.storedFilename}`,
            after: conflictImage,
            expectedBefore: 'absent',
          },
          {
            relativePath: conflict.annotationFile,
            after: Buffer.from(conflictAnnotations),
            expectedBefore: 'absent',
          },
          {
            relativePath: conflict.descriptionFile,
            after: Buffer.from(conflict.description),
            expectedBefore: 'absent',
          },
          {
            relativePath: 'project.json',
            after: Buffer.from(projectSource),
            expectedBefore: 'present',
          },
        ],
        () => assertProjectRevision(safePath, baseline.projectRevision),
      );
      return {
        project: savedProject,
        savedScreenshotId: conflict.id,
        conflictCreated: true,
        contentRevision: contentRevision(conflict.description, conflictAnnotations),
        projectRevision: projectRevisionForSource(projectSource),
        warnings: warnings.length ? warnings : undefined,
      };
    }
    const timestamp = nextProjectMutationTimestamp(project.updatedAt);
    const screenshot: ScreenshotRecord = {
      ...input.screenshot,
      id: trustedShot.id,
      collectionId: trustedShot.collectionId,
      storedFilename: trustedShot.storedFilename,
      annotationFile: trustedShot.annotationFile,
      descriptionFile: trustedShot.descriptionFile,
      createdAt: trustedShot.createdAt,
      updatedAt: timestamp,
    };
    project.screenshots = project.screenshots.map((shot) => (shot.id === screenshot.id ? screenshot : shot));
    project.updatedAt = timestamp;
    const annotationsJson = JSON.stringify(input.annotations, null, 2);
    const savedProject = validateProject(project);
    const projectSource = JSON.stringify(savedProject, null, 2);
    const warnings = await commitFileTransaction(
      safePath,
      'save',
      [
        { relativePath: screenshot.annotationFile, after: Buffer.from(annotationsJson) },
        { relativePath: screenshot.descriptionFile, after: Buffer.from(screenshot.description) },
        { relativePath: '.imnota-recovery.json', after: null },
        {
          relativePath: 'project.json',
          after: Buffer.from(projectSource),
          expectedBefore: 'present',
        },
      ],
      async () => {
        await assertProjectRevision(safePath, baseline.projectRevision);
        if ((await readScreenshotFiles(safePath, trustedShot)).revision !== input.contentRevision)
          throw new Error('Screenshot content changed while the save was prepared. Reload it and try again.');
      },
    );
    return {
      project: savedProject,
      savedScreenshotId: screenshot.id,
      conflictCreated: false,
      contentRevision: contentRevision(screenshot.description, annotationsJson),
      projectRevision: projectRevisionForSource(projectSource),
      warnings: warnings.length ? warnings : undefined,
    };
  });
  handle('screenshots:load-content', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const screenshot = project.screenshots.find((shot) => shot.id === input.screenshot.id);
    if (!screenshot) throw new Error('Screenshot does not belong to this project.');
    input.screenshot = screenshot;
    const annotationPath = path.join(safePath, input.screenshot.annotationFile);
    await assertNoLinks(annotationPath);
    const content = await readScreenshotFiles(safePath, input.screenshot);
    const [image] = await Promise.all([loadImage(safePath, input.screenshot)]);
    return {
      image,
      annotations: z.array(annotationSchema).parse(JSON.parse(content.annotationsJson)),
      description: content.description,
      contentRevision: content.revision,
    };
  });
  handle('screenshots:import-files', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    if (!Array.isArray(input.paths) || input.paths.length > 50)
      throw new Error('Choose up to 50 screenshots at a time.');
    for (const source of input.paths)
      await importOne(safePath, source, path.basename(source), input.collectionId);
    return makeSnapshot(safePath);
  });
  handle('screenshots:paste', async (_event, projectPath: string, collectionId?: string) => {
    const safePath = await assertProjectPath(projectPath);
    const image = clipboard.readImage();
    if (image.isEmpty())
      throw new Error('The clipboard does not contain an image. Copy a screenshot and try again.');
    const filename = `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    const temp = path.join(app.getPath('temp'), filename);
    await fs.writeFile(temp, image.toPNG());
    await importOne(safePath, temp, filename, collectionId);
    await fs.unlink(temp).catch(() => undefined);
    return makeSnapshot(safePath);
  });
  handle('screenshots:duplicate', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const source = project.screenshots.find((s) => s.id === input.screenshot.id);
    if (!source) throw new Error('Screenshot not found.');
    const ext = path.extname(source.storedFilename);
    const name = await uniqueStoredName(safePath, `${path.basename(source.storedFilename, ext)}-copy${ext}`);
    await assertNoLinks(screenshotPath(safePath, source));
    for (const [original, destination, fallback] of [
      [source.annotationFile, `collections/${source.collectionId}/annotations/${name}.json`, '[]'],
      [source.descriptionFile, `collections/${source.collectionId}/descriptions/${name}.md`, ''],
    ]) {
      await assertNoLinks(path.join(safePath, original));
      const contents = await fs
        .readFile(path.join(safePath, original), 'utf8')
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return fallback;
          throw error;
        });
      await atomicWrite(path.join(safePath, destination), contents);
    }
    await copyFile(
      screenshotPath(safePath, source),
      path.join(safePath, 'collections', source.collectionId, 'screenshots', name),
    );
    const timestamp = nowIso();
    project.screenshots.push({
      ...source,
      id: `shot_${crypto.randomUUID()}`,
      originalFilename: `${source.originalFilename} copy`,
      storedFilename: name,
      title: `${source.title} copy`,
      position: nextScreenshotPosition(project, source.collectionId),
      createdAt: timestamp,
      updatedAt: timestamp,
      annotationFile: `collections/${source.collectionId}/annotations/${name}.json`,
      descriptionFile: `collections/${source.collectionId}/descriptions/${name}.md`,
    });
    project.updatedAt = timestamp;
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(project, null, 2));
    return makeSnapshot(safePath);
  });
  handle('screenshots:delete', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const result = await deleteScreenshotToTrash(
      safePath,
      project,
      input.screenshotId,
      async (target) => {
        await shell.trashItem(target);
        projectWatchManager?.recordSelfDelete(target);
      },
      screenshotTrashOperations,
    );
    const projectFile = path.join(safePath, 'project.json');
    projectWatchManager?.recordSelfWrite(projectFile, await fs.readFile(projectFile));
    const snapshot = withSnapshotWarnings(
      await makeSnapshot(safePath),
      result.warning ? [result.warning] : [],
    );
    return { snapshot, undoToken: result.undoToken };
  });
  handle('screenshots:undo-delete', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const before = await readProject(safePath);
    const undo = await undoScreenshotDelete(safePath, before, input.undoToken, screenshotTrashOperations);
    const restored = undo.project.screenshots.find(
      (candidate) => !before.screenshots.some((existing) => existing.id === candidate.id),
    );
    if (restored)
      for (const target of [
        screenshotPath(safePath, restored),
        path.join(safePath, restored.annotationFile),
        path.join(safePath, restored.descriptionFile),
      ])
        projectWatchManager?.recordSelfWrite(target, await fs.readFile(target));
    const projectFile = path.join(safePath, 'project.json');
    projectWatchManager?.recordSelfWrite(projectFile, await fs.readFile(projectFile));
    return withSnapshotWarnings(await makeSnapshot(safePath), undo.warning ? [undo.warning] : []);
  });
  handle('collections:edit', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const source = project.collections.find((collection) => collection.id === input.collectionId);
    if (input.action !== 'create' && !source) throw new Error('Collection not found.');
    const timestamp = nowIso();
    if (input.action === 'rename') {
      if (!input.name) throw new Error('Enter a collection name.');
      source!.name = input.name;
      source!.updatedAt = timestamp;
    } else if (input.action === 'archive') {
      source!.archived = true;
      source!.updatedAt = timestamp;
    } else if (input.action === 'restore') {
      source!.archived = false;
      source!.updatedAt = timestamp;
    } else {
      const number = project.collections.length + 1;
      const workspaceName = path.basename(workspaceOrThrow());
      const id = `${String(number).padStart(3, '0')}-collection-${crypto.randomUUID().slice(0, 8)}`;
      await ensureCollection(safePath, id);
      Object.assign(project, addEmptyCollection(project, workspaceName, id, timestamp));
    }
    project.updatedAt = timestamp;
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(validateProject(project), null, 2));
    return makeSnapshot(safePath);
  });
  handle('projects:duplicate', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const workspace = workspaceOrThrow();
    const source = await readProject(safePath);
    const target = await uniqueProjectFolder(workspace, `${source.name} copy`);
    await fs.cp(safePath, target, { recursive: true });
    const copy = await readProject(target);
    copy.id = `project_${crypto.randomUUID()}`;
    copy.name = `${source.name} copy`;
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    await atomicWrite(path.join(target, 'project.json'), JSON.stringify(copy, null, 2));
    return makeSnapshot(target);
  });
  handle('projects:archive', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const p = await readProject(safePath);
    p.status = 'archived';
    p.updatedAt = nowIso();
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(p, null, 2));
  });
  handle('projects:delete', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const answer = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Move to trash'],
      defaultId: 0,
      cancelId: 0,
      message: 'Delete this project?',
      detail: `All project files in ${safePath} will be moved to the system trash.`,
    });
    if (answer.response !== 1) throw new Error('Project deletion cancelled.');
    await shell.trashItem(safePath);
  });
  handle('exports:annotated-image', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    if (input.collectionId && !project.collections.some((item) => item.id === input.collectionId))
      throw new Error('Collection not found.');
    const folder = input.collectionId
      ? path.join(safePath, 'collections', input.collectionId, 'exports')
      : path.join(safePath, 'exports');
    const filename = sanitizeFilename(input.filename, 'annotated.png').replace(/\.png$/i, '') + '.png';
    const target = path.join(folder, filename);
    await atomicWrite(target, Buffer.from(input.dataUrl.split(',')[1], 'base64'));
    return target;
  });
  handle('exports:package', async (_event, input: ExportRequest) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    if (input.collectionId && !project.collections.some((item) => item.id === input.collectionId))
      throw new Error('Collection not found.');
    const exportDir = input.collectionId
      ? path.join(safePath, 'collections', input.collectionId, 'exports')
      : path.join(safePath, 'exports');
    await assertNoLinks(exportDir);
    await fs.mkdir(exportDir, { recursive: true });
    const included = project.screenshots.filter(
      (s) => s.includeInExport && (!input.collectionId || s.collectionId === input.collectionId),
    );
    const briefPath = path.join(exportDir, 'context.md');
    await atomicWrite(briefPath, input.markdown);
    const zip = new JSZip();
    zip.file('context.md', input.markdown);
    zip.file(
      'project.json',
      JSON.stringify(
        {
          ...project,
          screenshots: included,
          collections: input.collectionId
            ? project.collections.filter((collection) => collection.id === input.collectionId)
            : project.collections,
        },
        null,
        2,
      ),
    );
    for (const image of input.annotatedImages) {
      const buffer = Buffer.from(image.dataUrl.split(',')[1], 'base64');
      await atomicWrite(path.join(exportDir, image.filename), buffer);
      zip.file(image.filename, buffer);
    }
    if (input.includeOriginal) {
      for (const shot of included) {
        await assertNoLinks(screenshotPath(safePath, shot));
        const buffer = await fs.readFile(screenshotPath(safePath, shot));
        zip.file(`collections/${shot.collectionId}/screenshots/${shot.storedFilename}`, buffer);
      }
    }
    if (input.includeAnnotations)
      for (const shot of included) {
        await assertNoLinks(path.join(safePath, shot.annotationFile));
        const json = await fs.readFile(path.join(safePath, shot.annotationFile), 'utf8').catch(() => '[]');
        zip.file(shot.annotationFile, json);
      }
    for (const shot of included) zip.file(shot.descriptionFile, shot.description);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const zipPath = path.join(exportDir, `${sanitizeFilename(project.name, 'imnota-project')}-package.zip`);
    await atomicWrite(zipPath, zipBuffer);
    return { folderPath: exportDir, zipPath, count: input.annotatedImages.length };
  });
  handle('system:open-path', async (_event, target: string) => {
    pathInput.parse(target);
    if (!isWithin(workspaceOrThrow(), target)) throw new Error('Folder is outside the workspace.');
    await assertNoLinks(target);
    if (!(await fs.stat(target)).isDirectory()) throw new Error('Only workspace folders can be opened.');
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  handle('system:copy-text', async (_event, text: string) => {
    copyTextToClipboard(text);
  });
  handle('system:copy-image', async (_event, dataUrl: string) => {
    copyImageToClipboard(dataUrl);
  });
  handle('system:copy-context', async (_event, input) => {
    copyContextToClipboard(input.markdown, input.imageDataUrl);
  });
  handle('recovery:save', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    await atomicWrite(
      path.join(safePath, '.imnota-recovery.json'),
      JSON.stringify({ savedAt: nowIso(), project: input.project, annotations: input.annotations }, null, 2),
    );
  });
  handle('recovery:clear', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    await fs.unlink(path.join(safePath, '.imnota-recovery.json')).catch(() => undefined);
  });
  // Long network operations run outside the filesystem IPC queue.
  handle('update:download', () => updateController.download());
  handle('update:check', () => updateController.check());
  handle('update:status', () => updateController.getStatus());
  handle('update:install', async () => {
    if (updateInstallPending) throw new Error('An update installation is already starting.');
    updateInstallPending = true;
    try {
      // Close admission before draining all file work accepted before restart.
      await pending;
      await updateController.install();
    } catch (error) {
      updateInstallPending = false;
      throw error;
    }
  });
}

let updateInstallPending = false;
function configureAutoUpdates(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  updateController = new UpdateController(settings.updateChannel, {
    currentVersion: app.getVersion(),
    enabled: app.isPackaged && process.env.IMNOTA_SMOKE !== '1',
    manual:
      process.platform === 'darwin' ||
      Boolean(process.env.PORTABLE_EXECUTABLE_FILE) ||
      (process.platform === 'linux' && !process.env.APPIMAGE),
    discover: (channel) => discoverRelease(channel, process.platform),
    prepare: (release, channel) => prepareNativeUpdate(autoUpdater, release, channel),
    prepareTerminal:
      process.platform === 'darwin'
        ? (release) =>
            prepareTerminalUpdate(
              release,
              path.resolve(app.getPath('exe'), '../../..'),
              path.join(app.getAppPath(), 'scripts/update-macos.sh'),
              app.getPath('temp'),
              app.getVersion(),
            )
        : undefined,
    download: () => autoUpdater.downloadUpdate(),
    install: () => autoUpdater.quitAndInstall(),
    open: (url) => shell.openExternal(url),
    emit: (status) => {
      if (status.state === 'downloaded' && status.installing === false) updateInstallPending = false;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send('update:status', status);
    },
  });
  autoUpdater.on('download-progress', (progress) => updateController.progress(progress.percent));
  // Check/download promises own their errors; installation also reports asynchronous native failures.
  autoUpdater.on('error', () => updateController.installationFailed());
  if (app.isPackaged && process.env.IMNOTA_SMOKE !== '1')
    setTimeout(() => void updateController.check(), 8000);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    show: process.env.IMNOTA_SMOKE !== '1',
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: process.env.IMNOTA_SMOKE !== '1',
      webSecurity: true,
    },
  });
  const createdWindow = mainWindow;
  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) mainWindow = null;
  });
  createdWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  createdWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  try {
    if (devUrl) await createdWindow.loadURL(devUrl);
    else await createdWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  } catch (error) {
    if (!createdWindow.isDestroyed()) throw error;
  }
}

app.whenReady().then(async () => {
  const stored =
    process.env.IMNOTA_SMOKE === '1' ? null : await fs.readFile(settingsFile(), 'utf8').catch(() => null);
  const settingsFileExists = stored !== null;
  if (stored)
    try {
      const persisted = JSON.parse(stored) as Record<string, unknown>;
      preferenceSettingsResult = resolvePreferenceSettings(persisted, true);
      const applicationSettings = { ...persisted };
      delete applicationSettings.preferences;
      delete applicationSettings.preferenceProfile;
      delete applicationSettings.theme;
      settings = {
        ...settings,
        ...applicationSettings,
        theme: preferenceSettingsResult.settings.appearance.mode,
      } as WorkspaceSettings;
      settings.updateChannel = settings.updateChannel === 'nightly' ? 'nightly' : 'stable';
    } catch {
      preferenceSettingsResult = resolvePreferenceSettings({}, settingsFileExists);
      /* Keep in-memory safe defaults; do not overwrite corrupt preferences before user action. */
    }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173; font-src 'self' data:;",
        ],
      },
    });
  });
  configureAutoUpdates();
  registerIpc();
  await createWindow();
  if (process.env.IMNOTA_SMOKE === '1') {
    const fixture = await fs.realpath(await fs.mkdtemp(path.join(app.getPath('temp'), 'imnota-smoke-')));
    try {
      if (process.env.IMNOTA_EXPECT_VERSION && app.getVersion() !== process.env.IMNOTA_EXPECT_VERSION)
        throw new Error('Packaged application version does not match the release candidate.');
      settings.workspacePath = fixture;
      const source = path.join(fixture, 'fixture.png');
      await fs.writeFile(
        source,
        nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG(),
      );
      const result = await mainWindow!.webContents.executeJavaScript(`(async () => {
        if (!window.imnota) throw new Error('Preload bridge is missing');
        const api = window.imnota;
        await api.checkForUpdates();
        const update = await api.getUpdateStatus();
        if (!update.currentVersion || update.state !== 'idle') throw new Error('Manual update check/status bridge failed');
        const snapshot = await api.createProject({ name: 'Smoke', description: '' });
        const imported = await api.importImageFiles({ projectPath: snapshot.projectPath, paths: [${JSON.stringify(source)}] });
        const shot = imported.project.screenshots[0];
        const content = await api.loadScreenshotContent({ projectPath: snapshot.projectPath, screenshot: shot });
        shot.description = 'Persist this description';
        content.annotations = [{ id: 'test', kind: 'rectangle', x: 0, y: 0, width: 1, height: 1, zIndex: 0 }];
        await api.saveScreenshotContent({ projectPath: snapshot.projectPath, screenshot: shot, annotations: content.annotations, contentRevision: content.contentRevision });
        const duplicate = await api.duplicateScreenshot({ projectPath: snapshot.projectPath, screenshot: shot });
        const copied = await api.loadScreenshotContent({ projectPath: snapshot.projectPath, screenshot: duplicate.project.screenshots[1] });
        if (duplicate.project.screenshots[1].description !== 'Persist this description' || copied.annotations.length !== 1) throw new Error('Duplication lost data');
        const secondCopy = await api.duplicateScreenshot({ projectPath: snapshot.projectPath, screenshot: shot });
        if (new Set(secondCopy.project.screenshots.map(s => s.storedFilename)).size !== 3) throw new Error('Duplicate filename collision');
        const collectionCopy = await api.editCollection({ projectPath: snapshot.projectPath, action: 'create', collectionId: shot.collectionId });
        const collectionId = collectionCopy.project.collections.at(-1).id;
        if (!collectionCopy.project.collections[0].archived || collectionCopy.project.screenshots.some(s => s.collectionId === collectionId)) throw new Error('New collection was not empty or previous collection was not archived');
        const renamed = await api.editCollection({ projectPath: snapshot.projectPath, action: 'rename', collectionId, name: 'Revision feedback' });
        if (renamed.project.collections.at(-1).name !== 'Revision feedback') throw new Error('Collection rename failed');
        const archived = await api.editCollection({ projectPath: snapshot.projectPath, action: 'archive', collectionId });
        if (!archived.project.collections.at(-1).archived) throw new Error('Collection archive failed');
        const restored = await api.editCollection({ projectPath: snapshot.projectPath, action: 'restore', collectionId });
        if (restored.project.collections.at(-1).archived) throw new Error('Collection restore failed');
        await api.copyImage(content.image.dataUrl);
        await api.exportPackage({ projectPath: snapshot.projectPath, markdown: '# Smoke', annotatedImages: [{ filename: 'reference.png', dataUrl: content.image.dataUrl }], includeOriginal: true, includeAnnotations: true });
        let blocked = false;
        try { await api.setSettings({ workspacePath: '/escape' }); } catch { blocked = true; }
        if (!blocked) throw new Error('Settings IPC permitted workspace escape');
        blocked = false;
        try { await api.exportPackage({ projectPath: snapshot.projectPath, markdown: '', annotatedImages: [{ filename: '../escape.png', dataUrl: content.image.dataUrl }], includeOriginal: false, includeAnnotations: false }); } catch { blocked = true; }
        if (!blocked) throw new Error('Export permitted traversal');
        return Boolean(document.getElementById('root')?.childElementCount);
      })()`);
      if (!result) throw new Error('React did not mount');
      if (clipboard.readImage().isEmpty()) throw new Error('Image clipboard is empty');
      const archive = await JSZip.loadAsync(
        await fs.readFile(path.join(fixture, 'smoke', 'exports', 'Smoke-package.zip')),
      );
      if (!archive.file('context.md') || !archive.file('reference.png'))
        throw new Error('ZIP entries missing');
      const savedProject = await readProject(path.join(fixture, 'smoke'));
      const recoveredProject = structuredClone(savedProject);
      recoveredProject.screenshots[0].description = 'Recovered after interruption';
      await atomicWrite(
        path.join(fixture, 'smoke', '.imnota-recovery.json'),
        JSON.stringify({
          project: recoveredProject,
          annotations: {},
        }),
      );
      const originalDialog = dialog.showMessageBox;
      try {
        dialog.showMessageBox = (async () => ({
          response: 0,
          checkboxChecked: false,
        })) as typeof dialog.showMessageBox;
        await openWithRecovery(path.join(fixture, 'smoke'));
      } finally {
        dialog.showMessageBox = originalDialog;
      }
      const recovered = await fs.readFile(
        path.join(fixture, 'smoke', savedProject.screenshots[0].descriptionFile),
        'utf8',
      );
      if (
        !recovered.includes('Recovered after interruption') ||
        existsSync(path.join(fixture, 'smoke', '.imnota-recovery.json'))
      )
        throw new Error('Recovery did not restore description and clear the journal');
      const largeSource = path.join(fixture, 'large.png');
      await fs.writeFile(
        largeSource,
        nativeImage
          .createFromBitmap(Buffer.alloc(1920 * 1080 * 4, 255), { width: 1920, height: 1080 })
          .toPNG(),
      );
      const metrics = await mainWindow!.webContents.executeJavaScript(`(async () => {
        const api = window.imnota;
        const project = await api.createProject({ name: 'Performance', description: '' });
        const started = performance.now();
        for (let i = 0; i < 2; i++) await api.importImageFiles({ projectPath: project.projectPath, paths: Array(50).fill(${JSON.stringify(largeSource)}) });
        const importedMs = performance.now() - started;
        const before = performance.now();
        const reopened = await api.loadProject(project.projectPath);
        if (reopened.project.screenshots.length !== 100 || Object.keys(reopened.thumbnails).length !== 100) throw new Error('100-image project lost screenshots or thumbnails');
        reopened.project.screenshots.forEach((shot, index) => { shot.includeInExport = index < 2; });
        await api.saveProject(project.projectPath, reopened.project);
        return { syntheticImages: 100, dimensions: '1920x1080', importMs: Math.round(importedMs), warmReopenMs: Math.round(performance.now() - before) };
      })()`);
      console.log('Synthetic project benchmark:', JSON.stringify(metrics));
      // Reopen through the real React boot flow, draw a crop, then use the PNG action.
      const previousWindow = mainWindow!;
      await createWindow();
      previousWindow.destroy();
      await mainWindow!.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        let tries = 0;
        const check = () => {
          if (document.querySelector('.konvajs-content canvas') && document.querySelector('.canvas-meta')?.textContent.includes('1920 × 1080')) return resolve(true);
          if (++tries > 200) return reject(new Error('Annotation workspace did not render'));
          setTimeout(check, 50);
        }; check();
      })`);
      const canvasBounds = await mainWindow!.webContents.executeJavaScript(`(() => {
        document.querySelector('[aria-label="Crop exported image (original preserved)"]').click();
        const wrap = document.querySelector('.canvas-wrap');
        const bounds = document.querySelector('.konvajs-content').getBoundingClientRect();
        return { x: bounds.x + Number(wrap.dataset.imageX), y: bounds.y + Number(wrap.dataset.imageY), width: 1920 * Number(wrap.dataset.imageScale), height: 1080 * Number(wrap.dataset.imageScale) };
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const startPoint = {
        x: canvasBounds.x + Math.round(canvasBounds.width * 0.2),
        y: canvasBounds.y + Math.round(canvasBounds.height * 0.2),
      };
      const endPoint = {
        x: canvasBounds.x + Math.round(canvasBounds.width * 0.7),
        y: canvasBounds.y + Math.round(canvasBounds.height * 0.7),
      };
      const dispatchPointer = (type: string, point: { x: number; y: number }) =>
        mainWindow!.webContents.executeJavaScript(
          `document.querySelector('.konvajs-content').dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, clientX: ${point.x}, clientY: ${point.y}, button: 0, buttons: 1 }))`,
        );
      await dispatchPointer('mousedown', startPoint);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await dispatchPointer('mousemove', endPoint);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await dispatchPointer('mouseup', endPoint);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await mainWindow!.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Export selected screenshot as PNG"]').click()`,
      );
      const performanceProject = await readProject(path.join(fixture, 'performance'));
      const exportedPng = path.join(
        fixture,
        'performance',
        'collections',
        performanceProject.screenshots[0].collectionId,
        'exports',
        performanceProject.screenshots[0].storedFilename.replace(/\.[^.]+$/, '') + '-annotated.png',
      );
      for (let attempt = 0; attempt < 400 && !existsSync(exportedPng); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      const pngSize = nativeImage.createFromPath(exportedPng).getSize();
      if (pngSize.width < 900 || pngSize.width > 1020 || pngSize.height < 500 || pngSize.height > 580)
        throw new Error(`Cropped PNG dimensions are wrong: ${JSON.stringify(pngSize)}`);
      console.log(
        'Renderer smoke passed: reopened workspace, crop drawing and cropped PNG export.',
        JSON.stringify(pngSize),
      );
      mainWindow!.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await mainWindow!.webContents.executeJavaScript(`(async () => {
        const delay = () => new Promise(resolve => setTimeout(resolve, 250));
        const canvas = () => document.querySelector('.canvas-wrap').getBoundingClientRect();
        const before = canvas().width;
        if (canvas().height > window.innerHeight || canvas().bottom > window.innerHeight + 1) throw new Error('Screenshot list stretched the canvas beyond the window');
        document.querySelector('[aria-label="Collapse screenshot list"]').click();
        await delay();
        if (canvas().width <= before + 100) throw new Error('Collapsing screenshot list did not expand canvas');
        const afterRail = canvas().width;
        document.querySelector('[aria-label="Toggle inspector"]').click();
        await delay();
        if (canvas().width <= afterRail + 100) throw new Error('Collapsing inspector did not expand canvas');
        const afterInspector = canvas().width;
        if (!document.querySelector('.sidebar [aria-label="Check for app updates"]') || !document.querySelector('.sidebar [aria-label="Hide navigation"]')) throw new Error('Navigation controls must be inside sidebar');
        document.querySelector('.sidebar [aria-label="Hide navigation"]').focus();
        document.querySelector('[aria-label="Hide navigation"]').click();
        await delay();
        if (canvas().width <= afterInspector + 100) throw new Error('Collapsing navigation did not expand canvas');
        if (document.activeElement?.getAttribute('aria-label') !== 'Show navigation') throw new Error('Collapse control lost keyboard focus');
        if (!document.querySelector('.sidebar-collapsed [aria-label="Check for app updates"]')) throw new Error('Refresh must remain accessible when sidebar collapsed');
        document.querySelector('.sidebar-collapsed [aria-label="Check for app updates"]').click();
        await delay();
        if ((await window.imnota.getUpdateStatus()).state !== 'idle') throw new Error('Sidebar refresh failed in offline smoke mode');
        document.querySelector('[aria-label="Show navigation"]').click();
        document.querySelector('[aria-label="Toggle inspector"]').click();
        document.querySelector('[aria-label="Expand screenshot list"]').click();
        await delay();
        const wrap = document.querySelector('.canvas-wrap');
        const problemField = document.querySelector('.inspector textarea');
        if (!problemField || document.querySelectorAll('.inspector textarea').length !== 1) throw new Error('Inspector must have one problem description editor');
        if (!document.querySelector('[aria-label="Collection"]')) throw new Error('Collection selector missing');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(problemField, 'A single clear problem description');
        problemField.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 900));
        const target = document.querySelector('.konvajs-content');
        const originX = Number(wrap.dataset.imageX);
        target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 40, deltaY: 20 }));
        await delay();
        if (Number(wrap.dataset.imageX) !== originX - 40) throw new Error('Trackpad panning failed');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
        await delay();
        // CI desktops can fit this large image below 10%, making text hit targets subpixel-sized.
        // Exercise editing at actual size, centred in the visible canvas on every platform.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
        await delay();
        document.querySelector('[aria-label="Text"]').click();
        await delay();
        const b = target.getBoundingClientRect();
        const scale = Number(wrap.dataset.imageScale);
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        const pointer = (type, px = x, py = y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0, buttons: 1 }));
        pointer('mousedown'); await delay(); pointer('mouseup'); await delay();
        const editor = document.querySelector('[aria-label="Edit annotation text"]');
        if (!editor) throw new Error('New text did not open the inline editor');
        const setText = (input, text) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); };
        setText(editor, 'Saved inline feedback'); await delay();
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await delay();
        const doubleClick = async () => {
          await new Promise(resolve => setTimeout(resolve, 550));
          for (let i = 0; i < 2; i++) { pointer('mousedown', x + 24 * scale, y + 16 * scale); pointer('mouseup', x + 24 * scale, y + 16 * scale); await delay(); }
        };
        await doubleClick();
        const reopened = document.querySelector('[aria-label="Edit annotation text"]');
        if (!reopened || reopened.value !== 'Saved inline feedback') throw new Error('Double-click text editing failed: ' + JSON.stringify({ editor: reopened?.value, fields: [...document.querySelectorAll('textarea')].map(e => e.value), x, y, scale }));
        setText(reopened, 'Cancelled text'); await delay();
        reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await delay();
        await doubleClick();
        const cancelled = document.querySelector('[aria-label="Edit annotation text"]');
        if (!cancelled || cancelled.value !== 'Saved inline feedback') throw new Error('Escape did not cancel text editing');
        cancelled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 850));
      })()`);
      console.log(
        'Feedback smoke passed: independent round duplication, rename/archive/restore, image clipboard, three panel toggles, bounded canvas, trackpad pan and inline text confirm/cancel.',
      );
      const textProject = await readProject(path.join(fixture, 'performance'));
      const persistedDescription = await fs.readFile(
        path.join(fixture, 'performance', textProject.screenshots[0].descriptionFile),
        'utf8',
      );
      if (persistedDescription !== 'A single clear problem description')
        throw new Error('Description was not persisted');
      const savedAnnotations = JSON.parse(
        await fs.readFile(
          path.join(fixture, 'performance', textProject.screenshots[0].annotationFile),
          'utf8',
        ),
      );
      if (!savedAnnotations.some((a: { text?: string }) => a.text === 'Saved inline feedback'))
        throw new Error('Inline text was not persisted');
      // Add an opaque redaction to the second synthetic reference, then verify
      // its actual pixels in the composed clipboard output below.
      await mainWindow!.webContents.executeJavaScript(`(async () => {
        const screenshot = ${JSON.stringify(textProject.screenshots[1])};
        const projectPath = ${JSON.stringify(path.join(fixture, 'performance'))};
        const content = await window.imnota.loadScreenshotContent({ projectPath, screenshot });
        content.annotations.push({ id: 'clipboard-mask', kind: 'blur', x: 20, y: 20, width: 80, height: 80, opacity: 0.1, zIndex: 100 });
        await window.imnota.saveScreenshotContent({ projectPath, screenshot, annotations: content.annotations, contentRevision: content.contentRevision });
      })()`);
      // Exercise the same context action from the builder, then the experimental
      // combined-copy button. Only the two included references should be copied.
      await mainWindow!.webContents.executeJavaScript(`(async () => {
        const wait = async (find) => {
          for (let i = 0; i < 200; i++) { const found = find(); if (found) return found; await new Promise(resolve => setTimeout(resolve, 50)); }
          throw new Error('Sharing UI timed out');
        };
        [...document.querySelectorAll('.topbar button')].find(b => b.textContent.trim() === 'Context Builder').click();
        const copy = await wait(() => [...document.querySelectorAll('.context-builder button')].find(b => b.textContent.trim() === 'Copy AI context'));
        copy.click();
        const combined = await wait(() => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes('Copy text + image')));
        if (document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length !== 2) throw new Error('Excluded screenshots entered sharing package');
        combined.click();
        await wait(() => [...document.querySelectorAll('[role="dialog"] [role="status"]')].find(e => e.textContent.includes('Text and image are on the clipboard')));
      })()`);
      const contextClipboard = clipboard.readText();
      const sheet = clipboard.readImage();
      if (
        !contextClipboard.includes('A single clear problem description') ||
        sheet.isEmpty() ||
        !clipboard.readHTML().includes('<pre>')
      )
        throw new Error('Combined clipboard lost text, HTML or image');
      if (sheet.getSize().width !== 1952 || sheet.getSize().height !== pngSize.height + 1080 + 128)
        throw new Error(
          'Contact sheet changed native resolution or selection: ' + JSON.stringify(sheet.getSize()),
        );
      const sheetPng = sheet.toPNG();
      const maskPixel = sheet
        .crop({ x: 16 + 60, y: pngSize.height + 112 + 60, width: 1, height: 1 })
        .toBitmap();
      // nativeImage bitmap channels are BGRA on the supported desktop hosts.
      if (!maskPixel.equals(Buffer.from([18, 13, 11, 255])))
        throw new Error('Combined clipboard did not preserve opaque redaction');
      await mainWindow!.webContents.executeJavaScript(`(async () => {
        try { await window.imnota.copyContext({ markdown: 'must not replace', imageDataUrl: 'data:image/png;base64,aGVsbG8=' }); throw new Error('Invalid PNG accepted'); }
        catch (error) { if (error.message === 'Invalid PNG accepted') throw error; }
      })()`);
      if (clipboard.readText() !== contextClipboard || !clipboard.readImage().toPNG().equals(sheetPng))
        throw new Error('Failed combined copy changed clipboard');
      console.log(
        'Combined clipboard smoke passed: builder action, two full-resolution annotated references, exclusions, crop, opaque redaction, text + HTML + PNG and unchanged clipboard on invalid input.',
      );
      await mainWindow!.webContents.executeJavaScript(`(async () => {
        const wait = async (find) => { for (let i=0;i<200;i++) { const value=find(); if(value) return value; await new Promise(resolve=>setTimeout(resolve,25)); } throw new Error('Channel UI timed out'); };
        document.querySelector('[role="dialog"] [aria-label="Close"]').click();
        await wait(()=>!document.querySelector('[role="dialog"]'));
        [...document.querySelectorAll('.sidebar button')].find(b=>b.textContent.trim()==='Settings').click();
        const select = await wait(()=>[...document.querySelectorAll('.settings-section select')].find(s=>[...s.options].some(o=>o.value==='nightly')));
        if(select.value!=='stable') throw new Error('Old settings did not default to stable');
        select.value='nightly'; select.dispatchEvent(new Event('change',{bubbles:true}));
        const cancel=await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==='Keep Stable'));
        if((await window.imnota.getSettings()).updateChannel!=='stable') throw new Error('Channel changed before confirmation');
        cancel.click();
        select.value='nightly'; select.dispatchEvent(new Event('change',{bubbles:true}));
        const confirm=await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==='Use Nightly')); confirm.click();
        await wait(()=>select.value==='nightly'&&!select.disabled&&!document.querySelector('[role="dialog"]'));
        if((await window.imnota.getSettings()).updateChannel!=='nightly') throw new Error('Nightly setting not persisted');
        await window.imnota.checkForUpdates();
        if((await window.imnota.getUpdateStatus()).channel!=='nightly') throw new Error('Refresh checked the wrong channel');
        try { await window.imnota.setSettings({updateChannel:'invalid'}); throw new Error('Invalid channel accepted'); } catch(error) { if(error.message==='Invalid channel accepted') throw error; }
      })()`);
      if (JSON.parse(await fs.readFile(settingsFile(), 'utf8')).updateChannel !== 'nightly')
        throw new Error('Nightly channel was not saved on disk');
      console.log(
        'Channel smoke passed: default stable, nightly confirm/cancel, persisted settings, selected-channel refresh and IPC enum rejection.',
      );
      if (process.env.IMNOTA_SMOKE_SCREENSHOT) {
        mainWindow!.showInactive();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fs.writeFile(
          process.env.IMNOTA_SMOKE_SCREENSHOT,
          (await mainWindow!.webContents.capturePage()).toPNG(),
        );
      }
      console.log(
        'Electron smoke passed: startup, IPC, create/import/save/reload/duplicate, recovery, 100-image project, ZIP export and traversal rejection.',
      );
      if (process.env.IMNOTA_SMOKE_RESULT)
        await fs.writeFile(
          process.env.IMNOTA_SMOKE_RESULT,
          JSON.stringify({ passed: true, version: app.getVersion() }),
        );
      await fs.rm(fixture, { recursive: true, force: true });
      app.exit(0);
    } catch (error) {
      console.error(error);
      if (process.env.IMNOTA_SMOKE_RESULT)
        await fs.writeFile(
          process.env.IMNOTA_SMOKE_RESULT,
          JSON.stringify({ passed: false, version: app.getVersion(), error: String(error) }),
        );
      console.error(
        'Renderer state:',
        await mainWindow!.webContents.executeJavaScript(
          `JSON.stringify({ error: document.querySelector('.error-banner')?.textContent, toast: document.querySelector('[role="status"]')?.textContent, canvas: document.querySelector('.canvas-meta')?.textContent, title: document.querySelector('.topbar')?.textContent })`,
        ),
      );
      if (process.env.IMNOTA_SMOKE_SCREENSHOT)
        await fs.writeFile(
          process.env.IMNOTA_SMOKE_SCREENSHOT,
          (await mainWindow!.webContents.capturePage()).toPNG(),
        );
      await fs.rm(fixture, { recursive: true, force: true });
      app.exit(1);
    }
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => projectWatchManager?.stopAll());
