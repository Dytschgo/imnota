import { beforeEach, expect, it, vi } from 'vitest';

function pointer(target: HTMLElement, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
  target.dispatchEvent(event);
}

async function setup() {
  await import('./main');
  const surface = document.querySelector<HTMLElement>('.capture-overlay')!;
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  surface.setPointerCapture = vi.fn();
  surface.hasPointerCapture = () => true;
  surface.releasePointerCapture = vi.fn();
  return surface;
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  window.imnotaCapture = {
    ready: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    onPayload: vi.fn(() => () => {}),
  };
});

it('keeps the completed selection while moving to and clicking Save', async () => {
  const surface = await setup();
  pointer(surface, 'pointerdown', 20, 30);
  pointer(surface, 'pointermove', 220, 180);
  pointer(surface, 'pointerup', 220, 180);
  pointer(surface, 'pointermove', 710, 580);
  const button = document.querySelector<HTMLButtonElement>('[data-action=save]')!;
  pointer(button, 'pointerdown', 710, 580);
  pointer(button, 'pointerup', 710, 580);
  expect(document.querySelector<HTMLElement>('.capture-actions')!.hidden).toBe(false);
  button.click();
  expect(window.imnotaCapture.save).toHaveBeenCalledExactlyOnceWith({
    x: 20,
    y: 30,
    width: 200,
    height: 150,
  });
  button.click();
  expect(window.imnotaCapture.save).toHaveBeenCalledTimes(1);
});

it('hides selection and actions on retake until a new drag completes', async () => {
  const surface = await setup();
  pointer(surface, 'pointerdown', 20, 30);
  pointer(surface, 'pointerup', 220, 180);
  document.querySelector<HTMLButtonElement>('[data-action=retake]')!.click();
  expect(document.querySelector<HTMLElement>('.capture-selection')!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('.capture-actions')!.hidden).toBe(true);
  pointer(surface, 'pointermove', 400, 300);
  document.querySelector<HTMLButtonElement>('[data-action=save]')!.click();
  expect(window.imnotaCapture.save).not.toHaveBeenCalled();
  pointer(surface, 'pointerdown', 300, 200);
  pointer(surface, 'pointerup', 250, 160);
  document.querySelector<HTMLButtonElement>('[data-action=save]')!.click();
  expect(window.imnotaCapture.save).toHaveBeenCalledWith({ x: 250, y: 160, width: 50, height: 40 });
});
