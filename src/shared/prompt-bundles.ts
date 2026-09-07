export type PromptPriority = 'low' | 'medium' | 'high';
export type PromptVisualKind = 'screenshot' | 'drawing';

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
  kind?: 'screenshot';
}
export interface PromptDrawingInput {
  id: string;
  kind: 'drawing';
  position: number;
  title: string;
  originalFilename: string;
  includeInExport: boolean;
  nativeWidth: number;
  nativeHeight: number;
  contentRevision: string;
  sourceFilename: string;
}
export interface PromptTextInput {
  id: string;
  kind: 'text';
  position: number;
  includeInExport: boolean;
  markdown: string;
  contentRevision: string;
}
export type PromptCollectionItemInput = PromptScreenshotInput | PromptDrawingInput | PromptTextInput;
export interface PromptCollectionInput {
  collectionId: string;
  collectionName: string;
  overallContext: string;
  /** Kept for existing callers; mixed callers must provide items. */
  screenshots: readonly PromptScreenshotInput[];
  items?: readonly PromptCollectionItemInput[];
}
export interface MeasuredPromptScreenshot {
  screenshotId: string;
  width: number;
  height: number;
  estimatedPngCharacters?: number;
  dataUrl?: string;
}
export interface PromptTextNote {
  number: number;
  text: string;
}
export interface PromptBundlePicture {
  screenshotId: string;
  pictureNumber: number;
  kind: PromptVisualKind;
  title: string;
  originalFilename: string;
  description: string;
  priority: PromptPriority;
  contentRevision: string;
  notes: PromptTextNote[];
  sourceFilename?: string;
  estimatedPngCharacters?: number;
  dataUrl?: string;
  width: number;
  height: number;
}
export interface PromptBundleText {
  itemId: string;
  markdown: string;
  contentRevision: string;
}
export type PromptBundleEntry =
  | { kind: 'visual'; itemId: string }
  | { kind: 'text'; itemId: string; markdown: string; contentRevision: string };
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
  textItems: PromptBundleText[];
  entries: PromptBundleEntry[];
  pictureNumbers: number[];
  excludedPictureNumbers: number[];
  excludedCount: number;
  excludedVisuals: Array<{ number: number; kind: PromptVisualKind }>;
  excludedTextCount: number;
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
  breakBeforeScreenshotIds?: ReadonlySet<string>;
  markdownIdentity?: PromptBundleMarkdownIdentity;
}
export interface PromptBundleMarkdownIdentity {
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
function normalized(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function mapPromptTextNotes(annotations: readonly PromptAnnotationInput[]): PromptTextNote[] {
  const notes: PromptTextNote[] = [];
  for (const annotation of annotations) {
    if (annotation.kind !== 'text' && annotation.kind !== 'callout') continue;
    const text = annotation.text && normalized(annotation.text);
    if (text?.trim()) notes.push({ number: notes.length + 1, text });
  }
  return notes;
}

export function calculatePromptBundleLayout(
  pictures: readonly Pick<PromptBundlePicture, 'screenshotId' | 'pictureNumber' | 'width' | 'height'>[],
  overrides: Partial<PromptBundleLayoutOptions> = {},
): PromptBundleLayout {
  const options = { ...DEFAULT_PROMPT_BUNDLE_LAYOUT, ...overrides };
  nonnegativeInteger(options.outerMargin, 'Outer margin');
  positiveInteger(options.labelHeight, 'Label height');
  nonnegativeInteger(options.labelGap, 'Label gap');
  nonnegativeInteger(options.pictureGap, 'Picture gap');
  if (!pictures.length) return { width: 0, height: 0, items: [] };
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
      (pictures.length ? 4096 : 0),
  );
}
function fitsClipboard(layout: PromptBundleLayout, estimate: number, limits: PromptBundleLimits): boolean {
  return (
    layout.width <= limits.maxEdge &&
    layout.height <= limits.maxEdge &&
    layout.width * layout.height <= limits.maxPixels &&
    estimate <= limits.maxEstimatedPngCharacters
  );
}
function visualLabel(picture: PromptBundlePicture): string {
  return `${picture.kind === 'drawing' ? 'Drawing' : 'Picture'} ${picture.pictureNumber}`;
}

function markdownForBundle(
  collection: PromptCollectionInput,
  bundle: Pick<
    PromptBundle,
    'pictures' | 'entries' | 'excludedVisuals' | 'excludedTextCount' | 'number' | 'total'
  >,
  identity?: PromptBundleMarkdownIdentity,
): string {
  const lines = [
    `# ${cleanHeading(collection.collectionName, 'Untitled collection')}`,
    '',
    `Prompt ${bundle.number} of ${bundle.total}`,
    '',
  ];
  if (identity)
    lines.push(
      `Export set: ${cleanHeading(identity.setName, 'Prompt export')}`,
      `Bundle reference: ${cleanHeading(identity.setName, 'Prompt export')} - ${String(bundle.number).padStart(2, '0')}`,
      '',
    );
  const context = normalized(collection.overallContext);
  if (context.trim() && bundle.number === 1) lines.push('## Overall context', '', context, '');
  else if (context.trim()) lines.push('Shared collection context is included in Prompt 1.', '');
  const visualById = new Map(bundle.pictures.map((picture) => [picture.screenshotId, picture]));
  for (const entry of bundle.entries) {
    if (entry.kind === 'text') {
      if (entry.markdown.trim()) lines.push(normalized(entry.markdown), '');
      continue;
    }
    const picture = visualById.get(entry.itemId);
    if (!picture) continue;
    lines.push(`## ${visualLabel(picture)} — ${cleanHeading(picture.title, picture.originalFilename)}`, '');
    if (picture.kind === 'screenshot') {
      lines.push(`Priority for agent: ${picture.priority[0].toUpperCase()}${picture.priority.slice(1)}`, '');
      if (normalized(picture.description).trim()) lines.push(normalized(picture.description), '');
      for (const note of picture.notes)
        lines.push(`### Picture ${picture.pictureNumber} / Note ${note.number}`, '', note.text, '');
    }
  }
  for (const visual of bundle.excludedVisuals)
    lines.push(
      `${visual.kind === 'drawing' ? 'Drawing' : 'Picture'} ${visual.number} was intentionally excluded from this prompt bundle.`,
      '',
    );
  if (bundle.excludedTextCount)
    lines.push(
      `${bundle.excludedTextCount === 1 ? 'A text block was' : `${bundle.excludedTextCount} text blocks were`} intentionally excluded from this prompt bundle.`,
      '',
    );
  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
}

function orderedItems(collection: PromptCollectionInput): PromptCollectionItemInput[] {
  const items =
    collection.items ?? collection.screenshots.map((item) => ({ ...item, kind: 'screenshot' as const }));
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((a, b) => a.item.position - b.item.position || a.sourceIndex - b.sourceIndex)
    .map(({ item }) => item);
}
function resolveRendered(
  item: Extract<PromptCollectionItemInput, { kind?: 'screenshot' } | { kind: 'drawing' }>,
  number: number,
  measured: ReadonlyMap<string, MeasuredPromptScreenshot>,
): PromptBundlePicture {
  const rendered = measured.get(item.id);
  const label = item.kind === 'drawing' ? `Drawing ${number}` : `Picture ${number}`;
  if (!rendered) throw new Error(`Measured visual is missing for ${label}.`);
  if (rendered.dataUrl !== undefined && !rendered.dataUrl.startsWith('data:image/png;base64,'))
    throw new Error(`Rendered visual for ${label} is not a PNG data URL.`);
  positiveInteger(rendered.width, `${label} width`);
  positiveInteger(rendered.height, `${label} height`);
  if (
    rendered.estimatedPngCharacters !== undefined &&
    (!Number.isSafeInteger(rendered.estimatedPngCharacters) || rendered.estimatedPngCharacters < 0)
  )
    throw new Error(`Estimated PNG size is invalid for ${label}.`);
  const drawing = item.kind === 'drawing';
  return {
    screenshotId: item.id,
    pictureNumber: number,
    kind: drawing ? 'drawing' : 'screenshot',
    title: item.title,
    originalFilename: item.originalFilename,
    description: drawing ? '' : item.description,
    priority: drawing ? 'medium' : item.priority,
    contentRevision: item.contentRevision,
    notes: drawing ? [] : mapPromptTextNotes(item.annotations),
    sourceFilename: drawing ? item.sourceFilename : undefined,
    estimatedPngCharacters: rendered.estimatedPngCharacters,
    dataUrl: rendered.dataUrl,
    width: rendered.width,
    height: rendered.height,
  };
}

export function planPromptBundles(
  collection: PromptCollectionInput,
  measuredVisuals: readonly MeasuredPromptScreenshot[],
  options: PlanPromptBundleOptions = {},
): PromptBundlePlanResult {
  const ordered = orderedItems(collection);
  if (new Set(ordered.map((item) => item.id)).size !== ordered.length)
    throw new Error('Collection contains duplicate content item IDs.');
  const included = ordered.filter((item) => item.includeInExport);
  if (!included.length)
    return {
      kind: 'no-content',
      message: collection.items
        ? ordered.length
          ? 'No content is included. Turn on at least one item to create a prompt bundle.'
          : 'This collection has no content yet. Add a screenshot, drawing, or text block to create a prompt bundle.'
        : ordered.length
          ? 'No screenshots are included. Turn on at least one screenshot to create a prompt bundle.'
          : 'This collection has no screenshots yet. Add a screenshot to create a prompt bundle.',
    };
  const limits = { ...DEFAULT_PROMPT_BUNDLE_LIMITS, ...options.limits };
  positiveInteger(limits.maxEdge, 'Maximum edge');
  positiveInteger(limits.maxPixels, 'Maximum pixels');
  positiveInteger(limits.maxEstimatedPngCharacters, 'Maximum estimated PNG characters');
  const measured = new Map(measuredVisuals.map((value) => [value.screenshotId, value]));
  if (measured.size !== measuredVisuals.length) throw new Error('Measured visuals contain duplicate IDs.');
  const visualNumbers = new Map<string, number>();
  let visualCount = 0;
  for (const item of ordered) if (item.kind !== 'text') visualNumbers.set(item.id, ++visualCount);
  const excludedPictureNumbers = ordered
    .filter((item) => item.kind !== 'text' && !item.includeInExport)
    .map((item) => visualNumbers.get(item.id)!);
  const excludedVisuals = ordered
    .filter((item) => item.kind !== 'text' && !item.includeInExport)
    .map((item) => ({
      number: visualNumbers.get(item.id)!,
      kind: item.kind === 'drawing' ? ('drawing' as const) : ('screenshot' as const),
    }));
  const excludedTextCount = ordered.filter((item) => item.kind === 'text' && !item.includeInExport).length;
  const groups: Array<{ pictures: PromptBundlePicture[]; entries: PromptBundleEntry[] }> = [];
  let current = { pictures: [] as PromptBundlePicture[], entries: [] as PromptBundleEntry[] };
  const finalize = () => {
    if (current.entries.length) groups.push(current);
    current = { pictures: [], entries: [] };
  };
  for (const item of included) {
    if (item.kind === 'text') {
      current.entries.push({
        kind: 'text',
        itemId: item.id,
        markdown: item.markdown,
        contentRevision: item.contentRevision,
      });
      continue;
    }
    if (current.pictures.length && options.breakBeforeScreenshotIds?.has(item.id)) finalize();
    const picture = resolveRendered(item, visualNumbers.get(item.id)!, measured);
    const candidate = [...current.pictures, picture];
    const layout = calculatePromptBundleLayout(candidate, options.layout);
    const estimate = estimatePngCharacters(candidate, limits.encodedSizeHeadroom);
    if (current.pictures.length && !fitsClipboard(layout, estimate, limits)) {
      finalize();
    }
    current.pictures.push(picture);
    current.entries.push({ kind: 'visual', itemId: item.id });
  }
  finalize();
  const bundles = groups.map((group, index): PromptBundle => {
    const layout = calculatePromptBundleLayout(group.pictures, options.layout);
    const estimatedPngCharacters = estimatePngCharacters(group.pictures, limits.encodedSizeHeadroom);
    const clipboardSafe = !group.pictures.length || fitsClipboard(layout, estimatedPngCharacters, limits);
    const bundle: PromptBundle = {
      number: index + 1,
      total: groups.length,
      pictures: group.pictures,
      textItems: group.entries
        .filter((entry): entry is Extract<PromptBundleEntry, { kind: 'text' }> => entry.kind === 'text')
        .map((entry) => ({
          itemId: entry.itemId,
          markdown: entry.markdown,
          contentRevision: entry.contentRevision,
        })),
      entries: group.entries,
      pictureNumbers: group.pictures.map((picture) => picture.pictureNumber),
      excludedPictureNumbers,
      excludedCount: excludedPictureNumbers.length,
      excludedVisuals,
      excludedTextCount,
      markdown: '',
      layout,
      estimatedPngCharacters,
      delivery: clipboardSafe ? 'clipboard' : 'file-only',
      warning: clipboardSafe ? undefined : FILE_ONLY_WARNING,
    };
    bundle.markdown = markdownForBundle(collection, bundle, options.markdownIdentity);
    return bundle;
  });
  return {
    kind: 'ready',
    collectionId: collection.collectionId,
    collectionName: collection.collectionName,
    overallContext: collection.overallContext,
    bundles,
  };
}

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
      markdown: markdownForBundle(collection, bundle, identity),
    })),
  };
}
export function encodedOverflowBreak(bundle: PromptBundle): string | null {
  return bundle.pictures.length < 2
    ? null
    : bundle.pictures[Math.ceil(bundle.pictures.length / 2)].screenshotId;
}
