import { describe, expect, it } from 'vitest';
import { CaptureRequestQueue } from './capture-request-queue.js';

describe('CaptureRequestQueue', () => {
  it('holds a tray capture until the reopened renderer is ready', () => {
    const queue = new CaptureRequestQueue();
    const firstWindow = {};
    const reopenedWindow = {};

    expect(queue.rendererReady(firstWindow)).toBeNull();
    expect(queue.request({ source: 'tray', mode: 'display' })).toEqual({ source: 'tray', mode: 'display' });
    queue.windowClosed(firstWindow);

    expect(queue.request({ source: 'tray', mode: 'window' })).toBeNull();
    expect(queue.rendererReady(reopenedWindow)).toEqual({ source: 'tray', mode: 'window' });
  });

  it('keeps only the newest request while no renderer can receive it', () => {
    const queue = new CaptureRequestQueue();
    expect(queue.request({ source: 'hotkey' })).toBeNull();
    expect(queue.request({ source: 'tray', mode: 'region' })).toBeNull();
    expect(queue.rendererReady({})).toEqual({ source: 'tray', mode: 'region' });
  });
});
