import {
  WindowsClipboardBusyError,
  WindowsClipboardChangedError,
  WindowsClipboardPriorContentError,
} from './windows-clipboard.js';
import { clipboardFailure, NativeWorkflowError } from './workflow-errors.js';

/** Map native failures at the clipboard boundary, without interpreting native message text. */
export function nativeClipboardFailure(error: unknown): NativeWorkflowError {
  if (error instanceof NativeWorkflowError) return error;
  const reason =
    error instanceof WindowsClipboardBusyError || error instanceof WindowsClipboardChangedError
      ? 'busy'
      : error instanceof WindowsClipboardPriorContentError
        ? 'prior-content'
        : 'rejected';
  return clipboardFailure(reason, error instanceof Error ? error.message : 'The clipboard copy failed.');
}
