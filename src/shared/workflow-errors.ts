import type { WorkflowError, WorkflowErrorCode, WorkflowResult } from './workflow-bridge.js';

export function workflowSuccess<T>(value: T): WorkflowResult<T> {
  return { ok: true, value };
}

export function workflowFailure(
  code: WorkflowErrorCode,
  message: string,
  options: Pick<WorkflowError, 'retryable'> & Partial<Pick<WorkflowError, 'details'>> = {
    retryable: false,
  },
): WorkflowResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: options.retryable,
      ...(options.details ? { details: options.details } : {}),
    },
  };
}
