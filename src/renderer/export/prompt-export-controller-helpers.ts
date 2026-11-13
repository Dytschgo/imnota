import type { TextWidthMeasurer } from '../../shared/annotation-geometry';
import { EXPORT_SAFETY_MARGIN, expandedExportBounds } from '../../shared/crop';
import {
  type MeasuredPromptScreenshot,
  type PromptBundle,
  type PromptBundlePlan,
  type PromptCollectionInput,
  type PromptDrawingInput,
  type PromptScreenshotInput,
} from '../../shared/prompt-bundles';
import type {
  PromptExportBundleGrant,
  PromptExportFinalized,
  PromptExportSessionInfo,
  WorkflowError,
  WorkflowResult,
} from '../../shared/workflow-bridge';
import { createBrowserTextMeasurer } from '../canvas/annotation-layout';
import {
  AnnotatedImageRenderLimitError,
  assertAnnotatedImageRenderBounds,
  renderAnnotatedImageWithDimensions,
} from '../export-image';
import { composePromptBundle, PromptBundleRenderError } from '../prompt-bundle-render';
import type { PromptBundleCardModel } from './PromptBundleCard';
import type {
  SavedPromptExportContext,
  PromptBundleControllerRendering,
  PromptBundleControllerErrorCode,
  PromptBundleControllerError,
  PromptBundleSelection,
} from './prompt-export-controller-core';

import { controllerExportFailure, nativeExportFailure, nativeFailureCatalog } from './export-failure-catalog';

/** Pure planning, limit and error helpers for the prompt export controller. */
export interface PreparedPromptMetadata {
  context: Readonly<SavedPromptExportContext>;
  input: Readonly<PromptCollectionInput>;
  snapshotFingerprint: string;
  measured: readonly MeasuredPromptScreenshot[];
  thumbnails: Readonly<Record<string, string>>;
  sourceByItemId: ReadonlyMap<string, { filename: string; source: string; contentRevision: string }>;
}

export interface PreparedPromptPlan extends PreparedPromptMetadata {
  plan: PromptBundlePlan;
  planId: string;
}

export interface SettledPromptPlan extends PreparedPromptPlan {
  encodedCharacters: ReadonlyMap<number, number>;
}

export interface PromptExportArtifact {
  sessionId: string;
  planId: string;
  projectPath: string;
  projectId: string;
  collectionId: string;
  grants: ReadonlyMap<number, PromptExportBundleGrant>;
  snapshotFingerprint: string;
}

export interface ActiveRun {
  id: number;
  controller: AbortController;
  session?: PromptExportSessionInfo;
  plan?: PreparedPromptPlan;
  terminalKind?: 'finish' | 'cancel';
  terminal?: Promise<WorkflowResult<PromptExportFinalized>>;
  finalized?: PromptExportFinalized;
}

export class ControllerFailure extends Error {
  constructor(readonly detail: PromptBundleControllerError) {
    super(detail.message);
    this.name = 'ControllerFailure';
  }
}

export const HARD_BUNDLE_MAX_EDGE = 16_384;
export const HARD_BUNDLE_MAX_PIXELS = 64_000_000;
// Encoded PNGs only, scoped to one export. Never retain decoded canvases or grow with collection size.
export const MAX_RETAINED_EXPORT_CHARACTERS = 8 * 1024 * 1024;
/** OCR is optional metadata: all screenshots in one Copy Bundle share this wait budget. */
export const OCR_EXPORT_BUDGET_MS = 10_000;
export let nextPlanId = 0;

export function freezeDeep<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

export function cloneAndFreeze<T>(value: T): Readonly<T> {
  const clone =
    typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  return freezeDeep(clone as T);
}

export function failure(
  code: PromptBundleControllerErrorCode,
  message: string,
  _retryable = true,
  fallbackAvailable = false,
  nativeCode?: WorkflowError['code'],
  technicalDetails?: string,
): ControllerFailure {
  // Every failure() message is written by the renderer and names the specific bundle, picture or
  // next step, so it stays visible. Raw IPC and OS text goes through nativeFailure/publicError instead.
  const detail = nativeCode
    ? {
        ...nativeExportFailure({ code: nativeCode, message, retryable: _retryable }, fallbackAvailable),
        message,
        technicalDetails,
      }
    : controllerExportFailure(code, technicalDetails, {
        safeMessage: code === 'unexpected' ? undefined : message,
        fallbackAvailable,
      });
  return new ControllerFailure(detail);
}

export function cancelledFailure(): ControllerFailure {
  return failure('cancelled', 'Prompt export was cancelled. Completed file pairs were kept.', true);
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledFailure();
}

export function actionableMessage(error: unknown, fallback: string): string {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : undefined;
  return message?.trim() || fallback;
}

