export const ANNOTATION_UNDO_LIMIT = 200;

export function pushBounded<T>(items: readonly T[], item: T, limit: number): T[] {
  return [...items, item].slice(-limit);
}
