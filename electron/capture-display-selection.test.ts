import { describe, expect, it, vi } from 'vitest';
import type { CaptureDisplay } from '../src/shared/capture.js';
import {
  captureDisplayWithStableGeometry,
  captureDisplaysHaveStableGeometry,
  captureDisplaysWithStableGeometry,
} from './capture-display-selection.js';

const primary: CaptureDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 3440, height: 1440 },
  scaleFactor: 1.25,
};
const secondary: CaptureDisplay = {
  id: 2,
  bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
  scaleFactor: 1.5,
};

describe('capture display geometry', () => {
  it('accepts the same complete desktop independent of enumeration order', () => {
    expect(captureDisplaysHaveStableGeometry([primary, secondary], [secondary, primary])).toBe(true);
  });

  it.each([
    ['removed display', [primary]],
    ['added display', [primary, secondary, { ...secondary, id: 3 }]],
    ['moved display', [primary, { ...secondary, bounds: { ...secondary.bounds, x: -1919 } }]],
    ['DPI change', [primary, { ...secondary, scaleFactor: 2 }]],
  ])('rejects a %s', (_label, current) => {
    expect(captureDisplaysHaveStableGeometry([primary, secondary], current)).toBe(false);
  });

  it('captures every exact display and rejects geometry changed after the last source resolves', async () => {
    let current: readonly CaptureDisplay[] = [primary, secondary];
    let finishSecond!: () => void;
    const secondPending = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const capture = vi.fn(async (displays: readonly CaptureDisplay[]) => {
      await secondPending;
      return displays.map((display) => `capture-${display.id}`);
    });
    const result = captureDisplaysWithStableGeometry([primary, secondary], capture, () => current);
    current = [primary, { ...secondary, bounds: { ...secondary.bounds, y: -100 } }];
    finishSecond();
    await expect(result).resolves.toBeNull();
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0]![0].map((display) => display.id)).toEqual([1, 2]);
  });

  it('keeps the single-display helper fail closed', async () => {
    await expect(
      captureDisplayWithStableGeometry(
        primary,
        async () => 'capture',
        () => [{ ...primary, scaleFactor: 2 }],
      ),
    ).resolves.toBeNull();
  });
});
