import { describe, expect, it } from 'vitest';
import type { WorkflowErrorCode } from '../../shared/workflow-bridge';
import type { PromptBundleControllerErrorCode } from './prompt-export-controller-core';
import { controllerExportFailure, nativeExportFailure, type ExportRecovery } from './export-failure-catalog';
import { publicError } from './prompt-export-controller-helpers';
import {
  AnnotatedImageRenderLimitError,
  assertAnnotatedImageRenderBounds,
  renderAnnotatedImageWithDimensions,
} from '../export-image';

const raw =
  'Error invoking remote method: ENOSPC EACCES EPERM EBUSY EROFS ENOENT D:/private/workspace/export.png';
const controllerRecoveries = {
  busy: 'none',
  cancelled: 'none',
  'cleanup-pending': 'retry-cleanup',
  'content-changed': 'rebuild',
  disposed: 'reopen-project',
  'invalid-bundle': 'rebuild',
  'native-failure': 'retry',
  'no-content': 'fix-content',
  'render-limit': 'fix-content',
  'save-failed': 'rebuild',
  'composition-unavailable': 'retry',
  'encode-failed': 'retry',
  'export-incomplete': 'rebuild',
  unexpected: 'rebuild',
} satisfies Record<PromptBundleControllerErrorCode, ExportRecovery>;
const nativeRecoveries = {
  'invalid-input': 'rebuild',
  'permission-denied': 'rebuild',
  'project-not-found': 'reopen-project',
  'collection-not-found': 'reopen-project',
  'project-changed': 'reopen-project',
  'session-not-found': 'rebuild',
  'session-cancelled': 'none',
  'bundle-not-found': 'rebuild',
  'clipboard-limit': 'use-files',
  'path-too-long': 'none',
  'linked-path': 'none',
  'io-failure': 'retry',
  'watch-failure': 'reopen-project',
  'network-failure': 'retry',
  'pairing-expired': 'none',
  'upload-rejected': 'none',
  'capture-unavailable': 'none',
  'capture-permission-denied': 'none',
  'capture-sources-unavailable': 'retry',
  'capture-empty-region': 'fix-content',
  'capture-failed': 'retry',
  'capture-cancelled': 'none',
} satisfies Record<WorkflowErrorCode, ExportRecovery>;

function expectSafe(detail: ReturnType<typeof publicError>, recovery: ExportRecovery) {
  expect(detail.message.trim().length).toBeGreaterThan(0);
  expect(detail.message).not.toMatch(
    /D:|private|workspace\/|export\.png|ENOSPC|EACCES|EPERM|EBUSY|EROFS|ENOENT|remote method/,
  );
  expect(detail.recovery).toBe(recovery);
  expect(detail.retryable).toBe(['retry', 'rebuild', 'retry-cleanup'].includes(recovery));
  expect(detail.technicalDetails).toBe(raw);
}

