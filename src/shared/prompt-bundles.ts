export type PromptPriority = 'low' | 'medium' | 'high';

export interface PromptAnnotationInput {
  kind: string;
  text?: string;
}

export interface PromptScreenshotInput {
  id: string;
  position: number;
  title: string;
  originalFilename: string;
  description: string;
  priority: PromptPriority;
  includeInExport: boolean;
  nativeWidth: number;
  nativeHeight: number;
  contentRevision: string;
  annotations: readonly PromptAnnotationInput[];
}

export interface PromptCollectionInput {
  collectionId: string;
  collectionName: string;
  overallContext: string;
  screenshots: readonly PromptScreenshotInput[];
}

export interface MeasuredPromptScreenshot {
  screenshotId: string;
  width: number;
  height: number;
  /** Optional preflight estimate; actual composed size remains authoritative. */
  estimatedPngCharacters?: number;
  /** Convenience only. Production integration should resolve PNGs per bundle on demand. */
  dataUrl?: string;
}

export interface PromptTextNote {
  number: number;
  text: string;
}

export interface PromptBundlePicture {
  screenshotId: string;
  pictureNumber: number;
  title: string;
  originalFilename: string;
  description: string;
  priority: PromptPriority;
  contentRevision: string;
  notes: PromptTextNote[];
  estimatedPngCharacters?: number;
  /** Convenience only; omit to keep the collection plan metadata-only. */
  dataUrl?: string;
  width: number;
  height: number;
}

export interface PromptBundleLayoutOptions {
  outerMargin: number;
  labelHeight: number;
  labelGap: number;
  pictureGap: number;
}

export interface PromptBundleLayoutItem {
  screenshotId: string;
  pictureNumber: number;
  x: number;
  labelY: number;
  imageY: number;
  width: number;
  height: number;
}

export interface PromptBundleLayout {
  width: number;
  height: number;
  items: PromptBundleLayoutItem[];
}

export interface PromptBundleLimits {
  maxEdge: number;
  maxPixels: number;
  maxEstimatedPngCharacters: number;
  encodedSizeHeadroom: number;
}

export type PromptBundleDelivery = 'clipboard' | 'file-only';

export interface PromptBundle {
  number: number;
  total: number;
  pictures: PromptBundlePicture[];
  pictureNumbers: number[];
  excludedPictureNumbers: number[];
  excludedCount: number;
  markdown: string;
  layout: PromptBundleLayout;
  estimatedPngCharacters: number;
  delivery: PromptBundleDelivery;
  warning?: string;
  reference?: string;
}

export interface PromptBundlePlan {
  kind: 'ready';
  collectionId: string;
  collectionName: string;
  overallContext: string;
  bundles: PromptBundle[];
}

export interface PromptBundleNoContent {
  kind: 'no-content';
  message: string;
}

export type PromptBundlePlanResult = PromptBundlePlan | PromptBundleNoContent;

export interface PromptBundleProgress {
  phase: 'planning' | 'rendering' | 'writing' | 'copying' | 'complete' | 'cancelled' | 'error';
  bundleNumber?: number;
  totalBundles?: number;
  message?: string;
}

export interface PlanPromptBundleOptions {
  limits?: Partial<PromptBundleLimits>;
  layout?: Partial<PromptBundleLayoutOptions>;
  /**
   * Integration may add a break and re-plan when an encoded composed PNG exceeds
   * the estimate. IDs mean "start a new bundle with this screenshot".
   */
  breakBeforeScreenshotIds?: ReadonlySet<string>;
  markdownIdentity?: PromptBundleMarkdownIdentity;
}

export interface PromptBundleMarkdownIdentity {
  /** Server-reserved set name, for example "Collection 02 - 260907-184205". */
  setName: string;
}

export const DEFAULT_PROMPT_BUNDLE_LIMITS: PromptBundleLimits = {
  maxEdge: 8192,
  maxPixels: 16_000_000,
  maxEstimatedPngCharacters: 32_000_000,
  encodedSizeHeadroom: 1.15,
};

export const DEFAULT_PROMPT_BUNDLE_LAYOUT: PromptBundleLayoutOptions = {
  outerMargin: 32,
  labelHeight: 36,
  labelGap: 12,
  pictureGap: 32,
};

