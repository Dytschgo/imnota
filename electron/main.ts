import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  shell,
  session,
  screen,
  Tray,
} from 'electron';
import { nativeClipboard } from './native-clipboard.js';
import { PersistenceDiagnostics, tracesPersistenceChannel } from './persistence-diagnostics.js';
import { inspectProjectFiles } from './project-integrity.js';
import { captureTrayTemplate } from './app-tray.js';
import {
  onboardingHandoffRoot,
  OnboardingHandoffWorkflow,
  promptHandoffRoot,
  TemporaryFileHandoffStore,
} from './onboarding-handoff.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import updater from 'electron-updater';
const { autoUpdater } = updater;
import type {
  ImagePayload,
  ProjectData,
  ProjectSnapshot,
  ScreenshotRecord,
  WorkspaceSettings,
} from '../src/shared/types.js';
import type { AppearanceMode, PreferenceSettingsResult } from '../src/shared/preferences.js';
import { preferenceSettingsEnvelope, resolvePreferenceSettings } from '../src/shared/preference-settings.js';
import type {
  ClipboardFormatsReport,
  ProjectWatchEvent,
  WindowsCopyVariantId,
} from '../src/shared/workflow-bridge.js';
import { DEFAULT_EXPORT_PREFERENCES, nowIso, sanitizeFilename, slugify } from '../src/shared/utils.js';
import { validateProject, parseProjectFile, annotationSchema, notesSchema } from '../src/shared/schema.js';
import { assertNoLinks, atomicWrite as writeAtomically, isWithin } from './files.js';
import { ThumbnailCache, thumbnailSize } from './thumbnail-cache.js';
import { ensureCollection, migrateProjectWithBackup, screenshotPath } from './collections.js';
import { recoverScreenshotTrashTransactions, type ScreenshotTrashOperations } from './screenshot-trash.js';
import {
  discardScreenshotTransaction,
  recoverScreenshotTransactions,
  replayScreenshotTransaction,
  screenshotTransactionBaseline,
  type ScreenshotTransactionKind,
  type ScreenshotTransactionOperations,
  type ScreenshotTransactionWrite,
} from './screenshot-transactions.js';
import {
  commitScreenshotFileTransaction,
  nextProjectMutationTimestamp,
  prepareRecoveryRestoreTransaction,
} from './screenshot-transaction-adapter.js';
import { normalizeRecoveredProject } from './recovery.js';
import { clipboardContextHtml, clipboardPngDimensions } from '../src/shared/clipboard-context.js';
import { UpdateController } from './update-controller.js';
import { discoverRelease } from './releases.js';
import { prepareNativeUpdate } from './native-update.js';
import { prepareTerminalUpdate } from './terminal-update.js';
import { PromptBundleWorkflow } from './prompt-bundle-workflow.js';
import { HostedShareClient } from './hosted-share-client.js';
import { PromptBundleStore, type PromptBundleManifestItem } from './prompt-bundle-store.js';
import { type OcrCropRect } from './windows-ocr.js';
import { ProjectWatchManager, projectRevisionForSource } from './project-watch.js';
import { workflowOutcome } from './workflow-errors.js';
import { IpcRouter } from './ipc-router.js';
import { registerCaptureIpc } from './ipc-capture.js';
import { registerProjectWatchIpc } from './ipc-project-watch.js';
import { registerHostedShareIpc } from './ipc-hosted-share.js';
import { registerPromptExportIpc } from './ipc-prompt-export.js';
import { registerPreferenceIpc } from './ipc-preferences.js';
import { registerSystemIpc } from './ipc-system.js';
import { registerContentIpc } from './ipc-content.js';
import { registerScreenshotIpc } from './ipc-screenshots.js';
import { registerProjectIpc } from './ipc-projects.js';
import { registerSettingsIpc } from './ipc-settings.js';
import { contracts, pathInput } from './ipc-contracts.js';
import { ContentPersistenceService } from './content-persistence.js';
import { contentItemRelativePaths } from './content-paths.js';
import { WorkspaceContentSearch } from './content-search.js';
import { LocalMcpServer } from './mcp-server.js';
import { assertProjectPath as authorizeProjectPath } from './project-path.js';
import { preserveMixedProjectMetadata } from './content-project-metadata.js';
import { recoverContentTrashTransactions, type ContentTrashOperations } from './content-trash.js';
import { ProjectSearchService } from './project-search.js';
import { BackupService } from './backup-service.js';
import { CaptureService, CaptureServiceError, type CapturedDisplayImage } from './capture-service.js';
import type { CaptureDisplay, CaptureOverlayMode, CaptureRectangle } from '../src/shared/capture.js';
import { CAPTURE_OVERLAY_MODES, MAX_CAPTURE_DIMENSION, MAX_CAPTURE_PIXELS } from '../src/shared/capture.js';
import { LastCaptureRegionMemory, lastCaptureRegionForDisplay } from './last-capture-region.js';
import { identifiableCaptureWindows, type CaptureWindowCandidate } from './capture-windows.js';
import { tryListWindowsCaptureWindows } from './windows-capture-windows.js';
import { NativeWorkflowError } from './workflow-errors.js';
import {
  CaptureOverlaySession,
  CaptureSelectionCoordinator,
  capturePointerGlobalPoint,
  closeCaptureOverlayWindows,
  createOverlayReadinessGuard,
  isCaptureOverlaySender,
  type CaptureOverlayFailure,
  type CaptureOverlayOutcome,
} from './capture-overlay-session.js';
import { CaptureDelaySession } from './capture-delay.js';
import {
  captureDelayHudWindowOptions,
  captureOverlayFreezeAppearance,
  captureOverlayWindowOptions,
  overlayCoversDisplay,
} from './capture-overlay-placement.js';
import {
  captureDisplayMetricsInvalidateSelection,
  captureDisplaysHaveStableGeometry,
  captureDisplayWithStableGeometry,
} from './capture-display-selection.js';
import { probeCaptureDisplays } from './capture-capability.js';
import { CaptureAdmissionGate, type CaptureAdmission } from './capture-admission.js';
import { CaptureGlobalShortcut, resolveCaptureGlobalShortcut } from './capture-global-shortcut.js';
import { onSuccessfulQuit, teardownTrayAfterSuccessfulQuit } from './tray-quit-lifecycle.js';
import { CaptureRequestQueue, type CaptureRequest } from './capture-request-queue.js';
import { assertCaptureCommitAdmission, readWithCaptureAdmission } from './capture-commit-guard.js';
import { syntheticCaptureColor } from './capture-smoke-contract.js';
import type { IpcMainInvokeEvent } from 'electron';

