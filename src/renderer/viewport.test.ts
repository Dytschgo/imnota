import { expect, it } from 'vitest';
import { zoomAt } from './viewport';

it('keeps the image point under the cursor stationary while zooming', () => {
  const initial = { x: -120, y: 70, scale: 0.5 };
  const cursor = { x: 320, y: 240 };
  const next = zoomAt(initial, cursor, 2);
  expect((cursor.x - next.x) / next.scale).toBe((cursor.x - initial.x) / initial.scale);
  expect((cursor.y - next.y) / next.scale).toBe((cursor.y - initial.y) / initial.scale);
});
it('limits zoom and applies each change to the current viewport', () => {
  const initial = { x: 10, y: 20, scale: 1 };
  expect(zoomAt(initial, { x: 0, y: 0 }, 100).scale).toBe(8);
  expect(zoomAt(initial, { x: 0, y: 0 }, 0.001).scale).toBe(0.02);
  expect(zoomAt(zoomAt(initial, { x: 0, y: 0 }, 2), { x: 0, y: 0 }, 2).scale).toBe(4);
});
