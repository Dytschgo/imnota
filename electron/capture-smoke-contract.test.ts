import { describe, expect, it } from 'vitest';
import type { CaptureDisplay } from '../src/shared/capture.js';
import { planCrossDisplaySmokeSelection, syntheticCaptureColor } from './capture-smoke-contract.js';

const display = (id: number, x: number, y: number, width: number, height: number): CaptureDisplay => ({
  id,
  bounds: { x, y, width, height },
  scaleFactor: 1,
});

describe('capture smoke contract', () => {
  it('plans a bounded selection across a negative-coordinate vertical seam', () => {
    const left = display(2, -3440, 0, 3440, 1440);
    const right = display(1, 0, 0, 3440, 1440);
    const plan = planCrossDisplaySmokeSelection([right, left]);

    expect(plan).toMatchObject({
      origin: left,
      destination: right,
      selection: { x: -160, y: 640, width: 320, height: 160 },
    });
    expect(plan!.start.x).toBeLessThan(0);
    expect(plan!.end.x).toBeGreaterThan(0);
  });

  it('supports a horizontal seam and rejects disconnected layouts', () => {
    const top = display(1, 0, -1080, 1920, 1080);
    const bottom = display(2, 0, 0, 1920, 1080);
    expect(planCrossDisplaySmokeSelection([top, bottom])).toMatchObject({
      origin: top,
      destination: bottom,
      selection: { x: 880, y: -160, width: 160, height: 320 },
    });
    expect(planCrossDisplaySmokeSelection([top, display(3, 2500, 0, 1920, 1080)])).toBeNull();
  });

  it('uses distinct opaque colors for adjacent synthetic displays', () => {
    expect(syntheticCaptureColor(0)).not.toEqual(syntheticCaptureColor(1));
    expect(syntheticCaptureColor(0)).not.toEqual(syntheticCaptureColor(4));
    expect(syntheticCaptureColor(0).alpha).toBe(255);
    expect(syntheticCaptureColor(216)).toEqual(syntheticCaptureColor(0));
  });
});
