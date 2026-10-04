import { describe, expect, it } from 'vitest';
import { constrainBoxDelta, constrainDraftDelta, constrainLineDelta } from './constrain';

describe('constrainLineDelta', () => {
  it('snaps near-horizontal and near-vertical lines onto the axis', () => {
    expect(constrainLineDelta({ x: 100, y: 12 })).toEqual({ x: 100, y: 0 });
    expect(constrainLineDelta({ x: -100, y: -12 })).toEqual({ x: -100, y: 0 });
    expect(constrainLineDelta({ x: 9, y: -80 })).toEqual({ x: 0, y: -80 });
    expect(constrainLineDelta({ x: -9, y: 80 })).toEqual({ x: 0, y: 80 });
  });

  it('snaps to an exact diagonal in every quadrant', () => {
    expect(constrainLineDelta({ x: 100, y: 80 })).toEqual({ x: 90, y: 90 });
    expect(constrainLineDelta({ x: -100, y: 80 })).toEqual({ x: -90, y: 90 });
    expect(constrainLineDelta({ x: -100, y: -80 })).toEqual({ x: -90, y: -90 });
    expect(constrainLineDelta({ x: 100, y: -80 })).toEqual({ x: 90, y: -90 });
  });

  it('leaves a zero-length line alone', () => {
    expect(constrainLineDelta({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('constrainBoxDelta', () => {
  it('uses the longer side and keeps the drag direction', () => {
    expect(constrainBoxDelta({ x: 120, y: 40 })).toEqual({ x: 120, y: 120 });
    expect(constrainBoxDelta({ x: -30, y: 90 })).toEqual({ x: -90, y: 90 });
    expect(constrainBoxDelta({ x: -30, y: -10 })).toEqual({ x: -30, y: -30 });
  });
});

describe('constrainDraftDelta', () => {
  const delta = { x: 100, y: 30 };

  it('changes nothing without the modifier', () => {
    for (const kind of ['arrow', 'line', 'rectangle', 'ellipse', 'highlight', 'pen', 'crop'] as const)
      expect(constrainDraftDelta(kind, delta, false)).toBe(delta);
  });

  it('snaps lines and arrows, and squares boxes and ellipses', () => {
    expect(constrainDraftDelta('arrow', delta, true)).toEqual({ x: 100, y: 0 });
    expect(constrainDraftDelta('line', delta, true)).toEqual({ x: 100, y: 0 });
    expect(constrainDraftDelta('rectangle', delta, true)).toEqual({ x: 100, y: 100 });
    expect(constrainDraftDelta('ellipse', delta, true)).toEqual({ x: 100, y: 100 });
    expect(constrainDraftDelta('highlight', delta, true)).toEqual({ x: 100, y: 100 });
  });

  it('never constrains freehand strokes or the crop box', () => {
    expect(constrainDraftDelta('pen', delta, true)).toBe(delta);
    expect(constrainDraftDelta('crop', delta, true)).toBe(delta);
  });
});