describe('export failure catalog', () => {
  it.each(Object.entries(controllerRecoveries))('has safe guidance for controller %s', (code, recovery) => {
    expectSafe(controllerExportFailure(code as PromptBundleControllerErrorCode, raw), recovery);
  });

  it.each(Object.entries(nativeRecoveries))(
    'has safe guidance for native %s without details',
    (code, recovery) => {
      const detail = nativeExportFailure({ code: code as WorkflowErrorCode, message: raw, retryable: false });
      expectSafe(detail, recovery);
      expect(detail.nativeCode).toBe(code);
      expect(detail.fallbackAvailable).toBe(code === 'clipboard-limit');
    },
  );

  it.each([
    ['too-large', 'use-files', /too large/],
    ['busy', 'retry', /Another app is using the clipboard/],
    ['prior-content', 'use-files', /current clipboard content cannot be safely replaced/],
    ['rejected', 'use-files', /clipboard did not accept/],
    ['decode', 'use-files', /image could not be prepared/],
  ] as const)('handles clipboard reason %s', (reason, recovery, message) => {
    const detail = nativeExportFailure({
      code: 'clipboard-limit',
      message: raw,
      retryable: true,
      details: { reason },
    });
    expectSafe(detail, recovery);
    expect(detail.message).toMatch(message);
    expect(detail.fallbackAvailable).toBe(recovery === 'use-files');
  });

  it.each([
    ['ENOSPC', 'rebuild', /disk is full/],
    ['EACCES', 'rebuild', /folder is not writable/],
    ['EPERM', 'rebuild', /folder is not writable/],
    ['EROFS', 'rebuild', /folder is not writable/],
    ['EBUSY', 'retry', /Another app.*using the export files/],
    ['ENOENT', 'rebuild', /file is missing/],
    ['ENAMETOOLONG', 'none', /workspace location is too long/],
  ] as const)('handles file error %s', (errno, recovery, message) => {
    const detail = nativeExportFailure({
      code: 'io-failure',
      message: raw,
      retryable: false,
      details: { errno },
    });
    expectSafe(detail, recovery);
    expect(detail.message).toMatch(message);
  });

  it.each(['future-reason', '__proto__', 'toString'])('handles unknown detail %s safely', (value) => {
    expectSafe(
      nativeExportFailure({ code: 'io-failure', message: raw, retryable: true, details: { errno: value } }),
      'retry',
    );
    expectSafe(
      nativeExportFailure({
        code: 'clipboard-limit',
        message: raw,
        retryable: true,
        details: { reason: value },
      }),
      'use-files',
    );
  });

  it('classifies typed IPC rejections and keeps their raw messages in details', () => {
    const rejection = { code: 'io-failure', message: raw, retryable: true, details: { errno: 'ENOSPC' } };
    expectSafe(publicError(rejection), 'rebuild');
    expectSafe(publicError(Object.assign(new Error(raw), rejection)), 'rebuild');
    expectSafe(publicError(new Error(raw)), 'rebuild');
    expectSafe(publicError(raw), 'rebuild');
  });

  it('preserves authored guidance from a genuinely thrown non-finite geometry error', () => {
    let thrown: unknown;
    try {
      assertAnnotatedImageRenderBounds({ x: 0, y: 0, width: Infinity, height: 80 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AnnotatedImageRenderLimitError);
    expect(publicError(thrown)).toMatchObject({
      code: 'render-limit',
      recovery: 'fix-content',
      message:
        'The annotated image has invalid or non-finite geometry. Reset the outlying annotation and try again.',
    });
  });

  it('classifies a genuine extreme-font renderer rejection before creating a canvas', async () => {
    const thrown = await renderAnnotatedImageWithDimensions(
      { filename: 'source.png', dataUrl: 'data:image/png;base64,AA==', width: 100, height: 80 },
      [{ id: 'note', kind: 'text', x: 0, y: 0, text: 'Note', fontSize: 5000, zIndex: 0 }],
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(AnnotatedImageRenderLimitError);
    expect(publicError(thrown)).toMatchObject({
      code: 'render-limit',
      recovery: 'fix-content',
      message: expect.stringContaining('Reduce that font size'),
    });
  });

  it('recognizes a render-limit code across renderer module boundaries', () => {
    const error = Object.assign(new Error('Reset the outlying annotation and try again.'), {
      code: 'ANNOTATED_IMAGE_RENDER_LIMIT',
    });
    expect(publicError(error)).toMatchObject({
      code: 'render-limit',
      message: error.message,
      recovery: 'fix-content',
    });
  });
});

it('keeps legacy render-limit diagnostic paths out of the user message', () => {
  const detail = publicError(new Error('Canvas safety failed at D:/private/export.png'));
  expect(detail).toMatchObject({
    code: 'render-limit',
    recovery: 'fix-content',
    technicalDetails: 'Canvas safety failed at D:/private/export.png',
  });
  expect(detail.message).not.toContain('private');
});
