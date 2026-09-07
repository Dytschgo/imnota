import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ImnotaBridge } from '../src/shared/types.js';

const bridge: ImnotaBridge = {
  setDesktopGlass: (input) => ipcRenderer.invoke('workflow:appearance:desktop', input),
  getPreferenceSettings: () => ipcRenderer.invoke('workflow:preferences:get'),
  setPreferenceSettings: (input) => ipcRenderer.invoke('workflow:preferences:set', input),
  getNativePerformanceProfile: () => ipcRenderer.invoke('workflow:performance:get'),
  startPromptExport: (input) => ipcRenderer.invoke('workflow:prompt-export:start', input),
  writePromptExportBundle: (input) => ipcRenderer.invoke('workflow:prompt-export:write', input),
  finishPromptExport: (input) => ipcRenderer.invoke('workflow:prompt-export:finish', input),
  cancelPromptExport: (input) => ipcRenderer.invoke('workflow:prompt-export:cancel', input),
  readPromptExportBundle: (input) => ipcRenderer.invoke('workflow:prompt-export:read', input),
  copyPromptExportBundle: (input) => ipcRenderer.invoke('workflow:prompt-export:copy', input),
  openPromptExportBundle: (input) => ipcRenderer.invoke('workflow:prompt-export:open', input),
  startProjectWatch: (input) => ipcRenderer.invoke('workflow:project-watch:start', input),
  stopProjectWatch: (input) => ipcRenderer.invoke('workflow:project-watch:stop', input),
  reloadWatchedProject: (input) => ipcRenderer.invoke('workflow:project-watch:reload', input),
  saveProjectCompareAndSwap: (input) => ipcRenderer.invoke('workflow:project-watch:cas', input),
  onProjectWatchEvent: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      watchEvent: import('../src/shared/workflow-bridge.js').ProjectWatchEvent,
    ) => handler(watchEvent);
    ipcRenderer.on('workflow:project-watch-event', listener);
    return () => ipcRenderer.removeListener('workflow:project-watch-event', listener);
  },
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
  pasteImage: (projectPath, roundId) => ipcRenderer.invoke('screenshots:paste', projectPath, roundId),
  editCollection: (input) => ipcRenderer.invoke('collections:edit', input),
  duplicateScreenshot: (input) => ipcRenderer.invoke('screenshots:duplicate', input),
  deleteScreenshot: (input) => ipcRenderer.invoke('screenshots:delete', input),
  undoDeleteScreenshot: (input) => ipcRenderer.invoke('screenshots:undo-delete', input),
  duplicateProject: (projectPath) => ipcRenderer.invoke('projects:duplicate', projectPath),
  archiveProject: (projectPath) => ipcRenderer.invoke('projects:archive', projectPath),
  deleteProject: (projectPath) => ipcRenderer.invoke('projects:delete', projectPath),
  exportAnnotatedImage: (input) => ipcRenderer.invoke('exports:annotated-image', input),
  exportPackage: (input) => ipcRenderer.invoke('exports:package', input),
  openPath: (targetPath) => ipcRenderer.invoke('system:open-path', targetPath),
  copyText: (text) => ipcRenderer.invoke('system:copy-text', text),
  copyContext: (input) => ipcRenderer.invoke('system:copy-context', input),
  copyImage: (dataUrl) => ipcRenderer.invoke('system:copy-image', dataUrl),
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
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
};

contextBridge.exposeInMainWorld('imnota', bridge);
