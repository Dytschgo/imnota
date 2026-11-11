import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTimeoutLifecycle } from './test-support/share-timeout-control.mjs';

function evidence() {
  const state = {
    bodySettled: true,
    openDatabases: 0,
    listening: 0,
    fixtures: [
      { bodySettled: true, operations: 0, requests: 0, openDatabases: 0, listening: false, retained: false },
    ],
  };
  return {
    code: 1,
    signal: null,
    output: 'Test timed out in 5000ms',
    results: {
      success: false,
      numTotalTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      numPassedTests: 0,
      testResults: [
        {
          assertionResults: [
            {
              status: 'failed',
              title: 'settles a real upload after the test timeout',
              failureMessages: ['timeout stack'],
            },
          ],
        },
      ],
    },
    events: [
      { event: 'upload.barrier' },
      { event: 'context.abort' },
      { event: 'upload.release' },
      { event: 'body.settled' },
      {
        event: 'rm.begin',
        path: '/tmp/imnota-share-split-data-fixture',
        ...globalThis.structuredClone(state),
      },
      {
        event: 'rm.begin',
        path: '/tmp/imnota-share-split-user-fixture',
        ...globalThis.structuredClone(state),
      },
      { event: 'terminal', ...globalThis.structuredClone(state) },
    ],
  };
}

test('accepts only the original timeout after the real upload and fixture teardown settle', () => {
  assertTimeoutLifecycle(evidence());
});

test('rejects premature upload release and removal of a live fixture', () => {
  const early = evidence();
  [early.events[1], early.events[2]] = [early.events[2], early.events[1]];
  assert.throws(() => assertTimeoutLifecycle(early));
  for (const field of ['bodySettled', 'openDatabases', 'listening']) {
    const live = evidence();
    live.events[4][field] = field === 'bodySettled' ? false : 1;
    assert.throws(() => assertTimeoutLifecycle(live));
  }
  const operations = evidence();
  operations.events[4].fixtures[0].operations = 1;
  assert.throws(() => assertTimeoutLifecycle(operations));
});

test('rejects a passing child, an extra teardown failure, or an unsettled terminal fixture', () => {
  const passed = evidence();
  passed.code = 0;
  assert.throws(() => assertTimeoutLifecycle(passed));
  const extra = evidence();
  extra.results.testResults[0].assertionResults[0].failureMessages.push('teardown timeout');
  assert.throws(() => assertTimeoutLifecycle(extra));
  const terminal = evidence();
  terminal.events.at(-1).fixtures[0].retained = true;
  assert.throws(() => assertTimeoutLifecycle(terminal));
});
