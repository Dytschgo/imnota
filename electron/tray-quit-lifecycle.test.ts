// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { onSuccessfulQuit, teardownTrayAfterSuccessfulQuit } from './tray-quit-lifecycle.js';

describe('tray quit lifecycle', () => {
  it('keeps the tray and shortcut after a cancelled quit, then tears both down on the completed retry', () => {
    const tray = { destroy: vi.fn() };
    const clearCaptureShortcut = vi.fn();
    const stopProjectWatches = vi.fn();
    const events = new EventEmitter();
    let activeTray: typeof tray | null = tray;
    onSuccessfulQuit(events, () => {
      activeTray = teardownTrayAfterSuccessfulQuit({
        tray: activeTray,
        clearCaptureShortcut,
        stopProjectWatches,
      });
    });

    events.emit('before-quit');
    // A renderer cancels this attempt, so will-quit does not follow.
    expect(activeTray).toBe(tray);
    expect(tray.destroy).not.toHaveBeenCalled();
    expect(clearCaptureShortcut).not.toHaveBeenCalled();
    expect(stopProjectWatches).not.toHaveBeenCalled();

    events.emit('before-quit');
    events.emit('will-quit');
    expect(activeTray).toBeNull();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(clearCaptureShortcut).toHaveBeenCalledOnce();
    expect(stopProjectWatches).toHaveBeenCalledOnce();
  });
});
