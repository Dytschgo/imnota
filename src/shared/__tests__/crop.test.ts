import { expect, test } from 'vitest';
import { exportBounds } from '../crop';

test('exports the original size without a crop', () => {
  expect(exportBounds(100, 80, [])).toEqual({ x: 0, y: 0, width: 100, height: 80 });
});
test('clamps crop dimensions to the source image', () => {
  expect(
    exportBounds(100, 80, [{ id: 'crop', kind: 'crop', x: 20, y: 30, width: 200, height: 200, zIndex: 0 }]),
  ).toEqual({ x: 20, y: 30, width: 80, height: 50 });
});
