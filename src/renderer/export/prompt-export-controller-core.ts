import { isTextAnnotation } from '../../shared/annotation-order';
import type { TextWidthMeasurer } from '../../shared/annotation-geometry';
import { EXPORT_SAFETY_MARGIN, expandedExportBounds } from '../../shared/crop';
import {
  applyPromptBundleMarkdownIdentity,
  planPromptBundles,
  type MeasuredPromptScreenshot,
  type PromptBundle,
  type PromptBundlePlan,
  type PromptBundleNoContent,
  type PromptBundleProgress,
  type PromptCollectionInput,
} from '../../shared/prompt-bundles';
import type { Annotation, ImagePayload, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type {
  PromptExportBundleContent,
  PromptExportBundleGrant,
  PromptExportCopyTarget,
  PromptExportFinalized,
  PromptExportSessionInfo,
  WorkflowError,
  WorkflowResult,
} from '../../shared/workflow-bridge';
import { createBrowserTextMeasurer } from '../canvas/annotation-layout';
import {
  assertAnnotatedImageRenderBounds,
  renderAnnotatedImageWithDimensions,
  type AnnotatedImageRender,
} from '../export-image';
import {
  composePromptBundle,
  type PromptBundleComposition,
  type ResolvedPromptPicturePng,
} from '../prompt-bundle-render';
import type { PromptBundleActionRequest, PromptBundleCardModel } from './PromptBundleCard';

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
  loadScreenshotContent(input: { projectPath: string; screenshot: ScreenshotRecord }): Promise<{
    image: ImagePayload;
    annotations: Annotation[];
    description: string;
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
    pngDataUrl: string;
    markdown: string;
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
  }): Promise<WorkflowResult<void>>;
  openPromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
    target: 'folder' | 'png' | 'markdown' | 'master';
  }): Promise<WorkflowResult<void>>;
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
}

interface PreparedPromptMetadata {
  context: Readonly<SavedPromptExportContext>;
  input: Readonly<PromptCollectionInput>;
  measured: readonly MeasuredPromptScreenshot[];
  thumbnails: Readonly<Record<string, string>>;
}

interface PreparedPromptPlan extends PreparedPromptMetadata {
  plan: PromptBundlePlan;
  planId: string;
}

interface SettledPromptPlan extends PreparedPromptPlan {
  encodedCharacters: ReadonlyMap<number, number>;
}

interface PromptExportArtifact {
  sessionId: string;
  planId: string;
  grants: ReadonlyMap<number, PromptExportBundleGrant>;
}

interface ActiveRun {
  id: number;
  controller: AbortController;
  session?: PromptExportSessionInfo;
  plan?: PreparedPromptPlan;
  terminalKind?: 'finish' | 'cancel';
  terminal?: Promise<WorkflowResult<PromptExportFinalized>>;
  finalized?: PromptExportFinalized;
}

class ControllerFailure extends Error {
  constructor(readonly detail: PromptBundleControllerError) {
    super(detail.message);
    this.name = 'ControllerFailure';
  }
}

const HARD_BUNDLE_MAX_EDGE = 16_384;
const HARD_BUNDLE_MAX_PIXELS = 64_000_000;
let nextPlanId = 0;

function freezeDeep<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function cloneAndFreeze<T>(value: T): Readonly<T> {
  const clone =
    typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  return freezeDeep(clone as T);
}

function failure(
  code: PromptBundleControllerErrorCode,
  message: string,
  retryable = true,
  fallbackAvailable = false,
  nativeCode?: WorkflowError['code'],
): ControllerFailure {
  return new ControllerFailure({ code, message, retryable, fallbackAvailable, nativeCode });
}

function cancelledFailure(): ControllerFailure {
  return failure('cancelled', 'Prompt export was cancelled. Completed file pairs were kept.', true);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledFailure();
}

function actionableMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

function nativeFailure(error: WorkflowError, fallbackAvailable = false): ControllerFailure {
  return failure('native-failure', error.message, error.retryable, fallbackAvailable, error.code);
}

function cleanupPendingFailure(error: unknown): ControllerFailure {
  const detail = publicError(error);
  return failure(
    'cleanup-pending',
    `The export session could not be finalized safely. Retry export cleanup before starting another export. ${detail.message}`,
    true,
    false,
    detail.nativeCode,
  );
}

