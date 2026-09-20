import type { CaptureRectangle } from '../shared/capture';
import './style.css';

interface CaptureSelectionState {
  selection: CaptureRectangle | null;
  complete: boolean;
  actionsDisplayId: number | null;
}

declare global {
  interface Window {
    imnotaCapture: {
      ready(): Promise<void>;
      pointer(update: { phase: 'begin' | 'move' | 'end' | 'reset'; point?: { x: number; y: number } }): void;
      save(): Promise<void>;
      cancel(): Promise<void>;
      onCountdown(handler: (payload: { remainingSeconds: number }) => void): () => void;
      onPayload(
        handler: (payload: {
          displayId: number;
          displayBounds: CaptureRectangle;
          imageDataUrl: string;
        }) => void,
      ): () => void;
      onSelection(handler: (state: CaptureSelectionState) => void): () => void;
    };
  }
}

const root = document.querySelector<HTMLDivElement>('#root')!;

if (new URLSearchParams(location.search).has('countdown')) setupCaptureDelayCountdown();
else setupRegionSelection();

function setupCaptureDelayCountdown() {
  root.innerHTML = `<main class="capture-countdown" aria-label="Capture delay"><strong>Capturing in <span data-remaining>0</span>s</strong><span>Press Escape to cancel</span><button type="button" data-action="cancel">Cancel</button></main>`;
  const remaining = root.querySelector<HTMLElement>('[data-remaining]')!;
  root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.addEventListener('click', () => {
    void window.imnotaCapture.cancel();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void window.imnotaCapture.cancel();
  });
  window.imnotaCapture.onCountdown((payload) => {
    remaining.textContent = String(payload.remainingSeconds);
  });
}

function setupRegionSelection() {
  root.innerHTML = `<main class="capture-overlay" aria-label="Select a screen region"><div class="capture-toolbar" role="status"><strong>Drag to select a region</strong><span class="capture-dimensions">Press Escape to cancel</span></div><div class="capture-selection" aria-hidden="true" hidden></div><div class="capture-actions" hidden><button type="button" data-action="retake">Retake</button><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save" class="primary">Save & annotate</button></div></main>`;

  const surface = root.querySelector<HTMLElement>('.capture-overlay')!;
  const selectionElement = root.querySelector<HTMLElement>('.capture-selection')!;
  const actions = root.querySelector<HTMLElement>('.capture-actions')!;
  const dimensions = root.querySelector<HTMLElement>('.capture-dimensions')!;
  let displayId: number | null = null;
  let displayBounds: CaptureRectangle | null = null;
  let dragging = false;
  let completedSelection = false;
  let saving = false;

  function localPoint(event: PointerEvent, clampToSurface: boolean) {
    const bounds = surface.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    return clampToSurface
      ? {
          x: Math.min(Math.max(x, 0), bounds.width),
          y: Math.min(Math.max(y, 0), bounds.height),
        }
      : { x, y };
  }

  function intersectSelection(selection: CaptureRectangle): CaptureRectangle | null {
    if (!displayBounds) return null;
    const x = Math.max(selection.x, displayBounds.x);
    const y = Math.max(selection.y, displayBounds.y);
    const right = Math.min(selection.x + selection.width, displayBounds.x + displayBounds.width);
    const bottom = Math.min(selection.y + selection.height, displayBounds.y + displayBounds.height);
    return right > x && bottom > y
      ? { x: x - displayBounds.x, y: y - displayBounds.y, width: right - x, height: bottom - y }
      : null;
  }

  function draw(state: CaptureSelectionState) {
    completedSelection = state.complete && Boolean(state.selection);
    const local = state.selection ? intersectSelection(state.selection) : null;
    if (local) {
      selectionElement.style.cssText = `left:${local.x}px;top:${local.y}px;width:${local.width}px;height:${local.height}px`;
      selectionElement.hidden = false;
    } else {
      selectionElement.style.cssText = '';
      selectionElement.hidden = true;
    }
    actions.hidden = !state.complete || state.actionsDisplayId !== displayId;
    dimensions.textContent = state.selection
      ? `${Math.round(state.selection.width)} × ${Math.round(state.selection.height)} points`
      : 'Press Escape to cancel';
  }

  surface.addEventListener('pointerdown', (event) => {
    if (saving || (event.target as HTMLElement).closest('.capture-actions, .capture-toolbar')) return;
    dragging = true;
    surface.setPointerCapture(event.pointerId);
    window.imnotaCapture.pointer({ phase: 'begin', point: localPoint(event, true) });
  });
  surface.addEventListener('pointermove', (event) => {
    // Some Windows configurations retain pointer capture in the origin window;
    // others route the pressed pointer into the next display window. Support both.
    if (dragging || event.buttons === 1)
      window.imnotaCapture.pointer({ phase: 'move', point: localPoint(event, false) });
  });
  surface.addEventListener('pointerup', (event) => {
    if (
      !dragging &&
      (event.button !== 0 || (event.target as HTMLElement).closest('.capture-actions, .capture-toolbar'))
    )
      return;
    dragging = false;
    window.imnotaCapture.pointer({ phase: 'end', point: localPoint(event, false) });
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  });
  surface.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false;
    window.imnotaCapture.pointer({ phase: 'reset' });
  });
  root
    .querySelector<HTMLButtonElement>('[data-action="retake"]')!
    .addEventListener('click', () => window.imnotaCapture.pointer({ phase: 'reset' }));
  root
    .querySelector<HTMLButtonElement>('[data-action="cancel"]')!
    .addEventListener('click', () => void window.imnotaCapture.cancel());
  root.querySelector<HTMLButtonElement>('[data-action="save"]')!.addEventListener('click', () => {
    if (!completedSelection || saving) return;
    saving = true;
    void window.imnotaCapture.save().catch(() => {
      saving = false;
    });
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void window.imnotaCapture.cancel();
  });
  window.imnotaCapture.onSelection(draw);
  window.imnotaCapture.onPayload((payload) => {
    displayId = payload.displayId;
    displayBounds = payload.displayBounds;
    surface.style.backgroundImage = `url("${payload.imageDataUrl}")`;
    void window.imnotaCapture.ready();
  });
}
