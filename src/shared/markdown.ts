import { orderedCollectionItems as orderedContent, type ContentItem } from './content-items.js';
import type { ProjectData, ScreenshotRecord } from './types.js';

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

/** Source screenshot pixels already stored on the record; not a schema field. */
export function pictureSourceSizeLine(width: number, height: number): string {
  return `Source size: ${width}×${height}`;
}