// Smoke never reads or writes the installed application's profile or caches.
if (process.env.IMNOTA_SMOKE === '1') {
  const profile = process.env.IMNOTA_SMOKE_USER_DATA;
  if (!profile || !path.isAbsolute(profile) || !existsSync(profile))
    throw new Error('Run smoke tests through scripts/smoke.mjs with an isolated profile.');
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  nativeTheme.themeSource = 'light';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
// Main-process-only, one-use approval for the disposable native smoke fixture.
let smokeBackupRestorePath: string | null = null;
let smokeProjectDeletionPath: string | null = null;
let updateController: UpdateController;
let projectWatchManager: ProjectWatchManager | undefined;
const contentSearch = new WorkspaceContentSearch();
let promptBundleWorkflow: PromptBundleWorkflow | undefined;
let onboardingHandoffWorkflow: OnboardingHandoffWorkflow | undefined;
let hostedShareClient: HostedShareClient | undefined;
let projectSearchService: ProjectSearchService | undefined;
let backupService: BackupService | undefined;
let contentPersistence: ContentPersistenceService;
let localMcpServer: LocalMcpServer | undefined;
let settings: WorkspaceSettings = {
  workspacePath: null,
  interfaceScale: 1,
  openRecentOnLaunch: true,
  confirmBeforeDeletion: true,
  updateChannel: 'stable',
  sharingSenderName: '',
};
let preferenceSettingsResult: PreferenceSettingsResult = resolvePreferenceSettings(undefined, false);
let captureOverlay: {
  overlays: Array<{
    window: BrowserWindow;
    capture: CapturedDisplayImage;
    ready: boolean;
  }>;
  session: CaptureOverlaySession;
  selection: CaptureSelectionCoordinator;
  readiness: ReturnType<typeof createOverlayReadinessGuard>;
  displays: CaptureDisplay[];
  overlayCommit: 'save' | 'annotate';
  disposeDisplayListeners: () => void;
} | null = null;
let captureDelaySession: CaptureDelaySession | null = null;
let captureDelayHud: BrowserWindow | null = null;
const captureAdmissionGate = new CaptureAdmissionGate();
const lastCaptureRegionMemory = new LastCaptureRegionMemory();
const captureGlobalShortcut = new CaptureGlobalShortcut({
  register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
  unregister: (accelerator) => globalShortcut.unregister(accelerator),
});
const captureRequests = new CaptureRequestQueue();
let pendingCapturePng: Buffer | null = null;
let appTray: Tray | null = null;
let lastOverlayCommit: 'save' | 'annotate' = 'save';
const CAPTURE_OVERLAY_READY_TIMEOUT_MS = 15_000;

function syncCaptureGlobalShortcut(): void {
  captureGlobalShortcut.sync(
    resolveCaptureGlobalShortcut({
      bindings: preferenceSettingsResult.settings.shortcuts.bindings,
      processPlatform: process.platform,
      experimentalEnabled: preferenceSettingsResult.settings.capture.experimentalRegionCapture,
    }),
    () => {
      if (captureAdmissionGate.isOccupied()) return;
      requestCapture({ source: 'hotkey' });
    },
  );
}

function raiseMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function trayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(__dirname, '../../build/icon.png'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return nativeImage.createFromPath(candidate);
  }
  return nativeImage.createEmpty();
}

function sendCaptureRequest(request: CaptureRequest): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  if (request.source === 'hotkey') mainWindow.webContents.send('workflow:capture:region-hotkey');
  else mainWindow.webContents.send('workflow:capture:tray', { mode: request.mode });
}

function requestCapture(request: CaptureRequest): void {
  const pending = captureRequests.request(request);
  if (pending) {
    sendCaptureRequest(pending);
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed())
    void createWindow()
      .then(() => syncCaptureGlobalShortcut())
      .catch(console.error);
}

function createAppTray(): void {
  if (appTray) return;
  const image = trayIcon();
  if (image.isEmpty()) return;
  appTray = new Tray(image);
  appTray.setToolTip('Imnota');
  appTray.setContextMenu(
    Menu.buildFromTemplate(
      captureTrayTemplate({
        windowCapture: process.platform === 'win32',
        onCapture: (mode) => requestCapture({ source: 'tray', mode }),
        onOpen: () => {
          if (!mainWindow || mainWindow.isDestroyed())
            void createWindow().then(() => syncCaptureGlobalShortcut());
          else raiseMainWindow();
        },
        onQuit: () => app.quit(),
      }),
    ),
  );
}

function assertLiveCaptureAdmission(event: IpcMainInvokeEvent, admission: CaptureAdmission): void {
  if (
    !captureAdmissionGate.isActive(admission) ||
    event.sender.isDestroyed() ||
    mainWindow?.isDestroyed() ||
    mainWindow?.webContents !== event.sender
  )
    throw new NativeWorkflowError('capture-cancelled', 'Screen capture cancelled.');
}

function resolvedWindowBackground(
  mode: AppearanceMode,
  systemDark = nativeTheme.shouldUseDarkColors,
): string {
  const theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  return theme === 'light' ? '#eceef2' : '#0b0d12';
}

async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  await diagnostics.filesystem('write', filePath, async () => {
    await writeAtomically(filePath, content);
    projectWatchManager?.recordSelfWrite(filePath, content);
  });
  projectSearchService?.invalidateForPath(filePath);
  contentSearch.invalidatePath(filePath);
}

async function copyFile(filePath: string, targetPath: string): Promise<void> {
  await diagnostics.filesystem('copy', targetPath, async () => {
    await fs.copyFile(filePath, targetPath);
    projectWatchManager?.recordSelfWrite(targetPath, await fs.readFile(targetPath));
  });
  projectSearchService?.invalidateForPath(targetPath);
  contentSearch.invalidatePath(targetPath);
}

async function unlinkTracked(filePath: string): Promise<void> {
  await diagnostics.filesystem('unlink', filePath, async () => {
    await fs.unlink(filePath);
    projectWatchManager?.recordSelfDelete(filePath);
  });
  projectSearchService?.invalidateForPath(filePath);
  contentSearch.invalidatePath(filePath);
}

const screenshotTransactionOperations: ScreenshotTransactionOperations = {
  write: atomicWrite,
  unlink: unlinkTracked,
  removeDirectory: (target) =>
    diagnostics.filesystem('remove-directory', target, () => fs.rm(target, { recursive: true, force: true })),
};

const screenshotTrashOperations: ScreenshotTrashOperations = {
  write: atomicWrite,
  unlink: unlinkTracked,
  removeDirectory: (target) =>
    diagnostics.filesystem('remove-directory', target, () => fs.rm(target, { recursive: true, force: true })),
};

const contentTrashOperations: ContentTrashOperations = {
  write: atomicWrite,
  unlink: unlinkTracked,
  removeDirectory: (target) =>
    diagnostics.filesystem('remove-directory', target, () => fs.rm(target, { recursive: true, force: true })),
};

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const diagnostics = new PersistenceDiagnostics(() => path.join(app.getPath('userData'), 'diagnostics'), {
  version: app.getVersion(),
  platform: process.platform,
});
const terminationMemory = {
  mainResidentBytes: () => process.memoryUsage.rss(),
  processMetrics: () => app.getAppMetrics(),
};
app.on('render-process-gone', (_event, _contents, details) => {
  void diagnostics.record({
    category: 'lifecycle',
    action: 'renderer-gone',
    phase: 'observed',
    termination: {
      details: { type: 'Tab', reason: details.reason, exitCode: details.exitCode },
      memory: terminationMemory,
    },
  });
});
app.on('child-process-gone', (_event, details) => {
  void diagnostics.record({
    category: 'lifecycle',
    action: 'child-process-gone',
    phase: 'observed',
    termination: {
      details: { type: details.type, reason: details.reason, exitCode: details.exitCode },
      memory: terminationMemory,
    },
  });
});

async function persistApplicationSettings(
  nextSettings: WorkspaceSettings,
  nextPreferences = preferenceSettingsResult.settings,
): Promise<void> {
  const persisted = preferenceSettingsEnvelope(
    nextSettings as unknown as Record<string, unknown>,
    nextPreferences,
    preferenceSettingsResult.profile,
  );
  const persist = async () => {
    await atomicWrite(settingsFile(), JSON.stringify(persisted, null, 2));
    if (nextSettings.workspacePath !== settings.workspacePath) contentSearch.invalidate();
    settings = { ...nextSettings };
    preferenceSettingsResult = { ...preferenceSettingsResult, settings: nextPreferences };
  };
  if (localMcpServer) await localMcpServer.savePreference(nextPreferences.agentAccess.enabled, persist);
  else await persist();
  syncCaptureGlobalShortcut();
}

function workspaceOrThrow(): string {
  if (!settings.workspacePath) throw new Error('Choose a workspace folder before opening a project.');
  return settings.workspacePath;
}

async function assertProjectPath(projectPath: string): Promise<string> {
  return authorizeProjectPath(settings.workspacePath, projectPath);
}

async function readProjectMetadata(projectPath: string): Promise<ProjectData> {
  await assertNoLinks(path.join(projectPath, 'project.json'));
  const raw = await fs.readFile(path.join(projectPath, 'project.json'), 'utf8');
  const source = parseProjectFile(JSON.parse(raw));
  const parsed = await migrateProjectWithBackup(projectPath, source, async () => {
    if (preferenceSettingsResult.settings.backups.enabled)
      await backupService!.createSnapshot(projectPath, 'migration');
  });
  return {
    ...parsed,
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
    exportPreferences: { ...DEFAULT_EXPORT_PREFERENCES, ...parsed.exportPreferences },
    screenshots,
  };
}