const FILE_ONLY_WARNING =
  'This full-resolution prompt exceeds safe clipboard limits. Use the saved PNG and Markdown files instead.';

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function cleanHeading(value: string, fallback: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim() || fallback;
}

/**
 * Input annotations must be in original creation/array order. Do not sort by
 * zIndex. Once src/shared/annotation-order.ts lands, integration must pass the
 * order produced by that shared helper into this mapper.
 */
export function mapPromptTextNotes(
  annotationsInCreationOrder: readonly PromptAnnotationInput[],
): PromptTextNote[] {
  const notes: PromptTextNote[] = [];
  for (const annotation of annotationsInCreationOrder) {
    if (annotation.kind !== 'text' && annotation.kind !== 'callout') continue;
    const text = annotation.text?.trim();
    if (!text) continue;
    notes.push({ number: notes.length + 1, text });
  }
  return notes;
}

export function calculatePromptBundleLayout(
  pictures: readonly Pick<PromptBundlePicture, 'screenshotId' | 'pictureNumber' | 'width' | 'height'>[],
  overrides: Partial<PromptBundleLayoutOptions> = {},
): PromptBundleLayout {
  if (!pictures.length) throw new Error('A visual prompt bundle needs at least one screenshot.');
  const options = { ...DEFAULT_PROMPT_BUNDLE_LAYOUT, ...overrides };
  nonnegativeInteger(options.outerMargin, 'Outer margin');
  positiveInteger(options.labelHeight, 'Label height');
  nonnegativeInteger(options.labelGap, 'Label gap');
  nonnegativeInteger(options.pictureGap, 'Picture gap');

  const widest = Math.max(...pictures.map((picture) => positiveInteger(picture.width, 'Picture width')));
  const width = widest + options.outerMargin * 2;
  let y = options.outerMargin;
  const items = pictures.map((picture, index) => {
    const pictureWidth = positiveInteger(picture.width, 'Picture width');
    const pictureHeight = positiveInteger(picture.height, 'Picture height');
    const item = {
      screenshotId: picture.screenshotId,
      pictureNumber: picture.pictureNumber,
      x: options.outerMargin + Math.floor((widest - pictureWidth) / 2),
      labelY: y,
      imageY: y + options.labelHeight + options.labelGap,
      width: pictureWidth,
      height: pictureHeight,
    };
    y = item.imageY + pictureHeight;
    if (index < pictures.length - 1) y += options.pictureGap;
    return item;
  });
  const height = y + options.outerMargin;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
    throw new Error('Prompt bundle dimensions exceed safe integer bounds.');
  return { width, height, items };
}

function estimatePngCharacters(pictures: readonly PromptBundlePicture[], headroom: number): number {
  if (!Number.isFinite(headroom) || headroom < 1)
    throw new Error('Encoded-size headroom must be at least 1.');
  return Math.ceil(
    pictures.reduce(
      (total, picture) => total + (picture.estimatedPngCharacters ?? picture.dataUrl?.length ?? 0),
      0,
    ) *
      headroom +
      4096,
  );
}

function fitsClipboard(
  layout: PromptBundleLayout,
  estimatedPngCharacters: number,
  limits: PromptBundleLimits,
): boolean {
  return (
    layout.width <= limits.maxEdge &&
    layout.height <= limits.maxEdge &&
    layout.width * layout.height <= limits.maxPixels &&
    estimatedPngCharacters <= limits.maxEstimatedPngCharacters
  );
}

