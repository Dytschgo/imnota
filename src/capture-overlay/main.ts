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
      annotate(): Promise<void>;
      copy(): Promise<{ image: boolean }>;
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
  root.innerHTML = `<main class="capture-countdown" role="timer" aria-label="Capture in 0 seconds. Press Escape to cancel."><strong data-remaining>0</strong></main>`;
  const countdown = root.querySelector<HTMLElement>('.capture-countdown')!;
  const remaining = root.querySelector<HTMLElement>('[data-remaining]')!;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void window.imnotaCapture.cancel();
  });
  window.imnotaCapture.onCountdown((payload) => {
    remaining.textContent = String(payload.remainingSeconds);
    countdown.setAttribute(
      'aria-label',
      `Capture in ${payload.remainingSeconds} seconds. Press Escape to cancel.`,
    );
  });
}

function setupRegionSelection() {
  root.innerHTML = `<main class="capture-overlay mode-region" aria-label="Capture a screenshot"><img class="capture-freeze-frame" alt="" draggable="false" /><div class="capture-toolbar" role="status"><div class="capture-modes" role="radiogroup" aria-label="Capture mode"><button type="button" role="radio" aria-label="Area" title="Area" aria-checked="true" data-mode="region"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4" /></svg></button><button type="button" role="radio" aria-label="Window" title="Window" aria-checked="false" data-mode="window"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="13" height="12" rx="1.5" /><path d="M8 19h12V9" /></svg></button><button type="button" role="radio" aria-label="Display" title="Display" aria-checked="false" data-mode="display"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M8 21h8m-4-4v4" /></svg></button></div><button type="button" data-action="last-region" disabled>Last area</button><strong class="capture-instruction">Drag to select an area</strong><span class="capture-dimensions">Press Escape to cancel</span></div><div class="capture-selection" aria-hidden="true" hidden></div><div class="capture-actions" hidden><button type="button" data-action="retake">Retake</button><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="copy">Copy image</button><button type="button" data-action="save" class="primary">Save to collection</button><button type="button" data-action="annotate">Annotate</button></div></main>`;

  const surface = root.querySelector<HTMLElement>('.capture-overlay')!;
  const freezeFrame = root.querySelector<HTMLImageElement>('.capture-freeze-frame')!;
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
  let copying = false;
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
      ? 'Select the last captured area from this session'
      : lastRegionAvailable
        ? 'The last area was captured on a different display.'
        : LAST_CAPTURE_REGION_UNAVAILABLE_MESSAGE;
  }

  function instructionFor(state: CaptureSelectionState): string {
    if (state.mode === 'window') {
      if (state.windowMessage) return state.windowMessage;
      if (state.windowTitle) return state.windowTitle;
      return 'Click a window';
    }
    if (state.mode === 'display') return 'Capture this entire display';
    return 'Drag to select an area';
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
  root.querySelector<HTMLButtonElement>('[data-action="annotate"]')!.addEventListener('click', () => {
    if (!completedSelection || saving) return;
    saving = true;
    void window.imnotaCapture.annotate().catch(() => {
      saving = false;
    });
  });
  root.querySelector<HTMLButtonElement>('[data-action="copy"]')!.addEventListener('click', () => {
    if (!completedSelection || saving || copying) return;
    copying = true;
    void window.imnotaCapture
      .copy()
      .then((report) => {
        dimensions.textContent = report.image ? 'Image copied' : 'Image was not kept on the clipboard';
      })
      .finally(() => {
        copying = false;
      });
  });
  for (const button of surface.querySelectorAll<HTMLButtonElement>('.capture-modes [data-mode]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.mode;
      if (next === 'region' || next === 'window' || next === 'display') window.imnotaCapture.setMode(next);
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(surface.querySelectorAll<HTMLButtonElement>('.capture-modes [data-mode]'));
      const currentIndex = buttons.indexOf(button);
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      const next = buttons[(currentIndex + direction + buttons.length) % buttons.length];
      next?.focus();
      next?.click();
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

  function presentCapturedStill(imageDataUrl: string): void {
    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      freezeFrame.removeEventListener('load', succeed);
      freezeFrame.removeEventListener('error', fail);
      void window.imnotaCapture.ready();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      freezeFrame.removeEventListener('load', succeed);
      freezeFrame.removeEventListener('error', fail);
    };
    freezeFrame.addEventListener('load', succeed);
    freezeFrame.addEventListener('error', fail);
    freezeFrame.src = imageDataUrl;
    if (freezeFrame.complete && freezeFrame.naturalWidth > 0) succeed();
  }

  window.imnotaCapture.onPayload((payload) => {
    displayId = payload.displayId;
    displayBounds = payload.displayBounds;
    setLastRegionAvailability(payload.lastRegion, payload.lastRegionAvailable);
    presentCapturedStill(payload.imageDataUrl);
  });
}