async function readProjectMutationBaseline(projectPath: string): Promise<{
  project: ProjectData;
  projectRevision: string;
  projectSource: Buffer;
}> {
  const projectFile = path.join(projectPath, 'project.json');
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await fs.readFile(projectFile);
    const project = await readProject(projectPath);
    const after = await fs.readFile(projectFile);
    const beforeRevision = projectRevisionForSource(before);
    const projectRevision = projectRevisionForSource(after);
    if (beforeRevision === projectRevision) return { project, projectRevision, projectSource: after };
  }
  throw new Error('The project kept changing while the save was prepared. Wait for changes to settle.');
}

async function readOptionalFile(filePath: string): Promise<Buffer | null> {
  await assertNoLinks(filePath);
  return fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
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
  recoveredContentDeletes: Array<{ undoToken: string; itemId: string }>;
}> {
  const warnings: string[] = [];
  const recoveredDeletes: Array<{ undoToken: string; screenshotId: string }> = [];
  const recoveredContentDeletes: Array<{ undoToken: string; itemId: string }> = [];
  const transactions = await recoverScreenshotTransactions(projectPath, screenshotTransactionOperations);
  await diagnostics.record({
    category: 'integrity',
    action: 'save-recovery-checked',
    phase: 'observed',
    target: projectPath,
    count: transactions.length,
  });
  for (const transaction of transactions) {
    if (transaction.warning) warnings.push(transaction.warning);
    if (!transaction.candidateAvailable) continue;
    const contentTransaction = transaction.kind.startsWith('content-');
    const choice = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      title: 'Recover interrupted save',
      message: `An interrupted ${contentTransaction ? 'content' : 'screenshot'} save was restored to its previous safe state.`,
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
  await diagnostics.record({
    category: 'integrity',
    action: 'screenshot-undo-checked',
    phase: 'observed',
    target: projectPath,
    count: trash.length,
  });
  for (const transaction of trash) {
    if (transaction.warning) warnings.push(transaction.warning);
    if (transaction.undoAvailable)
      recoveredDeletes.push({
        undoToken: transaction.undoToken,
        screenshotId: transaction.screenshotId,
      });
  }
  const contentTrash = await recoverContentTrashTransactions(projectPath, contentTrashOperations);
  await diagnostics.record({
    category: 'integrity',
    action: 'content-undo-checked',
    phase: 'observed',
    target: projectPath,
    count: contentTrash.length,
  });
  for (const transaction of contentTrash) {
    if (transaction.warning) warnings.push(transaction.warning);
    if (transaction.undoAvailable)
      recoveredContentDeletes.push({
        undoToken: transaction.undoToken,
        itemId: transaction.itemId,
      });
  }
  return { warnings, recoveredDeletes, recoveredContentDeletes };
}

function imageType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
}

