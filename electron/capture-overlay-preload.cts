import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureOverlayMode, CaptureRectangle } from '../src/shared/capture.js';

interface CaptureSelectionState {
  selection: CaptureRectangle | null;
  complete: boolean;
  actionsDisplayId: number | null;
  mode: CaptureOverlayMode;
  windowTitle: string | null;
  windowMessage: string | null;
}

interface CaptureOverlayPayload {
  displayId: number;
  displayBounds: CaptureRectangle;
  imageDataUrl: string;
  lastRegion: CaptureRectangle | null;
  lastRegionAvailable: boolean;
}

contextBridge.exposeInMainWorld('imnotaCapture', {
  ready: () => ipcRenderer.invoke('capture-overlay:ready'),
  pointer: (update: { phase: 'begin' | 'move' | 'end' | 'reset'; point?: { x: number; y: number } }) =>
    ipcRenderer.send('capture-overlay:pointer', update),
  setMode: (mode: CaptureOverlayMode) => ipcRenderer.send('capture-overlay:mode', mode),
  repeatLastRegion: () => ipcRenderer.send('capture-overlay:repeat-last'),
  save: () => ipcRenderer.invoke('capture-overlay:save'),
  annotate: () => ipcRenderer.invoke('capture-overlay:annotate'),
  copy: () => ipcRenderer.invoke('capture-overlay:copy') as Promise<{ image: boolean }>,
  cancel: () => ipcRenderer.invoke('capture-overlay:cancel'),
  onCountdown: (handler: (payload: { remainingSeconds: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { remainingSeconds: number }) =>
      handler(payload);
    ipcRenderer.on('capture-overlay:countdown', listener);
    return () => ipcRenderer.removeListener('capture-overlay:countdown', listener);
  },
  onPayload: (handler: (payload: CaptureOverlayPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CaptureOverlayPayload) => handler(payload);
    ipcRenderer.on('capture-overlay:payload', listener);
    return () => ipcRenderer.removeListener('capture-overlay:payload', listener);
  },
  onSelection: (handler: (state: CaptureSelectionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CaptureSelectionState) => handler(state);
    ipcRenderer.on('capture-overlay:selection', listener);
    return () => ipcRenderer.removeListener('capture-overlay:selection', listener);
  },
});
