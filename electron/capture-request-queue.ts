import type { CaptureOverlayMode } from '../src/shared/capture.js';

export type CaptureRequest = { source: 'hotkey' } | { source: 'tray'; mode: CaptureOverlayMode };

/**
 * Holds the newest request until the current renderer has installed its IPC
 * subscriptions. A tray click while reopening must not disappear between page
 * load and React's effect registration.
 */
export class CaptureRequestQueue {
  private pending: CaptureRequest | null = null;
  private readyWindow: object | null = null;

  request(request: CaptureRequest): CaptureRequest | null {
    this.pending = request;
    return this.takePending();
  }

  rendererReady(window: object): CaptureRequest | null {
    this.readyWindow = window;
    return this.takePending();
  }

  windowClosed(window: object): void {
    if (this.readyWindow === window) this.readyWindow = null;
  }

  private takePending(): CaptureRequest | null {
    if (!this.readyWindow || !this.pending) return null;
    const request = this.pending;
    this.pending = null;
    return request;
  }
}