function dataUrlFromBuffer(buffer: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

const thumbnailCache = new ThumbnailCache((filePath) => {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error('The image preview could not be loaded.');
  return image.resize({ ...thumbnailSize(image.getSize()), quality: 'good' }).toDataURL();
});
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
        thumbnails[shot.id] = await thumbnailCache.get(filePath, stat);
      } catch {
        warnings.push(`Preview unavailable for ${shot.originalFilename}.`);
      }
    }),
  );
  await Promise.all(
    (project.contentItems ?? [])
      .filter((item) => item.kind === 'drawing')
      .map(async (item) => {
        try {
          const relative = contentItemRelativePaths(item).image!;
          const filePath = path.join(projectPath, relative);
          await assertNoLinks(filePath);
          const stat = await fs.stat(filePath);
          thumbnails[item.id] = await thumbnailCache.get(filePath, stat);
        } catch {
          warnings.push(`Preview unavailable for ${item.title}.`);
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

async function openWithRecovery(projectPath: string, forcedChoice?: 'restore'): Promise<ProjectSnapshot> {
  const nativeRecovery = await recoverNativeProjectTransactions(projectPath);
  const decorateSnapshot = (snapshot: ProjectSnapshot, warnings: readonly string[] = []) => {
    const withWarnings = withSnapshotWarnings(snapshot, [...nativeRecovery.warnings, ...warnings]);
    return {
      ...withWarnings,
      ...(nativeRecovery.recoveredDeletes.length
        ? { recoveredDeletes: nativeRecovery.recoveredDeletes }
        : {}),
      ...(nativeRecovery.recoveredContentDeletes.length
        ? { recoveredContentDeletes: nativeRecovery.recoveredContentDeletes }
        : {}),
    };
  };
  const inspectSnapshot = async (snapshot: ProjectSnapshot) => {
    const integrityWarnings = await inspectProjectFiles(projectPath, snapshot.project, (target, error) =>
      diagnostics.record({
        category: 'integrity',
        action: 'file-unavailable',
        phase: 'observed',
        target,
        error,
      }),
    );
    return withSnapshotWarnings(snapshot, integrityWarnings);
  };
  const snapshot = decorateSnapshot(await makeSnapshot(projectPath));
  const recoveryPath = path.join(projectPath, '.imnota-recovery.json');
  if (!snapshot.recoveryFound) return inspectSnapshot(snapshot);
  const recoverySource = await readOptionalFile(recoveryPath);
  if (!recoverySource) throw new Error('Recovery data disappeared while the project was opened.');
  const recovery = z
    .object({
      project: z.unknown(),
      annotations: z.record(z.string(), z.array(annotationSchema)),
      notes: z.record(z.string(), notesSchema).optional(),
    })
    .parse(JSON.parse(recoverySource.toString('utf8')));
  const recoveryProject = parseProjectFile(recovery.project);
  if (recoveryProject.id !== snapshot.project.id)
    throw new Error('Recovery belongs to a different project. Your files were not changed.');
  const expectedProjectRevision = snapshot.projectRevision;
  if (!expectedProjectRevision) throw new Error('Recovery snapshot has no project revision.');
  const projectSource = await fs.readFile(path.join(projectPath, 'project.json'));
  if (projectRevisionForSource(projectSource) !== expectedProjectRevision)
    throw new Error('The project changed while recovery was prepared. Reopen it and try again.');
  const recoveredProject = validateProject({
    ...normalizeRecoveredProject(snapshot.project, recoveryProject, recovery.notes),
    updatedAt: nextProjectMutationTimestamp(snapshot.project.updatedAt),
  });
  const preparedRestore = await prepareRecoveryRestoreTransaction(projectPath, {
    currentProject: snapshot.project,
    recoveredProject,
    projectSource,
    recoverySource,
    annotations: recovery.annotations,
  });
  const choice =
    forcedChoice === 'restore'
      ? { response: 0 }
      : await dialog.showMessageBox(mainWindow!, {
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
  const warnings: string[] = [];
  if (choice.response === 0) {
    warnings.push(
      ...(await commitFileTransaction(
        projectPath,
        'recovery-restore',
        preparedRestore.writes,
        preparedRestore.assertBaseline,
      )),
    );
  } else {
    await preparedRestore.assertBaseline();
    await atomicWrite(recoveryBackupPath, recoverySource);
    await unlinkTracked(recoveryPath);
  }
  return inspectSnapshot(decorateSnapshot(await makeSnapshot(projectPath), warnings));
}

async function uniqueProjectFolder(workspace: string, name: string): Promise<string> {
  const base = slugify(name);
  let folder = path.join(workspace, base);
  let n = 2;
  while (existsSync(folder)) folder = path.join(workspace, `${base}-${n++}`);
  return folder;
}

let projectCreationQueue: Promise<void> = Promise.resolve();
async function withinProjectCreationQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = projectCreationQueue;
  let release!: () => void;
  projectCreationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
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
      ...(project.contentItems ?? [])
        .filter((item) => item.collectionId === collectionId)
        .map((item) => item.position),
    ) + 1
  );
}

async function readScreenshotFiles(projectPath: string, screenshot: ScreenshotRecord) {
  const annotationPath = path.join(projectPath, screenshot.annotationFile);
  const descriptionPath = path.join(projectPath, screenshot.descriptionFile);
  const [annotationSource, descriptionSource] = await Promise.all([
    readOptionalFile(annotationPath),
    readOptionalFile(descriptionPath),
  ]);
  for (const [target, source] of [
    [annotationPath, annotationSource],
    [descriptionPath, descriptionSource],
  ] as const) {
    if (source === null)
      await diagnostics.record({
        category: 'integrity',
        action: 'sidecar-missing',
        phase: 'observed',
        target,
        error: { code: 'ENOENT' },
      });
  }
  const annotationsJson = annotationSource?.toString('utf8') ?? '[]';
  const description = descriptionSource?.toString('utf8') ?? screenshot.description;
  return {
    annotationSource,
    annotationsJson,
    description,
    descriptionSource,
    revision: contentRevision(description, annotationsJson),
  };
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
  if (!collection) throw new Error('Choose a collection before importing.');
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
  collection.archived = false;
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

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof text !== 'string' || text.length > 2_000_000)
    throw new Error('Context is too large to copy. Export the Markdown file instead.');
  await nativeClipboard.writeText(text);
}

function cropPngForOcr(png: Uint8Array, crop: OcrCropRect): Uint8Array {
  const image = nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  if (image.isEmpty()) return png;
  const cropped = image.crop(crop);
  if (cropped.isEmpty()) return png;
  return cropped.toPNG();
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

async function copyImageToClipboard(imageDataUrl: string): Promise<void> {
  await nativeClipboard.writeImage(clipboardImage(imageDataUrl));
}

function clipboardOwnerHandle(): Buffer {
  const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!owner || owner.isDestroyed())
    throw new Error('A live Imnota window is required for clipboard access.');
  return owner.getNativeWindowHandle();
}

async function copyBundleToClipboard(
  markdown: string,
  imageDataUrl: string,
  filePaths: readonly string[] = [],
  variant: WindowsCopyVariantId = 'rich',
): Promise<ClipboardFormatsReport> {
  const image = clipboardImage(imageDataUrl);
  const html = clipboardContextHtml(markdown);
  if (variant === 'rich') return nativeClipboard.writeContext(markdown, html, image);
  return nativeClipboard.writeWindowsFiles(
    clipboardOwnerHandle(),
    filePaths,
    variant === 'files-rich' ? { text: markdown, html, image } : undefined,
  );
}

function captureService(): CaptureService {
  return new CaptureService({
    physicalDisplaySize: (display) => {
      // Bounds are DIP. Windows has an Electron conversion API; other supported
      // platforms expose the physical scale factor directly on Display.
      const physical =
        process.platform === 'win32'
          ? screen.dipToScreenRect(null, display.bounds)
          : {
              width: Math.round(display.bounds.width * display.scaleFactor),
              height: Math.round(display.bounds.height * display.scaleFactor),
            };
      return { width: physical.width, height: physical.height };
    },
    getSources: async (options) => {
      // This deliberately has two gates: it cannot be enabled outside the
      // disposable native smoke profile and it synthesizes every pixel itself.
      if (process.env.IMNOTA_SMOKE === '1' && process.env.IMNOTA_SMOKE_CAPTURE_SOURCE === 'synthetic') {
        // Exercise the same full-resolution validation path as a desktop
        // source. The disposable smoke profile synthesizes these pixels.
        const width = options.thumbnailSize.width;
        const height = options.thumbnailSize.height;
        return screen
          .getAllDisplays()
          .sort((left, right) => left.id - right.id)
          .map((display, displayIndex) => {
            const color = syntheticCaptureColor(displayIndex);
            const bitmap = Buffer.alloc(width * height * 4);
            bitmap.fill(Buffer.from([color.blue, color.green, color.red, color.alpha]));
            return {
              display_id: String(display.id),
              thumbnail: nativeImage.createFromBitmap(bitmap, { width, height }),
            };
          });
      }
      return desktopCapturer.getSources(options);
    },
    createImage: (png) => nativeImage.createFromBuffer(png),
    createBitmapImage: (bitmap, size) => nativeImage.createFromBitmap(bitmap, size),
  });
}

async function smokeDesktopCaptureCapability(): Promise<{
  windowCandidateCount: number;
  displays: Array<{
    displayId: number;
    bounds: CaptureRectangle;
    scaleFactor: number;
    sourcePixels: { width: number; height: number };
    cropDip: CaptureRectangle;
    cropPixels: { width: number; height: number };
  }>;
}> {
  if (
    process.env.IMNOTA_SMOKE !== '1' ||
    process.env.IMNOTA_SMOKE_CAPTURE_CAPABILITY !== 'real-memory-only' ||
    process.env.IMNOTA_SMOKE_CAPTURE_SOURCE === 'synthetic'
  )
    throw new Error(
      'The real capture capability probe requires the isolated smoke profile and explicit opt-in.',
    );
  const service = captureService();
  const displays = screen.getAllDisplays();
  const capability = await probeCaptureDisplays(displays, {
    capture: (display) =>
      captureDisplayWithStableGeometry(
        display,
        (target) => service.captureDisplay(target),
        () => screen.getAllDisplays(),
      ),
    crop: (source, selection) => service.crop(source, selection),
    // Source and crop buffers are intentionally neither persisted nor returned.
    decodeCrop: (png) => nativeImage.createFromBuffer(png),
  });
  return { ...capability, windowCandidateCount: listIdentifiableCaptureWindows(displays).length };
}

function cancelCaptureDelay(): void {
  captureDelaySession?.cancel();
}

async function closeCaptureDelayHud(): Promise<void> {
  const hud = captureDelayHud;
  captureDelayHud = null;
  if (!hud || hud.isDestroyed()) return;
  await new Promise<void>((resolve) => {
    if (hud.isDestroyed()) {
      resolve();
      return;
    }
    hud.once('closed', () => resolve());
    hud.close();
  });
}

function isCaptureDelayHudSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    captureDelayHud &&
    !captureDelayHud.isDestroyed() &&
    event.sender.id === captureDelayHud.webContents.id &&
    event.senderFrame === event.sender.mainFrame,
  );
}

