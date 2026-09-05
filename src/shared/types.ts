export type ProjectStatus = 'active' | 'archived';
export type ScreenshotStatus = 'draft' | 'ready' | 'needs-review' | 'completed';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
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
  id: string;
  originalFilename: string;
  storedFilename: string;
  title: string;
  description: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  priority: Priority;
  status: ScreenshotStatus;
  annotationFile: string;
  notesFile: string;
  originalWidth: number;
  originalHeight: number;
  includeInExport: boolean;
}

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
  includedFields: Array<keyof NoteFields>;
  overallInstructions: string;
  desiredOutcome: string;
  technicalConstraints: string;
  template: 'default';
}

export interface ProjectData {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  tags: string[];
  favourite: boolean;
  screenshots: ScreenshotRecord[];
  exportPreferences: ExportPreferences;
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
}

export type UpdateState = 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
export interface UpdateStatus {
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
  projectPath: string;
  markdown: string;
  annotatedImages: Array<{ filename: string; dataUrl: string }>;
  includeOriginal: boolean;
  includeAnnotations: boolean;
}

export interface ImnotaBridge {
  getSettings(): Promise<WorkspaceSettings>;
  chooseWorkspace(): Promise<WorkspaceSettings | null>;
  setSettings(settings: Partial<WorkspaceSettings>): Promise<WorkspaceSettings>;
  listProjects(): Promise<ProjectListItem[]>;
  createProject(input: { name: string; description: string; tags: string[] }): Promise<ProjectSnapshot>;
  openProjectDialog(): Promise<ProjectSnapshot | null>;
  loadProject(projectPath: string): Promise<ProjectSnapshot>;
  saveProject(projectPath: string, project: ProjectData): Promise<void>;
  saveScreenshotContent(input: {
    projectPath: string;
    screenshot: ScreenshotRecord;
    annotations: Annotation[];
    notes: NoteFields;
  }): Promise<void>;
  loadScreenshotContent(input: {
    projectPath: string;
    screenshot: ScreenshotRecord;
  }): Promise<{ image: ImagePayload; annotations: Annotation[]; notes: NoteFields }>;
  importImageFiles(input: { projectPath: string; paths: string[] }): Promise<ProjectSnapshot>;
  pasteImage(projectPath: string): Promise<ProjectSnapshot>;
  duplicateScreenshot(input: { projectPath: string; screenshot: ScreenshotRecord }): Promise<ProjectSnapshot>;
  duplicateProject(projectPath: string): Promise<ProjectSnapshot>;
  archiveProject(projectPath: string): Promise<void>;
  deleteProject(projectPath: string): Promise<void>;
  exportAnnotatedImage(input: { projectPath: string; filename: string; dataUrl: string }): Promise<string>;
  exportPackage(input: ExportRequest): Promise<{ folderPath: string; zipPath: string; count: number }>;
  openPath(targetPath: string): Promise<void>;
  copyText(text: string): Promise<void>;
  saveRecovery(input: {
    projectPath: string;
    project: ProjectData;
    annotations: Record<string, Annotation[]>;
    notes: Record<string, NoteFields>;
  }): Promise<void>;
  clearRecovery(projectPath: string): Promise<void>;
  getDroppedFilePath(file: File): string;
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
}

declare global {
  interface Window {
    imnota: ImnotaBridge;
  }
}
