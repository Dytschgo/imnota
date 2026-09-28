// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IpcRouter, type IpcRouterOptions } from './ipc-router.js';

const trusted = { trusted: true } as unknown as IpcMainInvokeEvent;
const untrusted = { trusted: false } as unknown as IpcMainInvokeEvent;

function setup(overrides: Partial<IpcRouterOptions> = {}) {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  let updatePending = false;
  const trace = vi.fn(async (_channel: string, run: () => unknown) => run());
  const router = new IpcRouter({
    register: (channel, listener) => listeners.set(channel, listener),
    trustedSender: (event) => (event as unknown as { trusted: boolean }).trusted,
    updateInstallPending: () => updatePending,
    contracts: { 'items:rename': z.tuple([z.string().min(1)]) },
    defaultContract: z.tuple([z.string().startsWith('/')]),
    tracesChannel: (channel) => channel.startsWith('items:'),
    trace: trace as IpcRouterOptions['trace'],
    ...overrides,
  });
  const call = (channel: string, event: IpcMainInvokeEvent, ...args: unknown[]) =>
    Promise.resolve().then(() => listeners.get(channel)!(event, ...args));
  return { router, call, trace, setUpdatePending: (value: boolean) => (updatePending = value) };
}

describe('IpcRouter', () => {
  it('rejects untrusted senders before running a handler', async () => {
    const { router, call } = setup();
    const listener = vi.fn();
    router.handle('items:rename', listener);
    router.handleConcurrent('items:peek', listener);
    router.handleWorkflow('workflow:items', listener);
    await expect(call('items:rename', untrusted, 'a')).rejects.toThrow('Untrusted IPC sender.');
    await expect(call('items:peek', untrusted, '/a')).rejects.toThrow('Untrusted IPC sender.');
    await expect(call('workflow:items', untrusted)).resolves.toMatchObject({ ok: false });
    expect(listener).not.toHaveBeenCalled();
  });

  it('validates arguments with the channel contract or the path default', async () => {
    const { router, call } = setup();
    const rename = vi.fn((_event: IpcMainInvokeEvent, name: string) => name.toUpperCase());
    const open = vi.fn((_event: IpcMainInvokeEvent, projectPath: string) => projectPath);
    router.handle('items:rename', rename);
    router.handle('items:open', open);
    await expect(call('items:rename', trusted, 'draft')).resolves.toBe('DRAFT');
    await expect(call('items:rename', trusted, '')).rejects.toThrow();
    await expect(call('items:open', trusted, '/project')).resolves.toBe('/project');
    await expect(call('items:open', trusted, 'relative')).rejects.toThrow();
    await expect(call('items:open', trusted, '/project', 'extra')).rejects.toThrow();
  });

  it('runs queued handlers one at a time and keeps going after a failure', async () => {
    const { router, call, trace } = setup();
    const order: string[] = [];
    let releaseFirst!: () => void;
    router.handle('items:rename', async (_event, name: string) => {
      order.push(`start ${name}`);
      if (name === 'first') await new Promise<void>((resolve) => (releaseFirst = resolve));
      if (name === 'second') throw new Error('second failed');
      order.push(`end ${name}`);
    });
    const first = call('items:rename', trusted, 'first');
    const second = call('items:rename', trusted, 'second');
    const third = call('items:rename', trusted, 'third');
    await vi.waitFor(() => expect(order).toEqual(['start first']));
    releaseFirst();
    await first;
    await expect(second).rejects.toThrow('second failed');
    await third;
    expect(order).toEqual(['start first', 'end first', 'start second', 'start third', 'end third']);
    expect(trace).toHaveBeenCalledTimes(3);
  });

  it('lets content search and update channels bypass the queue', async () => {
    const { router, call } = setup({
      contracts: {
        'items:slow': z.tuple([]),
        'projects:search-content': z.tuple([]),
        'update:status': z.tuple([]),
      },
    });
    let releaseSlow!: () => void;
    router.handle('items:slow', () => new Promise<void>((resolve) => (releaseSlow = resolve)));
    router.handle('projects:search-content', () => 'results');
    router.handle('update:status', () => 'idle');
    const slow = call('items:slow', trusted);
    await expect(call('projects:search-content', trusted)).resolves.toBe('results');
    await expect(call('update:status', trusted)).resolves.toBe('idle');
    releaseSlow();
    await slow;
  });

  it('closes admission while an update installs, except for update channels', async () => {
    const { router, call, setUpdatePending } = setup({
      contracts: { 'items:rename': z.tuple([z.string()]), 'update:status': z.tuple([]) },
    });
    router.handle('items:rename', () => 'renamed');
    router.handle('update:status', () => 'installing');
    router.handleWorkflow('workflow:items', () => 'done');
    setUpdatePending(true);
    await expect(call('items:rename', trusted, 'a')).rejects.toThrow('restarting to install an update');
    await expect(call('workflow:items', trusted)).resolves.toMatchObject({ ok: false });
    await expect(call('update:status', trusted)).resolves.toBe('installing');
    expect(() => router.assertCallable(trusted)).toThrow('restarting to install an update');
  });

  it('drains every operation queued before an install starts', async () => {
    const { router } = setup();
    let finished = false;
    void router.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished = true;
    });
    await router.drain();
    expect(finished).toBe(true);
  });

  it('wraps workflow results and queues them only when asked', async () => {
    const { router, call } = setup();
    let releaseSlow!: () => void;
    router.handle('items:rename', () => new Promise<void>((resolve) => (releaseSlow = resolve)));
    router.handleWorkflow('workflow:direct', () => 'direct');
    router.handleWorkflow('workflow:queued', () => 'queued', true);
    const slow = call('items:rename', trusted, 'a');
    await expect(call('workflow:direct', trusted)).resolves.toEqual({ ok: true, value: 'direct' });
    let queuedSettled = false;
    const queued = call('workflow:queued', trusted).then((result) => {
      queuedSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(queuedSettled).toBe(false);
    releaseSlow();
    await slow;
    await expect(queued).resolves.toEqual({ ok: true, value: 'queued' });
  });
});
