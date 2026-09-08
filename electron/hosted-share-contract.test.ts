// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error The separately packaged JavaScript service intentionally has no TypeScript surface.
import { createService } from '../share-service/src/app.js';
import { HostedShareClient } from './hosted-share-client.js';

const temporary: string[] = [];
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

it('uses the real service HTTP contract for creation, lost-response recovery, and revocation', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-contract-data-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-contract-user-'));
  temporary.push(dataDir, userData);
  const service = createService({
    dataDir,
    publicOrigin: 'https://app.imnota.xyz',
    receiptSecret: Buffer.alloc(32, 7).toString('base64url'),
    rateLimits: {
      pairing: { windowMs: 60_000, limit: 100 },
      upload: { windowMs: 60_000, limit: 100 },
      publicRead: { windowMs: 60_000, limit: 100 },
    },
  });
  const server = service.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const localOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;

  try {
    const pair = async (): Promise<string> => {
      const response = await realFetch(`${localOrigin}/api/pairing`, {
        method: 'POST',
        headers: { Origin: 'https://app.imnota.xyz', 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { uploadToken: string }).uploadToken;
    };

    let loseNextUploadResponse = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const requested = new URL(String(input));
        const response = await realFetch(`${localOrigin}${requested.pathname}${requested.search}`, init);
        if (loseNextUploadResponse && requested.pathname === '/api/shares' && init?.method === 'POST') {
          loseNextUploadResponse = false;
          await response.arrayBuffer();
          throw new TypeError('Connection closed after the service committed the upload.');
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }),
    );

    const client = new HostedShareClient(userData, async () => undefined);
    const first = await client.create(
      {
        requestId: '123e4567-e89b-42d3-a456-426614174011',
        pairingToken: '',
        senderName: 'Dylan',
        sessionId: 'final-session',
        bundleNumbers: [1],
        includeArchive: false,
        expiresInDays: 7,
      },
      {
        title: 'Real contract prompt',
        markdown: '# Real contract\r\n\r\nUnicode: café\n',
        images: [{ filename: 'prompt-001.png', dataBase64: pngBase64 }],
        bundles: [
          {
            bundleNumber: 1,
            markdown: '# Real contract\r\n\r\nUnicode: café\n',
            imageFilename: 'prompt-001.png',
          },
        ],
      },
    );
    expect(first).toMatchObject({
      title: 'Real contract prompt',
      url: expect.stringMatching(/^https:\/\/app\.imnota\.xyz\/s\/[A-Za-z0-9_-]{43}$/),
      createdAt: expect.stringMatching(/Z$/),
      byteSize: expect.any(Number),
    });
    const publicPath = new URL(first.url).pathname;
    const bundleMarkdown = await realFetch(`${localOrigin}${publicPath}/bundles/1/markdown`);
    expect(bundleMarkdown.status).toBe(200);
    expect(bundleMarkdown.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(await bundleMarkdown.text()).toBe('# Real contract\r\n\r\nUnicode: café\n');
    expect(await realFetch(`${localOrigin}${publicPath}`).then((response) => response.text())).toContain(
      'Dylan shared this prompt bundle with you',
    );

    loseNextUploadResponse = true;
    await expect(
      client.create(
        {
          requestId: '123e4567-e89b-42d3-a456-426614174012',
          pairingToken: await pair(),
          sessionId: 'final-session',
          bundleNumbers: [2],
          includeArchive: true,
          expiresInDays: 14,
        },
        {
          title: 'Recovered contract prompt',
          markdown: '# Recover me',
          images: [],
        },
      ),
    ).rejects.toMatchObject({ code: 'network-failure' });

    const recovered = await client.list();
    expect(recovered.recoveryErrors).toEqual([]);
    expect(recovered.records.map((record) => record.title)).toEqual([
      'Recovered contract prompt',
      'Real contract prompt',
    ]);

    const revoked = await client.revoke(first.id);
    expect(revoked.revokedAt).toMatch(/Z$/);
    await expect(client.list()).resolves.toMatchObject({
      records: expect.arrayContaining([{ ...first, revokedAt: revoked.revokedAt }]),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error?: Error) => (error ? reject(error) : resolve())),
    );
    service.close();
  }
});
