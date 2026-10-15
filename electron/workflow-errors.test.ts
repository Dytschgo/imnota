// @vitest-environment node
import { expect, it } from 'vitest';
import { z } from 'zod';
import { filesystemFailure, NativeWorkflowError, workflowOutcome } from './workflow-errors.js';

it('serializes validation and actionable native failures', async () => {
  await expect(
    workflowOutcome(() => z.object({ value: z.string() }).parse({ value: 1 })),
  ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input', retryable: false } });
  await expect(
    workflowOutcome(() => {
      throw new NativeWorkflowError('project-changed', 'Reload first.', true, {
        currentRevision: 'abc',
      });
    }),
  ).resolves.toEqual({
    ok: false,
    error: {
      code: 'project-changed',
      message: 'Reload first.',
      retryable: true,
      details: { currentRevision: 'abc' },
    },
  });
});

it.each(['ENOSPC', 'EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'EROFS'])(
  'preserves %s despite cancellation words in an OS path',
  async (errno) => {
    await expect(
      workflowOutcome(() => {
        throw Object.assign(new Error(`${errno}: D:\\Cancelled ideas\\clipboard-linked-too long.md`), {
          code: errno,
        });
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'io-failure', retryable: false, details: { errno } },
    });
  },
);

it('never infers cancellation from arbitrary error text, even without errno', async () => {
  await expect(
    workflowOutcome(() => {
      throw new Error('Could not write D:\\Cancelled ideas\\prompt.md');
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'io-failure', retryable: false },
  });
});

it.each([false, true])('classifies ENAMETOOLONG with errno (wrapped: %s)', async (wrapped) => {
  const error = Object.assign(new Error('ENAMETOOLONG: D:/private/clipboard'), { code: 'ENAMETOOLONG' });
  await expect(
    workflowOutcome(() => {
      throw wrapped ? filesystemFailure(error) : error;
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'path-too-long', retryable: false, details: { errno: 'ENAMETOOLONG' } },
  });
});
