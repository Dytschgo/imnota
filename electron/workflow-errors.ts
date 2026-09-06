import { ZodError } from 'zod';
import type { WorkflowErrorCode, WorkflowResult } from '../src/shared/workflow-bridge.js';
import { workflowFailure, workflowSuccess } from '../src/shared/workflow-errors.js';

export class NativeWorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = 'NativeWorkflowError';
  }
}

function inferredCode(message: string): WorkflowErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes('untrusted') || lower.includes('outside') || lower.includes('does not belong'))
    return 'permission-denied';
  if (lower.includes('collection') && (lower.includes('not found') || lower.includes('unavailable')))
    return 'collection-not-found';
  if (lower.includes('project') && (lower.includes('not found') || lower.includes('unavailable')))
    return 'project-not-found';
  if (lower.includes('session') && (lower.includes('not found') || lower.includes('closed')))
    return 'session-not-found';
  if (lower.includes('cancel')) return 'session-cancelled';
  if (lower.includes('bundle') && lower.includes('not found')) return 'bundle-not-found';
  if (lower.includes('clipboard')) return 'clipboard-limit';
  if (lower.includes('too long')) return 'path-too-long';
  if (lower.includes('linked')) return 'linked-path';
  return 'io-failure';
}

export async function workflowOutcome<T>(operation: () => Promise<T> | T): Promise<WorkflowResult<T>> {
  try {
    return workflowSuccess(await operation());
  } catch (error) {
    if (error instanceof NativeWorkflowError)
      return workflowFailure(error.code, error.message, {
        retryable: error.retryable,
        details: error.details,
      });
    if (error instanceof ZodError)
      return workflowFailure('invalid-input', 'The request contains invalid or unsupported values.', {
        retryable: false,
      });
    const message = error instanceof Error ? error.message : String(error);
    return workflowFailure(inferredCode(message), message, { retryable: false });
  }
}