async function openCaptureDelayHud(displayBounds: CaptureRectangle): Promise<BrowserWindow | null> {
  await closeCaptureDelayHud();
  try {
    const placement = captureDelayHudWindowOptions(displayBounds);
    const window = new BrowserWindow({
      ...placement,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'capture-overlay-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.setAlwaysOnTop(true, 'status');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (navigation) => navigation.preventDefault());
    captureDelayHud = window;
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) await window.loadURL(new URL('capture-overlay.html?countdown=1', `${devUrl}/`).toString());
    else
      await window.loadFile(path.join(__dirname, '../../dist/capture-overlay.html'), {
        query: { countdown: '1' },
      });
    if (captureDelayHud !== window || window.isDestroyed()) return null;
    window.showInactive();
    return window;
  } catch {
    await closeCaptureDelayHud();
    return null;
  }
}

function settleCaptureOverlay(selection: CaptureRectangle | null, mode: CaptureOverlayMode = 'region'): void {
  const active = captureOverlay;
  if (!active || !active.session.settle(selection, mode)) return;
  captureOverlay = null;
  active.readiness.dispose();
  active.disposeDisplayListeners();
  closeCaptureOverlayWindows(active.overlays.map(({ window }) => window));
}

function failCaptureOverlay(reason: CaptureOverlayFailure = 'not-ready'): void {
  const active = captureOverlay;
  if (!active || !active.session.fail(reason)) return;
  captureOverlay = null;
  active.readiness.dispose();
  active.disposeDisplayListeners();
  closeCaptureOverlayWindows(active.overlays.map(({ window }) => window));
}

function broadcastCaptureSelection(): void {
  const active = captureOverlay;
  if (!active) return;
  const state = active.selection.current();
  for (const overlay of active.overlays)
    if (!overlay.window.isDestroyed()) overlay.window.webContents.send('capture-overlay:selection', state);
}

function captureOverlayIds(): number[] | undefined {
  return captureOverlay?.overlays.map(({ window }) => window.webContents.id);
}

function captureOverlayGeometryIsStable(active: NonNullable<typeof captureOverlay>): boolean {
  return captureDisplaysHaveStableGeometry(active.displays, screen.getAllDisplays());
}

function listIdentifiableCaptureWindows(displays: readonly CaptureDisplay[]): CaptureWindowCandidate[] {
  if (process.env.IMNOTA_SMOKE_CAPTURE_SOURCE === 'synthetic') return [];
  return identifiableCaptureWindows(
    tryListWindowsCaptureWindows((rect) => screen.screenToDipRect(null, rect)),
    displays,
  );
}

async function chooseCaptureRegion(
  captures: readonly CapturedDisplayImage[],
  windows: readonly CaptureWindowCandidate[] = [],
  initialMode: CaptureOverlayMode = 'region',
): Promise<CaptureOverlayOutcome> {
  if (captureOverlay) throw new Error('A screen capture is already in progress.');
  if (!captures.length) throw new Error('No display capture is available.');
  const displays = captures.map(({ display }) => display);
  const session = new CaptureOverlaySession();
  const readiness = createOverlayReadinessGuard(() => failCaptureOverlay(), CAPTURE_OVERLAY_READY_TIMEOUT_MS);
  const selection = new CaptureSelectionCoordinator(displays, windows);
  if (initialMode !== 'region') {
    const pointerDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    selection.setMode(initialMode, pointerDisplayId);
  }
  const overlays: Array<{ window: BrowserWindow; capture: CapturedDisplayImage; ready: boolean }> = [];
  try {
    for (const capture of captures) {
      const displayBounds = capture.display.bounds;
      // Windows fullscreen windows ignore explicit coordinates and jump to the
      // primary display. Exact frameless bounds keep one overlay on each screen.
      const placement = captureOverlayWindowOptions(displayBounds, process.platform);
      const window = new BrowserWindow({
        ...placement,
        ...captureOverlayFreezeAppearance(),
        useContentSize: true,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: {
          preload: path.join(__dirname, 'capture-overlay-preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.setAlwaysOnTop(true, 'screen-saver');
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      if (!placement.fullscreen) window.setBounds(displayBounds);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.once('closed', () => failCaptureOverlay());
      window.once('unresponsive', () => failCaptureOverlay());
      window.webContents.once('render-process-gone', () => failCaptureOverlay());
      window.webContents.once('did-fail-load', () => failCaptureOverlay());
      window.webContents.once('did-finish-load', () => {
        const active = captureOverlay;
        if (!active?.overlays.some((candidate) => candidate.window === window) || window.isDestroyed())
          return;
        const remembered = lastCaptureRegionMemory.peek();
        window.webContents.send('capture-overlay:payload', {
          displayId: capture.display.id,
          displayBounds,
          imageDataUrl: `data:image/png;base64,${capture.png.toString('base64')}`,
          lastRegion: lastCaptureRegionForDisplay(remembered, capture.display),
          lastRegionAvailable: remembered !== null,
        });
      });
      overlays.push({ window, capture, ready: false });
    }
  } catch {
    readiness.dispose();
    closeCaptureOverlayWindows(overlays.map(({ window }) => window));
    throw new CaptureServiceError(
      'sources-unavailable',
      'The screen selection windows could not be created.',
    );
  }
  const failForDisplayChange = () => failCaptureOverlay('display-changed');
  const failForDisplayMetricsChange = (
    _event: Electron.Event,
    _display: Electron.Display,
    changedMetrics: string[],
  ) => {
    if (captureDisplayMetricsInvalidateSelection(changedMetrics)) failForDisplayChange();
  };
  screen.on('display-added', failForDisplayChange);
  screen.on('display-removed', failForDisplayChange);
  screen.on('display-metrics-changed', failForDisplayMetricsChange);
  captureOverlay = {
    overlays,
    session,
    selection,
    readiness,
    displays,
    overlayCommit: 'save',
    disposeDisplayListeners: () => {
      screen.off('display-added', failForDisplayChange);
      screen.off('display-removed', failForDisplayChange);
      screen.off('display-metrics-changed', failForDisplayMetricsChange);
    },
  };
  try {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    await Promise.all(
      overlays.map(({ window }) =>
        devUrl
          ? window.loadURL(new URL('capture-overlay.html', `${devUrl}/`).toString())
          : window.loadFile(path.join(__dirname, '../../dist/capture-overlay.html')),
      ),
    );
  } catch {
    failCaptureOverlay();
    throw new CaptureServiceError('sources-unavailable', 'The screen selection window could not be opened.');
  }
  return session.result;
}

async function insertCapturedPng(
  projectPath: string,
  collectionId: string,
  png: Buffer,
  assertAdmission: () => void,
): Promise<{
  snapshot: ProjectSnapshot;
  screenshotId: string;
}> {
  if (png.byteLength === 0 || png.byteLength > 100_000_000)
    throw new NativeWorkflowError(
      'capture-sources-unavailable',
      'The captured PNG is not a safe size. Use Import or Paste instead.',
    );
  let image: Electron.NativeImage;
  let dimensions: { width: number; height: number };
  try {
    image = nativeImage.createFromBuffer(png);
    dimensions = image.getSize();
  } catch {
    throw new NativeWorkflowError(
      'capture-sources-unavailable',
      'The selected area could not be decoded as a PNG. Use Import or Paste instead.',
    );
  }
  if (
    image.isEmpty() ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_CAPTURE_DIMENSION ||
    dimensions.height > MAX_CAPTURE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_CAPTURE_PIXELS
  )
    throw new NativeWorkflowError(
      'capture-sources-unavailable',
      'The selected area could not be saved as a PNG. Use Import or Paste instead.',
    );
  const baseline = await readWithCaptureAdmission(
    () => readProjectMutationBaseline(projectPath),
    assertAdmission,
  );
  const project = baseline.project;
  const collection = project.collections.find((candidate) => candidate.id === collectionId);
  if (!collection)
    throw new NativeWorkflowError(
      'collection-not-found',
      'The active collection is no longer available. Choose a collection and try again.',
    );
  await ensureCollection(projectPath, collection.id);
  assertAdmission();
  const storedFilename = await uniqueStoredName(
    projectPath,
    `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
  );
  assertAdmission();
  const timestamp = nextProjectMutationTimestamp(project.updatedAt);
  const screenshot: ScreenshotRecord = {
    collectionId: collection.id,
    id: `shot_${crypto.randomUUID()}`,
    originalFilename: 'Screen capture.png',
    storedFilename,
    title: 'Screen capture',
    description: '',
    position: nextScreenshotPosition(project, collection.id),
    createdAt: timestamp,
    updatedAt: timestamp,
    priority: 'medium',
    annotationFile: `collections/${collection.id}/annotations/${storedFilename}.json`,
    descriptionFile: `collections/${collection.id}/descriptions/${storedFilename}.md`,
    originalWidth: dimensions.width,
    originalHeight: dimensions.height,
    includeInExport: true,
  };
  project.screenshots.push(screenshot);
  collection.archived = false;
  project.updatedAt = timestamp;
  const savedProject = validateProject(project);
  const projectSource = Buffer.from(JSON.stringify(savedProject, null, 2));
  const recoverySource = await readWithCaptureAdmission(
    () => readOptionalFile(path.join(projectPath, '.imnota-recovery.json')),
    assertAdmission,
  );
  await commitFileTransaction(
    projectPath,
    'capture',
    [
      {
        relativePath: `collections/${collection.id}/screenshots/${storedFilename}`,
        after: png,
        expectedBefore: screenshotTransactionBaseline(null),
      },
      {
        relativePath: screenshot.annotationFile,
        after: Buffer.from('[]'),
        expectedBefore: screenshotTransactionBaseline(null),
      },
      {
        relativePath: screenshot.descriptionFile,
        after: Buffer.from(''),
        expectedBefore: screenshotTransactionBaseline(null),
      },
      {
        relativePath: '.imnota-recovery.json',
        after: null,
        expectedBefore: screenshotTransactionBaseline(recoverySource),
      },
      {
        relativePath: 'project.json',
        after: projectSource,
        expectedBefore: screenshotTransactionBaseline(baseline.projectSource),
      },
    ],
    () =>
      assertCaptureCommitAdmission(assertAdmission, () =>
        assertProjectRevision(projectPath, baseline.projectRevision),
      ),
  );
  return { snapshot: await makeSnapshot(projectPath), screenshotId: screenshot.id };
}

async function mutateProjectMetadata(
  projectPath: string,
  expectedRevision: string,
  mutate: (project: ProjectData) => ProjectData,
): Promise<ProjectSnapshot> {
  const safePath = await assertProjectPath(projectPath);
  const baseline = await readProjectMutationBaseline(safePath);
  if (baseline.projectRevision !== expectedRevision)
    throw new Error('The project changed before this update. Reload it and try again.');
  const next = validateProject({
    ...mutate(baseline.project),
    id: baseline.project.id,
    updatedAt: nextProjectMutationTimestamp(baseline.project.updatedAt),
  });
  await assertProjectRevision(safePath, expectedRevision);
  await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(next, null, 2));
  return makeSnapshot(safePath);
}

// Acquire before this request joins the shared IPC queue. Otherwise two rapid
// toolbar/shortcut invocations can each wait for a previous operation and
// subsequently create separate overlays.
function captureWorkflowRegistrar(router: IpcRouter) {
  return (
    channel: 'workflow:capture:region' | 'workflow:capture:repeat-last-region',
    listener: (
      event: IpcMainInvokeEvent,
      admission: CaptureAdmission,
      ...args: unknown[]
    ) => Promise<unknown> | unknown,
  ) => {
    ipcMain.handle(channel, (event, ...args) =>
      workflowOutcome(async () => {
        router.assertCallable(event);
        const admission = captureAdmissionGate.acquire();
        if (!admission)
          throw new NativeWorkflowError(
            'capture-unavailable',
            'A screen capture is already in progress. Finish or cancel it before starting another.',
          );
        const revoke = () => {
          captureAdmissionGate.revoke(admission);
          cancelCaptureDelay();
          settleCaptureOverlay(null);
        };
        event.sender.once('destroyed', revoke);
        event.sender.once('render-process-gone', revoke);
        try {
          return await router.enqueue(() =>
            diagnostics.run(channel, () => listener(event, admission, ...args)),
          );
        } finally {
          event.sender.removeListener('destroyed', revoke);
          event.sender.removeListener('render-process-gone', revoke);
          captureAdmissionGate.release(admission);
        }
      }),
    );
  };
}
export type CaptureWorkflowRegistrar = ReturnType<typeof captureWorkflowRegistrar>;

// ipc-host:start
/** Main-process state and helpers shared with the domain IPC modules. */
function createIpcHost() {
  return {
    assertLiveCaptureAdmission,
    assertProjectPath,
    assertProjectRevision,
    atomicWrite,
    captureAdmissionGate,
    captureGlobalShortcut,
    captureRequests,
    captureService,
    chooseCaptureRegion,
    clipboardImage,
    closeCaptureDelayHud,
    commitFileTransaction,
    contentRevision,
    contentSearch,
    copyBundleToClipboard,
    copyFile,
    copyImageToClipboard,
    copyTextToClipboard,
    cropPngForOcr,
    diagnostics,
    importOne,
    insertCapturedPng,
    lastCaptureRegionMemory,
    listIdentifiableCaptureWindows,
    loadImage,
    makeSnapshot,
    mutateProjectMetadata,
    nextScreenshotPosition,
    openCaptureDelayHud,
    openWithRecovery,
    persistApplicationSettings,
    raiseMainWindow,
    readOptionalFile,
    readProject,
    readProjectMetadata,
    readProjectMutationBaseline,
    readScreenshotFiles,
    resolvedWindowBackground,
    screenshotTrashOperations,
    sendCaptureRequest,
    uniqueProjectFolder,
    uniqueStoredName,
    withSnapshotWarnings,
    withinProjectCreationQueue,
    workspaceOrThrow,
    get backupService() {
      return backupService;
    },
    get captureDelayHud() {
      return captureDelayHud;
    },
    get captureDelaySession() {
      return captureDelaySession;
    },
    set captureDelaySession(value: typeof captureDelaySession) {
      captureDelaySession = value;
    },
    get contentPersistence() {
      return contentPersistence;
    },
    get hostedShareClient() {
      return hostedShareClient;
    },
    get lastOverlayCommit() {
      return lastOverlayCommit;
    },
    get mainWindow() {
      return mainWindow;
    },
    get onboardingHandoffWorkflow() {
      return onboardingHandoffWorkflow;
    },
    get pendingCapturePng() {
      return pendingCapturePng;
    },
    set pendingCapturePng(value: typeof pendingCapturePng) {
      pendingCapturePng = value;
    },
    get preferenceSettingsResult() {
      return preferenceSettingsResult;
    },
    get projectSearchService() {
      return projectSearchService;
    },
    get projectWatchManager() {
      return projectWatchManager;
    },
    get promptBundleWorkflow() {
      return promptBundleWorkflow;
    },
    get settings() {
      return settings;
    },
    get smokeBackupRestorePath() {
      return smokeBackupRestorePath;
    },
    set smokeBackupRestorePath(value: typeof smokeBackupRestorePath) {
      smokeBackupRestorePath = value;
    },
    get smokeProjectDeletionPath() {
      return smokeProjectDeletionPath;
    },
    set smokeProjectDeletionPath(value: typeof smokeProjectDeletionPath) {
      smokeProjectDeletionPath = value;
    },
    get updateController() {
      return updateController;
    },
    get updateInstallPending() {
      return updateInstallPending;
    },
    set updateInstallPending(value: typeof updateInstallPending) {
      updateInstallPending = value;
    },
  };
}
export type IpcHost = ReturnType<typeof createIpcHost>;
// ipc-host:end

function registerIpc(): void {
  // The selection window is not the main renderer. It receives no general
  // bridge and these handlers accept only its current webContents instance.
  ipcMain.handle('capture-overlay:ready', (event) => {
    if (
      !isCaptureOverlaySender(
        captureOverlayIds(),
        event.sender.id,
        event.senderFrame === event.sender.mainFrame,
      )
    )
      throw new Error('Untrusted capture overlay sender.');
    const active = captureOverlay;
    if (!active) throw new Error('Capture overlay is no longer available.');
    const source = active.overlays.find(({ window }) => window.webContents.id === event.sender.id);
    if (!source) throw new Error('Capture overlay is no longer available.');
    if (source.ready) return;
    source.ready = true;
    if (!active.overlays.every((overlay) => overlay.ready)) return;
    if (!active.readiness.ready()) throw new Error('Capture overlay readiness has expired.');
    if (!captureOverlayGeometryIsStable(active)) {
      failCaptureOverlay('display-changed');
      return;
    }
    // Showing can re-snap a window to the work area or another display. Reassert
    // every bound, then refuse the whole group if even one overlay is misplaced.
    for (const overlay of active.overlays) {
      overlay.window.show();
      const expected = overlay.capture.display.bounds;
      if (!overlayCoversDisplay(overlay.window.getContentBounds(), expected)) {
        overlay.window.setBounds(expected);
        if (!overlayCoversDisplay(overlay.window.getContentBounds(), expected)) {
          failCaptureOverlay('misplaced');
          return;
        }
      }
    }
    broadcastCaptureSelection();
    const pointerDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const focused = active.overlays.find(({ capture }) => capture.display.id === pointerDisplay.id);
    (focused ?? active.overlays[0])?.window.focus();
  });
  ipcMain.on('capture-overlay:pointer', (event, raw) => {
    if (
      !isCaptureOverlaySender(
        captureOverlayIds(),
        event.sender.id,
        event.senderFrame === event.sender.mainFrame,
      )
    )
      throw new Error('Untrusted capture overlay sender.');
    const active = captureOverlay;
    if (!active) throw new Error('Capture overlay is no longer available.');
    const overlay = active.overlays.find(({ window }) => window.webContents.id === event.sender.id);
    if (!overlay) throw new Error('Capture overlay is no longer available.');
    const update = z
      .object({
        phase: z.enum(['begin', 'move', 'end', 'reset']),
        point: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
      })
      .strict()
      .parse(raw);
    const globalPoint = update.point
      ? capturePointerGlobalPoint(overlay.capture.display, update.point, () => screen.getCursorScreenPoint())
      : undefined;
    active.selection.update(overlay.capture.display.id, update.phase, update.point, globalPoint);
    broadcastCaptureSelection();
  });
  ipcMain.on('capture-overlay:mode', (event, raw) => {
    if (
      !isCaptureOverlaySender(
        captureOverlayIds(),
        event.sender.id,
        event.senderFrame === event.sender.mainFrame,
      )
    )
      throw new Error('Untrusted capture overlay sender.');
    const active = captureOverlay;
    if (!active) throw new Error('Capture overlay is no longer available.');
    const source = active.overlays.find(({ window }) => window.webContents.id === event.sender.id);
    if (!source) throw new Error('Capture overlay is no longer available.');
    const mode = z.enum(CAPTURE_OVERLAY_MODES).parse(raw);
    active.selection.setMode(mode, source.capture.display.id);
    broadcastCaptureSelection();
  });
  function assertTrustedCaptureOverlay(
    event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
  ): NonNullable<typeof captureOverlay> {
    if (
      !isCaptureOverlaySender(
        captureOverlayIds(),
        event.sender.id,
        event.senderFrame === event.sender.mainFrame,
      )
    )
      throw new Error('Untrusted capture overlay sender.');
    const active = captureOverlay;
    if (!active) throw new Error('Capture overlay is no longer available.');
    return active;
  }
  function commitCaptureOverlay(
    active: NonNullable<typeof captureOverlay>,
    action: 'save' | 'annotate',
  ): void {
    if (!captureOverlayGeometryIsStable(active)) {
      failCaptureOverlay('display-changed');
      return;
    }
    for (const overlay of active.overlays) {
      if (!overlayCoversDisplay(overlay.window.getContentBounds(), overlay.capture.display.bounds)) {
        failCaptureOverlay('misplaced');
        return;
      }
    }
    const state = active.selection.current();
    if (!state.complete || !state.selection) throw new Error('Capture selection is incomplete.');
    active.overlayCommit = action;
    lastOverlayCommit = action;
    settleCaptureOverlay(state.selection, state.mode);
  }
  ipcMain.handle('capture-overlay:save', (event) => {
    commitCaptureOverlay(assertTrustedCaptureOverlay(event), 'save');
  });
  ipcMain.handle('capture-overlay:annotate', (event) => {
    commitCaptureOverlay(assertTrustedCaptureOverlay(event), 'annotate');
  });
  ipcMain.handle('capture-overlay:copy', async (event) => {
    const active = assertTrustedCaptureOverlay(event);
    if (!captureOverlayGeometryIsStable(active)) {
      failCaptureOverlay('display-changed');
      return { image: false };
    }
    for (const overlay of active.overlays) {
      if (!overlayCoversDisplay(overlay.window.getContentBounds(), overlay.capture.display.bounds)) {
        failCaptureOverlay('misplaced');
        return { image: false };
      }
    }
    const state = active.selection.current();
    if (!state.complete || !state.selection) throw new Error('Capture selection is incomplete.');
    const png = captureService().compose(
      active.overlays.map((overlay) => overlay.capture),
      state.selection,
    );
    const image = nativeImage.createFromBuffer(png);
    await nativeClipboard.writeImage(image);
    const kept = await nativeClipboard.readImage();
    return { image: !kept.isEmpty() };
  });
  ipcMain.on('capture-overlay:repeat-last', (event) => {
    if (
      !isCaptureOverlaySender(
        captureOverlayIds(),
        event.sender.id,
        event.senderFrame === event.sender.mainFrame,
      )
    )
      throw new Error('Untrusted capture overlay sender.');
    const active = captureOverlay;
    if (!active) throw new Error('Capture overlay is no longer available.');
    const source = active.overlays.find(({ window }) => window.webContents.id === event.sender.id);
    if (!source) throw new Error('Capture overlay is no longer available.');
    active.selection.applyLastRegion(lastCaptureRegionMemory.peek(), source.capture.display.id);
    broadcastCaptureSelection();
  });
  ipcMain.handle('capture-overlay:cancel', (event) => {
    if (isCaptureDelayHudSender(event)) {
      cancelCaptureDelay();
      return;
    }
    if (
      !isCaptureOverlaySender(
        captureOverlayIds(),
        event.sender.id,
        event.senderFrame === event.sender.mainFrame,
      )
    )
      throw new Error('Untrusted capture overlay sender.');
    settleCaptureOverlay(null);
  });
  const router = new IpcRouter({
    register: (channel, listener) => ipcMain.handle(channel, listener),
    trustedSender: (event) =>
      event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame,
    updateInstallPending: () => updateInstallPending,
    contracts,
    defaultContract: z.tuple([pathInput]),
    tracesChannel: tracesPersistenceChannel,
    trace: (channel, run) => diagnostics.run(channel, run),
  });
  const host = createIpcHost();
  const handleCaptureWorkflow = captureWorkflowRegistrar(router);
  registerCaptureIpc(router, handleCaptureWorkflow, host);

  projectWatchManager = new ProjectWatchManager({
    loadSnapshot: (projectPath) => makeSnapshot(projectPath),
    saveProject: async (projectPath, project) => {
      const current = await readProject(projectPath);
      if (current.id !== project.id) throw new Error('Project identity does not match its watch grant.');
      const next = preserveMixedProjectMetadata(current, {
        ...project,
        id: current.id,
        updatedAt: nowIso(),
      });
      await atomicWrite(path.join(projectPath, 'project.json'), JSON.stringify(next, null, 2));
      return makeSnapshot(projectPath);
    },
    emit: (event: ProjectWatchEvent) => {
      void diagnostics.record({
        category: 'integrity',
        action: event.kind,
        phase: 'observed',
        target: event.projectPath,
        count: event.changedPaths.length,
      });
      contentSearch.invalidatePath(event.projectPath);
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send('workflow:project-watch-event', event);
    },
  });
  projectSearchService = new ProjectSearchService({
    workspace: () => settings.workspacePath,
    authorizeProject: assertProjectPath,
    assertNoLinks,
  });
  backupService = new BackupService({
    getLocation: () => preferenceSettingsResult.settings.backups.location,
    getWorkspace: () => workspaceOrThrow(),
    getPreferences: () => preferenceSettingsResult.settings.backups,
  });
  contentPersistence = new ContentPersistenceService({
    snapshot: makeSnapshot,
    beforeSchemaMigration: async (projectPath) => {
      if (preferenceSettingsResult.settings.backups.enabled)
        await backupService!.createSnapshot(projectPath, 'migration');
    },
    transactionOperations: screenshotTransactionOperations,
    trashOperations: contentTrashOperations,
    trashItem: async (target) => {
      await diagnostics.filesystem('trash', target, () => shell.trashItem(target));
      projectWatchManager?.recordSelfDelete(target);
    },
    validatePng: (png, expected) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png));
      const actual = image.getSize();
      if (image.isEmpty() || actual.width !== expected.width || actual.height !== expected.height)
        throw new Error('Drawing PNG could not be decoded at its declared dimensions.');
    },
  });
  const handoffPaths = {
    temporaryDirectory: app.getPath('temp'),
    userDataDirectory: app.getPath('userData'),
  };
  const promptFileHandoffs = new TemporaryFileHandoffStore(promptHandoffRoot(handoffPaths));
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
      copyContext: (markdown, imageDataUrl, filePaths, variant) =>
        copyBundleToClipboard(markdown, imageDataUrl, filePaths, variant),
      prepareFileHandoff: async (markdown, imageDataUrl, sourcePaths) => {
        if (process.platform !== 'win32') return sourcePaths;
        const grant = await promptFileHandoffs.prepare({
          markdown,
          imageDataUrl,
          markdownFilename: path.basename(sourcePaths[0]),
          pngFilename: path.basename(sourcePaths[1]),
        });
        return [grant.markdownPath, grant.pngPath];
      },
      copyText: (markdown) => copyTextToClipboard(markdown),
      copyImage: (imageDataUrl) => copyImageToClipboard(imageDataUrl),
      openPath: async (targetPath) => {
        const error = await shell.openPath(targetPath);
        if (error) throw new Error(error);
      },
    },
    new PromptBundleStore({ validateDecodedPng: validateDecodedPromptPng }),
  );
  onboardingHandoffWorkflow = new OnboardingHandoffWorkflow({
    root: onboardingHandoffRoot(handoffPaths),
    copyContext: (markdown, imageDataUrl, filePaths, variant) =>
      copyBundleToClipboard(markdown, imageDataUrl, filePaths, variant),
    copyText: copyTextToClipboard,
    copyImage: copyImageToClipboard,
    openPath: async (targetPath) => {
      const error = await shell.openPath(targetPath);
      if (error) throw new Error(error);
    },
  });
  hostedShareClient = new HostedShareClient(
    app.getPath('userData'),
    async (url) => {
      await shell.openExternal(url);
    },
    (target, init) =>
      net.fetch(target, {
        ...init,
        bypassCustomProtocolHandlers: true,
        credentials: 'omit',
        cache: 'no-store',
      }),
  );
  registerSettingsIpc(router, host);
  registerPreferenceIpc(router, host);
  registerPromptExportIpc(router, host);
  registerHostedShareIpc(router, host);
  registerProjectWatchIpc(router, host);
  registerProjectIpc(router, host);
  registerScreenshotIpc(router, host);
  registerContentIpc(router, host);
  registerSystemIpc(router, host);
}

let updateInstallPending = false;
const UPDATE_STARTUP_CHECK_DELAY_MS = 8_000;
const UPDATE_RECHECK_INTERVAL_MS = 60 * 60 * 1000;
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
  if (app.isPackaged && process.env.IMNOTA_SMOKE !== '1') {
    // Startup and hourly checks are background checks: the controller
    // coalesces them with manual checks, skips them during a download and
    // keeps the last known status when offline. Discovery only; nothing
    // downloads until the user chooses to.
    setTimeout(() => void updateController.check({ background: true }), UPDATE_STARTUP_CHECK_DELAY_MS);
    setInterval(() => void updateController.check({ background: true }), UPDATE_RECHECK_INTERVAL_MS);
  }
}

async function createWindow(): Promise<BrowserWindow> {
  mainWindow = new BrowserWindow({
    // Native-input CI needs an actively presented window for canvas paint/hit testing.
    // Its profile and workspace remain disposable; local background smoke stays hidden.
    show: process.env.IMNOTA_SMOKE !== '1' || process.env.CI === 'true',
    // macOS CI displays can be smaller than the desktop viewport under test.
    enableLargerThanScreen: process.env.IMNOTA_SMOKE === '1',
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: resolvedWindowBackground(preferenceSettingsResult.settings.appearance.mode),
    // macOS must create an alpha-capable compositor before runtime vibrancy is
    // enabled. Changing only the background colour of an opaque window can
    // retain old frames while scrolling. Solid mode still paints opaque CSS.
    transparent: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 18 } } : {}),
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
  const createdWebContents = createdWindow.webContents;
  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) mainWindow = null;
    captureRequests.windowClosed(createdWebContents);
    if (!appTray && BrowserWindow.getAllWindows().length === 0) captureGlobalShortcut.clear();
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
  return createdWindow;
}

app.whenReady().then(async () => {
  await diagnostics.record({ category: 'lifecycle', action: 'startup', phase: 'observed' });
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
      settings = { ...settings, ...applicationSettings } as WorkspaceSettings;
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
          `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'${process.env.VITE_DEV_SERVER_URL ? " 'unsafe-inline'" : ''}; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173; font-src 'self' data:;`,
        ],
      },
    });
  });
  localMcpServer = new LocalMcpServer({
    enabled: () => preferenceSettingsResult.settings.agentAccess.enabled,
    workspacePath: () => settings.workspacePath,
    appVersion: () => app.getVersion(),
    search: (input) => contentSearch.search(input),
  });
  if (process.argv.includes('--mcp') && process.env.IMNOTA_SMOKE !== '1') {
    const started = await localMcpServer.startStdio();
    if (!started) {
      process.stderr.write('Local agent access is off. Enable it in Settings → Workspace.\n');
      app.exit(1);
      return;
    }
    app.exit(0);
    return;
  }
  configureAutoUpdates();
  registerIpc();
  syncCaptureGlobalShortcut();
  let agentAccessStartupError = '';
  if (process.env.IMNOTA_SMOKE !== '1')
    await localMcpServer.sync().catch(async () => {
      agentAccessStartupError =
        'Local agent access could not start. Port 17384 may be in use. Access is off; free the port and enable it again in Settings → Workspace.';
      const next = { ...preferenceSettingsResult.settings, agentAccess: { enabled: false } };
      // Fail closed for this process even if storing the disabled preference also fails.
      preferenceSettingsResult = { ...preferenceSettingsResult, settings: next };
      await persistApplicationSettings(settings, next).catch(() => {
        agentAccessStartupError += ' The disabled preference could not be saved.';
      });
    });
  await createWindow();
  createAppTray();
  if (agentAccessStartupError) dialog.showErrorBox('Local agent access is off', agentAccessStartupError);
  if (process.env.IMNOTA_SMOKE === '1') {
    // Loaded only for isolated smoke runs; packaged verification drives the shipped harness.
    const { runSmokeSession } = await import('./smoke-session.js');
    const exitCode = await runSmokeSession({
      mainWindow: () => mainWindow,
      captureCapability: smokeDesktopCaptureCapability,
      diagnosticsHealth: () => diagnostics.health(),
      setWorkspace(workspacePath) {
        settings = { ...settings, workspacePath };
      },
      async reopenWindow() {
        const previousWindow = mainWindow;
        const nextWindow = await createWindow();
        if (previousWindow && previousWindow !== nextWindow && !previousWindow.isDestroyed())
          previousWindow.destroy();
        return nextWindow;
      },
      async captureFromTray(mode) {
        const nextWindow = new Promise<BrowserWindow>((resolve) =>
          app.once('browser-window-created', (_event, window) => resolve(window)),
        );
        mainWindow?.destroy();
        requestCapture({ source: 'tray', mode });
        return nextWindow;
      },
      trayAvailable() {
        return appTray !== null && !appTray.isDestroyed();
      },
      globalCaptureShortcutRegistered() {
        return captureGlobalShortcut.registeredAccelerator !== null;
      },
      readProject,
      async restoreRecovery(projectPath) {
        return openWithRecovery(projectPath, 'restore');
      },
      async readSettings() {
        return structuredClone(settings);
      },
      approveBackupRestore(realPath) {
        smokeBackupRestorePath = realPath;
      },
      approveProjectDeletion(realPath) {
        smokeProjectDeletionPath = realPath;
      },
    });
    app.exit(exitCode);
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      void createWindow().then(() => syncCaptureGlobalShortcut());
  });
});
app.on('window-all-closed', () => {
  if (appTray) return;
  captureGlobalShortcut.clear();
  if (process.platform !== 'darwin') app.quit();
});
onSuccessfulQuit(app, () => {
  appTray = teardownTrayAfterSuccessfulQuit({
    tray: appTray,
    clearCaptureShortcut: () => captureGlobalShortcut.clear(),
    stopProjectWatches: () => projectWatchManager?.stopAll(),
  });
  void localMcpServer?.stop();
});
