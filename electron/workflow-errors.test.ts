// @vitest-environment node
import { expect, it } from 'vitest';
import { z } from 'zod';
import { NativeWorkflowError, workflowOutcome } from './workflow-errors.js';

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