function markdownForBundle(
  collection: PromptCollectionInput,
  pictures: readonly PromptBundlePicture[],
  excludedPictureNumbers: readonly number[],
  bundleNumber: number,
  bundleCount: number,
  identity?: PromptBundleMarkdownIdentity,
): string {
  const lines = [
    `# ${cleanHeading(collection.collectionName, 'Untitled collection')}`,
    '',
    `Prompt ${bundleNumber} of ${bundleCount}`,
    '',
  ];
  if (identity) {
    lines.push(`Export set: ${cleanHeading(identity.setName, 'Prompt export')}`);
    lines.push(
      `Bundle reference: ${cleanHeading(identity.setName, 'Prompt export')} - ${String(bundleNumber).padStart(2, '0')}`,
      '',
    );
  }
  const context = collection.overallContext.trim();
  if (context && bundleNumber === 1) lines.push('## Overall context', '', context, '');
  else if (context) lines.push('Shared collection context is included in Prompt 1.', '');

  for (const picture of pictures) {
    lines.push(
      `## Picture ${picture.pictureNumber} — ${cleanHeading(picture.title, picture.originalFilename)}`,
      '',
      `Priority for agent: ${picture.priority[0].toUpperCase()}${picture.priority.slice(1)}`,
      '',
    );
    const description = picture.description.trim();
    if (description) lines.push(description, '');
    for (const note of picture.notes)
      lines.push(`### Picture ${picture.pictureNumber} / Note ${note.number}`, '', note.text, '');
  }

  for (const pictureNumber of excludedPictureNumbers)
    lines.push(`Picture ${pictureNumber} was intentionally excluded from this prompt bundle.`, '');
  return `${lines.join('\n').trim()}\n`;
}

function orderedScreenshots(screenshots: readonly PromptScreenshotInput[]): PromptScreenshotInput[] {
  return screenshots
    .map((screenshot, sourceIndex) => ({ screenshot, sourceIndex }))
    .sort(
      (left, right) =>
        left.screenshot.position - right.screenshot.position || left.sourceIndex - right.sourceIndex,
    )
    .map(({ screenshot }) => screenshot);
}

function resolveRendered(
  screenshot: PromptScreenshotInput,
  pictureNumber: number,
  measuredById: ReadonlyMap<string, MeasuredPromptScreenshot>,
): PromptBundlePicture {
  const measured = measuredById.get(screenshot.id);
  if (!measured) throw new Error(`Measured screenshot is missing for Picture ${pictureNumber}.`);
  if (measured.dataUrl !== undefined && !measured.dataUrl.startsWith('data:image/png;base64,'))
    throw new Error(`Rendered screenshot for Picture ${pictureNumber} is not a PNG data URL.`);
  positiveInteger(measured.width, `Picture ${pictureNumber} width`);
  positiveInteger(measured.height, `Picture ${pictureNumber} height`);
  if (
    measured.estimatedPngCharacters !== undefined &&
    (!Number.isSafeInteger(measured.estimatedPngCharacters) || measured.estimatedPngCharacters < 0)
  )
    throw new Error(`Estimated PNG size is invalid for Picture ${pictureNumber}.`);
  return {
    screenshotId: screenshot.id,
    pictureNumber,
    title: screenshot.title,
    originalFilename: screenshot.originalFilename,
    description: screenshot.description,
    priority: screenshot.priority,
    contentRevision: screenshot.contentRevision,
    notes: mapPromptTextNotes(screenshot.annotations),
    estimatedPngCharacters: measured.estimatedPngCharacters,
    dataUrl: measured.dataUrl,
    width: measured.width,
    height: measured.height,
  };
}

