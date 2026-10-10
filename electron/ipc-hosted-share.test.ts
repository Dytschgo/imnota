// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHost } from './main.js';
import { IpcRouter } from './ipc-router.js';
import { registerHostedShareIpc } from './ipc-hosted-share.js';

// Lets every pending promise continuation run (one macrotask turn) without a timed wait.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

vi.mock('electron', () => ({ nativeImage: {} }));

it('plans granted content without uploading, then uploads only the cached selected part', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const router = new IpcRouter({
    register: (channel, listener) => handlers.set(channel, listener),
    trustedSender: () => true,
    updateInstallPending: () => false,
    contracts: {},
    defaultContract: z.tuple([]),
    tracesChannel: () => false,
    trace: async (_channel, run) => run(),
  });
  const read = vi.fn(async () => ({
    bundleNumber: 1,
    markdown: 'x'.repeat(600_000),
    markdownFilename: 'p.md',
    pngFilename: '',
  }));
  const create = vi.fn(async () => ({ id: 'created' }));
  registerHostedShareIpc(router, {
    promptBundleWorkflow: { read },
    hostedShareClient: { create },
  } as unknown as IpcHost);
  const event = {} as IpcMainInvokeEvent;
  const input = { sessionId: '123e4567-e89b-42d3-a456-426614174001', bundleNumbers: [1] };
  const result = (await handlers.get('workflow:hosted-share:plan')!(event, input)) as {
    ok: true;
    value: { planId: string; parts: unknown[] };
  };
  expect(result.ok).toBe(true);
  expect(result.value.parts).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain('xxxxx');
  expect(create).not.toHaveBeenCalled();
  read.mockRejectedValue(new Error('must use the immutable prepared plan'));
  const request = {
    ...input,
    requestId: '123e4567-e89b-42d3-a456-426614174002',
    pairingToken: '',
    includeArchive: true,
    expiresInDays: 1,
    planId: result.value.planId,
    partIndex: 1,
  };
  expect(await handlers.get('workflow:hosted-share:create')!(event, request)).toMatchObject({ ok: true });
  expect(create.mock.calls[0]).toEqual([
    request,
    expect.objectContaining({ markdown: 'x'.repeat(600_000 - 524_288), images: [] }),
  ]);
  expect(read).toHaveBeenCalledOnce();
  for (const changed of [
    { partIndex: 2 },
    { sessionId: '123e4567-e89b-42d3-a456-426614174003' },
    { bundleNumbers: [2] },
    { planId: '123e4567-e89b-42d3-a456-426614174004' },
  ]) {
    expect(
      await handlers.get('workflow:hosted-share:create')!(event, { ...request, ...changed }),
    ).toMatchObject({ ok: false });
  }
  expect(create).toHaveBeenCalledOnce();
  let finishOlder!: (value: Awaited<ReturnType<typeof read>>) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOlder = resolve;
      }),
  );
  const older = handlers.get('workflow:hosted-share:plan')!(event, input);
  read.mockResolvedValueOnce({
    bundleNumber: 1,
    markdown: 'latest content',
    markdownFilename: 'p.md',
    pngFilename: '',
  });
  const newer = (await handlers.get('workflow:hosted-share:plan')!(event, input)) as typeof result;
  finishOlder({ bundleNumber: 1, markdown: 'obsolete content', markdownFilename: 'p.md', pngFilename: '' });
  expect(await older).toMatchObject({ ok: false });
  expect(
    await handlers.get('workflow:hosted-share:create')!(event, {
      ...request,
      planId: newer.value.planId,
      partIndex: 0,
    }),
  ).toMatchObject({ ok: true });
  expect(create.mock.calls.at(-1)).toEqual([
    expect.anything(),
    expect.objectContaining({ markdown: 'latest content' }),
  ]);
});

