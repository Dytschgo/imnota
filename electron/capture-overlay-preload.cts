import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureOverlayMode, CaptureRectangle } from '../src/shared/capture.js';

interface CaptureSelectionState {
  selection: CaptureRectangle | null;
  complete: boolean;
  actionsDisplayId: number | null;
  mode: CaptureOverlayMode;
  windowTitle: string | null;
  windowCaptureAvailable: boolean;
  windowMessage: string | null;
}

contextBridge.exposeInMainWorld('imnotaCapture', {
  ready: () => ipcRenderer.invoke('capture-overlay:ready'),
  pointer: (update: { phase: 'begin' | 'move' | 'end' | 'reset'; point?: { x: number; y: number } }) =>
    ipcRenderer.send('capture-overlay:pointer', update),
  setMode: (mode: CaptureOverlayMode) => ipcRenderer.send('capture-overlay:mode', mode),
  save: () => ipcRenderer.invoke('capture-overlay:save'),
  cancel: () => ipcRenderer.invoke('capture-overlay:cancel'),
  onPayload: (
    handler: (payload: { displayId: number; displayBounds: CaptureRectangle; imageDataUrl: string }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { displayId: number; displayBounds: CaptureRectangle; imageDataUrl: string },
    ) => handler(payload);
    ipcRenderer.on('capture-overlay:payload', listener);
    return () => ipcRenderer.removeListener('capture-overlay:payload', listener);
  },
  onSelection: (handler: (state: CaptureSelectionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CaptureSelectionState) => handler(state);
    ipcRenderer.on('capture-overlay:selection', listener);
    return () => ipcRenderer.removeListener('capture-overlay:selection', listener);
  },
});
