import { contextBridge, ipcRenderer } from 'electron';
import type { QuickCaptureBridge } from '../src/shared/quick-capture.js';

const bridge: QuickCaptureBridge = {
  state: () => ipcRenderer.invoke('quick-capture:state'),
  copy: (input) => ipcRenderer.invoke('quick-capture:copy', input),
  discard: (input) => ipcRenderer.invoke('quick-capture:discard', input),
  add: (input) => ipcRenderer.invoke('quick-capture:add', input),
  edit: (input) => ipcRenderer.invoke('quick-capture:edit', input),
  apply: (input) => ipcRenderer.invoke('quick-capture:apply', input),
  resize: (editor) => ipcRenderer.invoke('quick-capture:resize', editor),
  hide: () => ipcRenderer.invoke('quick-capture:hide'),
  prepareDrag: (input) => ipcRenderer.invoke('quick-capture:prepare-drag', input),
  startDrag: (input) => ipcRenderer.send('quick-capture:drag', input),
  onChange: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('quick-capture:changed', listener);
    return () => ipcRenderer.removeListener('quick-capture:changed', listener);
  },
  onDragError: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => handler(message);
    ipcRenderer.on('quick-capture:drag-error', listener);
    return () => ipcRenderer.removeListener('quick-capture:drag-error', listener);
  },
};
contextBridge.exposeInMainWorld('imnotaQuickCapture', bridge);
