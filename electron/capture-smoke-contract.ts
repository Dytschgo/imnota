import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';

export interface SyntheticCaptureColor {
  blue: number;
  green: number;
  red: number;
  alpha: number;
}

export interface CrossDisplaySmokeSelection {
  origin: CaptureDisplay;
  destination: CaptureDisplay;
  start: { x: number; y: number };
  end: { x: number; y: number };
  selection: CaptureRectangle;
}

export function syntheticCaptureColor(displayIndex: number): SyntheticCaptureColor {
  const value = ((displayIndex % 216) + 216) % 216;
  return {
    blue: 40 + (value % 6) * 40,
    green: 40 + (Math.floor(value / 6) % 6) * 40,
    red: 40 + (Math.floor(value / 36) % 6) * 40,
    alpha: 255,
  };
}

function selectionBetween(start: { x: number; y: number }, end: { x: number; y: number }) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Choose a small deterministic rectangle spanning one real display seam. */
export function planCrossDisplaySmokeSelection(
  displays: readonly CaptureDisplay[],
): CrossDisplaySmokeSelection | null {
  for (let leftIndex = 0; leftIndex < displays.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < displays.length; rightIndex += 1) {
      const first = displays[leftIndex]!;
      const second = displays[rightIndex]!;
      const verticalCandidates: Array<[CaptureDisplay, CaptureDisplay, number]> = [];
      if (first.bounds.x + first.bounds.width === second.bounds.x)
        verticalCandidates.push([first, second, second.bounds.x]);
      if (second.bounds.x + second.bounds.width === first.bounds.x)
        verticalCandidates.push([second, first, first.bounds.x]);
      for (const [left, right, seam] of verticalCandidates) {
        const overlapStart = Math.max(left.bounds.y, right.bounds.y);
        const overlapEnd = Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height);
        if (overlapEnd - overlapStart < 40) continue;
        const halfWidth = Math.max(
          10,
          Math.floor(Math.min(160, left.bounds.width / 4, right.bounds.width / 4)),
        );
        const halfHeight = Math.max(10, Math.floor(Math.min(80, (overlapEnd - overlapStart) / 4)));
        const centerY = Math.floor((overlapStart + overlapEnd) / 2);
        const start = { x: seam - halfWidth, y: centerY - halfHeight };
        const end = { x: seam + halfWidth, y: centerY + halfHeight };
        return { origin: left, destination: right, start, end, selection: selectionBetween(start, end) };
      }

      const horizontalCandidates: Array<[CaptureDisplay, CaptureDisplay, number]> = [];
      if (first.bounds.y + first.bounds.height === second.bounds.y)
        horizontalCandidates.push([first, second, second.bounds.y]);
      if (second.bounds.y + second.bounds.height === first.bounds.y)
        horizontalCandidates.push([second, first, first.bounds.y]);
      for (const [top, bottom, seam] of horizontalCandidates) {
        const overlapStart = Math.max(top.bounds.x, bottom.bounds.x);
        const overlapEnd = Math.min(top.bounds.x + top.bounds.width, bottom.bounds.x + bottom.bounds.width);
        if (overlapEnd - overlapStart < 40) continue;
        const halfWidth = Math.max(10, Math.floor(Math.min(80, (overlapEnd - overlapStart) / 4)));
        const halfHeight = Math.max(
          10,
          Math.floor(Math.min(160, top.bounds.height / 4, bottom.bounds.height / 4)),
        );
        const centerX = Math.floor((overlapStart + overlapEnd) / 2);
        const start = { x: centerX - halfWidth, y: seam - halfHeight };
        const end = { x: centerX + halfWidth, y: seam + halfHeight };
        return { origin: top, destination: bottom, start, end, selection: selectionBetween(start, end) };
      }
    }
  }
  return null;
}
