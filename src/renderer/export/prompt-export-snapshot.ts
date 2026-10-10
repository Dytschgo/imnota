import { orderedCollectionItems, type CollectionContentItem } from '../../shared/markdown';
import type { PromptCollectionInput } from '../../shared/prompt-bundles';
import {
  planPromptBundles,
  type MeasuredPromptScreenshot,
  type PromptBundleNoContent,
  type PromptCollectionItemInput,
  type PromptDrawingInput,
  type PromptScreenshotInput,
  type PromptTextInput,
} from '../../shared/prompt-bundles';
import { recognisedScreenshotText } from '../../shared/screenshot-ocr';
import type { Annotation, ImagePayload, ProjectData, ScreenshotRecord } from '../../shared/types';
import { cloneAndFreeze, failure, throwIfAborted } from './prompt-export-controller-helpers';
import type { PreparedPromptMetadata } from './prompt-export-controller-helpers';
import type { SavedPromptExportContext } from './prompt-export-controller-core';

/**
 * Versioned identity for the saved content represented by a prompt plan.
 * This is an in-memory cache key; it is not persisted or sent outside the app.
 */
export const PROMPT_EXPORT_SNAPSHOT_VERSION = 3;

const OCR_EXPORT_BUDGET_MS = 10_000;

export interface PromptExportSnapshotCaptureOptions {
  context: Readonly<SavedPromptExportContext>;
  signal: AbortSignal;
  reuseCheck: boolean;
  includeRecognisedText: boolean;
  /** Omitted means on, matching the setting's default. */
  includeSourceContext?: boolean;
  assertActive(): void;
  loadContentItem(input: { projectPath: string; itemId: string }): Promise<{
    item: CollectionContentItem;
    markdown?: string;
    source?: string;
    image?: ImagePayload;
    contentRevision: string;
  }>;
  loadScreenshotContent(input: { projectPath: string; screenshot: ScreenshotRecord }): Promise<{
    image: ImagePayload;
    annotations: Annotation[];
    description: string;
    contentRevision: string;
  }>;
  preflight(
    image: ImagePayload,
    annotations: readonly Annotation[],
    signal: AbortSignal,
  ): Promise<MeasuredPromptScreenshot>;
  recognizeScreenshotText?(input: {
    pngDataUrl: string;
    screenshotId: string;
    crop?: { x: number; y: number; width: number; height: number };
  }): Promise<string>;
}

