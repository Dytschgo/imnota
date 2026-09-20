// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { captureTrayTemplate } from './app-tray.js';

describe('captureTrayTemplate', () => {
  it('includes region, display, and open actions, and disables window capture when unsupported', () => {
    const onCapture = vi.fn();
    const onOpen = vi.fn();
    const onQuit = vi.fn();
    const items = captureTrayTemplate({ windowCapture: false, onCapture, onOpen, onQuit });
    expect(items.map((item) => item.label ?? item.type)).toEqual([
      'Capture region',
      'Capture window',
      'Capture display',
      'separator',
      'Open Imnota',
      'Quit Imnota',
    ]);
    expect(items[1]?.enabled).toBe(false);
    items[0]?.click?.(undefined as never, undefined as never, undefined as never);
    items[2]?.click?.(undefined as never, undefined as never, undefined as never);
    items[4]?.click?.(undefined as never, undefined as never, undefined as never);
    items[5]?.click?.(undefined as never, undefined as never, undefined as never);
    expect(onCapture).toHaveBeenCalledWith('region');
    expect(onCapture).toHaveBeenCalledWith('display');
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onQuit).toHaveBeenCalledOnce();
  });
});