function shareHarness() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const router = new IpcRouter({
    register: (channel, listener) => handlers.set(channel, listener),
    trustedSender: () => true,
    updateInstallPending: () => false,
    contracts: { 'recovery:save': z.tuple([]), 'projects:save': z.tuple([]) },
    defaultContract: z.tuple([]),
    tracesChannel: () => false,
    trace: async (_channel, run) => run(),
  });
  const uploads: Array<{ requestId: string; finish(): void }> = [];
  const create = vi.fn(
    (input: { requestId: string }) =>
      new Promise<{ id: string }>((resolve) =>
        uploads.push({ requestId: input.requestId, finish: () => resolve({ id: input.requestId }) }),
      ),
  );
  let finishRevoke!: () => void;
  const revoke = vi.fn(
    (id: string) => new Promise<{ id: string }>((resolve) => (finishRevoke = () => resolve({ id }))),
  );
  const read = vi.fn(async () => ({
    bundleNumber: 1,
    markdown: 'prompt',
    markdownFilename: 'p.md',
    pngFilename: '',
  }));
  registerHostedShareIpc(router, {
    promptBundleWorkflow: { read },
    hostedShareClient: { create, revoke },
  } as unknown as IpcHost);
  const event = {} as IpcMainInvokeEvent;
  return {
    router,
    read,
    create,
    revoke,
    uploads,
    finishRevoke: () => finishRevoke(),
    call: (channel: string, ...args: unknown[]) =>
      Promise.resolve().then(() => handlers.get(channel)!(event, ...args)),
    request: (requestId: string) => ({
      sessionId: '123e4567-e89b-42d3-a456-426614174001',
      bundleNumbers: [1],
      requestId,
      pairingToken: '',
      includeArchive: true,
      expiresInDays: 1,
    }),
  };
}

it('does not hold project or recovery saves behind a pending upload or revocation', async () => {
  const { router, call, create, revoke, uploads, finishRevoke, request } = shareHarness();
  const saved: string[] = [];
  router.handle('projects:save', () => void saved.push('project'));
  router.handle('recovery:save', () => void saved.push('recovery'));

  const upload = call('workflow:hosted-share:create', request('123e4567-e89b-42d3-a456-426614174010'));
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  await call('projects:save');
  await call('recovery:save');
  expect(saved).toEqual(['project', 'recovery']);
  uploads[0].finish();
  expect(await upload).toMatchObject({ ok: true, value: { id: '123e4567-e89b-42d3-a456-426614174010' } });

  const revocation = call('workflow:hosted-share:revoke', { id: 'share' });
  await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('share'));
  await call('recovery:save');
  expect(saved).toEqual(['project', 'recovery', 'recovery']);
  finishRevoke();
  expect(await revocation).toMatchObject({ ok: true, value: { id: 'share' } });
});

it('reads committed artifacts inside the filesystem queue before uploading', async () => {
  const { router, call, create, read, uploads, request } = shareHarness();
  let finishSave: (() => void) | undefined;
  router.handle('projects:save', () => new Promise<void>((resolve) => (finishSave = resolve)));
  const save = call('projects:save');
  await vi.waitFor(() => expect(finishSave).toBeDefined());
  const upload = call('workflow:hosted-share:create', request('123e4567-e89b-42d3-a456-426614174011'));
  await settle();
  expect(read).not.toHaveBeenCalled();
  finishSave!();
  await save;
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(read).toHaveBeenCalledOnce();
  uploads[0].finish();
  expect(await upload).toMatchObject({ ok: true });
});

it('runs a repeated upload only after the earlier attempt settles, and drains accepted share work', async () => {
  const { router, call, create, revoke, uploads, finishRevoke, request } = shareHarness();
  const input = request('123e4567-e89b-42d3-a456-426614174012');
  const first = call('workflow:hosted-share:create', input);
  const repeated = call('workflow:hosted-share:create', input);
  const revocation = call('workflow:hosted-share:revoke', { id: 'share' });
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  await settle();
  expect(create).toHaveBeenCalledOnce();
  expect(revoke).not.toHaveBeenCalled();

  // An update install still waits for accepted share work, as it did inside the queue.
  let drained = false;
  const drain = router.drain().then(() => (drained = true));
  uploads[0].finish();
  expect(await first).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(drained).toBe(false);
  uploads[1].finish();
  expect(await repeated).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(revoke).toHaveBeenCalledOnce());
  expect(drained).toBe(false);
  finishRevoke();
  expect(await revocation).toMatchObject({ ok: true });
  await drain;
  expect(drained).toBe(true);
});
