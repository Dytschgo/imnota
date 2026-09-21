import { annotationMarkListItems } from './annotation-marks.js';
import { textAnnotationReferences } from './annotation-order.js';
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

/** Source screenshot pixels already stored on the record; not a schema field. */
export function pictureSourceSizeLine(width: number, height: number): string {
  return `Source size: ${width}×${height}`;
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
      pictureSourceSizeLine(shot.originalWidth, shot.originalHeight),
      '',
    );
    if (shot.description.trim()) out.push(shot.description.trim(), '');
    const shotAnnotations = annotations[shot.id] ?? [];
    for (const { annotation, noteNumber } of textAnnotationReferences(shotAnnotations)) {
      out.push(`### Picture ${visualNumber} / Note ${noteNumber}`, '', annotation.text!.trim(), '');
    }
    const marks = annotationMarkListItems(shotAnnotations, shot);
    if (marks.length) out.push(`### Picture ${visualNumber} / Marks`, '', ...marks, '');
  }
  return `${out.join('\n').replace(/\n+$/g, '')}\n`;
}
