import type { PreferenceSettings, PreferenceSettingsResult } from './preferences.js';
import type { ProjectData, ProjectSnapshot } from './types.js';

export type WorkflowErrorCode =
  | 'invalid-input'
  | 'permission-denied'
  | 'project-not-found'
  | 'collection-not-found'
  | 'project-changed'
  | 'session-not-found'
  | 'session-cancelled'
  | 'bundle-not-found'
  | 'clipboard-limit'
  | 'path-too-long'
  | 'linked-path'
  | 'io-failure'
  | 'watch-failure';

export interface WorkflowError {
  code: WorkflowErrorCode;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, string | number | boolean>>;
}

export type WorkflowResult<T> = { ok: true; value: T } | { ok: false; error: WorkflowError };

export interface PreferenceSettingsUpdate {
  appearance?: Partial<PreferenceSettings['appearance']>;
  shortcuts?: Partial<PreferenceSettings['shortcuts']>;
  onboarding?: Partial<PreferenceSettings['onboarding']>;
}

export interface NativePerformanceProfile {
  platform: 'windows' | 'macos' | 'linux' | 'unknown';
  performanceClass: 'constrained' | 'standard';
  reducedEffectsRecommended: boolean;
  reasons: readonly ('low-memory' | 'low-cpu-count' | 'unknown-platform')[];
}

export interface PromptExportSessionInfo {
  sessionId: string;
  collectionId: string;
  timestamp: string;
  setName: string;
}

export interface PromptExportBundleManifest {
  bundleNumber: number;
  width: number;
  height: number;
}

export interface PromptExportBundleGrant {
  bundleNumber: number;
  pngFilename: string;
  markdownFilename: string;
}

export interface PromptExportFinalized {
  status: 'completed' | 'cancelled';
  published: boolean;
  bundles: PromptExportBundleGrant[];
  hasMasterMarkdown: boolean;
  warnings: string[];
}

export interface PromptExportBundleContent extends PromptExportBundleGrant {
  markdown: string;
  imageDataUrl: string;
}

export type PromptExportCopyTarget = 'context' | 'markdown' | 'image';
export type PromptExportOpenTarget = 'folder' | 'png' | 'markdown' | 'master';

export interface ProjectRevisionSnapshot {
  snapshot: ProjectSnapshot;
  projectRevision: string;
}

export interface ProjectWatchGrant {
  watchId: string;
  projectPath: string;
  projectRevision: string;
}

export interface ProjectWatchEvent {
  watchId: string;
  projectPath: string;
  kind: 'external-change' | 'watch-error';
  projectRevision?: string;
  changedPaths: readonly string[];
  message?: string;
}

export interface WorkflowBridge {
  getPreferenceSettings(): Promise<WorkflowResult<PreferenceSettingsResult>>;
  setPreferenceSettings(update: PreferenceSettingsUpdate): Promise<WorkflowResult<PreferenceSettingsResult>>;
  getNativePerformanceProfile(): Promise<WorkflowResult<NativePerformanceProfile>>;

  startPromptExport(input: {
    projectPath: string;
    collectionId: string;
    bundles: readonly PromptExportBundleManifest[];
  }): Promise<WorkflowResult<PromptExportSessionInfo>>;
  writePromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
    pngDataUrl: string;
    markdown: string;
  }): Promise<WorkflowResult<PromptExportBundleGrant>>;
  finishPromptExport(input: {
    sessionId: string;
    masterMarkdown?: string;
  }): Promise<WorkflowResult<PromptExportFinalized>>;
  cancelPromptExport(input: { sessionId: string }): Promise<WorkflowResult<PromptExportFinalized>>;
  readPromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
  }): Promise<WorkflowResult<PromptExportBundleContent>>;
  copyPromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
    target: PromptExportCopyTarget;
  }): Promise<WorkflowResult<void>>;
  openPromptExportBundle(input: {
    sessionId: string;
    bundleNumber: number;
    target: PromptExportOpenTarget;
  }): Promise<WorkflowResult<void>>;

  startProjectWatch(input: { projectPath: string }): Promise<WorkflowResult<ProjectWatchGrant>>;
  stopProjectWatch(input: { watchId: string }): Promise<WorkflowResult<void>>;
  reloadWatchedProject(input: { watchId: string }): Promise<WorkflowResult<ProjectRevisionSnapshot>>;
  saveProjectCompareAndSwap(input: {
    watchId: string;
    expectedRevision: string;
    project: ProjectData;
  }): Promise<WorkflowResult<ProjectRevisionSnapshot>>;
  onProjectWatchEvent(handler: (event: ProjectWatchEvent) => void): () => void;
}
