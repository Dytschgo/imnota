import assert from 'node:assert/strict';
import test from 'node:test';
import { probeReleaseCheck } from './release-check-probe.mjs';

const endpoint = 'https://api.github.com/repos/Dytschgo/imnota/releases/latest';

test('failed discovery retains status and rate metadata without retrying or copying other headers', async () => {
  let calls = 0;
  const report = await probeReleaseCheck(
    async (_channel, _platform, request) => {
      const response = await request(endpoint);
      assert.equal(response.status, 403);
      throw new Error('Release information unavailable.');
    },
    () => assert.fail('Preparation must not run after discovery failure'),
    {
      request: async () => {
        calls += 1;
        return new globalThis.Response(null, {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1234', 'x-other': 'not-retained' },
        });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(report.status, 'failed');
  assert.equal(report.stage, 'discovery');
  assert.deepEqual(report.requests, [
    {
      endpoint: 'latest',
      status: 403,
      rateLimit: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1234' },
    },
  ]);
  assert.ok(!JSON.stringify(report).includes('not-retained'));
});

test('successful discovery separates preparation failure and validates the declared fixture arguments', async () => {
  const release = { version: '0.4.1-nightly.20261112.43195677216' };
  const report = await probeReleaseCheck(
    async () => release,
    (selected, appPath, currentVersion) => {
      assert.equal(selected, release);
      assert.equal(appPath, '/Applications/Imnota.app');
      assert.equal(currentVersion, '0.0.0');
      throw new Error('Missing checksum.');
    },
  );
  assert.equal(report.version, release.version);
  assert.equal(report.stage, 'preparation');
  assert.equal(report.error, 'Missing checksum.');
});

test('probe observes a successful check without treating it as the original walkthrough result', async () => {
  const report = await probeReleaseCheck(
    async () => ({ version: '0.4.0' }),
    () => {},
  );
  assert.equal(report.kind, 'secondary-release-check');
  assert.equal(report.status, 'ready');
  assert.equal(report.passed, undefined);
});

test('probe rejects unexpected endpoints before I/O and honors an aborted deadline', async () => {
  let calls = 0;
  const request = async (_target, options) => {
    calls += 1;
    options.signal.throwIfAborted();
    return new globalThis.Response(null);
  };
  const blocked = await probeReleaseCheck(
    async (_channel, _platform, fetchRelease) => fetchRelease('https://example.invalid/private'),
    () => {},
    { request },
  );
  assert.equal(blocked.status, 'failed');
  assert.equal(calls, 0);
  const aborted = await probeReleaseCheck(
    async (_channel, _platform, fetchRelease) => fetchRelease(endpoint),
    () => {},
    { request, signal: globalThis.AbortSignal.abort() },
  );
  assert.equal(aborted.status, 'failed');
  assert.equal(calls, 1);
});