export function nativeFailure(error: WorkflowError, fallbackAvailable = false): ControllerFailure {
  return new ControllerFailure(nativeExportFailure(error, fallbackAvailable));
}

export function cleanupPendingFailure(error: unknown): ControllerFailure {
  const detail = publicError(error);
  return new ControllerFailure({
    ...controllerExportFailure('cleanup-pending', detail.technicalDetails ?? detail.message),
    nativeCode: detail.nativeCode,
  });
}

export function unwrap<T>(result: WorkflowResult<T>, fallbackAvailable = false): T {
  if (!result.ok) throw nativeFailure(result.error, fallbackAvailable);
  return result.value;
}

export function defaultRendering(): PromptBundleControllerRendering {
  return {
    async preflight(image, annotations, signal) {
      throwIfAborted(signal);
      await document.fonts?.ready;
      throwIfAborted(signal);
      const measureText: TextWidthMeasurer = createBrowserTextMeasurer();
      const bounds = expandedExportBounds(
        image.width,
        image.height,
        annotations,
        EXPORT_SAFETY_MARGIN,
        measureText,
      );
      assertAnnotatedImageRenderBounds(bounds);
      return { screenshotId: '', width: bounds.width, height: bounds.height };
    },
    async render(image, annotations, options) {
      throwIfAborted(options.signal);
      const renderOptions = { margin: undefined, signal: options.signal };
      const rendered = await renderAnnotatedImageWithDimensions(image, annotations, renderOptions);
      throwIfAborted(options.signal);
      return rendered;
    },
    async compose(bundle, options) {
      const composeOptions = {
        signal: options.signal,
        resolvePicturePng: options.resolvePicturePng,
      };
      return composePromptBundle(bundle, composeOptions);
    },
  };
}

export function planId(): string {
  nextPlanId += 1;
  return `prompt-plan-${nextPlanId}`;
}

export function selectionNumber(selection?: PromptBundleSelection): number | undefined {
  return typeof selection === 'number' ? selection : selection?.bundleNumber;
}

export function estimatedBytes(encodedCharacters: number | undefined, markdown = ''): number | undefined {
  if (encodedCharacters === undefined) return undefined;
  return new TextEncoder().encode(markdown).length + Math.max(0, Math.floor((encodedCharacters * 3) / 4));
}

export function renderLimitMessage(bundle: PromptBundle): string {
  const pixels = bundle.layout.width * bundle.layout.height;
  return (
    `Bundle ${bundle.number} would be ${bundle.layout.width} × ${bundle.layout.height} ` +
    `(${(pixels / 1_000_000).toFixed(1)} MP), above the safe renderer limit of ` +
    `${HARD_BUNDLE_MAX_EDGE}px per side and ${HARD_BUNDLE_MAX_PIXELS / 1_000_000} MP. ` +
    'Move distant annotations closer, reduce oversized text, or reduce the screenshots in this collection.'
  );
}

export function assertBundleRenderLimit(bundle: PromptBundle): void {
  const { width, height } = bundle.layout;
  if (
    width > HARD_BUNDLE_MAX_EDGE ||
    height > HARD_BUNDLE_MAX_EDGE ||
    width * height > HARD_BUNDLE_MAX_PIXELS
  )
    throw failure('render-limit', renderLimitMessage(bundle), true);
}

export function plainHeading(value: string, fallback: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim() || fallback;
}

