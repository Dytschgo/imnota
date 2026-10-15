import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { act, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { COMMITTED_WRITE_WARNING } from '../../shared/write-outcome';
import { projectRevisionForSource } from '../../../electron/project-watch';
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

it.each(cases.flatMap((entry) => (['before', 'after'] as const).map((delivery) => ({ ...entry, delivery }))))(
  'keeps later foreign $kind bytes out of adoption after warned $code Restore with watcher delivery $delivery rejection',
  async ({ kind, code, delivery }) => {
    const f = await fixture(kind, { holdWatchEvents: true });
    const assertFault = fault(f.projectFile, code);
    let foreign!: Buffer;
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      const result = await f.restore();
      expect(result.warnings?.join(' ')).toContain(COMMITTED_WRITE_WARNING);
      foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), favourite: true }, null, 2));
      await fs.writeFile(f.projectFile, foreign);
      // Observe the real watcher identifying these exact foreign bytes before choosing
      // which side of the Restore-result handling receives the IPC notification.
      await waitFor(() =>
        expect(f.events).toContainEqual(
          expect.objectContaining({
            kind: 'external-change',
            projectRevision: projectRevisionForSource(foreign),
            changedPaths: expect.arrayContaining(['project.json']),
          }),
        ),
      );
      if (delivery === 'before') f.deliverWatchEvents();
      expect(
        await f.hook.result.current.acceptMutationSnapshot(
          result,
          f.itemId,
          token,
          undefined,
          result.projectRevision,
        ),
      ).toBe(false);
      if (delivery === 'after') f.deliverWatchEvents();
    });
    assertFault();
    expect(f.hook.result.current.externalChange?.message).toContain(COMMITTED_WRITE_WARNING);
    expect(f.hook.result.current.externalChange?.message).toContain('reload, compare');
    expect(f.hook.result.current.externalChange?.message).toContain('This project changed outside Imnota.');
    expect(f.hook.result.current.externalChange?.kind).toBe('external-change');
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

it.each(['EIO', 'EACCES', 'EPERM'])(
  'retains an unconfirmed %s Restore warning through dismissal and failed reload, then clears it on successful reload',
  async (code) => {
    const f = await fixture('screenshot', { holdWatchEvents: true });
    const assertFault = fault(f.projectFile, code);
    f.snapshot.mockRejectedValueOnce(new Error('Readback unavailable'));
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      try {
        await f.restore();
        throw new Error('Unexpected success');
      } catch (error) {
        expect((error as Error).message).toContain(COMMITTED_WRITE_WARNING);
        await f.hook.result.current.cancelNativeMutation(token, (error as Error).message);
      }
    });
    assertFault();
    const warning = f.hook.result.current.externalChange!.message;
    act(() => f.hook.result.current.dismissExternalChange());
    expect(f.hook.result.current.externalChange).toBeNull();
    await act(async () => expect(await f.hook.result.current.flushProjectMetadata()).toBe(false));
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();

    const changeFile = async (name: string) => {
      const foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), name }, null, 2));
      await fs.writeFile(f.projectFile, foreign);
      await waitFor(() =>
        expect(f.events).toContainEqual(
          expect.objectContaining({
            kind: 'external-change',
            projectRevision: projectRevisionForSource(foreign),
          }),
        ),
      );
      act(() => f.deliverWatchEvents());
      return foreign;
    };
    await changeFile('Foreign after dismissal');
    expect(f.hook.result.current.externalChange?.message).toContain(warning);
    expect(f.hook.result.current.externalChange?.message).toContain('This project changed outside Imnota.');
    // Repeated notifications must not grow duplicate warning text.
    const foreign = await changeFile('Another foreign edit');
    expect(f.hook.result.current.externalChange!.message.split(COMMITTED_WRITE_WARNING)).toHaveLength(2);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    f.bridge.reloadWatchedProject.mockResolvedValueOnce({
      ok: false,
      error: { code: 'io-failure', message: 'Reload unavailable', retryable: false },
    });
    await act(async () => {
      expect(await f.hook.result.current.reloadExternal({ discardLocalChanges: true })).toBe(false);
    });
    expect(f.hook.result.current.externalChange?.message).toContain(warning);
    expect(f.hook.result.current.projectRevision).toBeNull();
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
    await act(async () => {
      expect(await f.hook.result.current.reloadExternal({ discardLocalChanges: true })).toBe(true);
    });
    expect(f.hook.result.current.externalChange).toBeNull();
    expect(f.hook.result.current.projectRevision).toBe(
      projectRevisionForSource(await fs.readFile(f.projectFile)),
    );
    expect(f.onSnapshot).toHaveBeenCalledOnce();
    expect(f.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ project: JSON.parse(foreign.toString()) }),
    );
    const latestForeign = await changeFile('Foreign after successful reload');
    expect(f.hook.result.current.externalChange?.message).toContain('This project changed outside Imnota.');
    expect(f.hook.result.current.externalChange?.message).not.toContain(COMMITTED_WRITE_WARNING);
    expect(await fs.readFile(f.projectFile)).toEqual(latestForeign);
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
  },
);

