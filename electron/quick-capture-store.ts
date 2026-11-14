import { randomUUID } from 'node:crypto';
import type { Annotation } from '../src/shared/types.js';
import type { ScreenshotSource } from '../src/shared/source-context.js';
import type { QuickCaptureCard, QuickCaptureDestination } from '../src/shared/quick-capture.js';
import { NativeWorkflowError } from './workflow-errors.js';

export const QUICK_CAPTURE_LIMIT = 3;
export const QUICK_CAPTURE_BYTE_LIMIT = 200_000_000;

export interface PendingQuickCapture {
  id: string;
  revision: number;
  originalPng: Buffer;
  renderedPng: Buffer;
  annotations: Annotation[];
  source?: ScreenshotSource;
  previewDataUrl: string;
  width: number;
  height: number;
  busy: boolean;
  destination?: QuickCaptureDestination;
  message?: string;
  dragPath?: string;
}

/** Owns captures until an explicit successful Add or Discard. No eviction or project writes. */
export class QuickCaptureStore {
  private readonly items = new Map<string, PendingQuickCapture>();

  constructor(private readonly changed: () => void = () => undefined) {}

  get size(): number {
    return this.items.size;
  }

  private bytes(): number {
    return [...this.items.values()].reduce(
      (total, item) =>
        total +
        item.originalPng.length +
        (item.originalPng === item.renderedPng ? 0 : item.renderedPng.length),
      0,
    );
  }

  assertCanCapture(): void {
    if (this.items.size >= QUICK_CAPTURE_LIMIT || this.bytes() >= QUICK_CAPTURE_BYTE_LIMIT)
      throw new NativeWorkflowError(
        'capture-failed',
        'Quick capture is full. Add or discard a pending capture before taking another. Existing captures are kept.',
      );
  }

  add(input: {
    png: Buffer;
    previewDataUrl: string;
    width: number;
    height: number;
    source?: ScreenshotSource;
  }): string {
    this.assertCanCapture();
    if (
      !input.png.length ||
      input.png.length > 100_000_000 ||
      this.bytes() + input.png.length > QUICK_CAPTURE_BYTE_LIMIT
    )
      throw new NativeWorkflowError(
        'capture-failed',
        'The capture does not fit in quick access. Existing captures are kept; add or discard one and capture again.',
      );
    const id = `shot_${randomUUID()}`;
    const ownedPng = Buffer.from(input.png);
    this.items.set(id, {
      id,
      revision: 1,
      originalPng: ownedPng,
      renderedPng: ownedPng,
      annotations: [],
      ...(input.source ? { source: { ...input.source } } : {}),
      previewDataUrl: input.previewDataUrl,
      width: input.width,
      height: input.height,
      busy: false,
    });
    this.changed();
    return id;
  }

  cards(): QuickCaptureCard[] {
    return [...this.items.values()].map(
      ({ id, revision, previewDataUrl, width, height, busy, destination, message, dragPath }) => ({
        id,
        revision,
        previewDataUrl,
        width,
        height,
        busy,
        destination: destination ? { ...destination } : undefined,
        message,
        dragAvailable: Boolean(dragPath),
      }),
    );
  }

  item(id: string, revision: number): PendingQuickCapture {
    const item = this.items.get(id);
    if (!item)
      throw new NativeWorkflowError(
        'capture-failed',
        'This capture is no longer pending. Other captures are unchanged.',
      );
    if (item.revision !== revision)
      throw new NativeWorkflowError(
        'capture-failed',
        'This capture has newer edits. Review its current preview and retry.',
      );
    return item;
  }

  private available(id: string, revision: number): PendingQuickCapture {
    const item = this.item(id, revision);
    if (item.busy)
      throw new NativeWorkflowError(
        'capture-failed',
        'This capture has an action in progress. Wait for its result before retrying.',
      );
    return item;
  }

  async use<T>(id: string, revision: number, action: (item: PendingQuickCapture) => Promise<T>): Promise<T> {
    const item = this.available(id, revision);
    item.busy = true;
    item.message = undefined;
    this.changed();
    try {
      return await action(item);
    } catch (error) {
      item.message =
        error instanceof Error ? error.message : 'The action failed. This capture is kept for retry.';
      throw error;
    } finally {
      item.busy = false;
      this.changed();
    }
  }

  async commit(
    id: string,
    revision: number,
    destination: QuickCaptureDestination,
    insert: (item: PendingQuickCapture, destination: QuickCaptureDestination) => Promise<void>,
  ): Promise<void> {
    // Claim before the first await, including before entering the filesystem queue.
    await this.use(id, revision, async (item) => {
      if (
        item.destination &&
        (item.destination.projectPath !== destination.projectPath ||
          item.destination.collectionId !== destination.collectionId)
      )
        throw new NativeWorkflowError(
          'capture-failed',
          'Retry Add to its original destination. The previous write may already have completed.',
        );
      item.destination = { ...destination };
      await insert(item, item.destination);
      this.items.delete(id);
    });
  }

  discard(id: string, revision: number): void {
    this.available(id, revision);
    this.items.delete(id);
    this.changed();
  }

  discardAll(): void {
    if ([...this.items.values()].some((item) => item.busy))
      throw new NativeWorkflowError(
        'capture-failed',
        'A capture action is still in progress. Wait for its result before quitting.',
      );
    this.items.clear();
    this.changed();
  }

  apply(
    id: string,
    revision: number,
    input: { png: Buffer; annotations: Annotation[]; previewDataUrl: string },
  ): void {
    const item = this.available(id, revision);
    if (item.destination)
      throw new NativeWorkflowError(
        'capture-failed',
        'Finish retrying Add before changing this capture. Its saved result has not been confirmed.',
      );
    const oldRenderedBytes = item.renderedPng === item.originalPng ? 0 : item.renderedPng.length;
    if (
      !input.png.length ||
      input.png.length > 100_000_000 ||
      this.bytes() - oldRenderedBytes + input.png.length > QUICK_CAPTURE_BYTE_LIMIT
    )
      throw new NativeWorkflowError(
        'capture-failed',
        'These edits exceed the quick capture memory limit. The previous capture is kept.',
      );
    item.renderedPng = input.png;
    item.annotations = structuredClone(input.annotations);
    item.previewDataUrl = input.previewDataUrl;
    item.revision++;
    item.dragPath = undefined;
    item.message = undefined;
    this.changed();
  }

  setDragPath(id: string, revision: number, filePath: string): void {
    this.item(id, revision).dragPath = filePath;
    this.changed();
  }
}
