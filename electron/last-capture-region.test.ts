import { describe, expect, it } from 'vitest';
import type { CaptureDisplay } from '../src/shared/capture.js';
import {
  LAST_CAPTURE_REGION_DISPLAY_GONE_MESSAGE,
  LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE,
} from '../src/shared/capture.js';
import {
  LastCaptureRegionMemory,
  lastCaptureRegionForDisplay,
  lastCaptureRegionFromSelection,
  resolveLastCaptureRegion,
} from './last-capture-region.js';

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

describe('last capture region memory', () => {
  it('explains and does not invent a region when this session has none', () => {
    const memory = new LastCaptureRegionMemory();
    expect(memory.peek()).toBeNull();
    expect(memory.resolve([primary, secondary])).toEqual({
      ok: false,
      kind: 'unavailable',
      message: LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE,
    });
  });

  it('stores a successful region as display identity plus local DIP bounds', () => {
    const memory = new LastCaptureRegionMemory();
    memory.remember(secondary, { x: -1720, y: -80, width: 400, height: 250 }, 'region');
    expect(memory.peek()).toEqual({
      displayId: 2,
      bounds: { x: 200, y: 120, width: 400, height: 250 },
    });
    expect(memory.resolve([primary, secondary])).toEqual({
      ok: true,
      display: secondary,
      selection: { x: -1720, y: -80, width: 400, height: 250 },
      remembered: { displayId: 2, bounds: { x: 200, y: 120, width: 400, height: 250 } },
    });
  });

  it('does not remember window or full-display captures', () => {
    const memory = new LastCaptureRegionMemory();
    memory.remember(primary, { x: 10, y: 20, width: 300, height: 200 }, 'window');
    memory.remember(primary, { ...primary.bounds }, 'display');
    expect(memory.peek()).toBeNull();
    memory.remember(primary, { x: 40, y: 50, width: 120, height: 80 }, 'region');
    memory.remember(secondary, { x: -1800, y: -100, width: 200, height: 100 }, 'window');
    expect(memory.peek()).toEqual({
      displayId: 1,
      bounds: { x: 40, y: 50, width: 120, height: 80 },
    });
  });

  it('fails when the remembered display is gone instead of cropping another display', () => {
    const remembered = lastCaptureRegionFromSelection(
      secondary,
      { x: -1720, y: -80, width: 400, height: 250 },
      'region',
    );
    expect(remembered).toEqual({
      displayId: 2,
      bounds: { x: 200, y: 120, width: 400, height: 250 },
    });
    expect(resolveLastCaptureRegion(remembered, [primary])).toEqual({
      ok: false,
      kind: 'display-gone',
      message: LAST_CAPTURE_REGION_DISPLAY_GONE_MESSAGE,
    });
    expect(lastCaptureRegionForDisplay(remembered, primary.id)).toBeNull();
    expect(lastCaptureRegionForDisplay(remembered, secondary.id)).toEqual({
      x: 200,
      y: 120,
      width: 400,
      height: 250,
    });
  });

  it('rejects a region that no longer fits the same display', () => {
    const memory = new LastCaptureRegionMemory();
    memory.remember(secondary, { x: -1720, y: -80, width: 400, height: 250 }, 'region');
    const shrunk = { ...secondary, bounds: { ...secondary.bounds, width: 300, height: 200 } };
    expect(memory.resolve([primary, shrunk])).toMatchObject({
      ok: false,
      kind: 'region-invalid',
    });
  });
});
