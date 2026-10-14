import { recoverScreenshotTrashTransactions } from '../../../electron/screenshot-trash';
import { recoverContentTrashTransactions } from '../../../electron/content-trash';
import { CommittedWriteError } from '../../../electron/files';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectSnapshot } from '../../shared/types';
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

it.each(cases)(
  'adopts exact $kind bytes and warning after metadata $code, then saves queued metadata once',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    let token!: number;
    let result!: ProjectSnapshot;
    await act(async () => {
      token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Queued during Restore' });
      result = structuredClone(await f.restore());
      expect(result.projectRevision).toBe(projectRevisionForSource(await fs.readFile(f.projectFile)));
      expect(result.warnings?.join(' ')).toContain(COMMITTED_WRITE_WARNING);
      expect(
        await f.hook.result.current.acceptMutationSnapshot(
          result,
          f.itemId,
          token,
          undefined,
          result.projectRevision,
        ),
      ).toBe(true);
    });
    assertFault();
    for (const [index, member] of f.members.entries()) {
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
      expect(f.invalidated).toHaveBeenCalledWith(path.join(f.projectPath, member));
      expect(f.published).toHaveBeenCalledWith(path.join(f.projectPath, member), expect.anything());
    }
    expect(f.invalidated).toHaveBeenCalledWith(f.projectFile);
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(false);
    expect(f.hook.result.current.projectRevision).toBe(
      projectRevisionForSource(await fs.readFile(f.projectFile)),
    );
    expect(f.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ warnings: result.warnings }),
      f.itemId,
    );
    expect(f.selected).toHaveBeenCalledWith(f.itemId);
    expect((await f.readProject()).name).toBe('Queued during Restore');
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledOnce();
    expect(f.restore).toHaveBeenCalledOnce();
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(true);
    });
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledOnce();
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'restored',
    );
    const recover =
      kind === 'screenshot' ? recoverScreenshotTrashTransactions : recoverContentTrashTransactions;
    await expect(recover(f.projectPath)).resolves.toMatchObject([
      { status: 'undo-committed', undoAvailable: false },
    ]);
    expect(await fs.stat(f.journal).catch(() => null)).toBeNull();
    expect((await f.readProject()).name).toBe('Queued during Restore');
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
  },
);

it.each(
  kinds.flatMap((kind) =>
    ['untyped', 'foreign-file', 'missing-own-marker'].map((authority) => ({ kind, authority })),
  ),
)(
  'rejects $authority authority for a committed $kind Restore and retains recovery',
  async ({ kind, authority }) => {
    const f = await fixture(kind);
    const write = f.write.getMockImplementation()!;
    let armed = false;
    if (authority === 'missing-own-marker') {
      f.published.mockImplementation(() => undefined);
      fault(f.projectFile, 'EIO');
    } else {
      f.write.mockImplementation(async (file, source) => {
        await write(file, source);
        if (file !== f.projectFile || armed) return;
        armed = true;
        if (authority === 'untyped')
          throw Object.assign(new Error('Untyped commit-shaped error'), { committed: true });
        throw new CommittedWriteError(path.join(f.projectPath, 'foreign.json'), new Error('foreign-file'));
      });
    }
    await expect(f.restore()).rejects.toThrow('no matching own-write confirmation');
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
  },
);

it.each(cases)(
  'refuses $kind adoption when the restored phase cannot be recorded after metadata $code',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    const write = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (file, source) => {
      if (
        file === path.join(f.journal, 'manifest.json') &&
        JSON.parse(Buffer.from(source).toString()).phase === 'restored'
      )
        throw Object.assign(new Error('Restored phase EACCES'), { code: 'EACCES' });
      await write(file, source);
    });
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      try {
        await f.restore();
        throw new Error('Unexpected success');
      } catch (error) {
        expect((error as Error).message).toContain(COMMITTED_WRITE_WARNING);
        expect((error as Error).message).toContain('Restored phase EACCES');
        await f.hook.result.current.cancelNativeMutation(token, (error as Error).message);
      }
    });
    assertFault();
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'undoing',
    );
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
    });
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
  },
);
