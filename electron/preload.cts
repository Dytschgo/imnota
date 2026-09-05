import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ImnotaBridge } from '../src/shared/types.js';

const bridge: ImnotaBridge = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseWorkspace: () => ipcRenderer.invoke('settings:choose-workspace'),
  setSettings: (input) => ipcRenderer.invoke('settings:set', input),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (input) => ipcRenderer.invoke('projects:create', input),
  openProjectDialog: () => ipcRenderer.invoke('projects:open-dialog'),
  loadProject: (projectPath) => ipcRenderer.invoke('projects:load', projectPath),
  saveProject: (projectPath, project) => ipcRenderer.invoke('projects:save', projectPath, project),
  saveScreenshotContent: (input) => ipcRenderer.invoke('projects:save-screenshot', input),
  loadScreenshotContent: (input) => ipcRenderer.invoke('screenshots:load-content', input),
  importImageFiles: (input) => ipcRenderer.invoke('screenshots:import-files', input),
  pasteImage: (projectPath) => ipcRenderer.invoke('screenshots:paste', projectPath),
  duplicateScreenshot: (input) => ipcRenderer.invoke('screenshots:duplicate', input),
  duplicateProject: (projectPath) => ipcRenderer.invoke('projects:duplicate', projectPath),
  archiveProject: (projectPath) => ipcRenderer.invoke('projects:archive', projectPath),
  deleteProject: (projectPath) => ipcRenderer.invoke('projects:delete', projectPath),
  exportAnnotatedImage: (input) => ipcRenderer.invoke('exports:annotated-image', input),
  exportPackage: (input) => ipcRenderer.invoke('exports:package', input),
  openPath: (targetPath) => ipcRenderer.invoke('system:open-path', targetPath),
  copyText: (text) => ipcRenderer.invoke('system:copy-text', text),
  saveRecovery: (input) => ipcRenderer.invoke('recovery:save', input),
  clearRecovery: (projectPath) => ipcRenderer.invoke('recovery:clear', projectPath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  onUpdateStatus: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: import('../src/shared/types.js').UpdateStatus,
    ) => handler(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
};

contextBridge.exposeInMainWorld('imnota', bridge);
