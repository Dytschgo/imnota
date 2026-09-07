import type { ImagePayload, ProjectData, ProjectSnapshot, ScreenshotRecord } from './types.js';

export type ContentItemKind = 'drawing' | 'text';

export interface ContentItemBase {
  id: string;
  collectionId: string;
  kind: ContentItemKind;
  position: number;
  includeInExport: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DrawingRecord extends ContentItemBase {
  kind: 'drawing';
  title: string;
  sourceFilename: string;
  imageFilename: string;
  originalWidth: number;
  originalHeight: number;
}

export interface TextBlockRecord extends ContentItemBase {
  kind: 'text';
  markdownFilename: string;
  preview?: string;
}

export type ContentItem = DrawingRecord | TextBlockRecord;

export type OrderedScreenshotRecord = ScreenshotRecord & { kind: 'screenshot' };
export type OrderedCollectionItem = OrderedScreenshotRecord | ContentItem;

/** Returns the authoritative mixed collection order without duplicating screenshot metadata. */
export function orderedCollectionItems(
  project: Pick<ProjectData, 'screenshots' | 'contentItems'>,
  collectionId: string,
): OrderedCollectionItem[] {
  return [
    ...project.screenshots
      .filter((item) => item.collectionId === collectionId)
      .map((item) => ({ ...item, kind: 'screenshot' as const })),
    ...(project.contentItems ?? []).filter((item) => item.collectionId === collectionId),
  ].sort(
    (left, right) =>
      left.position - right.position ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export interface ContentItemContent {
  item: ContentItem;
  markdown?: string;
  source?: string;
  image?: ImagePayload;
  contentRevision: string;
}

export interface SaveContentItemResult {
  snapshot: ProjectSnapshot;
  itemId: string;
  contentRevision: string;
  conflictCreated: boolean;
}

export interface DeleteContentItemResult {
  snapshot: ProjectSnapshot;
  undoToken: string;
}

export interface ContentBridge {
  createContentItem(input: {
    projectPath: string;
    collectionId: string;
    kind: ContentItemKind;
    afterItemId?: string;
  }): Promise<ProjectSnapshot>;
  loadContentItem(input: { projectPath: string; itemId: string }): Promise<ContentItemContent>;
  saveContentItem(input: {
    projectPath: string;
    itemId: string;
    contentRevision: string;
    markdown?: string;
    source?: string;
    image?: ImagePayload;
  }): Promise<SaveContentItemResult>;
  duplicateContentItem(input: { projectPath: string; itemId: string }): Promise<ProjectSnapshot>;
  deleteContentItem(input: { projectPath: string; itemId: string }): Promise<DeleteContentItemResult>;
  undoDeleteContentItem(input: { projectPath: string; undoToken: string }): Promise<ProjectSnapshot>;
}
