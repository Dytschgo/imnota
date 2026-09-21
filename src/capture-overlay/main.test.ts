import { beforeEach, expect, it, vi } from 'vitest';
import type { CaptureRectangle } from '../shared/capture';

function pointer(
  target: HTMLElement,
  type: string,
  x: number,
  y: number,
  options: { button?: number; buttons?: number } = {},
) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, ...options });
  target.dispatchEvent(event);
}

const STILL = 'data:image/png;base64,cG5n';

async function setup(displayId = 2, displayBounds = { x: 0, y: 0, width: 800, height: 600 }) {
  let payloadHandler:
    | ((payload: { displayId: number; displayBounds: CaptureRectangle; imageDataUrl: string }) => void)
    | undefined;
  let selectionHandler:
    | ((state: {
        selection: CaptureRectangle | null;
        complete: boolean;
        actionsDisplayId: number | null;
      }) => void)
    | undefined;
  window.imnotaCapture.onPayload = vi.fn((handler) => {
    payloadHandler = handler;
    return () => {};
  });
  window.imnotaCapture.onSelection = vi.fn((handler) => {
    selectionHandler = handler;
    return () => {};
  });
  await import('./main');
  const surface = document.querySelector<HTMLElement>('.capture-overlay')!;
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  surface.setPointerCapture = vi.fn();
  surface.hasPointerCapture = () => true;
  surface.releasePointerCapture = vi.fn();
  payloadHandler!({ displayId, displayBounds, imageDataUrl: STILL });
  return { surface, selectionHandler: selectionHandler! };
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, '', '/');
  window.imnotaCapture = {
    ready: vi.fn(async () => {}),
    pointer: vi.fn(),
    save: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    onCountdown: vi.fn(() => () => {}),
    onPayload: vi.fn(() => () => {}),
    onSelection: vi.fn(() => () => {}),
  };
});

it('paints the captured still and only then marks the overlay ready', async () => {
  await setup();
  const still = document.querySelector<HTMLImageElement>('.capture-freeze-frame')!;
  expect(still.getAttribute('src')).toBe(STILL);
  expect(window.imnotaCapture.ready).not.toHaveBeenCalled();
  still.dispatchEvent(new Event('load'));
  expect(window.imnotaCapture.ready).toHaveBeenCalledOnce();
});

it('does not become ready when the captured still fails to load', async () => {
  await setup();
  const still = document.querySelector<HTMLImageElement>('.capture-freeze-frame')!;
  still.dispatchEvent(new Event('error'));
  expect(window.imnotaCapture.ready).not.toHaveBeenCalled();
  still.dispatchEvent(new Event('load'));
  expect(window.imnotaCapture.ready).not.toHaveBeenCalled();
});

it('shows a delay countdown without the region overlay', async () => {
  let countdownHandler: ((payload: { remainingSeconds: number }) => void) | undefined;
  window.history.replaceState({}, '', '?countdown=1');
  window.imnotaCapture.onCountdown = vi.fn((handler) => {
    countdownHandler = handler;
    return () => {};
  });
  await import('./main');
  expect(document.querySelector('.capture-overlay')).toBeNull();
  countdownHandler!({ remainingSeconds: 3 });
  expect(document.querySelector('[data-remaining]')!.textContent).toBe('3');
  document.querySelector<HTMLButtonElement>('[data-action=cancel]')!.click();
  expect(window.imnotaCapture.cancel).toHaveBeenCalledTimes(1);
});

it('reports uncapped pointer-capture coordinates for a cross-monitor reverse drag', async () => {
  const { surface } = await setup();
  pointer(surface, 'pointerdown', 500, 300);
  pointer(surface, 'pointermove', -240, -80);
  pointer(surface, 'pointerup', -240, -80);
  expect(window.imnotaCapture.pointer).toHaveBeenNthCalledWith(1, {
    phase: 'begin',
    point: { x: 500, y: 300 },
  });
  expect(window.imnotaCapture.pointer).toHaveBeenNthCalledWith(2, {
    phase: 'move',
    point: { x: -240, y: -80 },
  });
  expect(window.imnotaCapture.pointer).toHaveBeenNthCalledWith(3, {
    phase: 'end',
    point: { x: -240, y: -80 },
  });
});

it('continues a pressed drag routed in from another display overlay', async () => {
  const { surface } = await setup(2, { x: 0, y: 0, width: 800, height: 600 });
  pointer(surface, 'pointermove', 40, 50, { buttons: 1 });
  pointer(surface, 'pointerup', 60, 70, { button: 0 });
  expect(window.imnotaCapture.pointer).toHaveBeenNthCalledWith(1, {
    phase: 'move',
    point: { x: 40, y: 50 },
  });
  expect(window.imnotaCapture.pointer).toHaveBeenNthCalledWith(2, {
    phase: 'end',
    point: { x: 60, y: 70 },
  });
});

it('draws only this display intersection and saves the coordinated selection once', async () => {
  const { selectionHandler } = await setup(2, { x: 0, y: 0, width: 800, height: 600 });
  selectionHandler({
    selection: { x: -200, y: -100, width: 500, height: 250 },
    complete: true,
    actionsDisplayId: 2,
  });
  const selection = document.querySelector<HTMLElement>('.capture-selection')!;
  expect(selection.style.cssText).toContain('left: 0px');
  expect(selection.style.cssText).toContain('width: 300px');
  expect(document.querySelector<HTMLElement>('.capture-actions')!.hidden).toBe(false);
  const button = document.querySelector<HTMLButtonElement>('[data-action=save]')!;
  button.click();
  button.click();
  expect(window.imnotaCapture.save).toHaveBeenCalledTimes(1);
  expect(window.imnotaCapture.save).toHaveBeenCalledWith();
});

it('retake clears every overlay through the coordinator and cancellation remains global', async () => {
  const { selectionHandler } = await setup();
  selectionHandler({
    selection: { x: 20, y: 30, width: 200, height: 150 },
    complete: true,
    actionsDisplayId: 2,
  });
  document.querySelector<HTMLButtonElement>('[data-action=retake]')!.click();
  expect(window.imnotaCapture.pointer).toHaveBeenCalledWith({ phase: 'reset' });
  selectionHandler({ selection: null, complete: false, actionsDisplayId: null });
  expect(document.querySelector<HTMLElement>('.capture-selection')!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('.capture-actions')!.hidden).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-action=cancel]')!.click();
  expect(window.imnotaCapture.cancel).toHaveBeenCalledTimes(1);
});
