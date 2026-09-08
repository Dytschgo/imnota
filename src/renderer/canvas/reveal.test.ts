import { expect, it } from 'vitest';
import { viewportToReveal } from './reveal';

it('reveals an off-image search match at readable scale', () => {
  const bounds = { x: -600, y: 3000, width: 260, height: 90 };
  const view = viewportToReveal(bounds, { width: 800, height: 600 });
  expect(view.scale).toBe(1);
  expect(view.x + (bounds.x + bounds.width / 2) * view.scale).toBe(400);
  expect(view.y + (bounds.y + bounds.height / 2) * view.scale).toBe(300);
});
it('fits oversized matches within the usable canvas', () => {
  const bounds = { x: 300, y: -100, width: 2400, height: 1400 };
  const view = viewportToReveal(bounds, { width: 600, height: 400 });
  expect(view.x + bounds.x * view.scale).toBeGreaterThanOrEqual(32);
  expect(view.y + bounds.y * view.scale).toBeGreaterThanOrEqual(48);
  expect(view.x + (bounds.x + bounds.width) * view.scale).toBeLessThanOrEqual(568);
  expect(view.y + (bounds.y + bounds.height) * view.scale).toBeLessThanOrEqual(352);
});
