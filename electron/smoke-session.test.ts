// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSmokeSession, type SmokeSessionHost } from './smoke-session.js';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getVersion: () => '0.4.1-nightly.20261015.1' },
}));
vi.mock('./smoke-workflow.js', () => ({
  runSmokeWorkflow: vi.fn(async () => {
    throw new Error('Failed waiting for .library within 15000ms');
  }),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it.each(['responded', 'rejected', 'hung', 'destroyed', 'capture-hung'])(
  'retains the original failure and bounded renderer diagnostics: %s',
  async (mode) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-session-test-')));
    roots.push(root);
    const artifacts = path.join(root, 'imnota-verification-artifacts-failure');
    await fs.mkdir(artifacts);
    vi.stubEnv('IMNOTA_SMOKE_ARTIFACT_DIR', artifacts);
    vi.stubEnv('IMNOTA_SMOKE_RESULT', path.join(root, 'result.json'));
    vi.stubEnv('IMNOTA_SMOKE_CAPTURE_CAPABILITY', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = { sampledAt: '2026-10-15T10:00:00.000Z', eventLoopLagMs: 2, wait: { target: null } };
    const executeJavaScript = vi.fn(async () => {
      if (mode === 'hung') return new Promise(() => {});
      if (mode === 'rejected') throw new Error('Renderer gone');
      return state;
    });
    const capturePage = vi.fn(async () => {
      // JSON must survive even when capture cannot complete.
      expect(
        JSON.parse(await fs.readFile(path.join(artifacts, 'verification-failure.json'), 'utf8')),
      ).toHaveProperty('passed', false);
      if (mode === 'capture-hung') return new Promise<never>(() => {});
      return { toPNG: () => Buffer.from('synthetic capture') };
    });
    const host = {
      diagnosticsHealth: () => ({ healthy: true }),
      mainWindow: () => ({
        isDestroyed: () => mode === 'destroyed',
        isFocused: () => false,
        webContents: { executeJavaScript, capturePage },
      }),
    } as unknown as SmokeSessionHost;
    expect(await runSmokeSession(host)).toBe(1);
    const report = JSON.parse(await fs.readFile(path.join(artifacts, 'verification-failure.json'), 'utf8'));
    expect(report).toMatchObject({
      passed: false,
      version: '0.4.1-nightly.20261015.1',
      error: expect.stringContaining('Failed waiting for .library within 15000ms'),
      diagnosticsHealth: { healthy: true },
      rendererResponsiveness: {
        requestedAt: expect.any(String),
        elapsedMs: expect.any(Number),
        status: ['responded', 'capture-hung'].includes(mode) ? 'responded' : 'unavailable',
      },
    });
    if (['responded', 'capture-hung'].includes(mode)) expect(report.rendererState).toEqual(state);
    expect(report.windowFocused).toBe(mode === 'destroyed' ? undefined : false);
    expect(executeJavaScript).toHaveBeenCalledTimes(mode === 'destroyed' ? 0 : 1);
    if (!['destroyed', 'capture-hung'].includes(mode))
      expect(await fs.readFile(path.join(artifacts, 'failure.png'), 'utf8')).toBe('synthetic capture');
    expect(JSON.parse(await fs.readFile(path.join(root, 'result.json'), 'utf8'))).toEqual(report);
  },
);
