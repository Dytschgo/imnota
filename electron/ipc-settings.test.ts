// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { WorkspaceSettings } from '../src/shared/types.js';
import type { IpcHost } from './main.js';
import { IpcRouter } from './ipc-router.js';
import { registerSettingsIpc } from './ipc-settings.js';

const showOpenDialog = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  app: { getPath: () => '/documents' },
  dialog: { showOpenDialog },
  shell: {},
}));

function harness(persist: (next: WorkspaceSettings) => Promise<void>) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const router = new IpcRouter({
    register: (channel, listener) => handlers.set(channel, listener),
    trustedSender: () => true,
    updateInstallPending: () => false,
    contracts: { 'settings:choose-workspace': z.tuple([]), 'settings:get': z.tuple([]) },
    defaultContract: z.tuple([z.unknown()]),
    tracesChannel: () => false,
    trace: async (_channel, run) => run(),
  });
  // Mirrors the main process: live settings are replaced only after a successful write.
  let settings: WorkspaceSettings = {
    workspacePath: '/workspace/current',
    interfaceScale: 1,
    openRecentOnLaunch: true,
    confirmBeforeDeletion: true,
    updateChannel: 'stable',
  };
  const persistApplicationSettings = vi.fn(async (next: WorkspaceSettings) => {
    await persist(next);
    settings = { ...next };
  });
  registerSettingsIpc(router, {
    get settings() {
      return settings;
    },
    persistApplicationSettings,
    diagnostics: {},
  } as unknown as IpcHost);
  const call = (channel: string) =>
    Promise.resolve().then(() => handlers.get(channel)!({} as IpcMainInvokeEvent));
  return { call, persistApplicationSettings };
}

it('keeps the live workspace when the chosen one cannot be saved', async () => {
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/workspace/next'] });
  const { call, persistApplicationSettings } = harness(async () => {
    throw new Error('disk full');
  });
  const before = (await call('settings:get')) as WorkspaceSettings;
  await expect(call('settings:choose-workspace')).rejects.toThrow('disk full');
  expect(persistApplicationSettings).toHaveBeenCalledWith(
    expect.objectContaining({ workspacePath: '/workspace/next' }),
  );
  expect(before.workspacePath).toBe('/workspace/current');
  expect(await call('settings:get')).toMatchObject({ workspacePath: '/workspace/current' });
});

it('switches the workspace once the chosen one is saved, and not when cancelled', async () => {
  const { call, persistApplicationSettings } = harness(async () => undefined);
  showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await call('settings:choose-workspace')).toBeNull();
  expect(persistApplicationSettings).not.toHaveBeenCalled();
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/workspace/next'] });
  expect(await call('settings:choose-workspace')).toMatchObject({ workspacePath: '/workspace/next' });
  expect(await call('settings:get')).toMatchObject({ workspacePath: '/workspace/next' });
});
