import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureRectangle } from '../src/shared/capture.js';

contextBridge.exposeInMainWorld('imnotaCapture', {
  ready: () => ipcRenderer.invoke('capture-overlay:ready'),
  save: (selection: CaptureRectangle) => ipcRenderer.invoke('capture-overlay:save', selection),
  cancel: () => ipcRenderer.invoke('capture-overlay:cancel'),
  onPayload: (handler: (payload: { imageDataUrl: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { imageDataUrl: string }) =>
      handler(payload);
    ipcRenderer.on('capture-overlay:payload', listener);
    return () => ipcRenderer.removeListener('capture-overlay:payload', listener);
  },
});
