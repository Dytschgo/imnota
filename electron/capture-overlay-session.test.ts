import { describe, expect, it } from 'vitest';
import {
  CaptureOverlaySession,
  createOverlayReadinessGuard,
  isCaptureOverlaySender,
  type OverlayReadinessTimer,
} from './capture-overlay-session.js';

describe('capture overlay session', () => {
  it('only accepts the current overlay main frame', () => {
    expect(isCaptureOverlaySender(7, 7, true)).toBe(true);
    expect(isCaptureOverlaySender(7, 8, true)).toBe(false);
    expect(isCaptureOverlaySender(7, 7, false)).toBe(false);
  });

  it('keeps cancellation from becoming a delayed save', async () => {
    const session = new CaptureOverlaySession();
    expect(session.settle(null)).toBe(true);
    expect(session.settle({ x: 1, y: 1, width: 2, height: 2 })).toBe(false);
    await expect(session.result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('keeps an infrastructure failure distinct from a user cancellation', async () => {
    const session = new CaptureOverlaySession();
    expect(session.fail()).toBe(true);
    expect(session.settle(null)).toBe(false);
    await expect(session.result).resolves.toEqual({ kind: 'failed', reason: 'not-ready' });
  });

  it('settles a stalled overlay readiness phase and ignores a late ready signal', () => {
    let timeout: (() => void) | undefined;
    let cleared = false;
    const timer: OverlayReadinessTimer = {
      set(callback) {
        timeout = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clear() {
        cleared = true;
      },
    };
    let timedOut = 0;
    const guard = createOverlayReadinessGuard(
      () => {
        timedOut += 1;
      },
      250,
      timer,
    );
    timeout!();
    expect(timedOut).toBe(1);
    expect(guard.ready()).toBe(false);
    expect(cleared).toBe(false);
  });

  it('clears the readiness timeout when the overlay becomes ready', () => {
    let timeout: (() => void) | undefined;
    let cleared = false;
    const timer: OverlayReadinessTimer = {
      set(callback) {
        timeout = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clear() {
        cleared = true;
      },
    };
    let timedOut = false;
    const guard = createOverlayReadinessGuard(
      () => {
        timedOut = true;
      },
      250,
      timer,
    );
    expect(guard.ready()).toBe(true);
    expect(cleared).toBe(true);
    timeout!();
    expect(timedOut).toBe(false);
  });
});
