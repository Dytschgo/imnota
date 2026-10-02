// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHost } from './main.js';
import { IpcRouter } from './ipc-router.js';
import { registerHostedShareIpc } from './ipc-hosted-share.js';

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
