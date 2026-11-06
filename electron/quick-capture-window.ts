import { BrowserWindow, ipcMain, nativeImage, screen, type IpcMainInvokeEvent } from 'electron';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Annotation } from '../src/shared/types.js';
import type {
  QuickCaptureCorner,
  QuickCaptureDestination,
  QuickCaptureState,
} from '../src/shared/quick-capture.js';
import { annotationSchema } from '../src/shared/schema.js';
import { MAX_CAPTURE_DIMENSION, MAX_CAPTURE_PIXELS } from '../src/shared/capture.js';
import { QuickCaptureStore, type PendingQuickCapture } from './quick-capture-store.js';
import { nativeClipboard } from './native-clipboard.js';
import { NativeWorkflowError, workflowOutcome } from './workflow-errors.js';
import { QuickCaptureDragFiles } from './quick-capture-drag-files.js';
import { hideWindowForCapture } from './capture-window-hide.js';

const selection = z
  .object({ id: z.string().regex(/^shot_[a-f0-9-]{36}$/), revision: z.number().int().positive() })
  .strict();
const destination = z
  .object({ projectPath: z.string().min(1).max(4096), collectionId: z.string().min(1).max(200) })
  .strict();

export interface QuickCaptureWindowDependencies {
  preload: string;
  html: string;
  temporaryDirectory: string;
  devUrl?: string;
  corner(): QuickCaptureCorner;
  updatePending(): boolean;
  destinations(): Promise<QuickCaptureState['destinations']>;
  authorize(projectPath: string): Promise<string>;
  insert(item: PendingQuickCapture, destination: QuickCaptureDestination): Promise<void>;
}

function decodePng(png: Buffer) {
  if (!png.length || png.length > 100_000_000)
    throw new Error('The capture PNG is too large. Previous pixels are kept.');
  // Bound decoding from the PNG's own dimensions before allocating a native bitmap.
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('The capture is not a PNG. Previous pixels are kept.');
  const declaredWidth = png.readUInt32BE(16),
    declaredHeight = png.readUInt32BE(20);
  if (
    !declaredWidth ||
    !declaredHeight ||
    declaredWidth > MAX_CAPTURE_DIMENSION ||
    declaredHeight > MAX_CAPTURE_DIMENSION ||
    declaredWidth * declaredHeight > MAX_CAPTURE_PIXELS
  )
    throw new Error('The capture PNG dimensions exceed safe limits. Previous pixels are kept.');
  const image = nativeImage.createFromBuffer(png);
  const { width, height } = image.getSize();
  if (
    image.isEmpty() ||
    width !== declaredWidth ||
    height !== declaredHeight ||
    width < 1 ||
    height < 1 ||
    width > MAX_CAPTURE_DIMENSION ||
    height > MAX_CAPTURE_DIMENSION ||
    width * height > MAX_CAPTURE_PIXELS
  )
    throw new Error('The capture PNG could not be decoded safely. Previous pixels are kept.');
  return {
    image,
    width,
    height,
    previewDataUrl: image.resize({ width: Math.min(300, width), quality: 'good' }).toDataURL(),
  };
}

export function quickCaptureBounds(
  workArea: Electron.Rectangle,
  corner: QuickCaptureCorner,
  editor: boolean,
  count: number,
): Electron.Rectangle {
  const width = Math.min(editor ? 900 : 340, workArea.width);
  const height = Math.min(editor ? 680 : 80 + Math.max(1, count) * 245, workArea.height);
  const gap = Math.min(
    16,
    Math.max(0, Math.floor((workArea.width - width) / 2)),
    Math.max(0, Math.floor((workArea.height - height) / 2)),
  );
  return {
    x: corner === 'left' ? workArea.x + gap : workArea.x + workArea.width - width - gap,
    y: workArea.y + workArea.height - height - gap,
    width,
    height,
  };
}

