import { expect, it } from 'vitest';
import { workflowFailure, workflowSuccess } from '../workflow-errors';

it('constructs serializable typed workflow outcomes', () => {
  expect(workflowSuccess({ sessionId: 'session' })).toEqual({
    ok: true,
    value: { sessionId: 'session' },
  });
  expect(
    workflowFailure('project-changed', 'Reload before saving.', {
      retryable: true,
      details: { currentRevision: 'abc' },
    }),
  ).toEqual({
    ok: false,
    error: {
      code: 'project-changed',
      message: 'Reload before saving.',
      retryable: true,
      details: { currentRevision: 'abc' },
    },
  });
});
