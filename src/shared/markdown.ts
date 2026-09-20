import { textAnnotationNoteNumbers, textAnnotationReferences } from './annotation-order.js';
import { orderedCollectionItems as orderedContent, type ContentItem } from './content-items.js';
import type { Annotation, ProjectData, ScreenshotRecord } from './types.js';

export type CollectionItemKind = 'screenshot' | 'drawing' | 'text';

export type CollectionContentItem = ContentItem;

export type OrderedCollectionItem =
  | { kind: 'screenshot'; item: ScreenshotRecord; position: number; sourceIndex: number }
  | {
      kind: 'drawing';
      item: Extract<ContentItem, { kind: 'drawing' }>;
      position: number;
      sourceIndex: number;
    }
  | { kind: 'text'; item: Extract<ContentItem, { kind: 'text' }>; position: number; sourceIndex: number };

/**
 * Adapt the shared collection order to the export boundary.
 */
export function orderedCollectionItems(project: ProjectData, collectionId: string): OrderedCollectionItem[] {
  return orderedContent(project, collectionId).map((item, sourceIndex): OrderedCollectionItem => {
    if (item.kind === 'screenshot') return { kind: 'screenshot', item, position: item.position, sourceIndex };
    if (item.kind === 'drawing') return { kind: 'drawing', item, position: item.position, sourceIndex };
    return { kind: 'text', item, position: item.position, sourceIndex };
  });
}

export interface NumberedScreenshot {
  pictureNumber: number;
  screenshot: ScreenshotRecord;
}

/** Assign Picture numbers from mixed visual order before export filtering. */
export function numberCollectionScreenshots(
  project: ProjectData,
  collectionId: string,
): NumberedScreenshot[] {
  let visualNumber = 0;
  return orderedCollectionItems(project, collectionId).flatMap((entry) => {
    if (entry.kind === 'text') return [];
    visualNumber += 1;
    return entry.kind === 'screenshot' ? [{ pictureNumber: visualNumber, screenshot: entry.item }] : [];
  });
}

function priorityLabel(priority: ScreenshotRecord['priority']): string {
  return priority[0].toUpperCase() + priority.slice(1);
}

function formatPercent(value: number, total: number): string {
  const ratio = total > 0 && Number.isFinite(value) ? (value / total) * 100 : 0;
  return `${ratio.toFixed(1)}%`;
}

function formatPoint(x: number, y: number, screenshot: ScreenshotRecord): string {
  return `${formatPercent(x, screenshot.originalWidth)},${formatPercent(y, screenshot.originalHeight)}`;
}

function formatSize(width: number, height: number, screenshot: ScreenshotRecord): string {
  return `${formatPercent(width, screenshot.originalWidth)}×${formatPercent(height, screenshot.originalHeight)}`;
}

