import { describe, expect, it } from 'vitest';
import { annotationMarkListItems } from '../annotation-marks';

describe('annotationMarkListItems', () => {
  it('describes rotation around the annotation origin so unrotated box coordinates are not misleading', () => {
    expect(
      annotationMarkListItems(
        [
          {
            id: 'rotated-box',
            kind: 'rectangle',
            x: 10,
            y: 20,
            width: 30,
            height: 10,
            rotation: 90,
            zIndex: 0,
          },
        ],
        { originalWidth: 100, originalHeight: 100 },
      ),
    ).toEqual([
      '- rectangle `rotated-box` at 10.0%,20.0% 30.0%×10.0% rotated 90.0° about origin 10.0%,20.0%',
    ]);
  });
});
