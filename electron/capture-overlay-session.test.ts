// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CaptureOverlaySession,
  CaptureSelectionCoordinator,
  capturePointerGlobalPoint,
  closeCaptureOverlayWindows,
  createOverlayReadinessGuard,
  isCaptureOverlaySender,
  type OverlayReadinessTimer,
} from './capture-overlay-session.js';

describe('capture overlay session', () => {
  it('only accepts the current overlay main frame', () => {
    expect(isCaptureOverlaySender([7, 9], 7, true)).toBe(true);
    expect(isCaptureOverlaySender([7, 9], 8, true)).toBe(false);
    expect(isCaptureOverlaySender([7, 9], 7, false)).toBe(false);
  });

  it('coordinates a reverse drag across negative monitor coordinates', () => {
    const coordinator = new CaptureSelectionCoordinator([
      { id: 1, bounds: { x: -1200, y: -200, width: 1200, height: 800 }, scaleFactor: 1 },
      { id: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 },
    ]);
    expect(coordinator.update(2, 'begin', { x: 300, y: 250 })).toEqual({
      selection: null,
      complete: false,
      actionsDisplayId: null,
    });
    expect(coordinator.update(2, 'move', { x: -400, y: -150 })).toEqual({
      selection: { x: -400, y: -150, width: 700, height: 400 },
      complete: false,
      actionsDisplayId: null,
    });
    expect(coordinator.update(2, 'end', { x: -400, y: -150 })).toEqual({
      selection: { x: -400, y: -150, width: 700, height: 400 },
      complete: true,
      actionsDisplayId: 1,
    });
  });

  it('uses native global DIPs after pointer capture crosses from 150% to 100%', () => {
    const origin = {
      id: 1,
      bounds: { x: -1000, y: 0, width: 1000, height: 800 },
      scaleFactor: 1.5,
    };
    const nativeCursorPoint = vi.fn(() => ({ x: 250, y: 300 }));
    expect(capturePointerGlobalPoint(origin, { x: 1250, y: 300 }, nativeCursorPoint)).toEqual({
      x: 250,
      y: 300,
    });
    expect(nativeCursorPoint).toHaveBeenCalledOnce();
  });

  it('uses destination-local DIPs when Windows routes a 100% to 150% drag into that overlay', () => {
    const destination = {
      id: 2,
      bounds: { x: -1000, y: -200, width: 1000, height: 800 },
      scaleFactor: 1.5,
    };
    const nativeCursorPoint = vi.fn(() => ({ x: 999, y: 999 }));
    expect(capturePointerGlobalPoint(destination, { x: 200, y: 150 }, nativeCursorPoint)).toEqual({
      x: -800,
      y: -50,
    });
    expect(nativeCursorPoint).not.toHaveBeenCalled();
  });

  it('uses native global DIPs for a reverse drag retained by a 100% origin overlay', () => {
    const origin = { id: 2, bounds: { x: 0, y: 0, width: 1200, height: 900 }, scaleFactor: 1 };
    expect(capturePointerGlobalPoint(origin, { x: -300, y: 120 }, () => ({ x: -850, y: -80 }))).toEqual({
      x: -850,
      y: -80,
    });
  });

  it('clamps pointer capture outside the virtual desktop and resets the whole selection', () => {
    const coordinator = new CaptureSelectionCoordinator([
      { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 1 },
      { id: 2, bounds: { x: 100, y: 0, width: 100, height: 100 }, scaleFactor: 1 },
    ]);
    coordinator.update(1, 'begin', { x: 20, y: 20 });
    expect(coordinator.update(1, 'end', { x: 500, y: 500 }).selection).toEqual({
      x: 20,
      y: 20,
      width: 180,
      height: 80,
    });
    expect(coordinator.update(1, 'reset')).toEqual({
      selection: null,
      complete: false,
      actionsDisplayId: null,
    });
  });

  it('keeps cancellation from becoming a delayed save', async () => {
    const session = new CaptureOverlaySession();
    expect(session.settle(null)).toBe(true);
    expect(session.settle({ x: 1, y: 1, width: 2, height: 2 })).toBe(false);
    await expect(session.result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('closes every live display overlay on group cancellation', () => {
    const windows = [
      { isDestroyed: () => false, close: vi.fn() },
      { isDestroyed: () => true, close: vi.fn() },
      { isDestroyed: () => false, close: vi.fn() },
    ];
    closeCaptureOverlayWindows(windows);
    expect(windows[0].close).toHaveBeenCalledOnce();
    expect(windows[1].close).not.toHaveBeenCalled();
    expect(windows[2].close).toHaveBeenCalledOnce();
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
