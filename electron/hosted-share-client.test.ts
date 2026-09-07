import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostedShareClient } from './hosted-share-client.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.unstubAllGlobals();
});

async function client() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-'));
  roots.push(root);
  return new HostedShareClient(root, async () => undefined);
}

describe('HostedShareClient', () => {
  it('rejects malformed pairing codes before any network request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      (await client()).create(
        {
          requestId: '123e4567-e89b-42d3-a456-426614174000',
          pairingToken: 'short',
          sessionId: 'session',
          bundleNumbers: [1],
          includeArchive: true,
          expiresInDays: 30,
        },
        { title: 'Prompt', markdown: '# prompt', images: [] },
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('persists only local management metadata after a successful rendered-artifact upload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'share-a',
            url: 'https://app.imnota.xyz/s/abcdefghijklmnop',
            title: 'Prompt',
            createdAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-01-31T00:00:00.000Z',
            managementToken: 'manage-secret',
            byteSize: 12,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const instance = await client();
    const share = await instance.create(
      {
        requestId: '123e4567-e89b-42d3-a456-426614174001',
        pairingToken: 'a'.repeat(43),
        sessionId: 'session',
        bundleNumbers: [1],
        includeArchive: true,
        expiresInDays: 30,
      },
      { title: 'Prompt', markdown: '# prompt', images: [{ filename: 'prompt-001.png', dataBase64: 'YWJj' }] },
    );
    expect(share.url).toBe('https://app.imnota.xyz/s/abcdefghijklmnop');
    expect(await instance.list()).toEqual([share]);
  });
});
