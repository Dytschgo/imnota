import { CAPTURE_OVERLAY_MODES } from '../src/shared/capture.js';
import { filenameSchema } from '../src/shared/schema.js';
import { bindCaptureDelayCancel, CaptureDelaySession } from './capture-delay.js';
import { captureAllDisplaysWithStableGeometry } from './capture-display-selection.js';
import type { CaptureOverlayOutcome } from './capture-overlay-session.js';
import { type CapturedDisplayImage, CaptureServiceError } from './capture-service.js';
import { pathInput } from './ipc-contracts.js';
import { NativeWorkflowError } from './workflow-errors.js';
import { globalShortcut, screen, systemPreferences } from 'electron';
import { z } from 'zod';
import type { IpcRouter } from './ipc-router.js';
import type { CaptureWorkflowRegistrar, IpcHost } from './main.js';

export function registerCaptureIpc(
  router: IpcRouter,
  handleCaptureWorkflow: CaptureWorkflowRegistrar,
  host: IpcHost,
): void {
  const { handleWorkflow } = router;
  const {
    assertLiveCaptureAdmission,
    assertProjectPath,
    captureAdmissionGate,
    captureRequests,
    captureService,
    chooseCaptureRegion,
    closeCaptureDelayHud,
    insertCapturedPng,
    lastCaptureRegionMemory,
    listIdentifiableCaptureWindows,
    openCaptureDelayHud,
    readProjectMetadata,
    sendCaptureRequest,
  } = host;
  handleWorkflow('workflow:capture:renderer-ready', (event) => {
    const request = captureRequests.rendererReady(event.sender);
    if (request) sendCaptureRequest(request);
  });
  handleCaptureWorkflow('workflow:capture:region', async (event, admission, ...args) => {
    const [input] = z
      .tuple([
        z
          .object({
            projectPath: pathInput.optional(),
            collectionId: filenameSchema.optional(),
            overlayMode: z.enum(CAPTURE_OVERLAY_MODES).optional(),
            delaySeconds: z.union([z.literal(3), z.literal(5)]).optional(),
          })
          .strict()
          .refine((value) => Boolean(value.projectPath) === Boolean(value.collectionId)),
      ])
      .parse(args);
    assertLiveCaptureAdmission(event, admission);
    host.pendingCapturePng = null;
    if (!host.preferenceSettingsResult.settings.capture.experimentalRegionCapture)
      throw new NativeWorkflowError(
        'capture-unavailable',
        'Experimental screen capture is off. Enable it in Settings, or use Import or Paste instead.',
      );
    if (process.platform === 'linux')
      throw new NativeWorkflowError(
        'capture-unavailable',
        'Screen capture is unavailable on Linux in this experimental release. Use Import or Paste instead.',
      );
    if (process.platform !== 'win32' && process.platform !== 'darwin')
      throw new NativeWorkflowError(
        'capture-unavailable',
        'Screen capture is unavailable on this platform. Use Import or Paste instead.',
      );
    if (process.platform === 'darwin') {
      const permission = systemPreferences.getMediaAccessStatus('screen');
      if (permission === 'denied' || permission === 'restricted')
        throw new NativeWorkflowError(
          'capture-permission-denied',
          'Allow Screen Recording for Imnota in macOS System Settings, then try again. You can also use Import or Paste.',
        );
    }
    let safeProjectPath: string | undefined;
    if (input.projectPath && input.collectionId) {
      safeProjectPath = await assertProjectPath(input.projectPath);
      const beforeCapture = await readProjectMetadata(safeProjectPath);
      const beforeCollection = beforeCapture.collections.find((item) => item.id === input.collectionId);
      if (!beforeCollection)
        throw new NativeWorkflowError('collection-not-found', 'Choose a collection before capturing.');
    }
    // The renderer flushes before it invokes this workflow and rechecks its
    // project/collection identity. Recheck the originating renderer here as
    // well because this request may have waited in the shared IPC queue.
    assertLiveCaptureAdmission(event, admission);
    const displays = screen.getAllDisplays();
    if (!displays.length)
      throw new NativeWorkflowError(
        'capture-sources-unavailable',
        'No display is available to capture. Use Import or Paste instead.',
        true,
      );
    assertLiveCaptureAdmission(event, admission);
    const wasVisible = Boolean(
      host.mainWindow && !host.mainWindow.isDestroyed() && host.mainWindow.isVisible(),
    );
    const wasFocused = Boolean(
      host.mainWindow && !host.mainWindow.isDestroyed() && host.mainWindow.isFocused(),
    );
    try {
      // Capture before creating the overlay; otherwise the selection UI would
      // be present in the image. Hiding the main window prevents self-capture.
      if (wasVisible) host.mainWindow?.hide();
      if (input.delaySeconds) {
        let remainingSeconds: number = input.delaySeconds;
        const sendTick = (seconds: number) => {
          remainingSeconds = seconds;
          if (host.captureDelayHud && !host.captureDelayHud.isDestroyed())
            host.captureDelayHud.webContents.send('capture-overlay:countdown', { remainingSeconds: seconds });
        };
        const delay = new CaptureDelaySession(input.delaySeconds, undefined, sendTick);
        host.captureDelaySession = delay;
        const unbindDelayCancel = bindCaptureDelayCancel(
          (accelerator, callback) => globalShortcut.register(accelerator, callback),
          (accelerator) => {
            globalShortcut.unregister(accelerator);
          },
          () => delay.cancel(),
        );
        const hudDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        void openCaptureDelayHud(hudDisplay.bounds)
          .then((hud) => {
            if (hud && !hud.isDestroyed()) {
              hud.once('closed', () => delay.cancel());
              sendTick(remainingSeconds);
            }
          })
          .catch(() => undefined);
        try {
          if (!captureAdmissionGate.isActive(admission)) delay.cancel();
          if ((await delay.result) === 'cancelled')
            throw new NativeWorkflowError('capture-cancelled', 'Screen capture cancelled.');
        } finally {
          unbindDelayCancel();
          if (host.captureDelaySession === delay) host.captureDelaySession = null;
          await closeCaptureDelayHud();
        }
        assertLiveCaptureAdmission(event, admission);
      }
      let captured: CapturedDisplayImage[];
      const service = captureService();
      try {
        const stableCapture = await captureAllDisplaysWithStableGeometry(
          displays,
          (current) => service.captureDisplays(current),
          () => screen.getAllDisplays(),
        );
        if (!stableCapture)
          throw new NativeWorkflowError(
            'capture-sources-unavailable',
            'The display layout changed while capture was being prepared. Try again after the displays settle.',
            true,
          );
        captured = stableCapture;
      } catch (error) {
        if (error instanceof NativeWorkflowError) throw error;
        if (error instanceof CaptureServiceError) {
          if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted')
            throw new NativeWorkflowError(
              'capture-permission-denied',
              'Allow Screen Recording for Imnota in macOS System Settings, then try again. You can also use Import or Paste.',
            );
          throw new NativeWorkflowError(
            error.kind === 'empty-region' ? 'capture-empty-region' : 'capture-sources-unavailable',
            `${error.message} Use Import or Paste instead.`,
            true,
          );
        }
        throw new NativeWorkflowError(
          'capture-sources-unavailable',
          'The screen capture source could not be read. Use Import or Paste instead.',
          true,
        );
      }
      assertLiveCaptureAdmission(event, admission);
      let outcome: CaptureOverlayOutcome;
      try {
        outcome = await chooseCaptureRegion(
          captured,
          listIdentifiableCaptureWindows(captured.map(({ display }) => display)),
          input.overlayMode ?? 'region',
        );
      } catch (error) {
        if (error instanceof CaptureServiceError)
          throw new NativeWorkflowError(
            'capture-sources-unavailable',
            `${error.message} Use Import or Paste instead.`,
            true,
          );
        throw new NativeWorkflowError(
          'capture-sources-unavailable',
          'The screen selection window could not be opened. Use Import or Paste instead.',
          true,
        );
      }
      assertLiveCaptureAdmission(event, admission);
      if (outcome.kind === 'cancelled')
        throw new NativeWorkflowError('capture-cancelled', 'Screen capture cancelled.');
      if (outcome.kind === 'failed')
        throw new NativeWorkflowError(
          'capture-failed',
          outcome.reason === 'misplaced'
            ? 'The selection window could not cover a display. Try again, or use Import or Paste instead.'
            : outcome.reason === 'display-changed'
              ? 'The display layout changed during capture. Try again after the displays settle.'
              : 'The screen selection window stopped before it was ready. Use Import or Paste instead.',
          true,
        );
      const selection = outcome.selection;
      let png: Buffer;
      try {
        png = service.compose(captured, selection);
      } catch (error) {
        if (error instanceof CaptureServiceError)
          throw new NativeWorkflowError(
            error.kind === 'empty-region' ? 'capture-empty-region' : 'capture-sources-unavailable',
            `${error.message} Use Import or Paste instead.`,
            error.kind !== 'empty-region',
          );
        throw new NativeWorkflowError(
          'capture-sources-unavailable',
          'The selected screen area could not be prepared. Use Import or Paste instead.',
          true,
        );
      }
      lastCaptureRegionMemory.remember(
        captured.map(({ display }) => display),
        selection,
        outcome.mode,
      );
      assertLiveCaptureAdmission(event, admission);
      if (!safeProjectPath || !input.collectionId) {
        host.pendingCapturePng = png;
        return { buffered: true as const, overlayAction: host.lastOverlayCommit };
      }
      const inserted = await insertCapturedPng(safeProjectPath, input.collectionId, png, () =>
        assertLiveCaptureAdmission(event, admission),
      );
      return { ...inserted, overlayAction: host.lastOverlayCommit };
    } finally {
      if (wasVisible && host.mainWindow && !host.mainWindow.isDestroyed()) {
        host.mainWindow.show();
        if (wasFocused) host.mainWindow.focus();
      }
    }
  });
  handleCaptureWorkflow('workflow:capture:repeat-last-region', async (event, admission, ...args) => {
    const [input] = z
      .tuple([z.object({ projectPath: pathInput, collectionId: filenameSchema }).strict()])
      .parse(args);
    assertLiveCaptureAdmission(event, admission);
    if (!host.preferenceSettingsResult.settings.capture.experimentalRegionCapture)
      throw new NativeWorkflowError(
        'capture-unavailable',
        'Experimental screen capture is off. Enable it in Settings, or use Import or Paste instead.',
      );
    if (process.platform === 'linux')
      throw new NativeWorkflowError(
        'capture-unavailable',
        'Screen capture is unavailable on Linux in this experimental release. Use Import or Paste instead.',
      );
    if (process.platform !== 'win32' && process.platform !== 'darwin')
      throw new NativeWorkflowError(
        'capture-unavailable',
        'Screen capture is unavailable on this platform. Use Import or Paste instead.',
      );
    if (process.platform === 'darwin') {
      const permission = systemPreferences.getMediaAccessStatus('screen');
      if (permission === 'denied' || permission === 'restricted')
        throw new NativeWorkflowError(
          'capture-permission-denied',
          'Allow Screen Recording for Imnota in macOS System Settings, then try again. You can also use Import or Paste.',
        );
    }
    const safeProjectPath = await assertProjectPath(input.projectPath);
    const beforeCapture = await readProjectMetadata(safeProjectPath);
    const beforeCollection = beforeCapture.collections.find((item) => item.id === input.collectionId);
    if (!beforeCollection)
      throw new NativeWorkflowError('collection-not-found', 'Choose a collection before capturing.');
    assertLiveCaptureAdmission(event, admission);
    const resolved = lastCaptureRegionMemory.resolve(screen.getAllDisplays());
    if (!resolved.ok)
      throw new NativeWorkflowError(
        resolved.kind === 'unavailable' ? 'capture-unavailable' : 'capture-sources-unavailable',
        resolved.message,
        resolved.kind === 'display-gone',
      );
    const wasVisible = Boolean(
      host.mainWindow && !host.mainWindow.isDestroyed() && host.mainWindow.isVisible(),
    );
    const wasFocused = Boolean(
      host.mainWindow && !host.mainWindow.isDestroyed() && host.mainWindow.isFocused(),
    );
    try {
      if (wasVisible) host.mainWindow?.hide();
      let captured: CapturedDisplayImage[];
      const service = captureService();
      try {
        const stableCapture = await captureAllDisplaysWithStableGeometry(
          resolved.displays,
          (displays) => service.captureDisplays(displays),
          () => screen.getAllDisplays(),
        );
        if (!stableCapture)
          throw new NativeWorkflowError(
            'capture-sources-unavailable',
            'The display layout changed while the last area was being prepared. Capture a new area, or reconnect the displays.',
            true,
          );
        captured = stableCapture;
      } catch (error) {
        if (error instanceof NativeWorkflowError) throw error;
        if (error instanceof CaptureServiceError) {
          if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted')
            throw new NativeWorkflowError(
              'capture-permission-denied',
              'Allow Screen Recording for Imnota in macOS System Settings, then try again. You can also use Import or Paste.',
            );
          throw new NativeWorkflowError(
            error.kind === 'empty-region' ? 'capture-empty-region' : 'capture-sources-unavailable',
            `${error.message} Use Import or Paste instead.`,
            true,
          );
        }
        throw new NativeWorkflowError(
          'capture-sources-unavailable',
          'The screen capture source could not be read. Use Import or Paste instead.',
          true,
        );
      }
      assertLiveCaptureAdmission(event, admission);
      let png: Buffer;
      try {
        png = service.compose(captured, resolved.selection);
      } catch (error) {
        if (error instanceof CaptureServiceError)
          throw new NativeWorkflowError(
            error.kind === 'empty-region' ? 'capture-empty-region' : 'capture-sources-unavailable',
            `${error.message} Use Import or Paste instead.`,
            error.kind !== 'empty-region',
          );
        throw new NativeWorkflowError(
          'capture-sources-unavailable',
          'The selected screen area could not be prepared. Use Import or Paste instead.',
          true,
        );
      }
      lastCaptureRegionMemory.remember(
        captured.map(({ display }) => display),
        resolved.selection,
        'region',
      );
      assertLiveCaptureAdmission(event, admission);
      return insertCapturedPng(safeProjectPath, input.collectionId, png, () =>
        assertLiveCaptureAdmission(event, admission),
      );
    } finally {
      if (wasVisible && host.mainWindow && !host.mainWindow.isDestroyed()) {
        host.mainWindow.show();
        if (wasFocused) host.mainWindow.focus();
      }
    }
  });
  handleWorkflow(
    'workflow:capture:commit-buffered',
    async (event, ...args) => {
      const [input] = z
        .tuple([z.object({ projectPath: pathInput, collectionId: filenameSchema }).strict()])
        .parse(args);
      const png = host.pendingCapturePng;
      if (!png)
        throw new NativeWorkflowError(
          'capture-failed',
          'The captured screenshot is no longer available. Capture the region again.',
        );
      const safeProjectPath = await assertProjectPath(input.projectPath);
      const inserted = await insertCapturedPng(safeProjectPath, input.collectionId, png, () => {
        if (
          event.sender.isDestroyed() ||
          !host.mainWindow ||
          host.mainWindow.isDestroyed() ||
          host.mainWindow.webContents !== event.sender
        )
          throw new NativeWorkflowError('capture-cancelled', 'Screen capture cancelled.');
      });
      host.pendingCapturePng = null;
      return inserted;
    },
    true,
  );
  handleWorkflow(
    'workflow:capture:discard-buffered',
    (_event, ...args) => {
      z.tuple([]).parse(args);
      host.pendingCapturePng = null;
    },
    true,
  );
}
