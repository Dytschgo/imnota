// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error The separately packaged JavaScript service intentionally has no TypeScript surface.
import { createService } from '../share-service/src/app.js';
// @ts-expect-error The browser copy script is plain JavaScript served by the share service.
import { clipboardContextHtml as browserClipboardHtml } from '../share-service/public/share-copy.js';
import { clipboardContextHtml } from '../src/shared/clipboard-context.js';
import { HostedShareClient } from './hosted-share-client.js';
import { planHostedShares } from './hosted-share-plan.js';
import { randomUUID } from 'node:crypto';

// @ts-expect-error Test-only Node fixture helper has no production TypeScript surface.
import { ShareFixture, ownShareDatabase } from '../scripts/test-support/share-fixture.mjs';

vi.mock('node:sqlite', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:sqlite')>();
  return {
    ...original,
    DatabaseSync: class extends original.DatabaseSync {
      constructor(...args: ConstructorParameters<typeof original.DatabaseSync>) {
        super(...args);
        ownShareDatabase(this);
      }
    },
  };
});

let activeFixture: ShareFixture | undefined;
let retainedFixture = false;
const withFixture = (body: (fixture: ShareFixture) => Promise<void>) => () => {
  if (retainedFixture) throw new Error('Previous share fixture was retained after teardown failure');
  const fixture = new ShareFixture();
  activeFixture = fixture;
  return fixture.run(() => body(fixture));
};
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

it(
  'publishes and downloads every byte of oversized Unicode Markdown through split links',
  withFixture(async (fixture) => {
    const dataDir = await fixture.directory('imnota-share-split-data-');
    const userData = await fixture.directory('imnota-share-split-user-');
    const origin = await fixture.start(createService, {
      dataDir,
      publicOrigin: 'https://app.imnota.xyz',
      receiptSecret: Buffer.alloc(32, 7).toString('base64url'),
    });
    const transport = async (target: string, init: RequestInit) => {
      const url = new URL(target);
      const response = await fetch(origin + url.pathname, init);
      return new Response(response.body, { status: response.status, headers: response.headers });
    };
    const client = new HostedShareClient(userData, async () => undefined, transport);
    const markdown = '# Large collection\n' + '🙂 Grüezi\n'.repeat(65_000);
    const parts = await planHostedShares(
      {
        read: async () => ({
          bundleNumber: 1,
          markdown,
          markdownFilename: 'p.md',
          pngFilename: 'p.png',
          imageDataUrl: `data:image/png;base64,${pngBase64}`,
        }),
      },
      'final-session',
      [1],
      () => ({ width: 1, height: 1, dataBase64: pngBase64 }),
    );
    expect(parts.length).toBeGreaterThan(1);
    const downloads: string[] = [];
    for (const part of parts) {
      const record = await client.create(
        {
          requestId: randomUUID(),
          pairingToken: '',
          sessionId: 'final-session',
          bundleNumbers: [1],
          includeArchive: true,
          expiresInDays: 1,
        },
        part,
      );
      const response = await fetch(origin + new URL(record.url).pathname + '/markdown');
      expect(response.status).toBe(200);
      downloads.push(await response.text());
    }
    expect(downloads.join('')).toBe(markdown);
    expect((await client.list()).records).toHaveLength(parts.length);
  }),
);

afterEach(async () => {
  const fixture = activeFixture;
  activeFixture = undefined;
  try {
    if (fixture) await fixture.teardown();
  } catch (error) {
    retainedFixture = true;
    throw error;
  } finally {
    // Do not change transport globals underneath a body still using them.
    if (!retainedFixture || fixture?.bodySettled) vi.unstubAllGlobals();
  }
});

it(
  'uses the real service HTTP contract for creation, lost-response recovery, and revocation',
  withFixture(async (fixture) => {
    const dataDir = await fixture.directory('imnota-share-contract-data-');
    const userData = await fixture.directory('imnota-share-contract-user-');
    const localOrigin = await fixture.start(createService, {
      dataDir,
      publicOrigin: 'https://app.imnota.xyz',
      receiptSecret: Buffer.alloc(32, 7).toString('base64url'),
      rateLimits: {
        pairing: { windowMs: 60_000, limit: 100 },
        upload: { windowMs: 60_000, limit: 100 },
        publicRead: { windowMs: 60_000, limit: 100 },
      },
    });
    const realFetch = globalThis.fetch;

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
      '<strong>Dylan</strong> shared this prompt bundle with you',
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
  }),
);

it('places the same HTML representation on the clipboard as the desktop Rich copy', () => {
  const markdown = `# Prompt <b>&</b>\r\n\r\n"quoted" 'single' café 🙂\n`;
  expect(browserClipboardHtml(markdown)).toBe(clipboardContextHtml(markdown));
});

// Test-only lifecycle controls run in this separate service suite.
import '../scripts/test-support/share-fixture-regressions.mjs';
