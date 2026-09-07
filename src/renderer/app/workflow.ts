import type { WorkflowBridge, WorkflowError, WorkflowResult } from '../../shared/workflow-bridge';
import type { ImnotaBridge } from '../../shared/types';

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
