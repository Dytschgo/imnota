export type CaptureDelayOutcome = 'elapsed' | 'cancelled';

export interface CaptureDelayTimer {
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}

const nativeTimer: CaptureDelayTimer = {
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Cancellable wait before the selection overlay. Cancel wins over a late timer
 * so a countdown abort cannot open the overlay or write files.
 */
export class CaptureDelaySession {
  private finished = false;
  private readonly handles: unknown[] = [];
  private complete!: (outcome: CaptureDelayOutcome) => void;
  readonly result: Promise<CaptureDelayOutcome>;

  constructor(
    readonly seconds: number,
    private readonly timer: CaptureDelayTimer = nativeTimer,
    onTick?: (remainingSeconds: number) => void,
  ) {
    this.result = new Promise((resolve) => {
      this.complete = resolve;
    });
    if (seconds <= 0) {
      this.settle('elapsed');
      return;
    }
    onTick?.(seconds);
    for (let remaining = seconds - 1; remaining >= 0; remaining -= 1) {
      this.handles.push(
        this.timer.set(
          () => {
            if (this.finished) return;
            if (remaining === 0) this.settle('elapsed');
            else onTick?.(remaining);
          },
          (seconds - remaining) * 1000,
        ),
      );
    }
  }

  cancel(): boolean {
    return this.settle('cancelled');
  }

  private settle(outcome: CaptureDelayOutcome): boolean {
    if (this.finished) return false;
    this.finished = true;
    for (const handle of this.handles) this.timer.clear(handle);
    this.complete(outcome);
    return true;
  }
}

/** Starts overlay/file work only after the delay elapses without cancellation. */
export async function completeDelayedCaptureStart<T>(
  session: Pick<CaptureDelaySession, 'result'>,
  afterDelay: () => Promise<T>,
): Promise<{ kind: 'cancelled' } | { kind: 'completed'; value: T }> {
  if ((await session.result) === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'completed', value: await afterDelay() };
}

export function bindCaptureDelayCancel(
  register: (accelerator: string, callback: () => void) => boolean,
  unregister: (accelerator: string) => void,
  cancel: () => void,
): () => void {
  const registered: string[] = [];
  for (const accelerator of ['Escape', 'Esc']) {
    try {
      if (register(accelerator, cancel)) registered.push(accelerator);
    } catch {
      // Reserved accelerators fail closed; the delay HUD still offers Cancel.
    }
  }
  return () => {
    for (const accelerator of registered) {
      try {
        unregister(accelerator);
      } catch {
        // Restore capture even if the OS rejects unregister.
      }
    }
  };
}
