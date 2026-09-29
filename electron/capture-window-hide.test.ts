import { describe, expect, it, vi } from 'vitest';
import {
  hideWindowForCapture,
  restoreWindowAfterCapture,
  type HideableWindow,
} from './capture-window-hide.js';

function fakeWindow(options: { visible?: boolean; emitsHide?: boolean } = {}) {
  const calls: string[] = [];
  let hideListener: (() => void) | undefined;
  const window: HideableWindow = {
    isDestroyed: () => false,
    isVisible: () => options.visible ?? true,
    hide: () => {
      calls.push('hide');
      if (options.emitsHide ?? true) hideListener?.();
    },
    show: () => calls.push('show'),
    setOpacity: (value) => calls.push(`opacity:${value}`),
    once: (_event, listener) => {
      hideListener = listener;
    },
    removeListener: () => {
      hideListener = undefined;
    },
  };
  return { window, calls };
}

describe('hiding Imnota for capture', () => {
  it('makes the macOS window transparent before hiding, then waits for the fade to settle', async () => {
    const { window, calls } = fakeWindow();
    const wait = vi.fn(async (milliseconds: number) => {
      calls.push(`wait:${milliseconds}`);
    });
    await expect(hideWindowForCapture(window, 'darwin', wait)).resolves.toBe(true);
    expect(calls[0]).toBe('opacity:0');
    expect(calls[1]).toBe('hide');
    expect(calls).toContain('wait:350');
  });

  it('does not hang when macOS never reports the hide event', async () => {
    const { window } = fakeWindow({ emitsHide: false });
    await expect(hideWindowForCapture(window, 'darwin', async () => undefined)).resolves.toBe(true);
  });

  it('keeps the immediate Windows hide unchanged and skips hidden windows', async () => {
    const shown = fakeWindow();
    const wait = vi.fn(async () => undefined);
    await expect(hideWindowForCapture(shown.window, 'win32', wait)).resolves.toBe(true);
    expect(shown.calls).toEqual(['hide']);
    expect(wait).not.toHaveBeenCalled();
    const hidden = fakeWindow({ visible: false });
    await expect(hideWindowForCapture(hidden.window, 'darwin', wait)).resolves.toBe(false);
    expect(hidden.calls).toEqual([]);
  });

  it('restores visibility and full opacity', () => {
    const { window, calls } = fakeWindow();
    restoreWindowAfterCapture(window);
    expect(calls).toEqual(['show', 'opacity:1']);
  });
});
