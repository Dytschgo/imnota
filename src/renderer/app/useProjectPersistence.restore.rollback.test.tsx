import fs from 'node:fs/promises';
import path from 'node:path';
import { act, waitFor } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';
import { COMMITTED_WRITE_WARNING } from '../../shared/write-outcome';
import { projectRevisionForSource } from '../../../electron/project-watch';
import {
  cases,
  kinds,
  platform,
  session,
  it,
  fault,
  fixture,
} from './useProjectPersistence.restore.fixtures';

vi.mock('electron', () => ({ app: {}, shell: { trashItem: (target: string) => fs.unlink(target) } }));
vi.mock('../../../electron/native-clipboard', () => ({ nativeClipboard: {} }));
afterEach(async (context) => {
  try {
    await session.cleanup(context);
  } finally {
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

it.each(cases)(
  'repairs a per-member $kind $code failure without reporting whole Restore success',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(path.join(f.projectPath, f.members[0]), code);
    const before = await fs.readFile(f.projectFile);
    await expect(f.restore()).rejects.toThrow(COMMITTED_WRITE_WARNING);
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(before);
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'deleted',
    );
    for (const member of f.members)
      expect(await fs.stat(path.join(f.projectPath, member)).catch(() => null)).toBeNull();
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(f.restore).toHaveBeenCalledOnce();
  },
);

it.each(kinds)(
  'suppresses own watched %s Restore and invalidates the cached search, then detects external bytes',
  async (kind) => {
    const f = await fixture(kind);
    const query = kind === 'text' ? 'Exact restored Markdown' : kind === 'drawing' ? 'Drawing' : 'Restore';
    expect(
      (await f.search.search({ workspacePath: f.root, query })).results.some((r) => r.itemId === f.itemId),
    ).toBe(false);
    const assertFault = fault(f.projectFile, 'EPERM');
    await act(async () => {
      await f.restore();
    });
    assertFault();
    await waitFor(() => expect(f.watchedReads).toHaveBeenCalledWith(f.projectFile));
    // Invocation alone does not establish which bytes the asynchronous read observed.
    const readIndex = f.watchedReads.mock.calls.findIndex(([target]) => target === f.projectFile);
    expect(await f.watchedReads.mock.results[readIndex].value).toEqual(await fs.readFile(f.projectFile));
    expect(f.events).toEqual([]);
    expect(
      (await f.search.search({ workspacePath: f.root, query })).results.some((r) => r.itemId === f.itemId),
    ).toBe(true);
    const foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), favourite: true }, null, 2));
    await fs.writeFile(f.projectFile, foreign);
    await waitFor(() => expect(f.events.some((e) => e.kind === 'external-change')).toBe(true));
    expect(f.events).toContainEqual(
      expect.objectContaining({
        kind: 'external-change',
        projectRevision: projectRevisionForSource(foreign),
        changedPaths: expect.arrayContaining(['project.json']),
      }),
    );
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
  },
);

it.each(cases)(
  'preserves journal and original warning when $kind $code rollback cannot remove a member',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const target = path.join(f.projectPath, f.members[0]);
    const assertFault = fault(target, code);
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (String(file) === target) throw Object.assign(new Error('Repair EACCES'), { code: 'EACCES' });
      return unlink(file);
    });
    const before = await fs.readFile(f.projectFile);
    const outcome = f.restore();
    await expect(outcome).rejects.toThrow(COMMITTED_WRITE_WARNING);
    await expect(outcome).rejects.toThrow('Repair EACCES');
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(before);
    expect(await fs.readFile(target)).toEqual(f.bytes[0]);
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'undoing',
    );
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);

it.each(cases)(
  'preserves all $kind members when metadata changes immediately after $code commit',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    const write = f.write.getMockImplementation()!;
    let foreign!: Buffer;
    f.write.mockImplementation(async (file, source) => {
      try {
        await write(file, source);
      } catch (error) {
        if (file === f.projectFile) {
          foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), favourite: true }, null, 2));
          await fs.writeFile(file, foreign);
        }
        throw error;
      }
    });
    const outcome = f.restore();
    await expect(outcome).rejects.toThrow(COMMITTED_WRITE_WARNING);
    await expect(outcome).rejects.toThrow('changed again');
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'undoing',
    );
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);