export function normalizedMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function masterMarkdown(
  plan: PromptBundlePlan,
  input: PromptCollectionInput,
  setName: string,
): string {
  const lines = [
    `# ${plainHeading(plan.collectionName, 'Untitled collection')}`,
    '',
    `Export set: ${plainHeading(setName, 'Prompt export')}`,
    '',
  ];
  const context = normalizedMarkdown(plan.overallContext);
  if (context.trim()) lines.push('## Overall context', '', context, '');
  lines.push('## Prompt bundles', '');
  for (const bundle of plan.bundles)
    lines.push(
      `- ${bundle.reference ?? `Bundle ${bundle.number}`}: ${bundle.pictureNumbers.map((number) => `Picture ${number}`).join(', ')}`,
    );
  lines.push('');
  lines.push('## Collection content', '');
  const ordered = (input.items ?? input.screenshots)
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => left.item.position - right.item.position || left.sourceIndex - right.sourceIndex);
  const includedById = new Map(
    plan.bundles.flatMap((bundle) =>
      bundle.pictures.map((picture) => [picture.screenshotId, picture] as const),
    ),
  );
  let visualNumber = 0;
  for (const { item } of ordered) {
    if (item.kind === 'text') {
      if (item.includeInExport && item.markdown.trim()) lines.push(normalizedMarkdown(item.markdown), '');
      else if (!item.includeInExport)
        lines.push('A text block was intentionally excluded from this export.', '');
      continue;
    }
    const pictureNumber = ++visualNumber;
    const screenshot = item as PromptScreenshotInput | PromptDrawingInput;
    const visualLabel = item.kind === 'drawing' ? 'Drawing' : 'Picture';
    lines.push(
      `### ${visualLabel} ${pictureNumber} — ${plainHeading(screenshot.title, screenshot.originalFilename)}`,
      '',
    );
    if (item.kind === 'screenshot') {
      const screenshotItem = item as PromptScreenshotInput;
      lines.push(
        `Priority for agent: ${screenshotItem.priority[0].toUpperCase()}${screenshotItem.priority.slice(1)}`,
        '',
      );
      const description = normalizedMarkdown(screenshotItem.description);
      if (description.trim()) lines.push(description, '');
    }
    if (!screenshot.includeInExport) {
      lines.push(`${visualLabel} ${pictureNumber} was intentionally excluded from this export.`, '');
      continue;
    }
    if (item.kind === 'drawing') {
      const description = normalizedMarkdown(item.description ?? '');
      if (description.trim()) lines.push(description, '');
    }
    const included = includedById.get(screenshot.id);
    for (const note of included?.notes ?? [])
      lines.push(`#### Picture ${pictureNumber} / Note ${note.number}`, '', note.text, '');
    if (included?.marks.length)
      lines.push(`#### Picture ${pictureNumber} / Marks`, '', ...included.marks, '');
    if (included?.visibleText) lines.push('#### Visible text', '', included.visibleText, '');
  }
  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
}

export function cardsForPlan(
  prepared: PreparedPromptPlan,
  encoded: ReadonlyMap<number, number> = new Map(),
  artifact?: PromptExportArtifact,
): PromptBundleCardModel[] {
  return prepared.plan.bundles.map((bundle) => {
    const actualPngCharacters = encoded.get(bundle.number);
    const pictureEstimates = bundle.pictures.map((picture) => picture.estimatedPngCharacters);
    const estimatedPngCharacters =
      bundle.pictures.length === 0
        ? 0
        : actualPngCharacters !== undefined && actualPngCharacters > 0
          ? actualPngCharacters
          : pictureEstimates.every((characters) => characters !== undefined && characters > 0)
            ? pictureEstimates.reduce<number>((total, characters) => total + characters!, 0)
            : undefined;
    return {
      planId: prepared.planId,
      artifactSessionId: artifact?.grants.has(bundle.number) ? artifact.sessionId : undefined,
      filenames: artifact?.grants.has(bundle.number)
        ? [
            artifact.grants.get(bundle.number)!.markdownFilename,
            artifact.grants.get(bundle.number)!.pngFilename,
          ].filter(Boolean)
        : undefined,
      bundleNumber: bundle.number,
      pictureNumbers: bundle.pictureNumbers,
      screenshotCount: bundle.pictures.length,
      textCount: bundle.textItems.length,
      excludedCount: bundle.excludedCount,
      width: bundle.layout.width,
      height: bundle.layout.height,
      estimatedBytes: estimatedBytes(estimatedPngCharacters, bundle.markdown),
      previewDataUrl: prepared.thumbnails[bundle.pictures[0]?.screenshotId],
      delivery: bundle.delivery,
      warning: bundle.warning,
      state: 'idle',
    };
  });
}

export function publicError(error: unknown): PromptBundleControllerError {
  if (error instanceof ControllerFailure) return error.detail;
  const message = actionableMessage(error, 'Prompt export failed unexpectedly.');
  if (
    error instanceof AnnotatedImageRenderLimitError ||
    (error && typeof error === 'object' && 'code' in error && error.code === 'ANNOTATED_IMAGE_RENDER_LIMIT')
  )
    return controllerExportFailure('render-limit', message, { safeMessage: message });
  if (error instanceof PromptBundleRenderError)
    return controllerExportFailure(error.code, message, {
      safeMessage: error.code === 'render-limit' ? message : undefined,
    });
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(nativeFailureCatalog, error.code)
  ) {
    const details =
      'details' in error && error.details && typeof error.details === 'object'
        ? (error.details as WorkflowError['details'])
        : undefined;
    return nativeExportFailure({
      code: error.code as WorkflowError['code'],
      message,
      retryable: false,
      details,
    });
  }
  if (error instanceof DOMException && error.name === 'AbortError') return cancelledFailure().detail;
  // Compatibility for older renderers without a typed render-limit error.
  if (/safe render|safe renderer|render limit|canvas safety|above the safe/i.test(message))
    return controllerExportFailure('render-limit', message);
  return controllerExportFailure('unexpected', message);
}
