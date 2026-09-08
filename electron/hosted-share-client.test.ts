// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostedShareUpload } from '../src/shared/workflow-bridge.js';
import { HostedShareClient, type HostedShareFetch } from './hosted-share-client.js';

const roots: string[] = [];
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const firstRequest = '123e4567-e89b-42d3-a456-426614174001';
const secondRequest = '123e4567-e89b-42d3-a456-426614174002';
const firstShare = '9f1b0640-dd1d-4db2-8b0f-7e1238385071';
const secondShare = '9f1b0640-dd1d-4db2-8b0f-7e1238385072';

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.unstubAllGlobals();
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-'));
  roots.push(root);
  return { root, client: new HostedShareClient(root, async () => undefined) };
}

function upload(requestId = firstRequest): HostedShareUpload {
  return {
    requestId,
    pairingToken: requestId === firstRequest ? 'a'.repeat(43) : 'b'.repeat(43),
    sessionId: 'final-session',
    bundleNumbers: [1],
    includeArchive: true,
    expiresInDays: 30,
  };
}

function artifacts() {
  return {
    title: 'Prompt',
    markdown: '# prompt',
    images: [{ filename: 'prompt-001.png', dataBase64: pngBase64 }],
  };
}

function receipt(requestId = firstRequest) {
  const second = requestId === secondRequest;
  return {
    id: second ? secondShare : firstShare,
    url: `https://app.imnota.xyz/s/${second ? 'b' : 'a'}${'c'.repeat(42)}`,
    title: second ? 'Second prompt' : 'Prompt',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-31T00:00:00.000Z',
    managementToken: (second ? 'd' : 'm').repeat(43),
    byteSize: 128,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function seedHistory(root: string): Promise<void> {
  await fs.writeFile(path.join(root, 'hosted-shares.json'), JSON.stringify([receipt()]));
}

describe('HostedShareClient request boundary', () => {
  it('rejects malformed pairing codes and non-PNG artifacts before any network request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { client } = await fixture();
    await expect(client.create({ ...upload(), pairingToken: 'short' }, artifacts())).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(
      client.create(upload(), {
        ...artifacts(),
        images: [{ filename: 'prompt-001.png', dataBase64: Buffer.from('not png').toString('base64') }],
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the UUID request contract with pairing bearer and rendered base64 PNG', async () => {
    const fetch = vi.fn().mockResolvedValue(json(receipt(), 201));
    vi.stubGlobal('fetch', fetch);
    const { client } = await fixture();
    await client.create(upload(), artifacts());

    const [target, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(target).toBe('https://app.imnota.xyz/api/shares');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${'a'.repeat(43)}`, 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      requestId: firstRequest,
      title: 'Prompt',
      markdown: '# prompt',
      images: [{ filename: 'prompt-001.png', dataBase64: pngBase64 }],
      includeArchive: true,
      expiresInDays: 30,
    });
  });

  it('mints and persists an automatic pairing capability before uploading', async () => {
    const { root } = await fixture();
    const transport = vi.fn<HostedShareFetch>(async (target) =>
      target.endsWith('/api/pairing')
        ? json({ uploadToken: 'z'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' }, 201)
        : json(receipt(), 201),
    );
    const client = new HostedShareClient(root, async () => undefined, transport);
    await client.create({ ...upload(), pairingToken: '' }, artifacts());

    expect(transport.mock.calls.map(([target]) => target)).toEqual([
      'https://app.imnota.xyz/api/pairing',
      'https://app.imnota.xyz/api/shares',
    ]);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { Origin: 'https://app.imnota.xyz', 'Content-Type': 'application/json' },
    });
    expect((transport.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${'z'.repeat(43)}`,
    });
  });

  it('does not persist a pending upload when automatic pairing fails', async () => {
    const { root } = await fixture();
    const client = new HostedShareClient(
      root,
      async () => undefined,
      vi.fn(async () => json({}, 503)),
    );
    await expect(client.create({ ...upload(), pairingToken: '' }, artifacts())).rejects.toMatchObject({
      code: 'network-failure',
    });
    await expect(fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reuses a minted pairing capability after a lost upload response', async () => {
    const { root } = await fixture();
    let uploadAttempts = 0;
    const transport = vi.fn<HostedShareFetch>(async (target) => {
      if (target.endsWith('/api/pairing'))
        return json({ uploadToken: 'z'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' }, 201);
      uploadAttempts += 1;
      if (uploadAttempts === 1) throw new TypeError('lost response');
      return json(receipt(), 201);
    });
    const initial = new HostedShareClient(root, async () => undefined, transport);
    await expect(initial.create({ ...upload(), pairingToken: '' }, artifacts())).rejects.toMatchObject({
      code: 'network-failure',
    });
    await expect(
      new HostedShareClient(root, async () => undefined, transport).create(
        { ...upload(), pairingToken: '' },
        artifacts(),
      ),
    ).resolves.toMatchObject({ id: firstShare });
    expect(transport.mock.calls.filter(([target]) => target.endsWith('/api/pairing'))).toHaveLength(1);
  });

  it('sends normalized sender and structured bundle metadata only when supplied', async () => {
    const fetch = vi.fn().mockResolvedValue(json(receipt(), 201));
    vi.stubGlobal('fetch', fetch);
    await (
      await fixture()
    ).client.create(
      { ...upload(), senderName: '  Zoë  ' },
      {
        ...artifacts(),
        bundles: [{ bundleNumber: 1, markdown: '# prompt', imageFilename: 'prompt-001.png' }],
      },
    );
    expect(JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      senderName: 'Zoë',
      bundles: [{ bundleNumber: 1, markdown: '# prompt', imageFilename: 'prompt-001.png' }],
    });
  });

  it('accepts multiline Unicode structured Markdown with automatic pairing', async () => {
    const transport = vi.fn<HostedShareFetch>(async (target) =>
      target.endsWith('/api/pairing')
        ? json({ uploadToken: 'z'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' }, 201)
        : json(receipt(), 201),
    );
    const { root } = await fixture();
    const markdown = '# Grüezi\r\n\r\n\t– multilingual prompt\n\n```txt\n😀\n```';
    await new HostedShareClient(root, async () => undefined, transport).create(
      { ...upload(), pairingToken: '' },
      {
        ...artifacts(),
        markdown,
        bundles: [{ bundleNumber: 1, markdown, imageFilename: 'prompt-001.png' }],
      },
    );
    expect(JSON.parse(String((transport.mock.calls[1]?.[1] as RequestInit).body)).bundles[0].markdown).toBe(
      markdown,
    );
  });

  it('uses the injected transport for upload, receipt recovery, and revocation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-transport-'));
    roots.push(root);
    const transport = vi.fn<HostedShareFetch>(async (target) => {
      if (target.includes('/receipt/')) return json(receipt(secondRequest));
      if (target.endsWith('/revoke')) return json({ revokedAt: '2026-01-02T00:00:00.000Z' });
      return json(receipt(), 201);
    });
    const client = new HostedShareClient(root, async () => undefined, transport);

    await client.create(upload(), artifacts());
    await fs.writeFile(
      path.join(root, 'hosted-share-pending.json'),
      JSON.stringify({ [secondRequest]: { requestId: secondRequest, pairingToken: 'b'.repeat(43) } }),
    );
    await client.list();
    await client.revoke(firstShare);

    expect(transport.mock.calls.map(([target]) => target)).toEqual([
      'https://app.imnota.xyz/api/shares',
      `https://app.imnota.xyz/api/shares/receipt/${secondRequest}`,
      `https://app.imnota.xyz/api/shares/${firstShare}/revoke`,
    ]);
    expect(transport.mock.calls.map(([, init]) => (init as RequestInit).redirect)).toEqual([
      'error',
      'error',
      'error',
    ]);
  });

  it.each([
    ['CERT_HAS_EXPIRED', 'TLS certificate'],
    ['ERR_PROXY_CONNECTION_FAILED', 'network proxy'],
    ['ENOTFOUND', 'hostname could not be resolved'],
    ['ERR_INTERNET_DISCONNECTED', 'appears to be offline'],
    ['ECONNRESET', 'connection to the share service was interrupted'],
  ])(
    'reports a safe %s transport diagnostic without exposing the underlying error',
    async (code, expected) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-diagnostic-'));
      roots.push(root);
      const secret = 'https://private.invalid/path?token=do-not-expose';
      const transport = vi.fn(async () => {
        throw Object.assign(new Error(`transport failed for ${secret}`), { code });
      });
      const client = new HostedShareClient(root, async () => undefined, transport);

      const error = await client.create(upload(), artifacts()).catch((failure: unknown) => failure);

      expect(error).toMatchObject({ code: 'network-failure', retryable: true });
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain('do-not-expose');
    },
  );

  it('classifies Chromium message codes and nested Node errors without exposing either message', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-diagnostic-'));
    roots.push(root);
    const secret = 'https://private.invalid/path?token=do-not-expose';
    const chromium = new HostedShareClient(
      root,
      async () => undefined,
      vi.fn(async () => {
        throw new Error(`net::ERR_CERT_AUTHORITY_INVALID ${secret}`);
      }),
    );
    const nested = new HostedShareClient(
      root,
      async () => undefined,
      vi.fn(async () => {
        throw Object.assign(new Error(`outer failure ${secret}`), {
          cause: Object.assign(new Error(`inner failure ${secret}`), { code: 'ENOTFOUND' }),
        });
      }),
    );
    const unknown = new HostedShareClient(
      root,
      async () => undefined,
      vi.fn(async () => {
        throw new Error(`unrecognized failure ${secret}`);
      }),
    );

    const chromiumError = await chromium.create(upload(), artifacts()).catch((failure: unknown) => failure);
    const nestedError = await nested
      .create(upload(secondRequest), artifacts())
      .catch((failure: unknown) => failure);
    const unknownError = await unknown
      .create(upload('123e4567-e89b-42d3-a456-426614174003'), artifacts())
      .catch((failure: unknown) => failure);

    expect(chromiumError).toMatchObject({ message: expect.stringMatching(/TLS certificate/i) });
    expect(nestedError).toMatchObject({ message: expect.stringMatching(/hostname could not be resolved/i) });
    expect(unknownError).toMatchObject({
      message: 'Could not reach the share service. Your local exports remain available.',
    });
    for (const error of [chromiumError, nestedError, unknownError])
      expect((error as Error).message).not.toContain(secret);
  });

  it('reports local persistence failures without sending an upload', async () => {
    const { root } = await fixture();
    const transport = vi.fn();
    const guarded = new HostedShareClient(root, async () => undefined, transport);
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk /private/path token=secret'));

    await expect(guarded.create(upload(), artifacts())).rejects.toMatchObject({
      code: 'io-failure',
      message: expect.stringMatching(/save local hosted-share data/i),
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not mark a failed pending recovery read as safe to retry', async () => {
    const { root } = await fixture();
    const pendingFile = path.join(root, 'hosted-share-pending.json');
    await fs.writeFile(pendingFile, '{broken');
    const transport = vi.fn<HostedShareFetch>();
    const error = await new HostedShareClient(root, async () => undefined, transport)
      .create(upload(), artifacts())
      .catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: 'io-failure' });
    expect((error as { details?: Record<string, unknown> }).details?.requestMayHaveCommitted).not.toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(await fs.readFile(pendingFile, 'utf8')).toBe('{broken');
  });

  it('preserves pending recovery metadata when local history is saved but pending cleanup fails', async () => {
    const { root } = await fixture();
    const transport = vi.fn().mockResolvedValue(json(receipt(), 201));
    const client = new HostedShareClient(root, async () => undefined, transport);
    const rename = fs.rename.bind(fs);
    let pendingWrites = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('hosted-share-pending.json') && ++pendingWrites === 2)
        throw new Error('disk /private/path token=secret');
      await rename(from, to);
    });

    await expect(client.create(upload(), artifacts())).rejects.toMatchObject({
      code: 'io-failure',
      message: expect.stringMatching(/save local hosted-share data/i),
    });
    const pending = JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'));
    expect(pending).toHaveProperty(firstRequest);
    expect(JSON.parse(await fs.readFile(path.join(root, 'hosted-shares.json'), 'utf8'))).toEqual([
      expect.objectContaining({ id: firstShare }),
    ]);
  });

  it.each([
    [{ ...receipt(), id: 'share-a' }, 'identifier'],
    [{ ...receipt(), url: 'https://evil.test/s/abcdefghijklmnopqrstuv' }, 'share URL'],
    [{ ...receipt(), url: `${receipt().url}?leak=1` }, 'share URL'],
    [{ ...receipt(), url: `${receipt().url}#fragment` }, 'share URL'],
    [{ ...receipt(), url: receipt().url.replace('app.imnota.xyz', 'app.imnota.xyz:443') }, 'share URL'],
    [{ ...receipt(), url: receipt().url.replace('https://', 'https://user:pass@') }, 'share URL'],
    [{ ...receipt(), title: 'unsafe\ntitle' }, 'title'],
    [{ ...receipt(), expiresAt: 'tomorrow' }, 'expiration'],
    [{ ...receipt(), expiresAt: receipt().createdAt }, 'expiration'],
    [{ ...receipt(), managementToken: 'short' }, 'management capability'],
    [{ ...receipt(), byteSize: '128' }, 'share size'],
    [{ ...receipt(), byteSize: 52 * 1024 * 1024 }, 'share size'],
  ])('rejects a malformed successful receipt field: %s', async (body, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body, 201)));
    await expect((await fixture()).client.create(upload(), artifacts())).rejects.toThrow(expected);
  });

  it('rejects invalid JSON and streamed responses beyond the bounded parser limit', async () => {
    const { client } = await fixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken', { status: 201 })));
    await expect(client.create(upload(), artifacts())).rejects.toThrow(/invalid JSON/);

    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40_000));
        controller.enqueue(new Uint8Array(40_000));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(oversized, { status: 201 })));
    await expect(client.create(upload(secondRequest), artifacts())).rejects.toThrow(/oversized response/);
  });

  it('rejects a redirected private response even if a fetch mock follows it', async () => {
    const response = json(receipt(), 201);
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: 'https://app.imnota.xyz/login?next=%2Fapi%2Fshares' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect((await fixture()).client.create(upload(), artifacts())).rejects.toThrow(/redirected/);
  });

  it('maps quota rejection without persisting a successful history record', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: 'quota_exceeded', message: 'Storage quota is full.' } }, 507),
        ),
    );
    const { root, client } = await fixture();
    await expect(client.create(upload(), artifacts())).rejects.toMatchObject({
      code: 'upload-rejected',
      message: 'Storage quota is full.',
      retryable: false,
      details: { requestMayHaveCommitted: false },
    });
    expect((await client.list()).records).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'))).toEqual({});
  });

  it('clears pending capability on a definitive rejection even when its error body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken', { status: 413 })));
    const { root, client } = await fixture();

    await expect(client.create(upload(), artifacts())).rejects.toMatchObject({
      code: 'upload-rejected',
      details: { requestMayHaveCommitted: false },
    });
    expect(JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'))).toEqual({});
  });

  it('accepts bounded archive overhead in the stored receipt size', async () => {
    const archived = { ...receipt(), byteSize: 50 * 1024 * 1024 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(archived, 201)));
    await expect((await fixture()).client.create(upload(), artifacts())).resolves.toMatchObject({
      id: firstShare,
      byteSize: 50 * 1024 * 1024,
    });
  });

  it('aborts the upload body deadline and reports a retryable timeout rather than cancellation', async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => (started = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_target: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            started();
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const operation = (await fixture()).client.create(upload(), artifacts());
    const settled = operation.then(
      () => undefined,
      (error: unknown) => error,
    );
    await requestStarted;
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(settled).resolves.toMatchObject({
      code: 'network-failure',
      retryable: true,
      message: expect.stringMatching(/within 60 seconds/),
    });
  });
});

