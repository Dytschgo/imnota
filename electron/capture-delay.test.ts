import { describe, expect, it, vi } from 'vitest';
import { bindCaptureDelayCancel, CaptureDelaySession, type CaptureDelayTimer } from './capture-delay.js';

function manualTimer() {
  const scheduled: Array<{ at: number; callback: () => void; id: number }> = [];
  let now = 0;
  let nextId = 1;
  const timer: CaptureDelayTimer = {
    set(callback, milliseconds) {
      const id = nextId++;
      scheduled.push({ at: now + milliseconds, callback, id });
      return id;
    },
    clear(handle) {
      const index = scheduled.findIndex((item) => item.id === handle);
      if (index >= 0) scheduled.splice(index, 1);
    },
  };
  return {
    timer,
    advance(milliseconds: number) {
      now += milliseconds;
      const due = scheduled.filter((item) => item.at <= now).sort((left, right) => left.at - right.at);
      for (const item of due) {
        const index = scheduled.indexOf(item);
        if (index >= 0) scheduled.splice(index, 1);
        item.callback();
      }
    },
    get pending() {
      return scheduled.length;
    },
  };
}

describe('capture delay', () => {
  it('elapses immediately when no delay is requested', async () => {
    const clock = manualTimer();
    const ticks: number[] = [];
    const session = new CaptureDelaySession(0, clock.timer, (remaining) => ticks.push(remaining));
    await expect(session.result).resolves.toBe('elapsed');
    expect(ticks).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('ticks a 3s countdown then elapses', async () => {
    const clock = manualTimer();
    const ticks: number[] = [];
    const session = new CaptureDelaySession(3, clock.timer, (remaining) => ticks.push(remaining));
    expect(ticks).toEqual([3]);
    clock.advance(1000);
    expect(ticks).toEqual([3, 2]);
    clock.advance(1000);
    expect(ticks).toEqual([3, 2, 1]);
    clock.advance(1000);
    await expect(session.result).resolves.toBe('elapsed');
    expect(clock.pending).toBe(0);
  });

  it('ticks a 5s countdown then elapses', async () => {
    const clock = manualTimer();
    const ticks: number[] = [];
    const session = new CaptureDelaySession(5, clock.timer, (remaining) => ticks.push(remaining));
    clock.advance(4000);
    expect(ticks).toEqual([5, 4, 3, 2, 1]);
    clock.advance(1000);
    await expect(session.result).resolves.toBe('elapsed');
  });

  it('keeps cancellation from becoming a late elapsed overlay start', async () => {
    const clock = manualTimer();
    const session = new CaptureDelaySession(3, clock.timer);
    clock.advance(1000);
    expect(session.cancel()).toBe(true);
    clock.advance(2000);
    await expect(session.result).resolves.toBe('cancelled');
    expect(clock.pending).toBe(0);
    expect(session.cancel()).toBe(false);
  });

  it('starts overlay work only after the delay elapses', async () => {
    const clock = manualTimer();
    const session = new CaptureDelaySession(5, clock.timer);
    const afterDelay = vi.fn();
    const pending = session.result.then((outcome) => {
      if (outcome === 'elapsed') afterDelay();
    });
    clock.advance(4000);
    expect(afterDelay).not.toHaveBeenCalled();
    clock.advance(1000);
    await pending;
    expect(afterDelay).toHaveBeenCalledOnce();
  });

  it('registers Escape for delay cancel and unregisters only what bound', () => {
    const cancel = vi.fn();
    const register = vi.fn((accelerator: string) => accelerator === 'Escape');
    const unregister = vi.fn();
    const dispose = bindCaptureDelayCancel(register, unregister, cancel);
    expect(register).toHaveBeenCalledWith('Escape', cancel);
    expect(register).toHaveBeenCalledWith('Esc', cancel);
    dispose();
    expect(unregister).toHaveBeenCalledWith('Escape');
    expect(unregister).not.toHaveBeenCalledWith('Esc');
  });
});
