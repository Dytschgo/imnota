// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CaptureDisplay } from '../src/shared/capture.js';
import {
  captureDisplayMetricsInvalidateSelection,
  captureAllDisplaysWithStableGeometry,
  captureDisplayWithStableGeometry,
  captureDisplaysHaveStableGeometry,
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
  it('keeps selection open for fullscreen work-area changes but invalidates pixel geometry changes', () => {
    expect(captureDisplayMetricsInvalidateSelection(['workArea'])).toBe(false);
    for (const metric of ['bounds', 'scaleFactor', 'rotation', 'unknown']) {
      expect(captureDisplayMetricsInvalidateSelection(['workArea', metric])).toBe(true);
    }
    expect(captureDisplayMetricsInvalidateSelection([])).toBe(true);
  });

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

  it('rejects added displays during all-display preparation', async () => {
    await expect(
      captureAllDisplaysWithStableGeometry(
        [primary, secondary],
        async (displays) => displays.map(({ id }) => id),
        () => [primary, secondary, { ...secondary, id: 3 }],
      ),
    ).resolves.toBeNull();
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
