import { beforeEach, expect, it, vi } from 'vitest';
import type { CaptureOverlayMode, CaptureRectangle } from '../shared/capture';
import { WINDOW_CAPTURE_UNAVAILABLE_MESSAGE } from '../shared/capture';

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

function selectionState(
  partial: Partial<{
    selection: CaptureRectangle | null;
    complete: boolean;
    actionsDisplayId: number | null;
    mode: CaptureOverlayMode;
    windowTitle: string | null;
    windowCaptureAvailable: boolean;
    windowMessage: string | null;
  }> = {},
) {
  return {
    selection: null,
    complete: false,
    actionsDisplayId: null as number | null,
    mode: 'region' as CaptureOverlayMode,
    windowTitle: null,
    windowCaptureAvailable: false,
    windowMessage: null,
    ...partial,
  };
}

async function setup(displayId = 2, displayBounds = { x: 0, y: 0, width: 800, height: 600 }) {
  let payloadHandler:
    | ((payload: { displayId: number; displayBounds: CaptureRectangle; imageDataUrl: string }) => void)
    | undefined;
  let selectionHandler: ((state: ReturnType<typeof selectionState>) => void) | undefined;
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
  payloadHandler!({ displayId, displayBounds, imageDataUrl: 'data:image/png;base64,cG5n' });
  return { surface, selectionHandler: selectionHandler! };
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  window.imnotaCapture = {
    ready: vi.fn(async () => {}),
    pointer: vi.fn(),
    setMode: vi.fn(),
    save: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    onPayload: vi.fn(() => () => {}),
    onSelection: vi.fn(() => () => {}),
  };
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
  selectionHandler(
    selectionState({
      selection: { x: -200, y: -100, width: 500, height: 250 },
      complete: true,
      actionsDisplayId: 2,
    }),
  );
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
  selectionHandler(
    selectionState({
      selection: { x: 20, y: 30, width: 200, height: 150 },
      complete: true,
      actionsDisplayId: 2,
    }),
  );
  document.querySelector<HTMLButtonElement>('[data-action=retake]')!.click();
  expect(window.imnotaCapture.pointer).toHaveBeenCalledWith({ phase: 'reset' });
  selectionHandler(selectionState());
  expect(document.querySelector<HTMLElement>('.capture-selection')!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('.capture-actions')!.hidden).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-action=cancel]')!.click();
  expect(window.imnotaCapture.cancel).toHaveBeenCalledTimes(1);
});

it('defaults to Region and does not start a drag from the mode switcher', async () => {
  const { surface } = await setup();
  const region = document.querySelector<HTMLButtonElement>('[data-mode=region]')!;
  expect(region.getAttribute('aria-checked')).toBe('true');
  expect(surface.classList.contains('mode-region')).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-mode=window]')!.click();
  expect(window.imnotaCapture.setMode).toHaveBeenCalledWith('window');
  expect(window.imnotaCapture.pointer).not.toHaveBeenCalled();
});

it('explains when windows cannot be identified and keeps Region available', async () => {
  const { selectionHandler } = await setup();
  selectionHandler(
    selectionState({
      mode: 'window',
      windowCaptureAvailable: false,
      windowMessage: WINDOW_CAPTURE_UNAVAILABLE_MESSAGE,
    }),
  );
  expect(document.querySelector('.capture-instruction')!.textContent).toBe(
    WINDOW_CAPTURE_UNAVAILABLE_MESSAGE,
  );
  document.querySelector<HTMLButtonElement>('[data-mode=region]')!.click();
  expect(window.imnotaCapture.setMode).toHaveBeenCalledWith('region');
});

it('selects the full display without a drag and saves once', async () => {
  const { selectionHandler } = await setup(2, { x: 0, y: 0, width: 800, height: 600 });
  document.querySelector<HTMLButtonElement>('[data-mode=display]')!.click();
  expect(window.imnotaCapture.setMode).toHaveBeenCalledWith('display');
  selectionHandler(
    selectionState({
      mode: 'display',
      selection: { x: 0, y: 0, width: 800, height: 600 },
      complete: true,
      actionsDisplayId: 2,
    }),
  );
  expect(document.querySelector('.capture-instruction')!.textContent).toBe('Capture this entire display');
  expect(document.querySelector<HTMLElement>('.capture-actions')!.hidden).toBe(false);
  const button = document.querySelector<HTMLButtonElement>('[data-action=save]')!;
  button.click();
  button.click();
  expect(window.imnotaCapture.save).toHaveBeenCalledTimes(1);
});

it('highlights an identified window on hover and does not begin a region drag', async () => {
  const { surface, selectionHandler } = await setup();
  selectionHandler(selectionState({ mode: 'window', windowCaptureAvailable: true }));
  pointer(surface, 'pointermove', 120, 80);
  pointer(surface, 'pointerdown', 120, 80);
  pointer(surface, 'pointerup', 120, 80);
  expect(window.imnotaCapture.pointer).toHaveBeenNthCalledWith(1, {
    phase: 'move',
    point: { x: 120, y: 80 },
  });
  expect(window.imnotaCapture.pointer).toHaveBeenNthCalledWith(2, {
    phase: 'end',
    point: { x: 120, y: 80 },
  });
  expect(window.imnotaCapture.pointer).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'begin' }));
});
