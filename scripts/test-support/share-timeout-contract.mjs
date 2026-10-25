// Minimal real HTTP/SQLite upload for the child timeout control. Large Unicode
// split uploads retain their separate contract test; they are not a teardown clock.
import { afterEach, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { createService } from '../../share-service/src/app.js';
import { HostedShareClient } from '../../electron/hosted-share-client.js';
import { ShareFixture, ownShareDatabase } from './share-fixture.mjs';

vi.mock('node:sqlite', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    DatabaseSync: class extends original.DatabaseSync {
      constructor(...args) {
        super(...args);
        ownShareDatabase(this);
      }
    },
  };
});

const fixture = new ShareFixture();
it('settles a real upload after the test timeout', () =>
  fixture.run(async () => {
    const dataDir = await fixture.directory('imnota-share-split-data-');
    const userData = await fixture.directory('imnota-share-split-user-');
    const origin = await fixture.start(createService, {
      dataDir,
      publicOrigin: 'https://app.imnota.xyz',
      receiptSecret: Buffer.alloc(32, 7).toString('base64url'),
    });
    const transport = async (target, init) => {
      const url = new URL(target);
      const response = await globalThis.fetch(origin + url.pathname, init);
      return new globalThis.Response(response.body, { status: response.status, headers: response.headers });
    };
    const client = new HostedShareClient(userData, async () => undefined, transport);
    const record = await client.create(
      {
        requestId: '123e4567-e89b-42d3-a456-426614174011',
        pairingToken: '',
        sessionId: 'timeout-control',
        bundleNumbers: [1],
        includeArchive: true,
        expiresInDays: 1,
      },
      { title: 'Timeout control', markdown: '# Real upload', images: [] },
    );
    const response = await globalThis.fetch(origin + new URL(record.url).pathname + '/markdown');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# Real upload');
    expect((await client.list()).records).toHaveLength(1);
  }));

afterEach(() => fixture.teardown());
