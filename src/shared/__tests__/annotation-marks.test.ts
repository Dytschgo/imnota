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

  const image = { originalWidth: 200, originalHeight: 100 };
  const mask = (
    id: string,
    kind: 'blur' | 'pixelate',
    x: number,
    y: number,
    width: number,
    height: number,
  ) => ({
    id,
    kind,
    x,
    y,
    width,
    height,
    blurIntensity: 12,
    zIndex: 0,
  });

  it('lists one blur mask as a single redacted region without id, kind, position or size', () => {
    const items = annotationMarkListItems([mask('secret-blur', 'blur', 37, 41, 53, 29)], image);
    expect(items).toEqual(['- 1 redacted region']);
  });

  it('counts blur and pixelate masks together after the other marks', () => {
    const items = annotationMarkListItems(
      [
        mask('b1', 'blur', 37, 41, 53, 29),
        { id: 'r1', kind: 'rectangle', x: 20, y: 10, width: 40, height: 20, zIndex: 1 },
        mask('p1', 'pixelate', 123, 67, 31, 13),
        mask('b2', 'blur', 150, 80, 20, 10),
      ],
      image,
    );
    expect(items).toEqual(['- rectangle `r1` at 10.0%,10.0% 20.0%×20.0%', '- 3 redacted regions']);
    const text = items.join('\n');
    for (const leaked of [
      'b1',
      'b2',
      'p1',
      'blur',
      'pixelate',
      '18.5%',
      '41.0%',
      '26.5%',
      '29.0%',
      '61.5%',
      '67.0%',
      '15.5%',
      '13.0%',
      '75.0%',
      '80.0%',
      '37',
      '53',
      '123',
      '31',
    ])
      expect(text).not.toContain(leaked);
  });

  it('adds no redaction line when there are no masks', () => {
    expect(annotationMarkListItems([], image)).toEqual([]);
  });
});