function unwrap<T>(result: WorkflowResult<T>, fallbackAvailable = false): T {
  if (!result.ok) throw nativeFailure(result.error, fallbackAvailable);
  return result.value;
}

function defaultRendering(): PromptBundleControllerRendering {
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

function planId(): string {
  nextPlanId += 1;
  return `prompt-plan-${nextPlanId}`;
}

function selectionNumber(selection?: PromptBundleSelection): number | undefined {
  return typeof selection === 'number' ? selection : selection?.bundleNumber;
}

function estimatedBytes(encodedCharacters: number | undefined): number | undefined {
  return encodedCharacters === undefined ? undefined : Math.max(0, Math.floor((encodedCharacters * 3) / 4));
}

function renderLimitMessage(bundle: PromptBundle): string {
  const pixels = bundle.layout.width * bundle.layout.height;
  return (
    `Prompt ${bundle.number} would be ${bundle.layout.width} × ${bundle.layout.height} ` +
    `(${(pixels / 1_000_000).toFixed(1)} MP), above the safe renderer limit of ` +
    `${HARD_BUNDLE_MAX_EDGE}px per side and ${HARD_BUNDLE_MAX_PIXELS / 1_000_000} MP. ` +
    'Move distant annotations closer, reduce oversized text, or reduce the screenshots in this collection.'
  );
}

function assertBundleRenderLimit(bundle: PromptBundle): void {
  const { width, height } = bundle.layout;
  if (
    width > HARD_BUNDLE_MAX_EDGE ||
    height > HARD_BUNDLE_MAX_EDGE ||
    width * height > HARD_BUNDLE_MAX_PIXELS
  )
    throw failure('render-limit', renderLimitMessage(bundle), true);
}

function plainHeading(value: string, fallback: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim() || fallback;
}

function normalizedMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function masterMarkdown(plan: PromptBundlePlan, input: PromptCollectionInput, setName: string): string {
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
      `- ${bundle.reference ?? `Prompt ${bundle.number}`}: ${bundle.pictureNumbers.map((number) => `Picture ${number}`).join(', ')}`,
    );
  lines.push('');
  lines.push('## Collection pictures', '');
  const ordered = input.screenshots
    .map((screenshot, sourceIndex) => ({ screenshot, sourceIndex }))
    .sort(
      (left, right) =>
        left.screenshot.position - right.screenshot.position || left.sourceIndex - right.sourceIndex,
    );
  const includedById = new Map(
    plan.bundles.flatMap((bundle) =>
      bundle.pictures.map((picture) => [picture.screenshotId, picture] as const),
    ),
  );
  for (const [index, { screenshot }] of ordered.entries()) {
    const pictureNumber = index + 1;
    lines.push(
      `### Picture ${pictureNumber} — ${plainHeading(screenshot.title, screenshot.originalFilename)}`,
      '',
      `Priority for agent: ${screenshot.priority[0].toUpperCase()}${screenshot.priority.slice(1)}`,
      '',
    );
    const description = normalizedMarkdown(screenshot.description);
    if (description.trim()) lines.push(description, '');
    if (!screenshot.includeInExport) {
      lines.push(`Picture ${pictureNumber} was intentionally excluded from this export.`, '');
      continue;
    }
    for (const note of includedById.get(screenshot.id)?.notes ?? [])
      lines.push(`#### Picture ${pictureNumber} / Note ${note.number}`, '', note.text, '');
  }
  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
}

function cardsForPlan(
  prepared: PreparedPromptPlan,
  encoded: ReadonlyMap<number, number> = new Map(),
  artifact?: PromptExportArtifact,
): PromptBundleCardModel[] {
  return prepared.plan.bundles.map((bundle) => ({
    planId: prepared.planId,
    artifactSessionId: artifact?.grants.has(bundle.number) ? artifact.sessionId : undefined,
    bundleNumber: bundle.number,
    pictureNumbers: bundle.pictureNumbers,
    screenshotCount: bundle.pictures.length,
    excludedCount: bundle.excludedCount,
    width: bundle.layout.width,
    height: bundle.layout.height,
    estimatedBytes: estimatedBytes(encoded.get(bundle.number)),
    previewDataUrl: prepared.thumbnails[bundle.pictures[0]?.screenshotId],
    delivery: bundle.delivery,
    warning: bundle.warning,
    state: 'idle',
  }));
}

