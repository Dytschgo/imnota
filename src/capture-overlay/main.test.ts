import { beforeEach, expect, it, vi } from 'vitest';
import type { CaptureOverlayMode, CaptureRectangle } from '../shared/capture';
import {
  LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE,
  WINDOW_CAPTURE_UNAVAILABLE_MESSAGE,
} from '../shared/capture';

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
    windowMessage: string | null;
  }> = {},
) {
  return {
    selection: null,
    complete: false,
    actionsDisplayId: null as number | null,
    mode: 'region' as CaptureOverlayMode,
    windowTitle: null,
    windowMessage: null,
    ...partial,
  };
}

const STILL = 'data:image/png;base64,cG5n';

async function setup(
  displayId = 2,
  displayBounds = { x: 0, y: 0, width: 800, height: 600 },
  extra: { lastRegion?: CaptureRectangle | null; lastRegionAvailable?: boolean } = {},
) {
  let payloadHandler:
    | ((payload: {
        displayId: number;
        displayBounds: CaptureRectangle;
        imageDataUrl: string;
        lastRegion: CaptureRectangle | null;
        lastRegionAvailable: boolean;
      }) => void)
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
  payloadHandler!({
    displayId,
    displayBounds,
    imageDataUrl: STILL,
    lastRegion: extra.lastRegion ?? null,
    lastRegionAvailable: extra.lastRegionAvailable ?? extra.lastRegion != null,
  });
  return { surface, selectionHandler: selectionHandler! };
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, '', '/');
  window.imnotaCapture = {
    ready: vi.fn(async () => {}),
    pointer: vi.fn(),
    setMode: vi.fn(),
    repeatLastRegion: vi.fn(),
    save: vi.fn(async () => {}),
    annotate: vi.fn(async () => {}),
    copy: vi.fn(async () => ({ image: true })),
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
  expect(document.querySelector('.capture-countdown')!.textContent).toBe('3');
  expect(document.querySelector('.capture-countdown')).toHaveAttribute(
    'aria-label',
    'Capture in 3 seconds. Press Escape to cancel.',
  );
  const cancellations = vi.mocked(window.imnotaCapture.cancel).mock.calls.length;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(vi.mocked(window.imnotaCapture.cancel).mock.calls.length).toBeGreaterThan(cancellations);
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

it('copies the image without saving and can annotate instead of save', async () => {
  const { selectionHandler } = await setup(2, { x: 0, y: 0, width: 800, height: 600 });
  selectionHandler(
    selectionState({
      selection: { x: 10, y: 10, width: 40, height: 40 },
      complete: true,
      actionsDisplayId: 2,
    }),
  );
  const copy = document.querySelector<HTMLButtonElement>('[data-action=copy]')!;
  copy.click();
  copy.click();
  await Promise.resolve();
  expect(window.imnotaCapture.copy).toHaveBeenCalledOnce();
  expect(document.querySelector('.capture-overlay')).not.toBeNull();
  expect(window.imnotaCapture.save).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-action=annotate]')!.click();
  expect(window.imnotaCapture.annotate).toHaveBeenCalledOnce();
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

it('defaults to Area and does not start a drag from the mode switcher', async () => {
  const { surface } = await setup();
  const region = document.querySelector<HTMLButtonElement>('[data-mode=region]')!;
  expect(region.getAttribute('aria-checked')).toBe('true');
  expect(surface.classList.contains('mode-region')).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-mode=window]')!.click();
  expect(window.imnotaCapture.setMode).toHaveBeenCalledWith('window');
  expect(window.imnotaCapture.pointer).not.toHaveBeenCalled();
});

it('explains when windows cannot be identified and keeps Area available', async () => {
  const { selectionHandler } = await setup();
  selectionHandler(
    selectionState({
      mode: 'window',
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

it('keeps Last region disabled until this session has a region on this display', async () => {
  await setup();
  const button = document.querySelector<HTMLButtonElement>('[data-action=last-region]')!;
  expect(button.disabled).toBe(true);
  expect(button.title).toBe(LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE);
  button.click();
  expect(window.imnotaCapture.repeatLastRegion).not.toHaveBeenCalled();
});

it('applies the last region from the overlay when this display has one', async () => {
  await setup(
    2,
    { x: 0, y: 0, width: 800, height: 600 },
    {
      lastRegion: { x: 20, y: 30, width: 200, height: 150 },
      lastRegionAvailable: true,
    },
  );
  const button = document.querySelector<HTMLButtonElement>('[data-action=last-region]')!;
  const still = document.querySelector<HTMLImageElement>('.capture-freeze-frame')!;
  expect(still.getAttribute('src')).toBe(STILL);
  expect(window.imnotaCapture.ready).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  button.click();
  expect(window.imnotaCapture.repeatLastRegion).toHaveBeenCalledTimes(1);
  still.dispatchEvent(new Event('load'));
  expect(window.imnotaCapture.ready).toHaveBeenCalledOnce();
});

it('highlights an identified window on hover and does not begin a region drag', async () => {
  const { surface, selectionHandler } = await setup();
  selectionHandler(selectionState({ mode: 'window' }));
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
