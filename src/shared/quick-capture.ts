import type { Annotation, ImagePayload } from './types.js';
import type { WorkflowResult } from './workflow-bridge.js';

export type QuickCaptureCorner = 'off' | 'left' | 'right';

export interface QuickCaptureDestination {
  projectPath: string;
  collectionId: string;
}

export interface QuickCaptureCard {
  id: string;
  revision: number;
  previewDataUrl: string;
  width: number;
  height: number;
  busy: boolean;
  /** A failed Add stays bound to the original destination so a retry cannot duplicate it elsewhere. */
  destination?: QuickCaptureDestination;
  message?: string;
  dragAvailable: boolean;
}

export interface QuickCaptureState {
  cards: QuickCaptureCard[];
  destinations: Array<QuickCaptureDestination & { label: string }>;
  destinationError?: string;
  editorCaptureId?: string;
}

export interface QuickCaptureBridge {
  state(): Promise<WorkflowResult<QuickCaptureState>>;
  copy(input: { id: string; revision: number }): Promise<WorkflowResult<void>>;
  discard(input: { id: string; revision: number }): Promise<WorkflowResult<void>>;
  add(input: {
    id: string;
    revision: number;
    destination: QuickCaptureDestination;
  }): Promise<WorkflowResult<void>>;
  edit(input: {
    id: string;
    revision: number;
  }): Promise<WorkflowResult<{ image: ImagePayload; annotations: Annotation[] }>>;
  apply(input: {
    id: string;
    revision: number;
    annotations: Annotation[];
    pngDataUrl: string;
  }): Promise<WorkflowResult<void>>;
  resize(editor: boolean): Promise<WorkflowResult<void>>;
  hide(): Promise<WorkflowResult<void>>;
  startDrag(input: { id: string; revision: number }): void;
  prepareDrag(input: { id: string; revision: number }): Promise<WorkflowResult<void>>;
  onChange(handler: () => void): () => void;
  onDragError(handler: (message: string) => void): () => void;
}
