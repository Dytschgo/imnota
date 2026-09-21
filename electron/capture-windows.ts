import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';

export interface CaptureWindowCandidate {
  id: string;
  title: string;
  bounds: CaptureRectangle;
}

/** Raw OS/Electron window records before capture eligibility is applied. */
export interface NativeCaptureWindow {
  id: string;
  title: string;
  bounds: CaptureRectangle;
  className: string;
  visible: boolean;
  cloaked: boolean;
  toolWindow: boolean;
  minimized: boolean;
  currentProcess: boolean;
}

const SKIP_CAPTURE_WINDOW_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Progman',
  'WorkerW',
  'NotifyIconOverflowWindow',
]);

const MAX_CAPTURE_WINDOWS = 80;

export function intersectCaptureRectangles(
  left: CaptureRectangle,
  right: CaptureRectangle,
): CaptureRectangle | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  return rightEdge > x && bottom > y ? { x, y, width: rightEdge - x, height: bottom - y } : null;
}

function desktopBounds(displays: readonly CaptureDisplay[]): CaptureRectangle | null {
  if (!displays.length) return null;
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Keep a window crop inside the captured display set; never invent pixels. */
export function clipRectangleToDisplays(
  rectangle: CaptureRectangle,
  displays: readonly CaptureDisplay[],
): CaptureRectangle | null {
  const desktop = desktopBounds(displays);
  if (!desktop) return null;
  const clipped = intersectCaptureRectangles(rectangle, desktop);
  return clipped && clipped.width >= 1 && clipped.height >= 1 ? clipped : null;
}

export function captureWindowAtPoint(
  windows: readonly CaptureWindowCandidate[],
  point: { x: number; y: number },
): CaptureWindowCandidate | null {
  return (
    windows.find(
      (candidate) =>
        point.x >= candidate.bounds.x &&
        point.x <= candidate.bounds.x + candidate.bounds.width &&
        point.y >= candidate.bounds.y &&
        point.y <= candidate.bounds.y + candidate.bounds.height,
    ) ?? null
  );
}

/**
 * Windows Electron can identify, in z-order, intersecting the captured displays.
 * Empty means Window mode must explain and offer Region.
 */
export function identifiableCaptureWindows(
  natives: readonly NativeCaptureWindow[],
  displays: readonly CaptureDisplay[],
): CaptureWindowCandidate[] {
  const identified: CaptureWindowCandidate[] = [];
  for (const native of natives) {
    if (identified.length >= MAX_CAPTURE_WINDOWS) break;
    const title = native.title.trim();
    if (
      !native.visible ||
      native.cloaked ||
      native.toolWindow ||
      native.minimized ||
      native.currentProcess ||
      !title ||
      SKIP_CAPTURE_WINDOW_CLASSES.has(native.className)
    )
      continue;
    const bounds = clipRectangleToDisplays(native.bounds, displays);
    if (!bounds) continue;
    identified.push({ id: native.id, title: title.slice(0, 120), bounds });
  }
  return identified;
}
