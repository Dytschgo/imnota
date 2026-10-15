import type { WorkflowError, WorkflowErrorCode } from '../../shared/workflow-bridge';
import type {
  PromptBundleControllerError,
  PromptBundleControllerErrorCode,
} from './prompt-export-controller-core';

export type ExportRecovery =
  'rebuild' | 'retry' | 'retry-cleanup' | 'use-files' | 'reopen-project' | 'fix-content' | 'none';

type Guidance = Pick<PromptBundleControllerError, 'message' | 'recovery' | 'retryable' | 'fallbackAvailable'>;

function guidance(message: string, recovery: ExportRecovery, fallbackAvailable = false): Guidance {
  return {
    message,
    recovery,
    retryable: ['rebuild', 'retry', 'retry-cleanup'].includes(recovery),
    fallbackAvailable,
  };
}

// Record, rather than Partial<Record>, makes additions to either error union fail typecheck.
export const controllerFailureCatalog = {
  busy: guidance('Wait for the active prompt export to finish.', 'none'),
  cancelled: guidance('Prompt export was cancelled. Completed file pairs were kept.', 'none'),
  'cleanup-pending': guidance(
    'Export cleanup could not finish. Retry cleanup before starting another export.',
    'retry-cleanup',
  ),
  'content-changed': guidance(
    'The collection changed during export. Rebuild bundles to use the latest content.',
    'rebuild',
  ),
  disposed: guidance(
    'Prompt export is no longer available. Reopen the project to try again.',
    'reopen-project',
  ),
  'invalid-bundle': guidance(
    'This prompt is no longer available. Rebuild bundles and choose it again.',
    'rebuild',
  ),
  'native-failure': guidance('The export could not finish. Try again.', 'retry'),
  'no-content': guidance('Include a picture, text note or drawing before preparing bundles.', 'fix-content'),
  'render-limit': guidance(
    'This content is too large to render. Move distant annotations closer or reduce oversized text.',
    'fix-content',
  ),
  'save-failed': guidance(
    'Latest changes could not be saved. Save the project, then rebuild bundles.',
    'rebuild',
  ),
  'composition-unavailable': guidance(
    'Prompt images could not be composed on this device. Try again.',
    'retry',
  ),
  'encode-failed': guidance('The prompt image could not be prepared as PNG. Try again.', 'retry'),
  'export-incomplete': guidance(
    'Prompt export did not complete. Rebuild bundles to try again. Completed file pairs were kept.',
    'rebuild',
  ),
  unexpected: guidance('Prompt export could not finish. Rebuild bundles to try again.', 'rebuild'),
} satisfies Record<PromptBundleControllerErrorCode, Guidance>;

export const nativeFailureCatalog = {
  'invalid-input': guidance(
    'An internal export problem stopped this action. Rebuild bundles to try again.',
    'rebuild',
  ),
  'permission-denied': guidance(
    'The export folder is not writable. Choose a writable workspace folder, then rebuild bundles.',
    'rebuild',
  ),
  'project-not-found': guidance(
    'The project is no longer available. Reopen the project before exporting.',
    'reopen-project',
  ),
  'collection-not-found': guidance(
    'The collection is no longer available. Reopen the project and select a collection.',
    'reopen-project',
  ),
  'project-changed': guidance(
    'The project changed during export. Reload and review the project before exporting again.',
    'reopen-project',
  ),
  'session-not-found': guidance(
    'The saved export is no longer available. Rebuild bundles to create a new copy.',
    'rebuild',
  ),
  'session-cancelled': guidance('The export session was cancelled. Completed file pairs were kept.', 'none'),
  'bundle-not-found': guidance(
    'A saved bundle is no longer available. Rebuild bundles to create a new copy.',
    'rebuild',
  ),
  'clipboard-limit': guidance(
    'This prompt could not be placed on the clipboard. Use Copy Markdown only or Open files.',
    'use-files',
    true,
  ),
  'path-too-long': guidance(
    'The workspace location is too long for export filenames. Move the workspace to a shorter path before exporting.',
    'none',
  ),
  'linked-path': guidance(
    'The export location uses a linked folder. Choose a workspace folder without links before exporting.',
    'none',
  ),
  'io-failure': guidance('The export files could not be accessed. Try again.', 'retry'),
  'watch-failure': guidance(
    'Workspace changes could not be checked. Reopen the project before exporting.',
    'reopen-project',
  ),
  'network-failure': guidance(
    'The connection could not complete. Check your connection and try again.',
    'retry',
  ),
  'pairing-expired': guidance(
    'The sharing connection expired. Connect again before trying to share.',
    'none',
  ),
  'upload-rejected': guidance(
    'The upload could not be accepted. Review the sharing limits before trying again.',
    'none',
  ),
  'capture-unavailable': guidance(
    'Screen capture is unavailable on this device. Import a picture instead.',
    'none',
  ),
  'capture-permission-denied': guidance(
    'Screen capture needs permission. Allow it in system settings before trying again.',
    'none',
  ),
  'capture-sources-unavailable': guidance(
    'No screen is available to capture. Check your displays and try again.',
    'retry',
  ),
  'capture-empty-region': guidance('The capture area is empty. Choose an area with content.', 'fix-content'),
  'capture-failed': guidance('Screen capture could not finish. Try again.', 'retry'),
  'capture-cancelled': guidance('Screen capture was cancelled.', 'none'),
} satisfies Record<WorkflowErrorCode, Guidance>;

