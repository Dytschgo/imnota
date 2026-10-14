import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { COMMITTED_WRITE_WARNING } from '../../shared/write-outcome';
import {
  cases,
  kinds,
  platform,
  roots,
  stops,
  fault,
  fixture,
} from './useProjectPersistence.restore.fixtures';

vi.mock('electron', () => ({ app: {}, shell: { trashItem: (target: string) => fs.unlink(target) } }));
vi.mock('../../../electron/native-clipboard', () => ({ nativeClipboard: {} }));
afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: platform });
  for (const stop of stops.splice(0)) stop();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== (await fs.realpath(os.tmpdir())) ||
      !path.basename(root).startsWith('imnota-restore-')
    )
      throw new Error('Unexpected fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});

it.each(['screenshot', 'text', 'drawing'] as const)(
  'does not adopt foreign readback after a warned %s Restore',
  async (kind) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, 'EIO');
    const read = f.snapshot.getMockImplementation()!;
    let foreign!: Buffer;
    f.snapshot.mockImplementationOnce(async () => {
      const changed = { ...(await f.readProject()), favourite: true };
      foreign = Buffer.from(JSON.stringify(changed, null, 2));
      await fs.writeFile(f.projectFile, foreign);
      return read();
    });
    await expect(f.restore()).rejects.toThrow(/changed|confirm/i);
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);

it.each(cases)(
  'retains $kind journal and pending metadata after unreadable warned $code readback',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    f.snapshot.mockRejectedValueOnce(new Error('Readback EACCES'));
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      try {
        await f.restore();
        throw new Error('Unexpected success');
      } catch (error) {
        expect((error as Error).message).toContain(COMMITTED_WRITE_WARNING);
        expect((error as Error).message).toContain('Readback EACCES');
        await f.hook.result.current.cancelNativeMutation(token, (error as Error).message);
      }
    });
    assertFault();
    const bytes = await fs.readFile(f.projectFile);
    expect(f.hook.result.current.projectRevision).toBeNull();
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
    expect(f.hook.result.current.externalChange?.message).toContain(COMMITTED_WRITE_WARNING);
    expect(f.hook.result.current.externalChange?.message).toContain('Reload and compare');
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
    });
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    expect(f.restore).toHaveBeenCalledOnce();
    expect(await fs.readFile(f.projectFile)).toEqual(bytes);
  },
);

it.each(cases)(
  'keeps later foreign $kind bytes out of adoption after warned $code Restore',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    let foreign!: Buffer;
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      const result = await f.restore();
      foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), favourite: true }, null, 2));
      await fs.writeFile(f.projectFile, foreign);
      expect(
        await f.hook.result.current.acceptMutationSnapshot(
          result,
          f.itemId,
          token,
          undefined,
          result.projectRevision,
        ),
      ).toBe(false);
    });
    assertFault();
    expect(f.hook.result.current.externalChange?.message).toContain(COMMITTED_WRITE_WARNING);
    expect(f.hook.result.current.externalChange?.message).toContain('reload, compare');
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
    expect(f.hook.result.current.projectRevision).toBeNull();
    expect(f.onSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
    });
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
  },
);

it.each(kinds)(
  'rejects changed %s member readback and preserves the foreign member and journal',
  async (kind) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, 'EIO');
    const read = f.snapshot.getMockImplementation()!;
    const target = path.join(f.projectPath, f.members[0]);
    f.snapshot.mockImplementationOnce(async () => {
      await fs.writeFile(target, 'foreign member');
      return read();
    });
    await expect(f.restore()).rejects.toThrow('member content changed');
    assertFault();
    expect(await fs.readFile(target, 'utf8')).toBe('foreign member');
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);

it.each(kinds)('retains the %s warning and pending edits when renderer readback fails', async (kind) => {
  const f = await fixture(kind);
  fault(f.projectFile, 'EACCES');
  await act(async () => {
    const token = f.hook.result.current.beginNativeMutation();
    f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
    const result = await f.restore();
    f.bridge.reloadWatchedProject.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'io-failure',
        message: 'Renderer readback unavailable. Reload and compare.',
        retryable: false,
      },
    });
    expect(
      await f.hook.result.current.acceptMutationSnapshot(
        result,
        f.itemId,
        token,
        undefined,
        result.projectRevision,
      ),
    ).toBe(false);
  });
  expect(f.hook.result.current.externalChange?.message).toContain(COMMITTED_WRITE_WARNING);
  expect(f.hook.result.current.externalChange?.message).toContain('Renderer readback unavailable');
  expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
  expect(f.onSnapshot).not.toHaveBeenCalled();
  expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
  await act(async () => {
    expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
  });
  expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
});
