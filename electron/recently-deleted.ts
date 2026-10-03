import type { RecentlyDeletedItem } from '../src/shared/recently-deleted.js';
import {
  listDeletedContentItems,
  pruneExpiredContentDeletes,
  type ContentTrashOperations,
} from './content-trash.js';
import {
  listDeletedScreenshots,
  pruneExpiredScreenshotDeletes,
  type ScreenshotTrashOperations,
} from './screenshot-trash.js';

/** Restorable deletes for one project, newest first. Read-only. */
export async function listRecentlyDeleted(
  projectPath: string,
  now = Date.now(),
): Promise<RecentlyDeletedItem[]> {
  const screenshots = await listDeletedScreenshots(projectPath, now);
  const content = await listDeletedContentItems(projectPath, now);
  const items: RecentlyDeletedItem[] = [
    ...screenshots.map(({ undoToken, screenshot, deletedAt }) => ({
      kind: 'screenshot' as const,
      undoToken,
      itemId: screenshot.id,
      title: screenshot.title || screenshot.originalFilename,
      collectionId: screenshot.collectionId,
      deletedAt,
    })),
    ...content.map(({ undoToken, item, deletedAt }) => ({
      kind: item.kind,
      undoToken,
      itemId: item.id,
      title: item.kind === 'drawing' ? item.title || 'Drawing' : item.preview || 'Text block',
      collectionId: item.collectionId,
      deletedAt,
    })),
  ];
  return items.sort(
    (a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.undoToken.localeCompare(b.undoToken),
  );
}

export interface DeleteRetentionResult {
  pruned: number;
  /** One entry per journal (or journal root) that could not be pruned. Validation failures keep journals; cleanup failures keep any expired remnants. */
  failures: unknown[];
}

/**
 * Applies the retention window to committed-delete journals. Housekeeping only: it never
 * rejects, so a failure here cannot block the project open that triggers it.
 */
export async function pruneExpiredDeletes(
  projectPath: string,
  operations: { screenshots?: ScreenshotTrashOperations; content?: ContentTrashOperations } = {},
  now = Date.now(),
): Promise<DeleteRetentionResult> {
  const result: DeleteRetentionResult = { pruned: 0, failures: [] };
  for (const prune of [
    () => pruneExpiredScreenshotDeletes(projectPath, now, operations.screenshots),
    () => pruneExpiredContentDeletes(projectPath, now, operations.content),
  ]) {
    try {
      const outcome = await prune();
      result.pruned += outcome.pruned.length;
      result.failures.push(...outcome.failed.map((failure) => failure.error));
    } catch (error) {
      result.failures.push(error);
    }
  }
  return result;
}
