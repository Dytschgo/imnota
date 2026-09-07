import type { WorkflowBridge, WorkflowError, WorkflowResult } from '../../shared/workflow-bridge';
import type { ImnotaBridge, ScreenshotRecord } from '../../shared/types';

export type RendererBridge = ImnotaBridge & WorkflowBridge;

export function getRendererBridge(): RendererBridge {
  return window.imnota as RendererBridge;
}

export class WorkflowRequestError extends Error {
  readonly workflowError: WorkflowError;

  constructor(error: WorkflowError) {
    super(error.message);
    this.name = 'WorkflowRequestError';
    this.workflowError = error;
  }
}

export function workflowValue<T>(result: WorkflowResult<T>): T {
  if (!result.ok) throw new WorkflowRequestError(result.error);
  return result.value;
}

export function workflowMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function screenshotSaveError(
  screenshot: ScreenshotRecord,
  screenshots: readonly ScreenshotRecord[],
  error: unknown,
): string {
  const index = screenshots
    .filter((item) => item.collectionId === screenshot.collectionId)
    .sort((left, right) => left.position - right.position)
    .findIndex((item) => item.id === screenshot.id);
  const reference = index < 0 ? 'Screenshot' : `Picture ${index + 1}`;
  const title = screenshot.title.trim();
  const filename = screenshot.originalFilename;
  const identity = title && title !== filename ? `${title} (${filename})` : filename;
  return `Could not save ${reference} — ${identity}. ${workflowMessage(error, 'The save failed.')} Keep Imnota open; your edits are still in memory. Check the workspace and try again.`;
}
