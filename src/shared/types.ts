export type ProjectStatus = 'active' | 'archived';
export type Priority = 'low' | 'medium' | 'high';
export type AnnotationKind =
  | 'arrow'
  | 'line'
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'highlight'
  | 'pen'
  | 'text'
  | 'callout'
  | 'step'
  | 'blur'
  | 'pixelate'
  | 'crop';

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  points?: number[];
  text?: string;
  stepNumber?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  align?: 'left' | 'center' | 'right';
  arrowhead?: boolean;
  blurIntensity?: number;
  zIndex: number;
}

export interface ScreenshotRecord {
  collectionId: string;
  id: string;
  originalFilename: string;
  storedFilename: string;
  title: string;
  description: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  priority: Priority;
  annotationFile: string;
  descriptionFile: string;
  originalWidth: number;
  originalHeight: number;
  includeInExport: boolean;
  conflict?: boolean;
}

/** Version 1/2 note fields retained only for lossless migration. */
export interface NoteFields {
  summary: string;
  observation: string;
  problem: string;
  expectedBehaviour: string;
  requestedChange: string;
  technicalDetails: string;
  aiInstruction: string;
  additionalNotes: string;
}

export interface ExportPreferences {
  includeOriginalScreenshots: boolean;
  includeAnnotationMetadata: boolean;
  template: 'default';
}

export interface ProjectData {
  schemaVersion: 3;
  collections: Collection[];
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  favourite: boolean;
  screenshots: ScreenshotRecord[];
  exportPreferences: ExportPreferences;
}
export interface Collection {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  overallContext: string;
}

export interface ProjectSnapshot {
  projectPath: string;
  project: ProjectData;
  thumbnails: Record<string, string>;
  recoveryFound: boolean;
}

export type ProjectListItem = ProjectData & { projectPath: string; searchText?: string };

export interface WorkspaceSettings {
  workspacePath: string | null;
  theme: 'system' | 'light' | 'dark';
  interfaceScale: number;
  openRecentOnLaunch: boolean;
  confirmBeforeDeletion: boolean;
  updateChannel: UpdateChannel;
}

export type UpdateChannel = 'stable' | 'nightly';

export type UpdateState =
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
export interface UpdateStatus {
  terminalCommand?: string;
  installing?: boolean;
  channel?: UpdateChannel;
  releaseUrl?: string;
  manualDownload?: boolean;
  currentVersion?: string;
  state: UpdateState;
  version?: string;
  percent?: number;
  message?: string;
}

export interface ImagePayload {
  filename: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface ExportRequest {
  collectionId?: string;
  projectPath: string;
  markdown: string;
  annotatedImages: Array<{ filename: string; dataUrl: string }>;
  includeOriginal: boolean;
  includeAnnotations: boolean;
}

export interface SaveScreenshotResult {
  project: ProjectData;
  savedScreenshotId: string;
  conflictCreated: boolean;
  contentRevision: string;
}

export interface DeleteScreenshotResult {
  snapshot: ProjectSnapshot;
  undoToken: string;
}

export interface ImnotaBridge {
  getSettings(): Promise<WorkspaceSettings>;
  chooseWorkspace(): Promise<WorkspaceSettings | null>;
  setSettings(settings: Partial<WorkspaceSettings>): Promise<WorkspaceSettings>;
  listProjects(): Promise<ProjectListItem[]>;
  createProject(input: { name: string; description: string }): Promise<ProjectSnapshot>;
  openProjectDialog(): Promise<ProjectSnapshot | null>;
  loadProject(projectPath: string): Promise<ProjectSnapshot>;
  saveProject(projectPath: string, project: ProjectData): Promise<void>;
  saveScreenshotContent(input: {
    projectPath: string;
    screenshot: ScreenshotRecord;
    annotations: Annotation[];
    contentRevision: string;
  }): Promise<SaveScreenshotResult>;
  loadScreenshotContent(input: { projectPath: string; screenshot: ScreenshotRecord }): Promise<{
    image: ImagePayload;
    annotations: Annotation[];
    description: string;
    contentRevision: string;
  }>;
  importImageFiles(input: {
    projectPath: string;
    paths: string[];
    collectionId?: string;
  }): Promise<ProjectSnapshot>;
  pasteImage(projectPath: string, collectionId?: string): Promise<ProjectSnapshot>;
  editCollection(input: {
    projectPath: string;
    action: 'create' | 'rename' | 'archive' | 'restore';
    collectionId?: string;
    name?: string;
  }): Promise<ProjectSnapshot>;
  duplicateScreenshot(input: { projectPath: string; screenshot: ScreenshotRecord }): Promise<ProjectSnapshot>;
  deleteScreenshot(input: { projectPath: string; screenshotId: string }): Promise<DeleteScreenshotResult>;
  undoDeleteScreenshot(input: { projectPath: string; undoToken: string }): Promise<ProjectSnapshot>;
  duplicateProject(projectPath: string): Promise<ProjectSnapshot>;
  archiveProject(projectPath: string): Promise<void>;
  deleteProject(projectPath: string): Promise<void>;
  exportAnnotatedImage(input: {
    projectPath: string;
    filename: string;
    dataUrl: string;
    collectionId?: string;
  }): Promise<string>;
  exportPackage(input: ExportRequest): Promise<{ folderPath: string; zipPath: string; count: number }>;
  openPath(targetPath: string): Promise<void>;
  copyText(text: string): Promise<void>;
  copyContext(input: { markdown: string; imageDataUrl: string }): Promise<void>;
  copyImage(dataUrl: string): Promise<void>;
  saveRecovery(input: {
    projectPath: string;
    project: ProjectData;
    annotations: Record<string, Annotation[]>;
  }): Promise<void>;
  clearRecovery(projectPath: string): Promise<void>;
  getDroppedFilePath(file: File): string;
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void;
  downloadUpdate(): Promise<void>;
  checkForUpdates(): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
}

declare global {
  interface Window {
    imnota: ImnotaBridge;
  }
}
