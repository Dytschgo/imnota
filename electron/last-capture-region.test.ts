import { describe, expect, it } from 'vitest';
import type { CaptureDisplay } from '../src/shared/capture.js';
import { LastCaptureRegionMemory, lastCaptureRegionForDisplay } from './last-capture-region.js';

const left: CaptureDisplay = {
  id: 2,
  bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
  scaleFactor: 1.5,
};
const right: CaptureDisplay = { id: 1, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, scaleFactor: 1.25 };

describe('last capture region memory', () => {
  it('explains when this session has no area', () => {
    expect(new LastCaptureRegionMemory().resolve([left, right])).toMatchObject({
      ok: false,
      kind: 'unavailable',
    });
  });

  it('preserves negative global coordinates and cross-screen bounds for repeat and overlay preview', () => {
    const memory = new LastCaptureRegionMemory();
    const area = { x: -100, y: 100, width: 300, height: 200 };
    memory.remember([left, right], area, 'region');
    expect(memory.resolve([right, left])).toMatchObject({ ok: true, selection: area });
    expect(lastCaptureRegionForDisplay(memory.peek(), left)).toEqual(area);
    expect(lastCaptureRegionForDisplay(memory.peek(), right)).toEqual(area);
  });

  it('leaves the last area unchanged for window and display captures', () => {
    const memory = new LastCaptureRegionMemory();
    memory.remember([left, right], { x: -100, y: 10, width: 200, height: 100 }, 'region');
    const previous = memory.peek();
    memory.remember([left, right], right.bounds, 'display');
    memory.remember([left, right], right.bounds, 'window');
    expect(memory.peek()).toEqual(previous);
  });

  it('fails closed when a display is removed or moved', () => {
    const memory = new LastCaptureRegionMemory();
    memory.remember([left, right], { x: -100, y: 100, width: 300, height: 200 }, 'region');
    expect(memory.resolve([right])).toMatchObject({ ok: false, kind: 'display-gone' });
    expect(memory.resolve([left, { ...right, bounds: { ...right.bounds, x: 1 } }])).toMatchObject({
      ok: false,
      kind: 'region-invalid',
    });
    expect(memory.resolve([left, right, { ...right, id: 3 }])).toMatchObject({
      ok: false,
      kind: 'region-invalid',
    });
  });
});