/** A separate narrow bridge; these senders never gain access to the workbench IPC router. */
export class QuickCaptureWindow {
  readonly store = new QuickCaptureStore(() => this.notify());
  private window: BrowserWindow | undefined;
  private loading: Promise<void> | undefined;
  private editor = false;
  private suspended = false;
  private showAfterCapture = false;
  private wasVisible = false;
  private wasFocused = false;
  private focusAfterCapture = false;
  private requestedEditor: string | undefined;
  private quitting = false;
  private readonly dragFiles: QuickCaptureDragFiles;

  constructor(private readonly dependencies: QuickCaptureWindowDependencies) {
    this.dragFiles = new QuickCaptureDragFiles(
      path.join(dependencies.temporaryDirectory, 'imnota-quick-capture-handoffs'),
    );
  }

  get enabled(): boolean {
    return this.dependencies.corner() !== 'off';
  }
  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }

  private notify(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('quick-capture:changed');
      if (!this.store.size) this.window.hide();
      else if (!this.editor) this.place();
    }
  }

  private place(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.window.setBounds(
      quickCaptureBounds(display.workArea, this.dependencies.corner(), this.editor, this.store.size),
    );
  }

  async show(focus = false): Promise<void> {
    if (!this.store.size) return;
    if (!this.window || this.window.isDestroyed()) {
      const window = new BrowserWindow({
        width: 340,
        height: 290,
        show: false,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: '#191c24',
        title: 'Imnota quick captures',
        webPreferences: {
          preload: this.dependencies.preload,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      this.window = window;
      // Windows' below-taskbar levels can drop topmost when that taskbar is not
      // topmost. Bounds stay inside the work area, so this level does not cover it.
      window.setAlwaysOnTop(true, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
      if (process.platform === 'darwin')
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.on('close', (event) => {
        if (!this.quitting) {
          event.preventDefault();
          window.hide();
        }
      });
      window.on('closed', () => {
        if (this.window === window) {
          this.window = undefined;
          this.loading = undefined;
          this.editor = false;
        }
      });
      window.webContents.on('render-process-gone', () => {
        window.destroy();
      });
      this.loading = this.dependencies.devUrl
        ? window.loadURL(new URL('quick-capture.html', `${this.dependencies.devUrl}/`).toString())
        : window.loadFile(this.dependencies.html);
    }
    try {
      await this.loading;
    } catch (error) {
      this.window?.destroy();
      this.window = undefined;
      this.loading = undefined;
      throw error;
    }
    this.place();
    if (this.suspended) {
      this.showAfterCapture = true;
      this.focusAfterCapture ||= focus;
      return;
    }
    if (focus) this.window!.show();
    else this.window!.showInactive();
    this.window!.setOpacity(1);
  }

  async add(png: Buffer, annotate = false): Promise<string> {
    this.quitting = false;
    const decoded = decodePng(png);
    const id = this.store.add({ png, ...decoded });
    if (annotate) this.requestedEditor = id;
    try {
      await this.show(annotate);
      this.notify();
    } catch {
      throw new NativeWorkflowError(
        'capture-failed',
        'The quick capture window could not open. Your capture is kept; reopen Pending captures from the tray.',
      );
    }
    return id;
  }

  async suspend(): Promise<void> {
    this.suspended = true;
    this.wasVisible = Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
    this.wasFocused = Boolean(this.window && !this.window.isDestroyed() && this.window.isFocused());
    await hideWindowForCapture(this.window);
  }

  resume(): void {
    this.suspended = false;
    if (this.wasVisible || this.showAfterCapture)
      void this.show(this.focusAfterCapture || this.wasFocused).catch(() => undefined);
    this.wasVisible = false;
    this.showAfterCapture = false;
    this.focusAfterCapture = false;
    this.wasFocused = false;
  }

  allowQuit(): void {
    this.quitting = true;
  }

  private trusted(event: Electron.IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(
      this.window &&
      !this.window.isDestroyed() &&
      event.sender === this.window.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      !this.dependencies.updatePending(),
    );
  }

  private register<T>(channel: string, schema: z.ZodType<T>, handler: (value: T) => unknown): void {
    ipcMain.handle(channel, (event, ...args) =>
      workflowOutcome(async () => {
        if (!this.trusted(event))
          throw new NativeWorkflowError(
            'permission-denied',
            'This quick capture action is unavailable from this window.',
          );
        const value = schema.parse(args);
        return handler(value);
      }),
    );
  }

  private async stageDrag(id: string, revision: number): Promise<void> {
    await this.store.use(id, revision, async (item) => {
      if (item.dragPath) return;
      const filePath = await this.dragFiles.prepare(item.renderedPng);
      this.store.setDragPath(id, revision, filePath);
    });
  }

  registerIpc(): void {
    this.register('quick-capture:state', z.tuple([]), async (): Promise<QuickCaptureState> => {
      try {
        return {
          cards: this.store.cards(),
          destinations: await this.dependencies.destinations(),
          editorCaptureId: this.requestedEditor,
        };
      } catch (error) {
        return {
          cards: this.store.cards(),
          editorCaptureId: this.requestedEditor,
          destinations: [],
          destinationError:
            error instanceof Error
              ? error.message
              : 'Collections could not be loaded. Copy and Discard are still available.',
        };
      }
    });
    this.register('quick-capture:copy', z.tuple([selection]), async ([input]) =>
      this.store.use(input.id, input.revision, async (item) => {
        await nativeClipboard.writeImage(decodePng(item.renderedPng).image);
      }),
    );
    this.register('quick-capture:discard', z.tuple([selection]), ([input]) =>
      this.store.discard(input.id, input.revision),
    );
    this.register('quick-capture:add', z.tuple([selection.extend({ destination })]), async ([input]) => {
      const projectPath = await this.dependencies.authorize(input.destination.projectPath);
      await this.store.commit(
        input.id,
        input.revision,
        { ...input.destination, projectPath },
        this.dependencies.insert,
      );
    });
    this.register('quick-capture:edit', z.tuple([selection]), ([input]) => {
      const item = this.store.item(input.id, input.revision);
      if (item.busy || item.destination)
        throw new Error('Finish the pending Add before annotating this capture.');
      return {
        image: {
          filename: 'Screen capture.png',
          dataUrl: `data:image/png;base64,${item.originalPng.toString('base64')}`,
          width: item.width,
          height: item.height,
        },
        annotations: item.annotations,
      };
    });
    this.register(
      'quick-capture:apply',
      z.tuple([
        selection.extend({
          annotations: z.array(annotationSchema).max(10000),
          pngDataUrl: z.string().max(134_000_000).startsWith('data:image/png;base64,'),
        }),
      ]),
      ([input]) => {
        const png = Buffer.from(input.pngDataUrl.slice('data:image/png;base64,'.length), 'base64');
        const decoded = decodePng(png);
        this.store.apply(input.id, input.revision, {
          png,
          annotations: input.annotations as Annotation[],
          previewDataUrl: decoded.previewDataUrl,
        });
      },
    );
    this.register('quick-capture:resize', z.tuple([z.boolean()]), ([editor]) => {
      this.editor = editor;
      if (editor) this.requestedEditor = undefined;
      this.place();
      this.notify();
    });
    this.register('quick-capture:hide', z.tuple([]), () => this.window?.hide());
    this.register('quick-capture:prepare-drag', z.tuple([selection]), ([input]) =>
      this.stageDrag(input.id, input.revision),
    );
    ipcMain.on('quick-capture:drag', (event, input: unknown) => {
      if (!this.trusted(event)) return;
      try {
        const value = selection.parse(input);
        const item = this.store.item(value.id, value.revision);
        if (item.busy || !item.dragPath)
          throw new Error('The PNG is not ready to drag. Focus Drag PNG and try again, or use Copy image.');
        const stat = lstatSync(item.dragPath);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.size !== item.renderedPng.length
        )
          throw new Error('The temporary PNG is unavailable. Use Copy image or Add to collection instead.');
        event.sender.startDrag({
          file: item.dragPath,
          icon: decodePng(item.renderedPng).image.resize({ width: 120 }),
        });
      } catch (error) {
        event.sender.send(
          'quick-capture:drag-error',
          error instanceof Error
            ? error.message
            : 'Native drag is unavailable. Use Copy image or Add to collection.',
        );
      }
    });
  }
}