it.each(['text', 'drawing'] as const)(
  'retains the cancelled Restore warning after successfully adding %s without changing save authority',
  async (kind) => {
    const f = await fixture('screenshot', { holdWatchEvents: true });
    const assertFault = fault(f.projectFile, 'EIO');
    f.snapshot.mockRejectedValueOnce(new Error('Readback unavailable'));
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      try {
        await f.restore();
        throw new Error('Unexpected success');
      } catch (error) {
        expect((error as Error).message).toContain(COMMITTED_WRITE_WARNING);
        await f.hook.result.current.cancelNativeMutation(token, (error as Error).message);
      }
    });
    assertFault();
    expect(f.hook.result.current.projectRevision).toBeNull();
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(false);
    await expect(f.hook.result.current.getSavedContext(f.source.project.collections[0].id)).rejects.toThrow(
      'Reload and review',
    );
    const warning = f.hook.result.current.externalChange!.message;
    await act(async () => {
      expect(await f.hook.result.current.flush()).toBe(true);
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(true);
      const token = f.hook.result.current.beginNativeMutation();
      const created = await f.createContent(kind);
      expect(await f.hook.result.current.acceptMutationSnapshot(created, undefined, token)).toBe(true);
    });
    const adopted = f.onSnapshot.mock.calls[0][0];
    expect(adopted.project.contentItems).toEqual([expect.objectContaining({ kind })]);
    expect(f.hook.result.current.projectRevision).toBe(
      projectRevisionForSource(await fs.readFile(f.projectFile)),
    );
    expect(f.hook.result.current.externalChange?.message).toBe(warning);
    await expect(f.hook.result.current.getSavedContext(f.source.project.collections[0].id)).resolves.toEqual({
      snapshot: expect.objectContaining({ project: adopted.project }),
      collectionId: f.source.project.collections[0].id,
    });
    await act(async () => {
      expect(
        await f.hook.result.current.saveProjectMetadata({
          ...adopted.project,
          name: 'Allowed metadata save',
        }),
      ).toBe(true);
    });
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledOnce();
    expect((await f.readProject()).name).toBe('Allowed metadata save');
    expect(f.hook.result.current.externalChange?.message).toBe(warning);
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);

    const changeFile = async (name: string) => {
      const foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), name }, null, 2));
      await fs.writeFile(f.projectFile, foreign);
      await waitFor(() =>
        expect(f.events).toContainEqual(
          expect.objectContaining({
            kind: 'external-change',
            projectRevision: projectRevisionForSource(foreign),
          }),
        ),
      );
      act(() => f.deliverWatchEvents());
    };
    act(() => f.hook.result.current.dismissExternalChange());
    expect(f.hook.result.current.externalChange).toBeNull();
    await changeFile('Foreign after successful mutation');
    expect(f.hook.result.current.externalChange?.message).toContain(warning);
    expect(f.hook.result.current.externalChange?.message).toContain('This project changed outside Imnota.');
    f.bridge.reloadWatchedProject.mockResolvedValueOnce({
      ok: false,
      error: { code: 'io-failure', message: 'Reload unavailable', retryable: false },
    });
    await act(async () => expect(await f.hook.result.current.reloadExternal()).toBe(false));
    expect(f.hook.result.current.externalChange?.message).toContain(warning);
    await act(async () => expect(await f.hook.result.current.reloadExternal()).toBe(true));
    expect(f.hook.result.current.externalChange).toBeNull();
    await changeFile('Foreign after explicit reload');
    expect(f.hook.result.current.externalChange?.message).not.toContain(COMMITTED_WRITE_WARNING);
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
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
