import { expect, it } from 'vitest';
import { fitViewport, viewportForLayoutChange, zoomAt } from './viewport';

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

const bounds = { x: 0, y: 0, width: 1600, height: 900 };

it('fits and centres the screenshot inside the canvas', () => {
  expect(fitViewport({ width: 864, height: 600 }, bounds)).toEqual({ x: 32, y: 75, scale: 0.5 });
  expect(fitViewport({ width: 4000, height: 3000 }, bounds).scale).toBe(1);
});

it('offsets the fit by cropped source bounds', () => {
  const fitted = fitViewport({ width: 864, height: 600 }, { x: 200, y: 100, width: 800, height: 450 });
  expect(fitted.scale).toBe(1);
  expect(fitted.x + (200 + 400) * fitted.scale).toBe(432);
  expect(fitted.y + (100 + 225) * fitted.scale).toBe(300);
});

it('refits on resize while the user has not adjusted the view', () => {
  const resized = { width: 1264, height: 600 };
  expect(
    viewportForLayoutChange(
      { x: 32, y: 75, scale: 0.5 },
      { width: 864, height: 600 },
      resized,
      bounds,
      false,
    ),
  ).toEqual(fitViewport(resized, bounds));
});

it('preserves zoom and the centred image point on resize after the user adjusted the view', () => {
  const zoomed = { x: -500, y: -200, scale: 2 };
  const result = viewportForLayoutChange(
    zoomed,
    { width: 900, height: 600 },
    { width: 1200, height: 500 },
    bounds,
    true,
  );
  expect(result.scale).toBe(2);
  const centredBefore = { x: (450 - zoomed.x) / zoomed.scale, y: (300 - zoomed.y) / zoomed.scale };
  expect({ x: (600 - result.x) / result.scale, y: (250 - result.y) / result.scale }).toEqual(centredBefore);
});

it('fits the first layout even when asked to preserve', () => {
  const size = { width: 864, height: 600 };
  expect(viewportForLayoutChange({ x: -500, y: -200, scale: 2 }, null, size, bounds, true)).toEqual(
    fitViewport(size, bounds),
  );
});
