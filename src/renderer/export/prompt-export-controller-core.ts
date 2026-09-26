import { orderedCollectionItems, type CollectionContentItem } from '../../shared/markdown';
import { recognisedScreenshotText } from '../../shared/screenshot-ocr';
import {
  applyPromptBundleMarkdownIdentity,
  planPromptBundles,
  type MeasuredPromptScreenshot,
  type PromptBundle,
  type PromptBundleNoContent,
  type PromptBundleProgress,
  type PromptCollectionInput,
  type PromptCollectionItemInput,
  type PromptDrawingInput,
  type PromptScreenshotInput,
  type PromptTextInput,
} from '../../shared/prompt-bundles';
import type {
  Annotation,
  ImagePayload,
  ProjectData,
  ProjectSnapshot,
  ScreenshotRecord,
} from '../../shared/types';
import type {
  PromptExportBundleContent,
  PromptExportBundleGrant,
  PromptExportCopyResult,
  PromptExportCopyTarget,
  PromptExportFinalized,
  PromptExportSessionInfo,
  WorkflowError,
  WorkflowResult,
  WindowsCopyVariantId,
} from '../../shared/workflow-bridge';
import { describeCopyDelivery } from './clipboard-delivery';
import { type AnnotatedImageRender } from '../export-image';
import {
  type ComposedPromptBundle,
  type PromptBundleComposition,
  type ResolvedPromptPicturePng,
} from '../prompt-bundle-render';

// Encoded PNGs only, scoped to one export. Never retain decoded canvases or grow
// with collection size: eight million UTF-16 characters cost at most 16 MiB.
export const MAX_RETAINED_EXPORT_CHARACTERS = 8 * 1024 * 1024;