export function planPromptBundles(
  collection: PromptCollectionInput,
  measuredScreenshots: readonly MeasuredPromptScreenshot[],
  options: PlanPromptBundleOptions = {},
): PromptBundlePlanResult {
  const ordered = orderedScreenshots(collection.screenshots);
  const included = ordered.filter((screenshot) => screenshot.includeInExport);
  if (!included.length)
    return {
      kind: 'no-content',
      message: ordered.length
        ? 'No screenshots are included. Turn on at least one screenshot to create a prompt bundle.'
        : 'This collection has no screenshots yet. Add a screenshot to create a prompt bundle.',
    };

  const limits = { ...DEFAULT_PROMPT_BUNDLE_LIMITS, ...options.limits };
  positiveInteger(limits.maxEdge, 'Maximum edge');
  positiveInteger(limits.maxPixels, 'Maximum pixels');
  positiveInteger(limits.maxEstimatedPngCharacters, 'Maximum estimated PNG characters');
  const measuredById = new Map(measuredScreenshots.map((measured) => [measured.screenshotId, measured]));
  if (measuredById.size !== measuredScreenshots.length)
    throw new Error('Measured screenshots contain duplicate screenshot IDs.');

  const numberById = new Map(ordered.map((screenshot, index) => [screenshot.id, index + 1]));
  if (numberById.size !== ordered.length) throw new Error('Collection contains duplicate screenshot IDs.');
  const excludedPictureNumbers = ordered
    .map((screenshot, index) => ({ screenshot, pictureNumber: index + 1 }))
    .filter(({ screenshot }) => !screenshot.includeInExport)
    .map(({ pictureNumber }) => pictureNumber);
  const pictures = included.map((screenshot) =>
    resolveRendered(screenshot, numberById.get(screenshot.id)!, measuredById),
  );

  const groups: Array<{
    pictures: PromptBundlePicture[];
    layout: PromptBundleLayout;
    estimatedPngCharacters: number;
    delivery: PromptBundleDelivery;
    warning?: string;
  }> = [];
  let current: PromptBundlePicture[] = [];

  const finalizeCurrent = () => {
    if (!current.length) return;
    const layout = calculatePromptBundleLayout(current, options.layout);
    const estimatedPngCharacters = estimatePngCharacters(current, limits.encodedSizeHeadroom);
    const clipboardSafe = fitsClipboard(layout, estimatedPngCharacters, limits);
    groups.push({
      pictures: current,
      layout,
      estimatedPngCharacters,
      delivery: clipboardSafe ? 'clipboard' : 'file-only',
      warning: clipboardSafe ? undefined : FILE_ONLY_WARNING,
    });
    current = [];
  };

  for (const picture of pictures) {
    if (current.length && options.breakBeforeScreenshotIds?.has(picture.screenshotId)) finalizeCurrent();
    const candidate = [...current, picture];
    const layout = calculatePromptBundleLayout(candidate, options.layout);
    const estimatedPngCharacters = estimatePngCharacters(candidate, limits.encodedSizeHeadroom);
    if (current.length && !fitsClipboard(layout, estimatedPngCharacters, limits)) {
      finalizeCurrent();
      current = [picture];
    } else current = candidate;
  }
  finalizeCurrent();

  const bundles = groups.map((group, index): PromptBundle => ({
    number: index + 1,
    total: groups.length,
    pictures: group.pictures,
    pictureNumbers: group.pictures.map((picture) => picture.pictureNumber),
    excludedPictureNumbers,
    excludedCount: excludedPictureNumbers.length,
    markdown: markdownForBundle(
      collection,
      group.pictures,
      excludedPictureNumbers,
      index + 1,
      groups.length,
      options.markdownIdentity,
    ),
    layout: group.layout,
    estimatedPngCharacters: group.estimatedPngCharacters,
    delivery: group.delivery,
    warning: group.warning,
    reference: options.markdownIdentity
      ? `${options.markdownIdentity.setName} - ${String(index + 1).padStart(2, '0')}`
      : undefined,
  }));
  return {
    kind: 'ready',
    collectionId: collection.collectionId,
    collectionName: collection.collectionName,
    overallContext: collection.overallContext,
    bundles,
  };
}

/** Stamp an existing metadata-only plan after the main process reserves its collision-free set name. */
export function applyPromptBundleMarkdownIdentity(
  plan: PromptBundlePlan,
  identity: PromptBundleMarkdownIdentity,
): PromptBundlePlan {
  const collection: PromptCollectionInput = {
    collectionId: plan.collectionId,
    collectionName: plan.collectionName,
    overallContext: plan.overallContext,
    screenshots: [],
  };
  return {
    ...plan,
    bundles: plan.bundles.map((bundle) => ({
      ...bundle,
      reference: `${identity.setName} - ${String(bundle.number).padStart(2, '0')}`,
      markdown: markdownForBundle(
        collection,
        bundle.pictures,
        bundle.excludedPictureNumbers,
        bundle.number,
        bundle.total,
        identity,
      ),
    })),
  };
}

/** Return the first screenshot ID that should move into a new bundle after an actual encoded overflow. */
export function encodedOverflowBreak(bundle: PromptBundle): string | null {
  if (bundle.pictures.length < 2) return null;
  return bundle.pictures[Math.ceil(bundle.pictures.length / 2)].screenshotId;
}