function publicError(error: unknown): PromptBundleControllerError {
  if (error instanceof ControllerFailure) return error.detail;
  const message = actionableMessage(error, 'Prompt export failed unexpectedly. Try again.');
  if (/safe render|safe renderer|render limit|canvas safety|above the safe/i.test(message))
    return { code: 'render-limit', message, retryable: true, fallbackAvailable: false };
  return { code: 'unexpected', message, retryable: true, fallbackAvailable: false };
}

export class PromptBundleControllerEngine {
  private state: PromptBundleControllerState = { cards: [], isOpen: false, cleanupPending: false };
  private readonly listeners = new Set<() => void>();
  private readonly bridge: PromptBundleControllerBridge;
  private readonly rendering: PromptBundleControllerRendering;
  private readonly getSavedContext: () => Promise<SavedPromptExportContext>;
  private readonly includeMasterOverview: boolean;
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

  private async prepareMetadata(run: ActiveRun): Promise<PreparedPromptMetadata | PromptBundleNoContent> {
    this.emit({ error: undefined, noContentMessage: undefined, progress: { phase: 'planning' } });
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
    this.assertActive(run);
    const context = cloneAndFreeze(saved);
    const collection = context.snapshot.project.collections.find((item) => item.id === context.collectionId);
    if (!collection)
      throw failure(
        'save-failed',
        'The current collection no longer exists. Reload the project and try again.',
        true,
      );
    const screenshots = context.snapshot.project.screenshots.filter(
      (screenshot) => screenshot.collectionId === context.collectionId,
    );
    const measured: MeasuredPromptScreenshot[] = [];
    const promptScreenshots: PromptCollectionInput['screenshots'][number][] = [];
    for (const screenshot of screenshots) {
      this.assertActive(run);
      if (!screenshot.includeInExport) {
        promptScreenshots.push({
          id: screenshot.id,
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
      const dimensions = await this.rendering.preflight(loaded.image, annotations, run.controller.signal);
      this.assertActive(run);
      measured.push({
        screenshotId: screenshot.id,
        width: dimensions.width,
        height: dimensions.height,
        estimatedPngCharacters: dimensions.estimatedPngCharacters,
      });
      promptScreenshots.push({
        id: screenshot.id,
        position: screenshot.position,
        title: screenshot.title,
        originalFilename: screenshot.originalFilename,
        description: loaded.description,
        priority: screenshot.priority,
        includeInExport: true,
        nativeWidth: loaded.image.width,
        nativeHeight: loaded.image.height,
        contentRevision: loaded.contentRevision,
        annotations: annotations.filter(isTextAnnotation).map(({ kind, text }) => ({ kind, text })),
      });
    }
    const input = cloneAndFreeze({
      collectionId: collection.id,
      collectionName: collection.name,
      overallContext: collection.overallContext,
      screenshots: promptScreenshots,
    }) as Readonly<PromptCollectionInput>;
    const initial = planPromptBundles(input, measured);
    if (initial.kind === 'no-content') return initial;
    return {
      context,
      input,
      measured: cloneAndFreeze(measured) as readonly MeasuredPromptScreenshot[],
      thumbnails: context.snapshot.thumbnails,
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
  ): Promise<PromptPictureResolveResult> {
    throwIfAborted(signal);
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

  private async compose(prepared: PreparedPromptPlan, bundle: PromptBundle, signal: AbortSignal) {
    assertBundleRenderLimit(bundle);
    const composeOptions = {
      signal,
      resolvePicturePng: (picture: PromptBundle['pictures'][number]) =>
        this.resolvePicture(prepared, picture, signal),
    };
    return this.rendering.compose(bundle, composeOptions);
  }

  private async settleSplits(run: ActiveRun, metadata: PreparedPromptMetadata): Promise<SettledPromptPlan> {
    const breaks = new Set<string>();
    const includedCount = metadata.input.screenshots.filter(
      (screenshot) => screenshot.includeInExport,
    ).length;
    for (let attempt = 0; attempt <= includedCount; attempt += 1) {
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
            message: `Checking Prompt ${bundle.number} of ${prepared.plan.bundles.length}`,
          },
        });
        const composition = await this.compose(prepared, bundle, run.controller.signal);
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
    const settled = await this.settleSplits(run, metadata);
    this.assertActive(run);
    const manifests = settled.plan.bundles.map((bundle) => ({
      bundleNumber: bundle.number,
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
          message: `Writing Prompt ${bundle.number} of ${prepared.plan.bundles.length}`,
        },
      });
      const composition = await this.compose(prepared, bundle, run.controller.signal);
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
  }

  async open(): Promise<PromptBundleControllerActionResult> {
    this.emit({ isOpen: true, preview: undefined });
    let run: ActiveRun | undefined;
    try {
      run = this.beginRun();
      const metadata = await this.prepareMetadata(run);
      this.assertActive(run);
      if ('kind' in metadata) {
        this.latestPlan = undefined;
        this.emit({ cards: [], noContentMessage: metadata.message, progress: undefined });
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
    return this.fresh(selectionNumber(selection), true);
  }

  async prepareFreshFiles(selection?: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.fresh(selectionNumber(selection), false);
  }

  private async fresh(
    requestedBundleNumber: number | undefined,
    copyAfterExport: boolean,
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
            message: `Copying Prompt ${bundle.number}`,
          },
        });
        const copy = await this.bridge.copyPromptExportBundle({
          sessionId: session.sessionId,
          bundleNumber: bundle.number,
          target: 'context',
        });
        if (!copy.ok) {
          const detail = nativeFailure(copy.error, true).detail;
          this.setCardState(bundle.number, 'error', detail.message);
          throw new ControllerFailure(detail);
        }
        this.assertActive(run);
        this.setCardState(bundle.number, 'copied');
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
    action: (sessionId: string, bundleNumber: number) => Promise<WorkflowResult<void>>,
  ): Promise<PromptBundleControllerActionResult> {
    if (this.activeRun) {
      const detail = failure('busy', 'Wait for the active prompt export to finish.', true).detail;
      return { ok: false, error: detail };
    }
    try {
      if (this.disposed)
        throw failure('disposed', 'The prompt export controller is no longer available.', false);
      const { artifact, bundleNumber } = this.artifactSelection(selection);
      const result = await action(artifact.sessionId, bundleNumber);
      if (!result.ok) throw nativeFailure(result.error, true);
      return { ok: true, sessionId: artifact.sessionId, bundleNumber };
    } catch (error) {
      return this.resultError(error);
    }
  }

  copyMarkdown(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.nativeArtifactAction(selection, (sessionId, bundleNumber) =>
      this.bridge.copyPromptExportBundle({ sessionId, bundleNumber, target: 'markdown' }),
    );
  }

  copyImage(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.nativeArtifactAction(selection, (sessionId, bundleNumber) =>
      this.bridge.copyPromptExportBundle({ sessionId, bundleNumber, target: 'image' }),
    );
  }

  openFiles(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult> {
    return this.nativeArtifactAction(selection, async (sessionId, bundleNumber) => {
      const png = await this.bridge.openPromptExportBundle({ sessionId, bundleNumber, target: 'png' });
      if (!png.ok) return png;
      return this.bridge.openPromptExportBundle({ sessionId, bundleNumber, target: 'markdown' });
    });
  }

  async openFolder(): Promise<PromptBundleControllerActionResult> {
    const artifact = this.latestArtifact;
    const bundleNumber = artifact?.grants.keys().next().value as number | undefined;
    if (!artifact || bundleNumber === undefined)
      return this.resultError(
        failure('invalid-bundle', 'Prepare a fresh export before opening its folder.', true),
      );
    return this.nativeArtifactAction(bundleNumber, (sessionId, selectedBundleNumber) =>
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
      const cardUsesArtifact =
        artifact &&
        card?.planId === artifact.planId &&
        card.artifactSessionId === artifact.sessionId &&
        artifact.grants.has(bundleNumber);
      if (artifact && cardUsesArtifact) {
        const content = unwrap(
          await this.bridge.readPromptExportBundle({ sessionId: artifact.sessionId, bundleNumber }),
        );
        throwIfAborted(controller.signal);
        if (sequence !== this.previewSequence) throw cancelledFailure();
        this.emit({
          preview: {
            bundleNumber,
            dataUrl: content.imageDataUrl,
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
          dataUrl: composition.dataUrl,
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
