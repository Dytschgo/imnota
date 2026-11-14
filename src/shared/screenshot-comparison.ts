import type { ScreenshotComparison } from './types.js';

export function comparisonLabels(kind: ScreenshotComparison['kind']): readonly [string, string] {
  return kind === 'before-after' ? ['Before', 'After'] : ['Current', 'Expected'];
}

export function comparisonRole(pair: ScreenshotComparison | undefined, id: string): string | undefined {
  if (!pair) return undefined;
  const labels = comparisonLabels(pair.kind);
  return id === pair.leftId ? labels[0] : id === pair.rightId ? labels[1] : undefined;
}

/** Describes membership/visibility; never reads or restores excluded/deleted pixels. */
export function comparisonSummary(
  pair: ScreenshotComparison,
  visuals: readonly { id: string; includeInExport: boolean }[],
): string {
  const labels = comparisonLabels(pair.kind);
  const member = (id: string, label: string) => {
    const index = visuals.findIndex((shot) => shot.id === id);
    return index < 0
      ? `${label}: screenshot unavailable`
      : `${label}: Picture ${index + 1}${visuals[index].includeInExport ? '' : ' (excluded)'}`;
  };
  return `${labels.join(' / ')} comparison — ${member(pair.leftId, labels[0])}; ${member(pair.rightId, labels[1])}.`;
}