export const clipboardFailureCatalog = {
  'too-large': guidance(
    'This prompt is too large for the clipboard. Use the saved PNG and Markdown files.',
    'use-files',
    true,
  ),
  busy: guidance('Another app is using the clipboard. Try again.', 'retry'),
  'prior-content': guidance(
    'The current clipboard content cannot be safely replaced. Use Copy Markdown only or Open files, or clear the clipboard first.',
    'use-files',
    true,
  ),
  rejected: guidance(
    'The clipboard did not accept this prompt. Use Copy Markdown only or Open files.',
    'use-files',
    true,
  ),
  decode: guidance(
    'The prompt image could not be prepared for the clipboard. Use Copy Markdown only or Open files.',
    'use-files',
    true,
  ),
} satisfies Record<'too-large' | 'busy' | 'prior-content' | 'rejected' | 'decode', Guidance>;

const notWritable = nativeFailureCatalog['permission-denied'];
export const ioFailureCatalog = {
  ENOSPC: guidance('The disk is full. Free some space, then rebuild bundles.', 'rebuild'),
  EACCES: notWritable,
  EPERM: notWritable,
  EROFS: notWritable,
  EBUSY: guidance(
    'Another app, such as sync or antivirus software, is using the export files. Try again.',
    'retry',
  ),
  ENAMETOOLONG: nativeFailureCatalog['path-too-long'],
  ENOENT: guidance('An export file is missing. Rebuild bundles to create a new copy.', 'rebuild'),
} satisfies Record<'ENOSPC' | 'EACCES' | 'EPERM' | 'EBUSY' | 'EROFS' | 'ENOENT' | 'ENAMETOOLONG', Guidance>;

function entryFor<T extends Record<string, Guidance>>(catalog: T, key: unknown): Guidance | undefined {
  return typeof key === 'string' && Object.hasOwn(catalog, key) ? catalog[key] : undefined;
}

export function controllerExportFailure(
  code: PromptBundleControllerErrorCode,
  raw?: string,
  options: { safeMessage?: string; fallbackAvailable?: boolean } = {},
): PromptBundleControllerError {
  return {
    code,
    ...controllerFailureCatalog[code],
    ...(options.safeMessage ? { message: options.safeMessage } : {}),
    ...(options.fallbackAvailable === undefined ? {} : { fallbackAvailable: options.fallbackAvailable }),
    technicalDetails: raw,
  };
}

export function nativeExportFailure(
  error: WorkflowError,
  fallbackAvailable = false,
): PromptBundleControllerError {
  const specialized =
    error.code === 'clipboard-limit'
      ? entryFor(clipboardFailureCatalog, error.details?.reason)
      : error.code === 'io-failure'
        ? entryFor(ioFailureCatalog, error.details?.errno)
        : undefined;
  const entry = specialized ?? nativeFailureCatalog[error.code];
  return {
    code: 'native-failure',
    nativeCode: error.code,
    ...entry,
    fallbackAvailable: entry.fallbackAvailable || fallbackAvailable,
    technicalDetails: error.message,
  };
}
