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

export type ClipboardFailureReason = 'too-large' | 'busy' | 'prior-content' | 'rejected' | 'decode';

export function clipboardFailure(reason: ClipboardFailureReason, message: string): NativeWorkflowError {
  return new NativeWorkflowError('clipboard-limit', message, reason === 'busy', { reason });
}

/** Keep native filesystem codes authoritative even when a path contains workflow keywords. */
export function filesystemFailure(error: unknown): NativeWorkflowError {
  if (error instanceof NativeWorkflowError) return error;
  const errno = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return Object.assign(
    new NativeWorkflowError(
      errno === 'ENAMETOOLONG' ? 'path-too-long' : 'io-failure',
      error instanceof Error ? error.message : String(error),
      false,
      typeof errno === 'string' ? { errno } : undefined,
    ),
    { cause: error },
  );
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
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^E[A-Z0-9]+$/.test(error.code)
    ) {
      const failure = filesystemFailure(error);
      return workflowFailure(failure.code, failure.message, {
        retryable: failure.retryable,
        details: failure.details,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return workflowFailure(inferredCode(message), message, { retryable: false });
  }
}
