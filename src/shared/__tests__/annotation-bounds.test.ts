import { describe, expect, it } from 'vitest';
import { normalizeAnnotationBounds } from '../annotation-geometry';
import type { Annotation } from '../types';

describe('annotation drag bounds', () => {
  it.each(['rectangle', 'rounded-rectangle', 'ellipse', 'highlight', 'blur', 'pixelate', 'crop'] as const)(
    'keeps %s under the pointer in all four quadrants',
    (kind) => {
      for (const width of [-80, 80])
        for (const height of [-30, 30]) {
          const draft: Annotation = { id: 'draft', kind, x: 100, y: 100, width, height, zIndex: 0 };
          const bounds = normalizeAnnotationBounds(draft);
          expect(bounds).toMatchObject({
            x: width < 0 ? 20 : 100,
            y: height < 0 ? 70 : 100,
            width: 80,
            height: 30,
          });
          expect(normalizeAnnotationBounds(bounds)).toEqual(bounds);
          expect(draft.x).toBe(100);
        }
    },
  );
  it('preserves directional line points and their origin', () => {
    const draft: Annotation = {
      id: 'arrow',
      kind: 'arrow',
      x: 100,
      y: 100,
      width: 80,
      height: 30,
      points: [0, 0, -80, -30],
      zIndex: 0,
    };
    expect(normalizeAnnotationBounds(draft)).toEqual(draft);
  });
});
