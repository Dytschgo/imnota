/** How long a committed delete stays restorable from Recently deleted. */
export const DELETED_ITEM_RETENTION_DAYS = 30;
export const DELETED_ITEM_RETENTION_MS = DELETED_ITEM_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** A deleted item whose local recovery journal still carries a valid Undo grant. */
export interface RecentlyDeletedItem {
  kind: 'screenshot' | 'drawing' | 'text';
  undoToken: string;
  itemId: string;
  title: string;
  collectionId: string;
  deletedAt: string;
}

/**
 * True only for a readable timestamp at least one retention window old. An unreadable or
 * future timestamp is never treated as expired, so uncertainty keeps the recovery data.
 */
export function deleteRetentionExpired(
  deletedAt: string,
  now: number,
  retentionMs = DELETED_ITEM_RETENTION_MS,
): boolean {
  const deleted = Date.parse(deletedAt);
  return (
    Number.isFinite(deleted) &&
    Number.isFinite(now) &&
    Number.isFinite(retentionMs) &&
    retentionMs > 0 &&
    now >= deleted &&
    now - deleted >= retentionMs
  );
}

/** Null is clean success; a string is failure; an object is success with a visible warning. */
export type RecentlyDeletedRestoreResult = string | null | { warning: string };
