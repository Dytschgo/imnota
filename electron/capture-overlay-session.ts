import type { CaptureRectangle } from '../src/shared/capture.js';

export type CaptureOverlayFailure = 'not-ready' | 'misplaced';

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
  expectedWebContentsId: number | undefined,
  senderWebContentsId: number,
  senderIsMainFrame: boolean,
): boolean {
  return expectedWebContentsId === senderWebContentsId && senderIsMainFrame;
}
