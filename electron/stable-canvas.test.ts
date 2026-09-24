import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForStableCanvasSample } from './stable-canvas.js';

afterEach(() => vi.useRealTimers());

describe('waitForStableCanvasSample', () => {
  it('restarts its stable interval when a ready canvas disappears', async () => {
    vi.useFakeTimers();
    const samples = [{ width: 1280 }, null, { width: 1280 }];
    const sample = vi.fn(async () => (samples.length ? samples.shift()! : { width: 1280 }));
    const pending = waitForStableCanvasSample(
      sample,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(sample).toHaveBeenCalled();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ width: 1280 });
  });

  it('fails after the deadline when the canvas remains absent', async () => {
    vi.useFakeTimers();
    const pending = waitForStableCanvasSample(
      async () => null,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    );
    const assertion = expect(pending).rejects.toThrow('Canvas layout did not settle');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('propagates unexpected evaluation errors', async () => {
    await expect(
      waitForStableCanvasSample(
        async () => {
          throw new Error('renderer crashed');
        },
        async () => undefined,
      ),
    ).rejects.toThrow('renderer crashed');
  });
});
