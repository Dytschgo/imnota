import type { CaptureOverlayMode, CaptureRectangle } from '../shared/capture';
import { LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE } from '../shared/capture';
import './style.css';

interface CaptureSelectionState {
  selection: CaptureRectangle | null;
  complete: boolean;
  actionsDisplayId: number | null;
  mode: CaptureOverlayMode;
  windowTitle: string | null;
  windowMessage: string | null;
}

declare global {
  interface Window {
    imnotaCapture: {
      ready(): Promise<void>;
      pointer(update: { phase: 'begin' | 'move' | 'end' | 'reset'; point?: { x: number; y: number } }): void;
      setMode(mode: CaptureOverlayMode): void;
      repeatLastRegion(): void;
      save(): Promise<void>;
      cancel(): Promise<void>;
      onCountdown(handler: (payload: { remainingSeconds: number }) => void): () => void;
      onPayload(
        handler: (payload: {
          displayId: number;
          displayBounds: CaptureRectangle;
          imageDataUrl: string;
          lastRegion: CaptureRectangle | null;
          lastRegionAvailable: boolean;
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
  root.innerHTML = `<main class="capture-overlay mode-region" aria-label="Capture a screenshot"><div class="capture-toolbar" role="status"><div class="capture-modes" role="radiogroup" aria-label="Capture mode"><button type="button" role="radio" aria-checked="true" data-mode="region">Region</button><button type="button" role="radio" aria-checked="false" data-mode="window">Window</button><button type="button" role="radio" aria-checked="false" data-mode="display">Display</button></div><button type="button" data-action="last-region" disabled>Last region</button><strong class="capture-instruction">Drag to select a region</strong><span class="capture-dimensions">Press Escape to cancel</span></div><div class="capture-selection" aria-hidden="true" hidden></div><div class="capture-actions" hidden><button type="button" data-action="retake">Retake</button><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save" class="primary">Save & annotate</button></div></main>`;

  const surface = root.querySelector<HTMLElement>('.capture-overlay')!;
  const selectionElement = root.querySelector<HTMLElement>('.capture-selection')!;
  const actions = root.querySelector<HTMLElement>('.capture-actions')!;
  const instruction = root.querySelector<HTMLElement>('.capture-instruction')!;
  const dimensions = root.querySelector<HTMLElement>('.capture-dimensions')!;
  const lastRegionButton = root.querySelector<HTMLButtonElement>('[data-action="last-region"]')!;
  let displayId: number | null = null;
  let displayBounds: CaptureRectangle | null = null;
  let dragging = false;
  let completedSelection = false;
  let saving = false;
  let mode: CaptureOverlayMode = 'region';

  setLastRegionAvailability(null, false);

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

  function setLastRegionAvailability(lastRegion: CaptureRectangle | null, lastRegionAvailable: boolean) {
    lastRegionButton.disabled = !lastRegion;
    lastRegionButton.title = lastRegion
      ? 'Select the last captured region from this session'
      : lastRegionAvailable
        ? 'The last region was captured on a different display.'
        : LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE;
  }

  function instructionFor(state: CaptureSelectionState): string {
    if (state.mode === 'window') {
      if (state.windowMessage) return state.windowMessage;
      if (state.windowTitle) return state.windowTitle;
      return 'Click a window';
    }
    if (state.mode === 'display') return 'Capture this entire display';
    return 'Drag to select a region';
  }

  function draw(state: CaptureSelectionState) {
    mode = state.mode;
    surface.classList.remove('mode-region', 'mode-window', 'mode-display');
    surface.classList.add(`mode-${state.mode}`);
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
    instruction.textContent = instructionFor(state);
    dimensions.textContent = state.selection
      ? `${Math.round(state.selection.width)} × ${Math.round(state.selection.height)} points`
      : 'Press Escape to cancel';
    for (const button of surface.querySelectorAll<HTMLButtonElement>('.capture-modes [data-mode]'))
      button.setAttribute('aria-checked', button.dataset.mode === state.mode ? 'true' : 'false');
  }

  function ignoreChrome(event: Event): boolean {
    return Boolean((event.target as HTMLElement).closest('.capture-actions, .capture-toolbar'));
  }

  surface.addEventListener('pointerdown', (event) => {
    if (saving || ignoreChrome(event)) return;
    if (mode !== 'region') return;
    dragging = true;
    surface.setPointerCapture(event.pointerId);
    window.imnotaCapture.pointer({ phase: 'begin', point: localPoint(event, true) });
  });
  surface.addEventListener('pointermove', (event) => {
    if (mode === 'window') {
      window.imnotaCapture.pointer({ phase: 'move', point: localPoint(event, false) });
      return;
    }
    // Some Windows configurations retain pointer capture in the origin window;
    // others route the pressed pointer into the next display window. Support both.
    if (mode === 'region' && (dragging || event.buttons === 1))
      window.imnotaCapture.pointer({ phase: 'move', point: localPoint(event, false) });
  });
  surface.addEventListener('pointerup', (event) => {
    if (saving || ignoreChrome(event)) {
      if (mode === 'region' && dragging) dragging = false;
      return;
    }
    if (mode === 'window' || mode === 'display') {
      window.imnotaCapture.pointer({ phase: 'end', point: localPoint(event, false) });
      return;
    }
    if (!dragging && event.button !== 0) return;
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
  for (const button of surface.querySelectorAll<HTMLButtonElement>('.capture-modes [data-mode]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.mode;
      if (next === 'region' || next === 'window' || next === 'display') window.imnotaCapture.setMode(next);
    });
  }
  lastRegionButton.addEventListener('click', () => {
    if (lastRegionButton.disabled) return;
    window.imnotaCapture.repeatLastRegion();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void window.imnotaCapture.cancel();
  });
  window.imnotaCapture.onSelection(draw);
  window.imnotaCapture.onPayload((payload) => {
    displayId = payload.displayId;
    displayBounds = payload.displayBounds;
    setLastRegionAvailability(payload.lastRegion, payload.lastRegionAvailable);
    surface.style.backgroundImage = `url("${payload.imageDataUrl}")`;
    void window.imnotaCapture.ready();
  });
}
