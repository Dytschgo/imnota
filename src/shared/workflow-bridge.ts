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
  | 'watch-failure'
  | 'network-failure'
  | 'pairing-expired'
  | 'upload-rejected';

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
  /** Text-only bundles deliberately reserve no PNG. */
  hasImage?: boolean;
  width: number;
  height: number;
}

export interface PromptExportBundleGrant {
  bundleNumber: number;
  /** Empty only for a text-only bundle; no fake PNG is created. */
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
  /** Omitted for a text-only bundle. */
  imageDataUrl?: string;
}

/** Deliberately contains only rendered prompt artifacts, never project paths or sources. */
export interface HostedShareUpload {
  requestId: string;
  /** Empty requests a private one-use pairing capability from the share service. */
  pairingToken: string;
  senderName?: string;
  sessionId: string;
  bundleNumbers: readonly number[];
  includeArchive: boolean;
  expiresInDays: number;
}

export interface HostedShareRecord {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  byteSize?: number;
}

/** An opaque, incident-specific recovery warning identifier. */
export interface HostedShareRecoveryWarning {
  id: string;
  message: string;
}

export interface HostedShareList {
  records: readonly HostedShareRecord[];
  /** Recovery problems are shown alongside intact local history and can be retried later. */
  recoveryErrors: readonly string[];
  /**
   * Incident-specific recovery warnings. New desktop clients can acknowledge these by id.
   * Optional while older native clients and renderer test doubles are still supported.
   */
  recoveryWarnings?: readonly HostedShareRecoveryWarning[];
}

/** Drawing sources are carried into the reserved export directory, never rasterized as text. */
export interface PromptExportSourceAsset {
  filename: string;
  source: string;
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
  setDesktopGlass(input: { enabled: boolean }): Promise<WorkflowResult<{ active: boolean }>>;
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
    /** Required only when the manifest reserved a visual PNG. */
    pngDataUrl?: string;
    markdown: string;
    sourceAssets?: readonly PromptExportSourceAsset[];
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
  openHostedSharePairing(): Promise<WorkflowResult<void>>;
  createHostedShare(input: HostedShareUpload): Promise<WorkflowResult<HostedShareRecord>>;
  cancelHostedShare(input: { requestId: string }): Promise<WorkflowResult<void>>;
  listHostedShares(): Promise<WorkflowResult<HostedShareList>>;
  dismissHostedShareRecoveryWarning(input: { id: string }): Promise<WorkflowResult<void>>;
  revokeHostedShare(input: { id: string }): Promise<WorkflowResult<HostedShareRecord>>;

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
