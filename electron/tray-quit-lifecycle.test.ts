import { describe, expect, it, vi } from 'vitest';
import { teardownTrayAfterSuccessfulQuit } from './tray-quit-lifecycle.js';

describe('tray quit lifecycle', () => {
  it('keeps the tray and shortcut after a cancelled quit, then tears both down on the completed retry', () => {
    const tray = { destroy: vi.fn() };
    const clearCaptureShortcut = vi.fn();
    const stopProjectWatches = vi.fn();

    // Electron emits before-quit for this attempt, but a renderer cancels it.
    expect(tray.destroy).not.toHaveBeenCalled();
    expect(clearCaptureShortcut).not.toHaveBeenCalled();

    const next = teardownTrayAfterSuccessfulQuit({ tray, clearCaptureShortcut, stopProjectWatches });
    expect(next).toBeNull();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(clearCaptureShortcut).toHaveBeenCalledOnce();
    expect(stopProjectWatches).toHaveBeenCalledOnce();
  });
});
