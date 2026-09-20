import { describe, expect, it, vi } from 'vitest';
import type { CaptureDisplay } from '../src/shared/capture.js';
import {
  captureDisplayOptions,
  captureDisplayWithStableGeometry,
  captureDisplaysHaveStableGeometry,
  captureDisplaysWithStableGeometry,
  selectedCaptureDisplay,
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
    expect(selectedCaptureDisplay([primary], undefined)).toBe(primary);
    expect(selectedCaptureDisplay([primary, secondary], undefined)).toBeNull();
    expect(selectedCaptureDisplay([primary, secondary], 2)).toBe(secondary);
    expect(selectedCaptureDisplay([primary, secondary], 999)).toBeNull();
  });
});

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
