import type { CaptureRectangle } from '../shared/capture';
import './style.css';

declare global {
  interface Window {
    imnotaCapture: {
      ready(): Promise<void>;
      save(selection: CaptureRectangle): Promise<void>;
      cancel(): Promise<void>;
      onPayload(handler: (payload: { imageDataUrl: string }) => void): () => void;
    };
  }
}

const root = document.querySelector<HTMLDivElement>('#root')!;
root.innerHTML = `<main class="capture-overlay" aria-label="Select a screen region"><div class="capture-toolbar" role="status"><strong>Drag to select a region</strong><span class="capture-dimensions">Press Escape to cancel</span></div><div class="capture-selection" aria-hidden="true" hidden></div><div class="capture-actions" hidden><button type="button" data-action="retake">Retake</button><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save" class="primary">Save & annotate</button></div></main>`;

const surface = root.querySelector<HTMLElement>('.capture-overlay')!;
const selectionElement = root.querySelector<HTMLElement>('.capture-selection')!;
const actions = root.querySelector<HTMLElement>('.capture-actions')!;
const dimensions = root.querySelector<HTMLElement>('.capture-dimensions')!;
let start: { x: number; y: number } | null = null;
let selection: CaptureRectangle | null = null;
let saving = false;

function bounded(event: PointerEvent) {
  const bounds = surface.getBoundingClientRect();
  return {
    x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
    y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
  };
}
function draw(next: CaptureRectangle | null) {
  selection = next;
  if (!next) {
    selectionElement.style.cssText = '';
    selectionElement.hidden = true;
    actions.hidden = true;
    dimensions.textContent = 'Press Escape to cancel';
    return;
  }
  selectionElement.style.cssText = `left:${next.x}px;top:${next.y}px;width:${next.width}px;height:${next.height}px`;
  selectionElement.hidden = false;
  actions.hidden = false;
  dimensions.textContent = `${Math.round(next.width)} × ${Math.round(next.height)} points`;
}
function selectionFrom(event: PointerEvent): CaptureRectangle | null {
  if (!start) return null;
  const current = bounded(event);
  const x = Math.min(start.x, current.x),
    y = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x),
    height = Math.abs(current.y - start.y);
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}
surface.addEventListener('pointerdown', (event) => {
  if (saving || (event.target as HTMLElement).closest('.capture-actions, .capture-toolbar')) return;
  start = bounded(event);
  surface.setPointerCapture(event.pointerId);
  draw(null);
});
surface.addEventListener('pointermove', (event) => {
  if (start) draw(selectionFrom(event));
});
surface.addEventListener('pointerup', (event) => {
  if (!start) return;
  draw(selectionFrom(event));
  start = null;
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
});
surface.addEventListener('pointercancel', () => {
  if (!start) return;
  start = null;
  draw(null);
});
root.querySelector<HTMLButtonElement>('[data-action="retake"]')!.addEventListener('click', () => draw(null));
root
  .querySelector<HTMLButtonElement>('[data-action="cancel"]')!
  .addEventListener('click', () => void window.imnotaCapture.cancel());
root.querySelector<HTMLButtonElement>('[data-action="save"]')!.addEventListener('click', () => {
  if (!selection || saving) return;
  saving = true;
  void window.imnotaCapture.save(selection).catch(() => {
    saving = false;
  });
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void window.imnotaCapture.cancel();
});
window.imnotaCapture.onPayload(({ imageDataUrl }) => {
  surface.style.backgroundImage = `url("${imageDataUrl}")`;
  void window.imnotaCapture.ready();
});
