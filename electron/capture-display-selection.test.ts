import { describe, expect, it, vi } from 'vitest';
import type { CaptureDisplay } from '../src/shared/capture.js';
import {
  captureDisplayOptions,
  captureDisplayWithStableGeometry,
  selectedCaptureDisplay,
} from './capture-display-selection.js';

const primary: CaptureDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 3440, height: 1440 },
  scaleFactor: 1.25,
};

describe('capture display selection', () => {
  it('describes negative, above, below, and diagonal desktop bounds without changing their DIP values', () => {
    const displays: CaptureDisplay[] = [
      { id: 2, bounds: { x: -3440, y: 0, width: 3440, height: 1440 }, scaleFactor: 1 },
      { id: 4, bounds: { x: 0, y: 1440, width: 1920, height: 1080 }, scaleFactor: 1.5 },
      primary,
      { id: 3, bounds: { x: 0, y: -2160, width: 3840, height: 2160 }, scaleFactor: 2 },
      { id: 5, bounds: { x: 3440, y: -1080, width: 1920, height: 1080 }, scaleFactor: 1 },
    ];

    expect(captureDisplayOptions(displays, primary.id)).toEqual([
      { ...primary, bounds: { ...primary.bounds }, primary: true, position: 'Primary display' },
      { ...displays[3], bounds: { ...displays[3]!.bounds }, primary: false, position: 'Above primary' },
      {
        ...displays[4],
        bounds: { ...displays[4]!.bounds },
        primary: false,
        position: 'Above and right',
      },
      { ...displays[0], bounds: { ...displays[0]!.bounds }, primary: false, position: 'Left of primary' },
      { ...displays[1], bounds: { ...displays[1]!.bounds }, primary: false, position: 'Below primary' },
    ]);
  });

  it('returns no options when Electron does not report the declared primary display', () => {
    expect(captureDisplayOptions([primary], 99)).toEqual([]);
  });

  it('allows an omitted id only for one display and never falls back from a stale selected id', () => {
    const secondary = { id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
    expect(selectedCaptureDisplay([primary], undefined)).toBe(primary);
    expect(selectedCaptureDisplay([primary, secondary], undefined)).toBeNull();
    expect(selectedCaptureDisplay([primary, secondary], 2)).toBe(secondary);
    expect(selectedCaptureDisplay([primary, secondary], 999)).toBeNull();
  });

  it.each([
    ['is removed', []],
    ['moves', [{ ...primary, bounds: { ...primary.bounds, x: -3440 } }]],
    ['changes scale', [{ ...primary, scaleFactor: 1.5 }]],
  ] as const)('rejects a captured display that %s while capture sources resolve', async (_label, changed) => {
    let resolveCapture!: (value: string) => void;
    const pendingCapture = new Promise<string>((resolve) => {
      resolveCapture = resolve;
    });
    let displays: readonly CaptureDisplay[] = [primary];
    const currentDisplays = vi.fn(() => displays);
    const result = captureDisplayWithStableGeometry(primary, () => pendingCapture, currentDisplays);

    expect(currentDisplays).not.toHaveBeenCalled();
    displays = changed;
    resolveCapture('pixels');

    await expect(result).resolves.toBeNull();
    expect(currentDisplays).toHaveBeenCalledOnce();
  });

  it('returns the capture only when display identity, bounds, and scale remain unchanged', async () => {
    const captured = { pixels: Buffer.from('screen') };
    await expect(
      captureDisplayWithStableGeometry(
        primary,
        async () => captured,
        () => [{ ...primary, bounds: { ...primary.bounds } }],
      ),
    ).resolves.toBe(captured);
  });
});