describe('HostedShareClient persistence and recovery', () => {
  it('serializes concurrent uploads without losing pending capabilities or final history', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn(async (_target: string, init: RequestInit) => {
      await held;
      const requestId = JSON.parse(String(init.body)).requestId as string;
      return json(receipt(requestId), 201);
    });
    vi.stubGlobal('fetch', fetch);
    const { root, client } = await fixture();
    const first = client.create(upload(firstRequest), artifacts());
    const second = client.create(upload(secondRequest), { ...artifacts(), title: 'Second prompt' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const pending = JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'));
    expect(Object.keys(pending).sort()).toEqual([firstRequest, secondRequest]);
    release();
    await Promise.all([first, second]);
    const listed = await client.list();
    expect(listed.records.map((record) => record.id).sort()).toEqual([firstShare, secondShare]);
    expect(JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'))).toEqual({});
  });

  it('recovers multiple lost upload responses with each original pairing bearer', async () => {
    const { root } = await fixture();
    await fs.writeFile(
      path.join(root, 'hosted-share-pending.json'),
      JSON.stringify({
        [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) },
        [secondRequest]: { requestId: secondRequest, pairingToken: 'b'.repeat(43) },
      }),
    );
    const seenHeaders: (HeadersInit | undefined)[] = [];
    const fetch = vi.fn(async (target: string, init?: RequestInit) => {
      seenHeaders.push(init?.headers);
      return json(receipt(target.includes(secondRequest) ? secondRequest : firstRequest));
    });
    vi.stubGlobal('fetch', fetch);
    const client = new HostedShareClient(root, async () => undefined);
    const [result, concurrentResult] = await Promise.all([client.list(), client.list()]);

    expect(result.records).toHaveLength(2);
    expect(concurrentResult).toEqual(result);
    expect(result.recoveryErrors).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(seenHeaders).toEqual([
      { Authorization: `Bearer ${'a'.repeat(43)}`, Accept: 'application/json' },
      { Authorization: `Bearer ${'b'.repeat(43)}`, Accept: 'application/json' },
    ]);
  });

  it('retains cancellation recovery metadata and later recovers its committed receipt', async () => {
    const { root, client } = await fixture();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => (started = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_target: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            started();
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const operation = client.create(upload(), artifacts());
    await requestStarted;
    await client.cancel(firstRequest);
    await expect(operation).rejects.toMatchObject({ code: 'session-cancelled' });
    expect(
      JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8')),
    ).toHaveProperty(firstRequest);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...receipt(), recovered: true })));
    await expect(client.list()).resolves.toMatchObject({ records: [{ id: firstShare }], recoveryErrors: [] });
  });

  it('keeps the original capability when a lost response is retried with a changed pairing code', async () => {
    const { root, client } = await fixture();
    const fetch = vi.fn().mockRejectedValue(new TypeError('connection closed after upload'));
    vi.stubGlobal('fetch', fetch);

    await expect(client.create(upload(), artifacts())).rejects.toMatchObject({
      code: 'network-failure',
      retryable: true,
    });
    const original = JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'))[
      firstRequest
    ];

    await expect(
      client.create({ ...upload(), pairingToken: 'z'.repeat(43) }, artifacts()),
    ).rejects.toMatchObject({
      code: 'invalid-input',
      message: expect.stringMatching(/unresolved upload.*original pairing code.*Recover/i),
    });

    expect(fetch).toHaveBeenCalledOnce();
    const preserved = JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'))[
      firstRequest
    ];
    expect(preserved).toEqual(original);
    expect(preserved.pairingToken).toBe('a'.repeat(43));
    expect(preserved.payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(preserved.deadlineAt) - Date.parse(preserved.createdAt)).toBe(24 * 60 * 60 * 1000);
  });

  it('does not race receipt recovery against an active upload', async () => {
    const { client } = await fixture();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => (started = resolve));
    const fetch = vi.fn(
      (_target: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          started();
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const uploadOperation = client.create(upload(), artifacts());
    const settled = uploadOperation.catch((error: unknown) => error);
    await requestStarted;

    await expect(client.list()).resolves.toMatchObject({ records: [], recoveryErrors: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.cancel(firstRequest);
    await expect(settled).resolves.toMatchObject({ code: 'session-cancelled' });
  });

  it('surfaces expired and failed recovery independently while preserving existing history', async () => {
    const { root, client } = await fixture();
    await seedHistory(root);
    await fs.writeFile(
      path.join(root, 'hosted-share-pending.json'),
      JSON.stringify({
        [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) },
        [secondRequest]: { requestId: secondRequest, pairingToken: 'b'.repeat(43) },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string) =>
        target.includes(firstRequest)
          ? json({ error: { code: 'recovery_expired', message: 'Expired.' } }, 410)
          : json({ error: { code: 'service_unavailable', message: 'Recovery is unavailable.' } }, 503),
      ),
    );

    const result = await client.list();
    expect(result.records.map((record) => record.id)).toEqual([firstShare]);
    expect(result.recoveryErrors).toEqual([
      'A previous share upload could not be recovered because its receipt expired.',
      'Recovery is unavailable.',
    ]);
    const pending = JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'));
    expect(pending).not.toHaveProperty(firstRequest);
    expect(pending).toHaveProperty(secondRequest);
  });

  it('expires legacy recovery capabilities after 24 hours without contacting the service', async () => {
    const { root, client } = await fixture();
    const pendingFile = path.join(root, 'hosted-share-pending.json');
    await fs.writeFile(
      pendingFile,
      JSON.stringify({
        [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) },
      }),
    );
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(pendingFile, old, old);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const result = await client.list();

    expect(fetch).not.toHaveBeenCalled();
    expect(result.records).toEqual([]);
    expect(result.recoveryErrors).toEqual([
      'A previous share upload was not resolved within 24 hours. Its local recovery capability was cleared.',
    ]);
    expect(JSON.parse(await fs.readFile(pendingFile, 'utf8'))).toEqual({});
  });

  it('retains a receipt 404 and later recovers it with the original request and bearer', async () => {
    const { root, client } = await fixture();
    const pendingFile = path.join(root, 'hosted-share-pending.json');
    await fs.writeFile(
      pendingFile,
      JSON.stringify({
        [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) },
      }),
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 'receipt_not_found', message: 'Not ready.' } }, 404))
      .mockResolvedValueOnce(json({ ...receipt(), recovered: true }));
    vi.stubGlobal('fetch', fetch);

    await expect(client.list()).resolves.toMatchObject({
      records: [],
      recoveryErrors: ['A previous share receipt is not ready yet. Recovery will retry later.'],
    });
    const retained = JSON.parse(await fs.readFile(pendingFile, 'utf8'));
    expect(Object.keys(retained)).toEqual([firstRequest]);
    expect(retained[firstRequest].pairingToken).toBe('a'.repeat(43));

    await expect(client.list()).resolves.toMatchObject({
      records: [{ id: firstShare }],
      recoveryErrors: [],
    });
    expect(JSON.parse(await fs.readFile(pendingFile, 'utf8'))).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      `https://app.imnota.xyz/api/shares/receipt/${firstRequest}`,
      `https://app.imnota.xyz/api/shares/receipt/${firstRequest}`,
    ]);
    expect(fetch.mock.calls.map((call) => (call[1] as RequestInit).headers)).toEqual([
      { Authorization: `Bearer ${'a'.repeat(43)}`, Accept: 'application/json' },
      { Authorization: `Bearer ${'a'.repeat(43)}`, Accept: 'application/json' },
    ]);
  });

  it('clears a definitive receipt rejection while retaining an in-progress request', async () => {
    const { root, client } = await fixture();
    await fs.writeFile(
      path.join(root, 'hosted-share-pending.json'),
      JSON.stringify({
        [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) },
        [secondRequest]: { requestId: secondRequest, pairingToken: 'b'.repeat(43) },
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string) => {
        if (target.includes(firstRequest))
          return json({ error: { code: 'invalid_pairing', message: 'Pairing rejected.' } }, 401);
        return json({ error: { code: 'upload_in_progress', message: 'Upload still running.' } }, 409);
      }),
    );

    const result = await client.list();

    expect(result.recoveryErrors).toEqual([
      'This pairing code expired or was already used. Create a new code in your browser. Its local recovery capability was cleared.',
      'Upload still running.',
    ]);
    const pending = JSON.parse(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8'));
    expect(pending).not.toHaveProperty(firstRequest);
    expect(pending).toHaveProperty(secondRequest);
  });

  it('persists dismissal for a recovery incident without changing its capability or local history', async () => {
    const { root, client } = await fixture();
    const pendingFile = path.join(root, 'hosted-share-pending.json');
    await fs.writeFile(
      pendingFile,
      JSON.stringify({ [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) } }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ error: { code: 'service_unavailable', message: 'Recovery is unavailable.' } }, 503),
      ),
    );

    const initial = await client.list();
    const warning = initial.recoveryWarnings?.[0];
    expect(warning).toMatchObject({
      id: expect.stringMatching(/^recovery:[a-f0-9]{64}$/),
      message: 'Recovery is unavailable.',
    });
    const pendingBeforeDismissal = await fs.readFile(pendingFile, 'utf8');

    await client.dismissRecoveryWarning(warning!.id);
    expect(await fs.readFile(pendingFile, 'utf8')).toBe(pendingBeforeDismissal);
    await expect(fs.readFile(path.join(root, 'hosted-shares.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await expect(client.list()).resolves.toMatchObject({ recoveryErrors: [], recoveryWarnings: [] });
    const reopened = new HostedShareClient(root, async () => undefined);
    await expect(reopened.list()).resolves.toMatchObject({ recoveryErrors: [], recoveryWarnings: [] });

    const pending = JSON.parse(await fs.readFile(pendingFile, 'utf8'));
    pending[secondRequest] = { requestId: secondRequest, pairingToken: 'b'.repeat(43) };
    await fs.writeFile(pendingFile, JSON.stringify(pending));

    const later = await reopened.list();
    expect(later.recoveryWarnings).toHaveLength(1);
    expect(later.recoveryWarnings?.[0]).toMatchObject({ message: 'Recovery is unavailable.' });
    expect(later.recoveryWarnings?.[0]?.id).not.toBe(warning!.id);
  });

  it('rejects a stale warning ID after recovery reports a later error episode', async () => {
    const { root, client } = await fixture();
    await fs.writeFile(
      path.join(root, 'hosted-share-pending.json'),
      JSON.stringify({ [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) } }),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ error: { code: 'service_unavailable', message: 'First recovery error.' } }, 503),
        )
        .mockResolvedValueOnce(
          json({ error: { code: 'service_unavailable', message: 'Later recovery error.' } }, 503),
        ),
    );

    const initial = await client.list();
    const later = await client.list();
    expect(later.recoveryWarnings?.[0]?.id).not.toBe(initial.recoveryWarnings?.[0]?.id);
    await expect(client.dismissRecoveryWarning(initial.recoveryWarnings![0]!.id)).rejects.toMatchObject({
      code: 'invalid-input',
      message: expect.stringMatching(/no longer available/i),
    });
  });

  it('preserves corrupt local files and reports actionable history and recovery errors', async () => {
    const { root, client } = await fixture();
    const corruptHistory = '[{"id":"partial"}]';
    await fs.writeFile(path.join(root, 'hosted-shares.json'), corruptHistory);
    await expect(client.list()).rejects.toThrow(/history is corrupt.*preserved/i);
    expect(await fs.readFile(path.join(root, 'hosted-shares.json'), 'utf8')).toBe(corruptHistory);

    await seedHistory(root);
    const corruptPending = '{broken';
    await fs.writeFile(path.join(root, 'hosted-share-pending.json'), corruptPending);
    await expect(client.list()).resolves.toMatchObject({
      records: [{ id: firstShare }],
      recoveryErrors: [expect.stringMatching(/recovery metadata is corrupt.*preserved/i)],
    });
    expect(await fs.readFile(path.join(root, 'hosted-share-pending.json'), 'utf8')).toBe(corruptPending);
  });

  it('bounds receipt recovery and revoke routes independently', async () => {
    vi.useFakeTimers();
    const { root, client } = await fixture();
    await seedHistory(root);
    await fs.writeFile(
      path.join(root, 'hosted-share-pending.json'),
      JSON.stringify({ [firstRequest]: { requestId: firstRequest, pairingToken: 'a'.repeat(43) } }),
    );
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_target: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            calls++;
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const listing = client.list();
    await vi.waitFor(() => expect(calls).toBe(1));
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(listing).resolves.toMatchObject({
      records: [{ id: firstShare }],
      recoveryErrors: [expect.stringMatching(/15 seconds/)],
    });

    const revoking = client.revoke(firstShare).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(calls).toBe(2));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(revoking).resolves.toMatchObject({ message: expect.stringMatching(/30 seconds/) });
  });
});
