import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';

export type CaptureOverlayFailure = 'not-ready' | 'misplaced' | 'display-changed';

export type CaptureOverlayOutcome =
  | { kind: 'selected'; selection: CaptureRectangle }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: CaptureOverlayFailure };

export interface OverlayReadinessTimer {
  set(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
}

const nativeTimer: OverlayReadinessTimer = {
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: (handle) => clearTimeout(handle),
};

/** One overlay gets one result; cancellation wins over delayed renderer IPC. */
export class CaptureOverlaySession {
  private finished = false;
  private complete!: (outcome: CaptureOverlayOutcome) => void;
  readonly result: Promise<CaptureOverlayOutcome>;

  constructor() {
    this.result = new Promise((resolve) => {
      this.complete = resolve;
    });
  }

  settle(selection: CaptureRectangle | null): boolean {
    if (this.finished) return false;
    this.finished = true;
    this.complete(selection ? { kind: 'selected', selection } : { kind: 'cancelled' });
    return true;
  }

  fail(reason: CaptureOverlayFailure = 'not-ready'): boolean {
    if (this.finished) return false;
    this.finished = true;
    this.complete({ kind: 'failed', reason });
    return true;
  }
}

export function closeCaptureOverlayWindows(
  windows: readonly { isDestroyed(): boolean; destroy(): void }[],
): void {
  // Selection windows have no unsaved renderer state. Destroy them after settling
  // the session, without cancellable close or macOS fullscreen transitions.
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
}

export interface CaptureSelectionState {
  selection: CaptureRectangle | null;
  complete: boolean;
  actionsDisplayId: number | null;
}

export function capturePointerGlobalPoint(
  display: CaptureDisplay,
  localPoint: { x: number; y: number },
  nativeCursorPoint: () => { x: number; y: number },
): { x: number; y: number } {
  if (
    localPoint.x >= 0 &&
    localPoint.x <= display.bounds.width &&
    localPoint.y >= 0 &&
    localPoint.y <= display.bounds.height
  )
    return { x: display.bounds.x + localPoint.x, y: display.bounds.y + localPoint.y };
  // Pointer capture can keep events in the origin renderer after crossing onto
  // a differently scaled display. Its out-of-window CSS coordinates are not a
  // trustworthy global DIP grid; Electron's native cursor point is.
  return nativeCursorPoint();
}

function desktopBounds(displays: readonly CaptureDisplay[]): CaptureRectangle {
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Coordinates pointer capture across one exact-bound overlay per display. */
export class CaptureSelectionCoordinator {
  private readonly desktop: CaptureRectangle;
  private start: { x: number; y: number } | null = null;
  private state: CaptureSelectionState = {
    selection: null,
    complete: false,
    actionsDisplayId: null,
  };

  constructor(private readonly displays: readonly CaptureDisplay[]) {
    if (!displays.length) throw new Error('Capture selection needs at least one display.');
    this.desktop = desktopBounds(displays);
  }

  update(
    displayId: number,
    phase: 'begin' | 'move' | 'end' | 'reset',
    localPoint?: { x: number; y: number },
    globalPoint?: { x: number; y: number },
  ): CaptureSelectionState {
    if (phase === 'reset') {
      this.start = null;
      this.state = { selection: null, complete: false, actionsDisplayId: null };
      return this.current();
    }
    const display = this.displays.find((candidate) => candidate.id === displayId);
    if (!display || !localPoint || !Number.isFinite(localPoint.x) || !Number.isFinite(localPoint.y))
      return this.current();
    const translated = globalPoint ?? {
      x: display.bounds.x + localPoint.x,
      y: display.bounds.y + localPoint.y,
    };
    const point = {
      x: clamp(translated.x, this.desktop.x, this.desktop.x + this.desktop.width),
      y: clamp(translated.y, this.desktop.y, this.desktop.y + this.desktop.height),
    };
    if (phase === 'begin') {
      this.start = point;
      this.state = { selection: null, complete: false, actionsDisplayId: null };
      return this.current();
    }
    if (!this.start) return this.current();
    const selection = {
      x: Math.min(this.start.x, point.x),
      y: Math.min(this.start.y, point.y),
      width: Math.abs(point.x - this.start.x),
      height: Math.abs(point.y - this.start.y),
    };
    const validSelection = selection.width >= 1 && selection.height >= 1 ? selection : null;
    if (phase === 'end') {
      this.start = null;
      const actionsDisplay = this.displays.find(
        ({ bounds }) =>
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height,
      );
      this.state = {
        selection: validSelection,
        complete: Boolean(validSelection),
        actionsDisplayId: validSelection ? (actionsDisplay?.id ?? displayId) : null,
      };
    } else {
      this.state = { selection: validSelection, complete: false, actionsDisplayId: null };
    }
    return this.current();
  }

  current(): CaptureSelectionState {
    return {
      selection: this.state.selection ? { ...this.state.selection } : null,
      complete: this.state.complete,
      actionsDisplayId: this.state.actionsDisplayId,
    };
  }
}

/** Bounds the hidden-overlay phase so an unavailable renderer cannot hide the app indefinitely. */
export function createOverlayReadinessGuard(
  onTimeout: () => void,
  timeoutMilliseconds: number,
  timer: OverlayReadinessTimer = nativeTimer,
): { ready(): boolean; dispose(): void } {
  let finished = false;
  const handle = timer.set(() => {
    if (finished) return;
    finished = true;
    onTimeout();
  }, timeoutMilliseconds);
  return {
    ready() {
      if (finished) return false;
      finished = true;
      timer.clear(handle);
      return true;
    },
    dispose() {
      if (finished) return;
      finished = true;
      timer.clear(handle);
    },
  };
}

export function isCaptureOverlaySender(
  expectedWebContentsIds: readonly number[] | undefined,
  senderWebContentsId: number,
  senderIsMainFrame: boolean,
): boolean {
  return Boolean(expectedWebContentsIds?.includes(senderWebContentsId) && senderIsMainFrame);
}