async function imageFingerprint(image: ImagePayload): Promise<string> {
  const bytes = new TextEncoder().encode(`${image.width}:${image.height}:${image.dataUrl}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
import type {
  PromptBundleActionRequest,
  PromptBundleCardModel,
  PromptDeliveryOutcome,
} from './PromptBundleCard';
import {
  PreparedPromptMetadata,
  PreparedPromptPlan,
  SettledPromptPlan,
  PromptExportArtifact,
  ActiveRun,
  ControllerFailure,
  OCR_EXPORT_BUDGET_MS,
  cloneAndFreeze,
  failure,
  cancelledFailure,
  throwIfAborted,
  actionableMessage,
  nativeFailure,
  cleanupPendingFailure,
  unwrap,
  defaultRendering,
  planId,
  selectionNumber,
  assertBundleRenderLimit,
  masterMarkdown,
  cardsForPlan,
  publicError,
} from './prompt-export-controller-helpers';

export interface SavedPromptExportContext {
  snapshot: ProjectSnapshot;
  collectionId: string;
}

export interface PromptExportBundleManifestInput {
  bundleNumber: number;
  width: number;
  height: number;
}

export interface PromptBundleControllerBridge {
  copyText?(text: string): Promise<void>;
  loadScreenshotContent(input: { projectPath: string; screenshot: ScreenshotRecord }): Promise<{
    image: ImagePayload;
    annotations: Annotation[];
    description: string;
    contentRevision: string;
  }>;
  loadContentItem?(input: { projectPath: string; itemId: string }): Promise<{
    item: CollectionContentItem;
    markdown?: string;
    source?: string;
    image?: ImagePayload;
    contentRevision: string;
  }>;
  startPromptExport(input: {
    projectPath: string;
    collectionId: string;
    bundles: readonly PromptExportBundleManifestInput[];
  }): Promise<WorkflowResult<PromptExportSessionInfo>>;
  writePromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
    pngDataUrl?: string;
    markdown: string;
    sourceAssets?: readonly { filename: string; source: string }[];
  }): Promise<WorkflowResult<PromptExportBundleGrant>>;
  finishPromptExport(input: {
    sessionId: string;
    masterMarkdown?: string;
  }): Promise<WorkflowResult<PromptExportFinalized>>;
  cancelPromptExport(input: { sessionId: string }): Promise<WorkflowResult<PromptExportFinalized>>;
  readPromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
  }): Promise<WorkflowResult<PromptExportBundleContent>>;
  copyPromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
    target: PromptExportCopyTarget;
  }): Promise<WorkflowResult<PromptExportCopyResult>>;
  openPromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
    target: 'folder' | 'png' | 'markdown' | 'master';
  }): Promise<WorkflowResult<void>>;
  recognizeScreenshotText?(input: {
    pngDataUrl: string;
    screenshotId: string;
    crop?: { x: number; y: number; width: number; height: number };
  }): Promise<string>;
}

export interface PromptPictureResolveResult extends ResolvedPromptPicturePng {
  contentRevision: string;
}

export interface PromptBundleComposeControllerOptions {
  signal: AbortSignal;
  resolvePicturePng(picture: PromptBundle['pictures'][number]): Promise<PromptPictureResolveResult>;
}

export interface PromptBundleControllerRendering {
  preflight(
    image: ImagePayload,
    annotations: readonly Annotation[],
    signal: AbortSignal,
  ): Promise<MeasuredPromptScreenshot>;
  render(
    image: ImagePayload,
    annotations: Annotation[],
    options: { signal: AbortSignal },
  ): Promise<AnnotatedImageRender>;
  compose(
    bundle: PromptBundle,
    options: PromptBundleComposeControllerOptions,
  ): Promise<PromptBundleComposition>;
}

export type PromptBundleControllerErrorCode =
  | 'busy'
  | 'cancelled'
  | 'cleanup-pending'
  | 'content-changed'
  | 'disposed'
  | 'invalid-bundle'
  | 'native-failure'
  | 'no-content'
  | 'render-limit'
  | 'save-failed'
  | 'unexpected';

export interface PromptBundleControllerError {
  code: PromptBundleControllerErrorCode;
  message: string;
  retryable: boolean;
  fallbackAvailable: boolean;
  nativeCode?: WorkflowError['code'];
}

export type PromptBundleControllerActionResult =
  { ok: true; sessionId?: string; bundleNumber?: number } | { ok: false; error: PromptBundleControllerError };

export interface HostedShareArtifacts {
  title: string;
  sessionId: string;
  bundleNumbers: readonly number[];
  imageBundleNumbers: readonly number[];
}

export interface PromptBundleLargePreview {
  bundleNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PromptBundleControllerState {
  cards: readonly PromptBundleCardModel[];
  progress?: PromptBundleProgress;
  error?: PromptBundleControllerError;
  isOpen: boolean;
  cleanupPending: boolean;
  noContentMessage?: string;
  preview?: PromptBundleLargePreview;
}

export type PromptBundleSelection =
  number | Pick<PromptBundleActionRequest, 'bundleNumber' | 'planId' | 'artifactSessionId'>;

export interface PromptBundleControllerEngineOptions {
  getSavedContext(): Promise<SavedPromptExportContext>;
  bridge: PromptBundleControllerBridge;
  rendering?: Partial<PromptBundleControllerRendering>;
  includeMasterOverview?: boolean;
  getIncludeRecognisedText?(): boolean;
}

export class PromptBundleControllerEngine {
  private state: PromptBundleControllerState = { cards: [], isOpen: false, cleanupPending: false };
  private readonly listeners = new Set<() => void>();
  private readonly bridge: PromptBundleControllerBridge;
  private readonly rendering: PromptBundleControllerRendering;
  private readonly getSavedContext: () => Promise<SavedPromptExportContext>;
  private readonly includeMasterOverview: boolean;
  private readonly getIncludeRecognisedText: () => boolean;
  private activeRun?: ActiveRun;
  private latestPlan?: PreparedPromptPlan;
  private latestArtifact?: PromptExportArtifact;
  private runSequence = 0;
  private previewSequence = 0;
  private previewAbort?: AbortController;
  private pendingCleanup?: ActiveRun;
  private disposed = false;

  constructor(options: PromptBundleControllerEngineOptions) {
    this.bridge = options.bridge;
    this.getSavedContext = options.getSavedContext;
    this.rendering = { ...defaultRendering(), ...options.rendering };
    this.includeMasterOverview = options.includeMasterOverview ?? true;
    this.getIncludeRecognisedText = options.getIncludeRecognisedText ?? (() => true);
  }

  getState = (): PromptBundleControllerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(patch: Partial<PromptBundleControllerState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setCardState(bundleNumber: number, state: PromptBundleCardModel['state'], error?: string): void {
    this.emit({
      cards: this.state.cards.map((card) =>
        card.bundleNumber === bundleNumber ? { ...card, state, error } : card,
      ),
    });
  }

  private deliveryCompleted(
    bundleNumber: number,
    outcome: PromptDeliveryOutcome | undefined,
    primaryCopy = false,
    warning?: string,
    showExportProgress = true,
  ): void {
    this.emit({
      error: undefined,
      cards: this.state.cards.map((card) =>
        card.bundleNumber === bundleNumber
          ? { ...card, state: primaryCopy ? 'copied' : 'idle', outcome, error: undefined, warning }
          : card,
      ),
      progress: showExportProgress
        ? { phase: 'complete', bundleNumber, totalBundles: this.state.cards.length }
        : undefined,
    });
  }

  private resultError(error: unknown, run?: ActiveRun): PromptBundleControllerActionResult {
    const detail = publicError(error);
    if (!run || this.activeRun === run) {
      this.emit({
        error: detail,
        progress: {
          phase: detail.code === 'cancelled' ? 'cancelled' : 'error',
          message: detail.message,
        },
      });
      if (run) this.activeRun = undefined;
    }
    return { ok: false, error: detail };
  }

  private beginRun(): ActiveRun {
    if (this.disposed)
      throw failure('disposed', 'The prompt export controller is no longer available.', false);
    if (this.activeRun) throw failure('busy', 'Another prompt export action is already running.', true);
    const run = { id: ++this.runSequence, controller: new AbortController() };
    this.activeRun = run;
    return run;
  }

  private assertActive(run: ActiveRun): void {
    throwIfAborted(run.controller.signal);
    if (this.activeRun !== run) throw cancelledFailure();
  }

  private async loadContentItem(input: { projectPath: string; itemId: string }) {
    if (!this.bridge.loadContentItem)
      throw failure(
        'save-failed',
        'Mixed content is unavailable until the native content bridge is installed.',
        true,
      );
    return this.bridge.loadContentItem(input);
  }

  private async readSavedContext(signal: AbortSignal): Promise<Readonly<SavedPromptExportContext>> {
    throwIfAborted(signal);
    let saved: SavedPromptExportContext;
    try {
      saved = await this.getSavedContext();
    } catch (error) {
      throw failure(
        'save-failed',
        `Latest changes could not be saved, so no export was created. ${actionableMessage(error, 'Try saving again.')}`,
        true,
      );
    }
    throwIfAborted(signal);
    return cloneAndFreeze(saved);
  }

  private assertArtifactContext(
    artifact: PromptExportArtifact,
    context: Readonly<SavedPromptExportContext>,
  ): void {
    if (
      artifact.projectPath !== context.snapshot.projectPath ||
      artifact.projectId !== context.snapshot.project.id
    )
      throw failure(
        'content-changed',
        'These files belong to another project. Prepare fresh files for the current project.',
      );
    if (artifact.input.collectionId !== context.collectionId)
      throw failure(
        'content-changed',
        'These files belong to another collection. Prepare fresh files for the current collection.',
      );
  }

  private async validateArtifactContext(artifact: PromptExportArtifact, signal: AbortSignal): Promise<void> {
    const context = await this.readSavedContext(signal);
    this.assertArtifactContext(artifact, context);
    if (this.latestArtifact !== artifact)
      throw failure(
        'invalid-bundle',
        'These files belong to an older export session. Use the latest prompt card.',
      );
  }

  private async prepareMetadata(
    run: ActiveRun,
    artifact?: PromptExportArtifact,
    reuseCheck = false,
  ): Promise<PreparedPromptMetadata | PromptBundleNoContent> {
    if (!reuseCheck)
      this.emit({ error: undefined, noContentMessage: undefined, progress: { phase: 'planning' } });
    const context = await this.readSavedContext(run.controller.signal);
    this.assertActive(run);
    if (artifact) this.assertArtifactContext(artifact, context);
    const collection = context.snapshot.project.collections.find((item) => item.id === context.collectionId);
    if (!collection)
      throw failure(
        'save-failed',
        'The current collection no longer exists. Reload the project and try again.',
        true,
      );
    const measured: MeasuredPromptScreenshot[] = [];
    const promptItems: PromptCollectionItemInput[] = [];
    const hasMixedContentItems = Boolean(
      (context.snapshot.project as ProjectData & { contentItems?: unknown[] }).contentItems?.length,
    );
    const sourceByItemId = new Map<string, { filename: string; source: string; contentRevision: string }>();
    const ocrController = new AbortController();
    const cancelOcr = () => ocrController.abort();
    run.controller.signal.addEventListener('abort', cancelOcr, { once: true });
    const ocrTimeout = window.setTimeout(cancelOcr, OCR_EXPORT_BUDGET_MS);
    try {
      for (const entry of orderedCollectionItems(context.snapshot.project, context.collectionId)) {
        this.assertActive(run);
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
          const loaded = await this.loadContentItem({
            projectPath: context.snapshot.projectPath,
            itemId: item.id,
          });
          this.assertActive(run);
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
          const loaded = await this.loadContentItem({
            projectPath: context.snapshot.projectPath,
            itemId: item.id,
          });
          this.assertActive(run);
          if (!loaded.image)
            throw failure(
              'content-changed',
              'A drawing image is unavailable. Save the drawing and export again.',
              true,
            );
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
        const loaded = await this.bridge.loadScreenshotContent({
          projectPath: context.snapshot.projectPath,
          screenshot: cloneAndFreeze(screenshot) as ScreenshotRecord,
        });
        this.assertActive(run);
        const annotations = cloneAndFreeze(loaded.annotations) as readonly Annotation[];
        if (!reuseCheck) {
          const dimensions = await this.rendering.preflight(loaded.image, annotations, run.controller.signal);
          this.assertActive(run);
          measured.push({
            screenshotId: screenshot.id,
            width: dimensions.width,
            height: dimensions.height,
            estimatedPngCharacters: dimensions.estimatedPngCharacters,
          });
        }
        this.assertActive(run);
        const visibleText = await recognisedScreenshotText({
          includeRecognisedText: this.getIncludeRecognisedText(),
          annotations,
          pngDataUrl: loaded.image.dataUrl,
          screenshotId: screenshot.id,
          nativeWidth: loaded.image.width,
          nativeHeight: loaded.image.height,
          recognizer: this.bridge.recognizeScreenshotText
            ? { recognize: (input) => this.bridge.recognizeScreenshotText!(input) }
            : undefined,
          signal: ocrController.signal,
        });
        this.assertActive(run);
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
        });
      }
    } finally {
      window.clearTimeout(ocrTimeout);
      run.controller.signal.removeEventListener('abort', cancelOcr);
    }
    const input = cloneAndFreeze({
      collectionId: collection.id,
      collectionName: collection.name,
      overallContext: collection.overallContext,
      screenshots: hasMixedContentItems ? [] : (promptItems as PromptScreenshotInput[]),
      items: hasMixedContentItems ? promptItems : undefined,
    }) as Readonly<PromptCollectionInput>;
    // A reused copy only compares the saved input with its artifact. Changed input
    // takes the fresh path, which performs full measurement and no-content checks.
    if (!reuseCheck) {
      const initial = planPromptBundles(input, measured);
      if (initial.kind === 'no-content') return initial;
    }
    return {
      context,
      input,
      measured: cloneAndFreeze(measured) as readonly MeasuredPromptScreenshot[],
      thumbnails: context.snapshot.thumbnails,
      sourceByItemId,
    };
  }

  private planMetadata(
    metadata: PreparedPromptMetadata,
    breakBeforeScreenshotIds: ReadonlySet<string> = new Set(),
  ): PreparedPromptPlan {
    const result = planPromptBundles(metadata.input, metadata.measured, { breakBeforeScreenshotIds });
    if (result.kind === 'no-content') throw failure('no-content', result.message, true);
    return { ...metadata, plan: result, planId: planId() };
  }

  private async resolvePicture(
    prepared: PreparedPromptPlan,
    picture: PromptBundle['pictures'][number],
    signal: AbortSignal,
    fingerprints?: Map<string, string>,
  ): Promise<PromptPictureResolveResult> {
    throwIfAborted(signal);
    if (picture.kind === 'drawing') {
      const loaded = await this.loadContentItem({
        projectPath: prepared.context.snapshot.projectPath,
        itemId: picture.screenshotId,
      });
      throwIfAborted(signal);
      if (!loaded.image || loaded.contentRevision !== picture.contentRevision)
        throw failure(
          'content-changed',
          `Drawing ${picture.pictureNumber} changed after export planning. Save and export again.`,
          true,
        );
      return {
        dataUrl: loaded.image.dataUrl,
        width: loaded.image.width,
        height: loaded.image.height,
        contentRevision: loaded.contentRevision,
        release: () => undefined,
      };
    }
    const screenshot = prepared.context.snapshot.project.screenshots.find(
      (item) => item.collectionId === prepared.context.collectionId && item.id === picture.screenshotId,
    );
    if (!screenshot)
      throw failure(
        'content-changed',
        `Picture ${picture.pictureNumber} is no longer in this collection. Save and export again.`,
        true,
      );
    const loaded = await this.bridge.loadScreenshotContent({
      projectPath: prepared.context.snapshot.projectPath,
      screenshot: cloneAndFreeze(screenshot) as ScreenshotRecord,
    });
    throwIfAborted(signal);
    if (loaded.contentRevision !== picture.contentRevision)
      throw failure(
        'content-changed',
        `Picture ${picture.pictureNumber} changed after export planning. Save the latest version and export again.`,
        true,
      );
    const renderOptions = { signal };
    if (fingerprints) fingerprints.set(picture.screenshotId, await imageFingerprint(loaded.image));
    throwIfAborted(signal);
    const rendered = await this.rendering.render(loaded.image, loaded.annotations, renderOptions);
    throwIfAborted(signal);
    return {
      dataUrl: rendered.dataUrl,
      width: rendered.width,
      height: rendered.height,
      contentRevision: loaded.contentRevision,
      release: () => undefined,
    };
  }

  private async compose(
    prepared: PreparedPromptPlan,
    bundle: PromptBundle,
    signal: AbortSignal,
    fingerprints?: Map<string, string>,
  ) {
    if (!bundle.pictures.length)
      return {
        kind: 'composed' as const,
        dataUrl: undefined,
        width: 0,
        height: 0,
        encodedCharacters: 0,
        delivery: 'clipboard' as const,
      };
    assertBundleRenderLimit(bundle);
    const composeOptions = {
      signal,
      resolvePicturePng: (picture: PromptBundle['pictures'][number]) =>
        this.resolvePicture(prepared, picture, signal, fingerprints),
    };
    return this.rendering.compose(bundle, composeOptions);
  }

  private async verifyBundleContent(
    prepared: PreparedPromptPlan,
    bundle: PromptBundle,
    signal: AbortSignal,
    fingerprints?: ReadonlyMap<string, string>,
  ): Promise<readonly { filename: string; source: string }[]> {
    const assets: { filename: string; source: string }[] = [];
    for (const text of bundle.textItems) {
      throwIfAborted(signal);
      const loaded = await this.loadContentItem({
        projectPath: prepared.context.snapshot.projectPath,
        itemId: text.itemId,
      });
      if (loaded.contentRevision !== text.contentRevision || (loaded.markdown ?? '') !== text.markdown)
        throw failure(
          'content-changed',
          'Text content changed after export planning. Save and export again.',
          true,
        );
    }
    for (const picture of bundle.pictures) {
      if (picture.kind !== 'drawing') {
        if (fingerprints) {
          throwIfAborted(signal);
          const screenshot = prepared.context.snapshot.project.screenshots.find(
            (item) => item.id === picture.screenshotId && item.collectionId === prepared.context.collectionId,
          );
          if (!screenshot) throw failure('content-changed', 'The screenshot is no longer available.', true);
          const loaded = await this.bridge.loadScreenshotContent({
            projectPath: prepared.context.snapshot.projectPath,
            screenshot,
          });
          if (
            loaded.contentRevision !== picture.contentRevision ||
            (await imageFingerprint(loaded.image)) !== fingerprints.get(picture.screenshotId)
          )
            throw failure(
              'content-changed',
              'Picture content changed after export planning. Save and export again.',
              true,
            );
        }
        continue;
      }
      throwIfAborted(signal);
      const loaded = await this.loadContentItem({
        projectPath: prepared.context.snapshot.projectPath,
        itemId: picture.screenshotId,
      });
      if (loaded.contentRevision !== picture.contentRevision || !loaded.source)
        throw failure(
          'content-changed',
          `Drawing ${picture.pictureNumber} changed after export planning. Save and export again.`,
          true,
        );
      const expected = prepared.sourceByItemId.get(picture.screenshotId);
      if (
        !expected ||
        expected.contentRevision !== loaded.contentRevision ||
        expected.source !== loaded.source
      )
        throw failure(
          'content-changed',
          `Drawing ${picture.pictureNumber} changed after export planning. Save and export again.`,
          true,
        );
      assets.push({ filename: expected.filename, source: expected.source });
    }
    throwIfAborted(signal);
    return assets;
  }

  private async settleSplits(
    run: ActiveRun,
    metadata: PreparedPromptMetadata,
    compositions: Map<number, ComposedPromptBundle>,
    fingerprints: Map<string, string>,
  ): Promise<SettledPromptPlan> {
    const breaks = new Set<string>();
    const includedCount = (metadata.input.items ?? metadata.input.screenshots).filter(
      (item) => item.includeInExport && item.kind !== 'text',
    ).length;
    for (let attempt = 0; attempt <= includedCount; attempt += 1) {
      compositions.clear();
      fingerprints.clear();
      let retainedCharacters = 0;
      this.assertActive(run);
      const prepared = this.planMetadata(metadata, breaks);
      const encoded = new Map<number, number>();
      let changed = false;
      for (const bundle of prepared.plan.bundles) {
        this.emit({
          progress: {
            phase: 'rendering',
            bundleNumber: bundle.number,
            totalBundles: prepared.plan.bundles.length,
            message: `Checking Bundle ${bundle.number} of ${prepared.plan.bundles.length}`,
          },
        });
        const composition = await this.compose(prepared, bundle, run.controller.signal, fingerprints);
        this.assertActive(run);
        if (composition.kind === 'encoded-overflow') {
          if (breaks.has(composition.breakBeforeScreenshotId))
            throw failure(
              'render-limit',
              'Prompt splitting could not reach a stable encoded size. Reduce oversized content and try again.',
              true,
            );
          breaks.add(composition.breakBeforeScreenshotId);
          changed = true;
          break;
        }
        encoded.set(bundle.number, composition.encodedCharacters);
        const characters = composition.dataUrl?.length ?? 0;
        if (retainedCharacters + characters <= MAX_RETAINED_EXPORT_CHARACTERS) {
          compositions.set(bundle.number, composition);
          retainedCharacters += characters;
        }
        bundle.delivery = composition.delivery;
        bundle.warning = composition.warning;
      }
      if (!changed) return { ...prepared, encodedCharacters: encoded };
    }
    throw failure('render-limit', 'Prompt splitting exceeded the safe number of attempts.', true);
  }

  private terminate(
    run: ActiveRun,
    kind: 'finish' | 'cancel',
    master?: string,
  ): Promise<WorkflowResult<PromptExportFinalized>> {
    if (!run.session)
      return Promise.resolve({
        ok: true,
        value: {
          status: 'cancelled',
          published: false,
          bundles: [],
          hasMasterMarkdown: false,
          warnings: [],
        },
      });
    if (!run.terminal) {
      run.terminalKind = kind;
      const operation = Promise.resolve().then(() =>
        kind === 'finish'
          ? this.bridge.finishPromptExport({ sessionId: run.session!.sessionId, masterMarkdown: master })
          : this.bridge.cancelPromptExport({ sessionId: run.session!.sessionId }),
      );
      const tracked: Promise<WorkflowResult<PromptExportFinalized>> = operation.catch((error) => {
        if (run.terminal === tracked) {
          run.terminal = undefined;
          run.terminalKind = undefined;
        }
        throw error;
      });
      run.terminal = tracked;
    }
    return run.terminal;
  }

  private rememberPendingCleanup(run: ActiveRun): void {
    this.pendingCleanup = run;
    this.emit({ cleanupPending: true });
  }

  private async cleanupRun(run: ActiveRun): Promise<PromptExportFinalized | undefined> {
    if (!run.session || run.finalized) return run.finalized;
    try {
      const result = await this.terminate(run, 'cancel');
      if (!result.ok) {
        run.terminal = undefined;
        run.terminalKind = undefined;
        throw nativeFailure(result.error);
      }
      run.finalized = result.value;
      if (run.plan) this.applyArtifact(run.plan, run.session, result.value, new Map());
      if (this.pendingCleanup === run) {
        this.pendingCleanup = undefined;
        this.emit({ cleanupPending: false });
      }
      return result.value;
    } catch (error) {
      run.terminal = undefined;
      run.terminalKind = undefined;
      this.rememberPendingCleanup(run);
      throw cleanupPendingFailure(error);
    }
  }

  private applyArtifact(
    prepared: PreparedPromptPlan,
    session: PromptExportSessionInfo,
    finalized: PromptExportFinalized,
    encoded: ReadonlyMap<number, number>,
  ): void {
    if (!finalized.published || !finalized.bundles.length) return;
    const artifact: PromptExportArtifact = {
      sessionId: session.sessionId,
      planId: prepared.planId,
      projectPath: prepared.context.snapshot.projectPath,
      projectId: prepared.context.snapshot.project.id,
      input: prepared.input,
      grants: new Map(finalized.bundles.map((grant) => [grant.bundleNumber, grant])),
    };
    this.latestArtifact = artifact;
    this.emit({ cards: cardsForPlan(prepared, encoded, artifact) });
  }

  private async createFreshExport(run: ActiveRun): Promise<{
    prepared: PreparedPromptPlan;
    session: PromptExportSessionInfo;
    finalized: PromptExportFinalized;
  }> {
    const metadata = await this.prepareMetadata(run);
    if ('kind' in metadata) throw failure('no-content', metadata.message, true);
    const compositions = new Map<number, ComposedPromptBundle>();
    const fingerprints = new Map<string, string>();
    try {
      const settled = await this.settleSplits(run, metadata, compositions, fingerprints);
      this.assertActive(run);
      const manifests = settled.plan.bundles.map((bundle) => ({
        bundleNumber: bundle.number,
        ...(bundle.pictures.length ? {} : { hasImage: false }),
        width: bundle.layout.width,
        height: bundle.layout.height,
      }));
      const startInput = {
        projectPath: metadata.context.snapshot.projectPath,
        collectionId: metadata.context.collectionId,
        bundles: manifests,
      };
      const session = unwrap(await this.bridge.startPromptExport(startInput));
      run.session = session;
      this.assertActive(run);
      const identifiedPlan = applyPromptBundleMarkdownIdentity(settled.plan, { setName: session.setName });
      const prepared = { ...settled, plan: identifiedPlan };
      run.plan = prepared;
      this.latestPlan = prepared;
      this.emit({ cards: cardsForPlan(prepared, settled.encodedCharacters) });

      for (const bundle of prepared.plan.bundles) {
        this.assertActive(run);
        this.setCardState(bundle.number, 'writing');
        this.emit({
          progress: {
            phase: 'writing',
            bundleNumber: bundle.number,
            totalBundles: prepared.plan.bundles.length,
            message: `Writing Bundle ${bundle.number} of ${prepared.plan.bundles.length}`,
          },
        });
        const cached = compositions.get(bundle.number);
        compositions.delete(bundle.number);
        const composition = cached ?? (await this.compose(prepared, bundle, run.controller.signal));
        this.assertActive(run);
        if (composition.kind === 'encoded-overflow')
          throw failure(
            'content-changed',
            'Encoded output changed after preflight. No incomplete prompt pair was published; export again.',
            true,
          );
        unwrap(
          await this.bridge.writePromptExportBundle({
            sessionId: session.sessionId,
            bundleNumber: bundle.number,
            pngDataUrl: composition.dataUrl,
            markdown: bundle.markdown,
            sourceAssets: await this.verifyBundleContent(
              prepared,
              bundle,
              run.controller.signal,
              cached !== undefined ? fingerprints : undefined,
            ),
          }),
        );
        this.assertActive(run);
        this.setCardState(bundle.number, 'idle');
      }

      const overview = this.includeMasterOverview
        ? masterMarkdown(prepared.plan, prepared.input, session.setName)
        : undefined;
      const finishResult = await this.terminate(run, 'finish', overview);
      if (!finishResult.ok) {
        run.terminal = undefined;
        run.terminalKind = undefined;
        throw nativeFailure(finishResult.error);
      }
      const finalized = finishResult.value;
      run.finalized = finalized;
      if (run.terminalKind !== 'finish' || finalized.status !== 'completed') {
        this.applyArtifact(prepared, session, finalized, settled.encodedCharacters);
        throw cancelledFailure();
      }
      this.applyArtifact(prepared, session, finalized, settled.encodedCharacters);
      return { prepared, session, finalized };
    } finally {
      compositions.clear();
      fingerprints.clear();
    }
  }

  async open(): Promise<PromptBundleControllerActionResult> {
    const artifact = this.latestArtifact;
    const reusablePlan = this.latestPlan;
    const hasReusablePlan = Boolean(artifact && reusablePlan?.planId === artifact.planId);
    this.emit({
      isOpen: true,
      preview: undefined,
      error: undefined,
      noContentMessage: undefined,
      progress: hasReusablePlan
        ? { phase: 'checking', message: 'Loading saved bundles' }
        : { phase: 'planning' },
    });
    let run: ActiveRun | undefined;
    try {
      run = this.beginRun();
      let metadata = await this.prepareMetadata(run, undefined, hasReusablePlan);
      this.assertActive(run);
      if (
        hasReusablePlan &&
        ('kind' in metadata ||
          artifact?.projectPath !== metadata.context.snapshot.projectPath ||
          artifact.projectId !== metadata.context.snapshot.project.id ||
          JSON.stringify(metadata.input) !== JSON.stringify(artifact.input))
      ) {
        metadata = await this.prepareMetadata(run);
        this.assertActive(run);
      }
      if ('kind' in metadata) {
        this.latestPlan = undefined;
        this.emit({ cards: [], noContentMessage: metadata.message, progress: undefined });
        this.activeRun = undefined;
        return { ok: true };
      }
      if (
        artifact &&
        reusablePlan?.planId === artifact.planId &&
        artifact.projectPath === metadata.context.snapshot.projectPath &&
        artifact.projectId === metadata.context.snapshot.project.id &&
        JSON.stringify(metadata.input) === JSON.stringify(artifact.input)
      ) {
        const cards =
          this.state.cards.length === reusablePlan.plan.bundles.length &&
          this.state.cards.every((card) => card.planId === artifact.planId)
            ? this.state.cards
            : cardsForPlan(reusablePlan, undefined, artifact);
        this.emit({ cards, progress: undefined, noContentMessage: undefined });
        this.activeRun = undefined;
        return { ok: true };
      }
      const prepared = this.planMetadata(metadata);
      this.latestPlan = prepared;
      this.emit({ cards: cardsForPlan(prepared), progress: undefined, noContentMessage: undefined });
      this.activeRun = undefined;
      return { ok: true };
    } catch (error) {
      return this.resultError(error, run);
    }
  }

  close(): void {
    this.clearPreview();
    this.emit({ isOpen: false });
    if (this.activeRun) void this.cancel();
  }

  clearPreview(): void {
    this.previewSequence += 1;
    this.previewAbort?.abort();
    this.previewAbort = undefined;
    this.emit({ preview: undefined });
  }

  async copyFresh(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.copyWithReusableArtifact(selection, 'rich');
  }

  async copyVariant(
    selection: PromptBundleSelection,
    variant: WindowsCopyVariantId,
  ): Promise<PromptBundleControllerActionResult> {
    return this.copyWithReusableArtifact(selection, variant);
  }

  private async copyWithReusableArtifact(
    selection: PromptBundleSelection,
    target: WindowsCopyVariantId,
  ): Promise<PromptBundleControllerActionResult> {
    if (this.activeRun)
      return {
        ok: false,
        error: failure('busy', 'Wait for the active prompt export to finish.', true).detail,
      };
    const bundleNumber = selectionNumber(selection);
    const artifact = this.latestArtifact;
    if (typeof selection !== 'number' && selection.artifactSessionId) {
      if (selection.planId !== artifact?.planId || selection.artifactSessionId !== artifact.sessionId)
        return this.resultError(
          failure(
            'invalid-bundle',
            'These files belong to an older export session. Use the latest prompt card.',
            true,
          ),
        );
    }
    const card = this.state.cards.find((item) => item.bundleNumber === bundleNumber);
    const matchesCurrentCard =
      typeof selection === 'number' ||
      Boolean(
        card && card.planId === selection.planId && card.artifactSessionId === selection.artifactSessionId,
      );
    if (!matchesCurrentCard)
      return this.resultError(
        failure('invalid-bundle', 'Review the current prompt cards before copying.', true),
      );
    if (
      this.pendingCleanup ||
      !artifact ||
      bundleNumber === undefined ||
      !artifact.grants.has(bundleNumber) ||
      (typeof selection !== 'number' && !selection.artifactSessionId) ||
      (typeof selection === 'number' && card?.artifactSessionId !== artifact.sessionId)
    )
      return this.fresh(bundleNumber, true, target);

    let run: ActiveRun | undefined;
    try {
      run = this.beginRun();
      this.emit({
        error: undefined,
        noContentMessage: undefined,
        progress: { phase: 'copying', bundleNumber, message: `Copying Bundle ${bundleNumber}` },
      });
      this.setCardState(bundleNumber, 'copying');
      const metadata = await this.prepareMetadata(run, artifact, true);
      this.assertActive(run);
      if ('kind' in metadata) throw failure('no-content', metadata.message, true);
      if (JSON.stringify(metadata.input) !== JSON.stringify(artifact.input)) {
        this.activeRun = undefined;
        return this.fresh(bundleNumber, true, target);
      }
      if (card?.delivery === 'file-only')
        throw failure(
          'native-failure',
          card.warning ?? 'This prompt exceeds safe clipboard limits. Use its saved PNG and Markdown files.',
          true,
          true,
          'clipboard-limit',
        );
      await this.validateArtifactContext(artifact, run.controller.signal);
      this.assertActive(run);
      const copy = await this.bridge.copyPromptExportBundle({
        sessionId: artifact.sessionId,
        bundleNumber,
        target,
      });
      if (!copy.ok) throw nativeFailure(copy.error, true);
      this.assertActive(run);
      const delivery = describeCopyDelivery(
        target,
        copy.value.placed,
        Boolean(artifact.grants.get(bundleNumber)?.pngFilename),
      );
      this.deliveryCompleted(bundleNumber, delivery.outcome, true, delivery.warning, false);
      this.activeRun = undefined;
      return { ok: true, sessionId: artifact.sessionId, bundleNumber };
    } catch (error) {
      if (bundleNumber !== undefined) this.setCardState(bundleNumber, 'error', publicError(error).message);
      return this.resultError(error, run);
    }
  }

  async prepareFreshFiles(selection?: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.fresh(selectionNumber(selection), false);
  }

  /** Creates a new local finalized export, then reads only Markdown and rendered PNG bytes for opt-in sharing. */
  async prepareHostedShare(): Promise<
    { ok: true; value: HostedShareArtifacts } | { ok: false; error: PromptBundleControllerError }
  > {
    const prepared = await this.fresh(undefined, false);
    if (!prepared.ok || !prepared.sessionId)
      return prepared as { ok: false; error: PromptBundleControllerError };
    try {
      const artifact = this.latestArtifact;
      const plan = this.latestPlan;
      if (!artifact || !plan)
        throw failure('native-failure', 'The finalized local export is unavailable. Prepare it again.', true);
      return {
        ok: true,
        value: {
          title: plan.plan.collectionName || 'Imnota prompt',
          sessionId: artifact.sessionId,
          bundleNumbers: [...artifact.grants.keys()].sort((left, right) => left - right),
          imageBundleNumbers: [...artifact.grants.entries()]
            .filter(([, grant]) => Boolean(grant.pngFilename))
            .map(([bundleNumber]) => bundleNumber)
            .sort((left, right) => left - right),
        },
      };
    } catch (error) {
      return this.resultError(error) as { ok: false; error: PromptBundleControllerError };
    }
  }

  private async fresh(
    requestedBundleNumber: number | undefined,
    copyAfterExport: boolean,
    copyTarget: WindowsCopyVariantId = 'rich',
  ): Promise<PromptBundleControllerActionResult> {
    if (this.pendingCleanup) {
      const cleanup = await this.retryCleanup();
      if (!cleanup.ok) return cleanup;
    }
    let run: ActiveRun | undefined;
    try {
      run = this.beginRun();
      const { prepared, session } = await this.createFreshExport(run);
      this.assertActive(run);
      const bundleNumber = requestedBundleNumber ?? prepared.plan.bundles[0]?.number;
      const bundle = prepared.plan.bundles.find((item) => item.number === bundleNumber);
      if (!bundle)
        throw failure(
          'invalid-bundle',
          'That prompt number is not present in the latest saved collection. Review the refreshed prompt cards.',
          true,
          true,
        );
      if (copyAfterExport) {
        if (bundle.delivery === 'file-only')
          throw failure(
            'native-failure',
            bundle.warning ??
              'This prompt exceeds safe clipboard limits. Use its saved PNG and Markdown files.',
            true,
            true,
            'clipboard-limit',
          );
        this.setCardState(bundle.number, 'copying');
        this.emit({
          progress: {
            phase: 'copying',
            bundleNumber: bundle.number,
            totalBundles: prepared.plan.bundles.length,
            message: `Copying Bundle ${bundle.number}`,
          },
        });
        const copy = await this.bridge.copyPromptExportBundle({
          sessionId: session.sessionId,
          bundleNumber: bundle.number,
          target: copyTarget,
        });
        if (!copy.ok) {
          const detail = nativeFailure(copy.error, true).detail;
          this.setCardState(bundle.number, 'error', detail.message);
          throw new ControllerFailure(detail);
        }
        this.assertActive(run);
        const delivery = describeCopyDelivery(copyTarget, copy.value.placed, bundle.pictures.length > 0);
        this.deliveryCompleted(bundle.number, delivery.outcome, true, delivery.warning);
      }
      this.emit({
        progress: { phase: 'complete', bundleNumber, totalBundles: prepared.plan.bundles.length },
      });
      this.activeRun = undefined;
      return { ok: true, sessionId: session.sessionId, bundleNumber };
    } catch (error) {
      let reportedError = error;
      if (run?.session && !run.finalized) {
        try {
          await this.cleanupRun(run);
        } catch (cleanupError) {
          reportedError = cleanupError;
        }
      }
      return this.resultError(reportedError, run);
    }
  }

  private artifactSelection(selection: PromptBundleSelection): {
    artifact: PromptExportArtifact;
    bundleNumber: number;
  } {
    const artifact = this.latestArtifact;
    const bundleNumber = selectionNumber(selection);
    if (!artifact || bundleNumber === undefined || !artifact.grants.has(bundleNumber))
      throw failure(
        'invalid-bundle',
        'Prepare a fresh export before using this fallback action.',
        true,
        false,
      );
    if (typeof selection !== 'number') {
      if (selection.planId !== artifact.planId || selection.artifactSessionId !== artifact.sessionId)
        throw failure(
          'invalid-bundle',
          'These files belong to an older export session. Use the fallback on the latest prompt card.',
          true,
        );
    }
    return { artifact, bundleNumber };
  }

  private async nativeArtifactAction(
    selection: PromptBundleSelection,
    action: (
      sessionId: string,
      bundleNumber: number,
      validate: () => Promise<void>,
    ) => Promise<WorkflowResult<unknown>>,
    outcome: PromptDeliveryOutcome = 'files',
  ): Promise<PromptBundleControllerActionResult> {
    if (this.activeRun) {
      const detail = failure('busy', 'Wait for the active prompt export to finish.', true).detail;
      return { ok: false, error: detail };
    }
    let run: ActiveRun | undefined;
    try {
      if (this.disposed)
        throw failure('disposed', 'The prompt export controller is no longer available.', false);
      // Fallbacks are usable before the first combined copy. Keep existing grants
      // after a copy failure so retries need not render everything again.
      if (typeof selection !== 'number' && !selection.artifactSessionId) {
        const selectedCard = selection;
        if (
          this.state.cards.length &&
          !this.state.cards.some(
            (card) => card.planId === selectedCard.planId && card.bundleNumber === selectedCard.bundleNumber,
          )
        )
          throw failure('invalid-bundle', 'Review the current prompt cards before copying.', true);
        const prepared = await this.prepareFreshFiles(selection);
        if (!prepared.ok) return prepared;
        selection = selection.bundleNumber;
      } else if (typeof selection === 'number' && !this.latestArtifact) {
        const prepared = await this.prepareFreshFiles(selection);
        if (!prepared.ok) return prepared;
      }
      const { artifact, bundleNumber } = this.artifactSelection(selection);
      run = this.beginRun();
      this.emit({
        error: undefined,
        noContentMessage: undefined,
        progress: {
          phase: 'copying',
          bundleNumber,
          message: outcome === 'files' ? 'Opening generated files' : `Copying ${outcome}`,
        },
      });
      this.setCardState(bundleNumber, 'copying');
      const metadata = await this.prepareMetadata(run, artifact, true);
      this.assertActive(run);
      if ('kind' in metadata || JSON.stringify(metadata.input) !== JSON.stringify(artifact.input))
        throw failure(
          'content-changed',
          'The collection changed since these files were generated. Prepare fresh files before using this fallback.',
          true,
          true,
        );
      const actionRun = run;
      const validate = async () => {
        await this.validateArtifactContext(artifact, actionRun.controller.signal);
        this.assertActive(actionRun);
      };
      await validate();
      const result = await action(artifact.sessionId, bundleNumber, validate);
      if (!result.ok) throw nativeFailure(result.error, true);
      this.assertActive(run);
      this.deliveryCompleted(bundleNumber, outcome, false, undefined, false);
      this.activeRun = undefined;
      return { ok: true, sessionId: artifact.sessionId, bundleNumber };
    } catch (error) {
      const number = selectionNumber(selection);
      if (number !== undefined) this.setCardState(number, 'error', publicError(error).message);
      return this.resultError(error, run);
    }
  }

  async copyMarkdown(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    const hasGrant =
      typeof selection === 'number'
        ? this.latestArtifact?.grants.has(selection)
        : Boolean(selection.artifactSessionId);
    if (!hasGrant && this.bridge.copyText) {
      let run: ActiveRun | undefined;
      try {
        if (
          typeof selection !== 'number' &&
          !this.state.cards.some(
            (card) => card.planId === selection.planId && card.bundleNumber === selection.bundleNumber,
          )
        )
          throw failure('invalid-bundle', 'Review the current prompt cards before copying.', true);
        run = this.beginRun();
        const metadata = await this.prepareMetadata(run);
        if ('kind' in metadata) throw failure('no-content', metadata.message, true);
        const prepared = this.planMetadata(metadata);
        const bundle = prepared.plan.bundles.find((item) => item.number === selectionNumber(selection));
        if (!bundle)
          throw failure('invalid-bundle', 'That prompt is no longer in the saved collection.', true);
        await this.verifyBundleContent(prepared, bundle, run.controller.signal);
        for (const picture of bundle.pictures) {
          if (picture.kind === 'drawing') continue;
          const screenshot = prepared.context.snapshot.project.screenshots.find(
            (item) => item.id === picture.screenshotId,
          );
          if (!screenshot)
            throw failure('content-changed', 'The selected picture is no longer in the collection.', true);
          const loaded = await this.bridge.loadScreenshotContent({
            projectPath: prepared.context.snapshot.projectPath,
            screenshot,
          });
          if (loaded.contentRevision !== picture.contentRevision)
            throw failure(
              'content-changed',
              'A picture changed while Markdown was prepared. Save and copy again.',
              true,
            );
        }
        this.assertActive(run);
        await this.bridge.copyText(bundle.markdown);
        this.assertActive(run);
        this.latestPlan = prepared;
        this.emit({ cards: cardsForPlan(prepared) });
        this.deliveryCompleted(bundle.number, 'markdown');
        this.activeRun = undefined;
        return { ok: true, bundleNumber: bundle.number };
      } catch (error) {
        return this.resultError(error, run);
      }
    }
    return this.nativeArtifactAction(
      selection,
      (sessionId, bundleNumber) =>
        this.bridge.copyPromptExportBundle({ sessionId, bundleNumber, target: 'markdown' }),
      'markdown',
    );
  }

  copyImage(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.nativeArtifactAction(
      selection,
      (sessionId, bundleNumber) =>
        this.bridge.copyPromptExportBundle({ sessionId, bundleNumber, target: 'image' }),
      'image',
    );
  }

  copyPaths(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.nativeArtifactAction(
      selection,
      (sessionId, bundleNumber) =>
        this.bridge.copyPromptExportBundle({ sessionId, bundleNumber, target: 'paths' }),
      'paths',
    );
  }

  openFiles(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.nativeArtifactAction(selection, async (sessionId, bundleNumber, validate) => {
      if (this.latestArtifact?.grants.get(bundleNumber)?.pngFilename) {
        const png = await this.bridge.openPromptExportBundle({ sessionId, bundleNumber, target: 'png' });
        if (!png.ok) return png;
        await validate();
      }
      return this.bridge.openPromptExportBundle({ sessionId, bundleNumber, target: 'markdown' });
    });
  }

  async openFolder(): Promise<PromptBundleControllerActionResult> {
    let artifact = this.latestArtifact;
    let bundleNumber = artifact?.grants.keys().next().value as number | undefined;
    if (!artifact || bundleNumber === undefined) {
      const prepared = await this.fresh(undefined, false);
      if (!prepared.ok || !prepared.sessionId || prepared.bundleNumber === undefined) return prepared;
      artifact = this.latestArtifact;
      bundleNumber = prepared.bundleNumber;
    }
    if (!artifact)
      return this.resultError(
        failure('invalid-bundle', 'Prepare fresh files before opening the export folder.'),
      );
    return this.nativeArtifactAction(
      { planId: artifact.planId, artifactSessionId: artifact.sessionId, bundleNumber },
      (sessionId, selectedBundleNumber) =>
        this.bridge.openPromptExportBundle({
          sessionId,
          bundleNumber: selectedBundleNumber,
          target: 'folder',
        }),
    );
  }

  async loadPreview(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    if (this.activeRun) {
      const detail = failure('busy', 'Wait for the active prompt export to finish.', true).detail;
      return { ok: false, error: detail };
    }
    const bundleNumber = selectionNumber(selection);
    if (bundleNumber === undefined)
      return this.resultError(failure('invalid-bundle', 'Choose a prompt to preview.', true));
    const sequence = ++this.previewSequence;
    this.previewAbort?.abort();
    const controller = new AbortController();
    this.previewAbort = controller;
    try {
      const artifact = this.latestArtifact;
      const card = this.state.cards.find((item) => item.bundleNumber === bundleNumber);
      const requestedArtifact =
        typeof selection !== 'number' && selection.artifactSessionId
          ? this.artifactSelection(selection).artifact
          : undefined;
      if (card && !card.pictureNumbers.length)
        throw failure('invalid-bundle', 'This text-only prompt has no image preview.', true);
      const cardUsesArtifact =
        artifact &&
        card?.planId === artifact.planId &&
        card.artifactSessionId === artifact.sessionId &&
        artifact.grants.has(bundleNumber);
      if (artifact && (requestedArtifact || cardUsesArtifact)) {
        await this.validateArtifactContext(artifact, controller.signal);
        if (sequence !== this.previewSequence) throw cancelledFailure();
        const content = unwrap(
          await this.bridge.readPromptExportBundle({ sessionId: artifact.sessionId, bundleNumber }),
        );
        await this.validateArtifactContext(artifact, controller.signal);
        if (sequence !== this.previewSequence) throw cancelledFailure();
        this.emit({
          preview: {
            bundleNumber,
            dataUrl:
              content.imageDataUrl ??
              (() => {
                throw failure('invalid-bundle', 'This text-only prompt has no image preview.', true);
              })(),
            width: card?.width ?? 0,
            height: card?.height ?? 0,
          },
        });
        return { ok: true, sessionId: artifact.sessionId, bundleNumber };
      }
      const prepared = this.latestPlan;
      const bundle = prepared?.plan.bundles.find((item) => item.number === bundleNumber);
      if (!prepared || !bundle)
        throw failure('invalid-bundle', 'Open the sharing dialog again to prepare this preview.', true);
      const composition = await this.compose(prepared, bundle, controller.signal);
      throwIfAborted(controller.signal);
      if (composition.kind === 'encoded-overflow')
        throw failure(
          'render-limit',
          'This preview needs a fresh split. Prepare the export files first.',
          true,
        );
      if (sequence !== this.previewSequence) throw cancelledFailure();
      this.emit({
        preview: {
          bundleNumber,
          dataUrl:
            composition.dataUrl ??
            (() => {
              throw failure('invalid-bundle', 'This text-only prompt has no image preview.', true);
            })(),
          width: composition.width,
          height: composition.height,
        },
      });
      return { ok: true, bundleNumber };
    } catch (error) {
      if (sequence !== this.previewSequence || controller.signal.aborted)
        return { ok: false, error: cancelledFailure().detail };
      return this.resultError(error);
    } finally {
      if (sequence === this.previewSequence) this.previewAbort = undefined;
    }
  }

  async cancel(): Promise<PromptBundleControllerActionResult> {
    const run = this.activeRun;
    if (!run) return { ok: true };
    run.controller.abort();
    try {
      const result = await this.terminate(run, 'cancel');
      const finalized = unwrap(result);
      if (run.session) run.finalized = finalized;
      if (run.session && run.plan) this.applyArtifact(run.plan, run.session, finalized, new Map());
      if (this.activeRun === run) {
        this.activeRun = undefined;
        this.emit({
          progress: {
            phase: finalized.status === 'completed' ? 'complete' : 'cancelled',
            message:
              finalized.status === 'completed'
                ? 'Export completed before cancellation took effect.'
                : 'Export cancelled. Completed file pairs were kept.',
          },
        });
      }
      return { ok: true, sessionId: run.session?.sessionId };
    } catch (error) {
      let reportedError = error;
      if (run.session) {
        run.terminal = undefined;
        run.terminalKind = undefined;
        this.rememberPendingCleanup(run);
        reportedError = cleanupPendingFailure(error);
      }
      return this.resultError(reportedError, run);
    }
  }

  async retryCleanup(): Promise<PromptBundleControllerActionResult> {
    if (this.disposed)
      return {
        ok: false,
        error: failure('disposed', 'The prompt export controller is no longer available.', false).detail,
      };
    if (this.activeRun) {
      const detail = failure('busy', 'Wait for the active prompt export to finish.', true).detail;
      return { ok: false, error: detail };
    }
    const run = this.pendingCleanup;
    if (!run) return { ok: true };
    try {
      await this.cleanupRun(run);
      this.emit({
        cleanupPending: false,
        error: undefined,
        progress: {
          phase: 'cancelled',
          message: 'Export cleanup completed. Any complete file pairs were kept.',
        },
      });
      return { ok: true, sessionId: run.session?.sessionId };
    } catch (error) {
      return this.resultError(error);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.previewSequence += 1;
    this.previewAbort?.abort();
    const cleanupRuns = new Set(
      [this.activeRun, this.pendingCleanup].filter((run): run is ActiveRun => Boolean(run)),
    );
    for (const run of cleanupRuns) {
      run.controller.abort();
      if (run.session && !run.finalized) void this.cleanupRun(run).catch(() => undefined);
    }
    this.activeRun = undefined;
    this.latestPlan = undefined;
    this.state = { cards: [], isOpen: false, cleanupPending: false };
    this.listeners.clear();
  }
}