function axisAlignedBox(annotation: Annotation): { x: number; y: number; width: number; height: number } {
  const width = annotation.width ?? 0;
  const height = annotation.height ?? 0;
  return {
    x: annotation.x + Math.min(0, width),
    y: annotation.y + Math.min(0, height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

function pathEndpoints(annotation: Annotation): { fromX: number; fromY: number; toX: number; toY: number } {
  const points = annotation.points ?? [0, 0, annotation.width ?? 0, annotation.height ?? 0];
  const last = points.length >= 4 ? points.length - 2 - (points.length % 2) : 2;
  return {
    fromX: annotation.x + (points[0] ?? 0),
    fromY: annotation.y + (points[1] ?? 0),
    toX: annotation.x + (Number.isFinite(points[last]) ? points[last] : (annotation.width ?? 0)),
    toY: annotation.y + (Number.isFinite(points[last + 1]) ? points[last + 1] : (annotation.height ?? 0)),
  };
}

function pathBox(annotation: Annotation): { x: number; y: number; width: number; height: number } {
  const points = annotation.points;
  if (!points || points.length < 2) return axisAlignedBox(annotation);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = annotation.x + points[index];
    const y = annotation.y + points[index + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Crop is an image operation; redaction coordinates would outline secrets. */
function formatMarkLine(
  annotation: Annotation,
  screenshot: ScreenshotRecord,
  noteNumber: number | undefined,
): string | null {
  if (annotation.kind === 'crop' || annotation.kind === 'blur' || annotation.kind === 'pixelate') return null;
  if ((annotation.kind === 'text' || annotation.kind === 'callout') && noteNumber === undefined) return null;
  const id = `\`${annotation.id}\``;
  if (annotation.kind === 'arrow' || annotation.kind === 'line') {
    const { fromX, fromY, toX, toY } = pathEndpoints(annotation);
    return `${annotation.kind} ${id} from ${formatPoint(fromX, fromY, screenshot)} to ${formatPoint(toX, toY, screenshot)}`;
  }
  if (annotation.kind === 'step') {
    return `step ${id} number ${annotation.stepNumber ?? 1} at ${formatPoint(annotation.x, annotation.y, screenshot)}`;
  }
  const box = annotation.kind === 'pen' ? pathBox(annotation) : axisAlignedBox(annotation);
  const note = noteNumber === undefined ? '' : ` note ${noteNumber}`;
  return `${annotation.kind} ${id}${note} at ${formatPoint(box.x, box.y, screenshot)} ${formatSize(box.width, box.height, screenshot)}`;
}

function markListItems(annotations: readonly Annotation[], screenshot: ScreenshotRecord): string[] {
  const noteNumbers = textAnnotationNoteNumbers(annotations);
  return annotations.flatMap((annotation) => {
    const line = formatMarkLine(annotation, screenshot, noteNumbers.get(annotation.id));
    return line ? [`- ${line}`] : [];
  });
}

/** Legacy/package overview Markdown. Prompt bundles use the richer planner. */
export function generateMarkdown(
  project: ProjectData,
  collectionId: string,
  annotations: Record<string, Annotation[]>,
  markdownByTextItem: Record<string, string> = {},
): string {
  const collection = project.collections.find((item) => item.id === collectionId);
  if (!collection) throw new Error('Collection not found.');
  const out = [`# ${collection.name}`, ''];
  if (collection.overallContext.trim())
    out.push('## Overall context', '', collection.overallContext.trim(), '');

  let visualNumber = 0;
  for (const entry of orderedCollectionItems(project, collectionId)) {
    if (entry.kind === 'text') {
      if (!entry.item.includeInExport)
        out.push('A text block was intentionally excluded from this prompt bundle.', '');
      else if (markdownByTextItem[entry.item.id]?.trim()) out.push(markdownByTextItem[entry.item.id], '');
      continue;
    }
    visualNumber += 1;
    if (entry.kind === 'drawing') {
      if (!entry.item.includeInExport)
        out.push(`Drawing ${visualNumber} was intentionally excluded from this prompt bundle.`, '');
      else {
        out.push(`## Drawing ${visualNumber} — ${entry.item.title?.trim() || 'Untitled drawing'}`, '');
        if (entry.item.description?.trim()) out.push(entry.item.description.trim(), '');
      }
      continue;
    }
    const shot = entry.item as ScreenshotRecord;
    if (!shot.includeInExport) {
      out.push(`Picture ${visualNumber} was intentionally excluded from this prompt bundle.`, '');
      continue;
    }
    out.push(
      `## Picture ${visualNumber} — ${shot.title || shot.originalFilename}`,
      '',
      `Priority for agent: ${priorityLabel(shot.priority)}`,
      '',
    );
    if (shot.description.trim()) out.push(shot.description.trim(), '');
    const shotAnnotations = annotations[shot.id] ?? [];
    for (const { annotation, noteNumber } of textAnnotationReferences(shotAnnotations)) {
      out.push(`### Picture ${visualNumber} / Note ${noteNumber}`, '', annotation.text!.trim(), '');
    }
    const marks = markListItems(shotAnnotations, shot);
    if (marks.length) out.push(`### Picture ${visualNumber} / Marks`, '', ...marks, '');
  }
  return `${out.join('\n').replace(/\n+$/g, '')}\n`;
}