export async function capturePromptExportSnapshot(
  options: PromptExportSnapshotCaptureOptions,
): Promise<PreparedPromptMetadata | PromptBundleNoContent> {
  const { context, signal, reuseCheck, assertActive } = options;
  const collection = context.snapshot.project.collections.find((item) => item.id === context.collectionId);
  if (!collection)
    throw failure(
      'save-failed',
      'The current collection no longer exists. Reload the project and try again.',
      true,
    );

  const measured: MeasuredPromptScreenshot[] = [];
  const promptItems: PromptCollectionItemInput[] = [];
  const imageFingerprints: Array<readonly [string, string]> = [];
  const hasMixedContentItems = Boolean(
    (context.snapshot.project as ProjectData & { contentItems?: unknown[] }).contentItems?.length,
  );
  const sourceByItemId = new Map<string, { filename: string; source: string; contentRevision: string }>();
  const ocrController = new AbortController();
  const cancelOcr = () => ocrController.abort();
  signal.addEventListener('abort', cancelOcr, { once: true });
  const ocrTimeout = window.setTimeout(cancelOcr, OCR_EXPORT_BUDGET_MS);
  try {
    for (const entry of orderedCollectionItems(context.snapshot.project, context.collectionId)) {
      assertActive();
      if (entry.kind === 'text') {
        const item = entry.item;
        if (!item.includeInExport) {
          promptItems.push({
            id: item.id,
            kind: 'text',
            position: item.position,
            includeInExport: false,
            markdown: '',
            contentRevision: 'excluded',
          });
          continue;
        }
        const loaded = await options.loadContentItem({
          projectPath: context.snapshot.projectPath,
          itemId: item.id,
        });
        assertActive();
        promptItems.push({
          id: item.id,
          kind: 'text',
          position: item.position,
          includeInExport: true,
          markdown: loaded.markdown ?? '',
          contentRevision: loaded.contentRevision,
        } satisfies PromptTextInput);
        continue;
      }
      if (entry.kind === 'drawing') {
        const item = entry.item;
        if (!item.includeInExport) {
          promptItems.push({
            id: item.id,
            kind: 'drawing',
            position: item.position,
            title: item.title ?? 'Untitled drawing',
            originalFilename: item.imageFilename,
            description: item.description ?? '',
            includeInExport: false,
            nativeWidth: item.originalWidth ?? 1,
            nativeHeight: item.originalHeight ?? 1,
            contentRevision: 'excluded',
            sourceFilename: item.sourceFilename ?? `${item.id}.json`,
          });
          continue;
        }
        const loaded = await options.loadContentItem({
          projectPath: context.snapshot.projectPath,
          itemId: item.id,
        });
        assertActive();
        if (!loaded.image)
          throw failure(
            'content-changed',
            'A drawing image is unavailable. Save the drawing and export again.',
            true,
          );
        imageFingerprints.push([item.id, await fingerprintPromptExportImage(loaded.image)]);
        assertActive();
        // Drawing PNGs already contain their final white crop/padding. Screenshot
        // preflight adds annotation margins that resolvePicture does not render again.
        if (!reuseCheck)
          measured.push({
            screenshotId: item.id,
            width: loaded.image.width,
            height: loaded.image.height,
            estimatedPngCharacters: loaded.image.dataUrl.length,
          });
        const sourceFilename = item.sourceFilename ?? `${item.id}.json`;
        if (loaded.source)
          sourceByItemId.set(item.id, {
            filename: sourceFilename,
            source: loaded.source,
            contentRevision: loaded.contentRevision,
          });
        promptItems.push({
          id: item.id,
          kind: 'drawing',
          position: item.position,
          title: item.title ?? 'Untitled drawing',
          originalFilename: item.imageFilename,
          description: item.description ?? '',
          includeInExport: true,
          nativeWidth: loaded.image.width,
          nativeHeight: loaded.image.height,
          contentRevision: loaded.contentRevision,
          sourceFilename,
        } satisfies PromptDrawingInput);
        continue;
      }
      const screenshot = entry.item as ScreenshotRecord;
      if (!screenshot.includeInExport) {
        promptItems.push({
          id: screenshot.id,
          kind: 'screenshot',
          position: screenshot.position,
          title: screenshot.title,
          originalFilename: screenshot.originalFilename,
          description: screenshot.description,
          priority: screenshot.priority,
          includeInExport: false,
          nativeWidth: screenshot.originalWidth,
          nativeHeight: screenshot.originalHeight,
          contentRevision: 'excluded',
          annotations: [],
        });
        continue;
      }
      const loaded = await options.loadScreenshotContent({
        projectPath: context.snapshot.projectPath,
        screenshot: cloneAndFreeze(screenshot) as ScreenshotRecord,
      });
      assertActive();
      imageFingerprints.push([screenshot.id, await fingerprintPromptExportImage(loaded.image)]);
      assertActive();
      const annotations = cloneAndFreeze(loaded.annotations) as readonly Annotation[];
      if (!reuseCheck) {
        const dimensions = await options.preflight(loaded.image, annotations, signal);
        assertActive();
        measured.push({
          screenshotId: screenshot.id,
          width: dimensions.width,
          height: dimensions.height,
          estimatedPngCharacters: dimensions.estimatedPngCharacters,
        });
      }
      assertActive();
      const visibleText = await recognisedScreenshotText({
        includeRecognisedText: options.includeRecognisedText,
        annotations,
        pngDataUrl: loaded.image.dataUrl,
        screenshotId: screenshot.id,
        nativeWidth: loaded.image.width,
        nativeHeight: loaded.image.height,
        recognizer: options.recognizeScreenshotText
          ? { recognize: options.recognizeScreenshotText }
          : undefined,
        signal: ocrController.signal,
      });
      assertActive();
      promptItems.push({
        id: screenshot.id,
        kind: 'screenshot',
        position: screenshot.position,
        title: screenshot.title,
        originalFilename: screenshot.originalFilename,
        description: loaded.description,
        priority: screenshot.priority,
        includeInExport: true,
        nativeWidth: loaded.image.width,
        nativeHeight: loaded.image.height,
        contentRevision: loaded.contentRevision,
        annotations,
        ...(visibleText ? { visibleText } : {}),
        ...(options.includeSourceContext !== false && screenshot.source ? { source: screenshot.source } : {}),
      });
    }
  } finally {
    window.clearTimeout(ocrTimeout);
    signal.removeEventListener('abort', cancelOcr);
  }

  const input = cloneAndFreeze({
    collectionId: collection.id,
    collectionName: collection.name,
    overallContext: collection.overallContext,
    screenshots: hasMixedContentItems ? [] : (promptItems as PromptScreenshotInput[]),
    items: hasMixedContentItems ? promptItems : undefined,
  }) as Readonly<PromptCollectionInput>;
  const snapshotFingerprint = await fingerprintPromptExportSnapshot(input, imageFingerprints);
  throwIfAborted(signal);
  assertActive();
  if (!reuseCheck) {
    const initial = planPromptBundles(input, measured);
    if (initial.kind === 'no-content') return initial;
  }
  return {
    context,
    input,
    snapshotFingerprint,
    measured: cloneAndFreeze(measured) as readonly MeasuredPromptScreenshot[],
    thumbnails: context.snapshot.thumbnails,
    sourceByItemId,
  };
}

/** Hash one loaded image at a time; only the digest survives snapshot capture. */
export async function fingerprintPromptExportImage(image: ImagePayload): Promise<string> {
  const bytes = new TextEncoder().encode(`${image.width}:${image.height}:${image.dataUrl}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintPromptExportSnapshot(
  input: PromptCollectionInput,
  imageFingerprints: readonly (readonly [string, string])[] = [],
): Promise<string> {
  const serialized = JSON.stringify({ input, imageFingerprints });
  const bytes = new TextEncoder().encode(
    `imnota-prompt-export-v${PROMPT_EXPORT_SNAPSHOT_VERSION}\0${serialized}`,
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
