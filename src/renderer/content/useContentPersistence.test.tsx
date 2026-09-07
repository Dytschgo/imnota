import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContentItemContent, TextBlockRecord } from '../../shared/content-items';
import type { ImnotaBridge, ProjectSnapshot } from '../../shared/types';
import { useContentPersistence } from './useContentPersistence';

const item: TextBlockRecord = {
  id: 'text-1',
  kind: 'text',
  collectionId: 'c',
  position: 0,
  includeInExport: true,
  createdAt: 'now',
  updatedAt: 'now',
  markdownFilename: 'text-1.md',
};
const snapshot = {
  projectPath: '/project',
  project: { contentItems: [item], screenshots: [] },
} as unknown as ProjectSnapshot;
const loaded: ContentItemContent = { item, markdown: 'Original', contentRevision: 'r1' };

function setup(save: ImnotaBridge['saveContentItem'], acceptSnapshot = vi.fn(async () => true)) {
  window.imnota = {
    loadContentItem: vi.fn(async () => loaded),
    saveContentItem: save,
  } as unknown as ImnotaBridge;
  return renderHook(() =>
    useContentPersistence({
      snapshot,
      itemId: item.id,
      beforeSave: async () => true,
      beginMutation: () => 1,
      acceptSnapshot,
      cancelMutation: async () => true,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('preserves newer typing while an older save is in flight and advances its revision', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi
    .fn<ImnotaBridge['saveContentItem']>()
    .mockImplementationOnce(async () => {
      await gate;
      return { snapshot, itemId: item.id, contentRevision: 'r2', conflictCreated: false };
    })
    .mockResolvedValue({ snapshot, itemId: item.id, contentRevision: 'r3', conflictCreated: false });
  const hook = setup(save);
  await waitFor(() => expect(hook.result.current.content?.markdown).toBe('Original'));
  act(() => hook.result.current.change({ markdown: 'First' }));
  let saving!: Promise<boolean>;
  act(() => {
    saving = hook.result.current.flush();
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  act(() => hook.result.current.change({ markdown: 'Second' }));
  await act(async () => {
    release();
    expect(await saving).toBe(true);
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0]).toMatchObject({ markdown: 'Second', contentRevision: 'r2' });
  expect(hook.result.current.content?.markdown).toBe('Second');
  expect(hook.result.current.hasUnsavedChanges).toBe(false);
  hook.unmount();
});

it('retains a failed save for retry instead of discarding the text', async () => {
  const save = vi
    .fn<ImnotaBridge['saveContentItem']>()
    .mockRejectedValueOnce(new Error('Disk full'))
    .mockResolvedValue({ snapshot, itemId: item.id, contentRevision: 'r2', conflictCreated: false });
  const hook = setup(save);
  await waitFor(() => expect(hook.result.current.content).not.toBeNull());
  act(() => hook.result.current.change({ markdown: 'Keep me' }));
  await act(async () => {
    expect(await hook.result.current.flush()).toBe(false);
  });
  expect(hook.result.current.error).toBe('Disk full');
  expect(hook.result.current.hasUnsavedChanges).toBe(true);
  expect(hook.result.current.content?.markdown).toBe('Keep me');
  await act(async () => {
    expect(await hook.result.current.flush()).toBe(true);
  });
  expect(hook.result.current.hasUnsavedChanges).toBe(false);
  hook.unmount();
});

it('does not write merely because a content item is opened', async () => {
  const save = vi.fn<ImnotaBridge['saveContentItem']>();
  const hook = setup(save);
  await waitFor(() => expect(hook.result.current.content).not.toBeNull());
  act(() => hook.result.current.change({ markdown: 'Original' }));
  await act(async () => {
    expect(await hook.result.current.flush()).toBe(true);
  });
  expect(save).not.toHaveBeenCalled();
  hook.unmount();
});

it('keeps a successful write pending until snapshot adoption succeeds and retries without rewriting', async () => {
  const save = vi
    .fn<ImnotaBridge['saveContentItem']>()
    .mockResolvedValue({ snapshot, itemId: item.id, contentRevision: 'r2', conflictCreated: false });
  const accept = vi.fn(async () => true).mockResolvedValueOnce(false);
  const hook = setup(save, accept);
  await waitFor(() => expect(hook.result.current.content).not.toBeNull());
  act(() => hook.result.current.change({ markdown: 'Written but not adopted' }));
  await act(async () => {
    expect(await hook.result.current.flush()).toBe(false);
  });
  expect(hook.result.current.hasUnsavedChanges).toBe(true);
  await act(async () => {
    expect(await hook.result.current.flush()).toBe(true);
  });
  expect(accept).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledOnce();
  expect(hook.result.current.hasUnsavedChanges).toBe(false);
  hook.unmount();
});

it('retains newer edits through a yielded conflict selection handoff', async () => {
  const conflict = { ...item, id: 'text-conflict', includeInExport: false };
  const conflictSnapshot = { ...snapshot, project: { ...snapshot.project, contentItems: [item, conflict] } };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi
    .fn<ImnotaBridge['saveContentItem']>()
    .mockResolvedValueOnce({
      snapshot: conflictSnapshot,
      itemId: conflict.id,
      contentRevision: 'r2',
      conflictCreated: true,
    })
    .mockResolvedValue({
      snapshot: conflictSnapshot,
      itemId: conflict.id,
      contentRevision: 'r3',
      conflictCreated: false,
    });
  const accept = vi
    .fn(async () => true)
    .mockImplementationOnce(async () => {
      await gate;
      return true;
    });
  window.imnota = {
    loadContentItem: vi.fn(async () => loaded),
    saveContentItem: save,
  } as unknown as ImnotaBridge;
  const hook = renderHook(
    ({ value, selected }) =>
      useContentPersistence({
        snapshot: value,
        itemId: selected,
        beforeSave: async () => true,
        beginMutation: () => 1,
        acceptSnapshot: accept,
        cancelMutation: async () => true,
      }),
    { initialProps: { value: snapshot, selected: item.id } },
  );
  await waitFor(() => expect(hook.result.current.content).not.toBeNull());
  act(() => hook.result.current.change({ markdown: 'First' }));
  let saving!: Promise<boolean>;
  act(() => {
    saving = hook.result.current.flush();
  });
  await waitFor(() => expect(accept).toHaveBeenCalledOnce());
  act(() => hook.result.current.change({ markdown: 'Newer typing' }));
  hook.rerender({ value: conflictSnapshot, selected: item.id });
  expect(hook.result.current.content?.markdown).toBe('Newer typing');
  await act(async () => {
    release();
    expect(await saving).toBe(true);
  });
  expect(save.mock.calls[1][0]).toMatchObject({
    itemId: conflict.id,
    markdown: 'Newer typing',
    contentRevision: 'r2',
  });
  hook.rerender({ value: conflictSnapshot, selected: conflict.id });
  expect(hook.result.current.content?.markdown).toBe('Newer typing');
  hook.unmount();
});
