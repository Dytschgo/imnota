// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { QuickCaptureStore } from './quick-capture-store.js';

const destination = { projectPath: '/workspace/project', collectionId: 'collection' };
const source = (value: string) => ({
  png: Buffer.from(value),
  width: 720,
  height: 480,
  previewDataUrl: value,
});

describe('pending quick capture ownership', () => {
  it('owns its source bytes even when a caller reuses the capture buffer', () => {
    const store = new QuickCaptureStore();
    const input = source('original');
    const id = store.add(input);
    input.png.fill(0);
    expect(store.item(id, 1).originalPng.toString()).toBe('original');
    expect(store.item(id, 1).renderedPng.toString()).toBe('original');
  });
  it('keeps three independent captures, rejects overflow and discards only the selected one', () => {
    const store = new QuickCaptureStore();
    const ids = ['a', 'b', 'c'].map((value) => store.add(source(value)));
    expect(() => store.add(source('d'))).toThrow(/full/);
    store.discard(ids[1], 1);
    expect(store.cards().map((item) => item.id)).toEqual([ids[0], ids[2]]);
    expect(store.item(ids[2], 1).originalPng.toString()).toBe('c');
    expect(() => store.discard(ids[1], 1)).toThrow(/no longer pending/);
    expect(store.size).toBe(2);
  });

  it('claims Add synchronously so repeated actions cannot duplicate or discard an in-flight item', async () => {
    const store = new QuickCaptureStore();
    const id = store.add(source('chosen'));
    let finish!: () => void;
    const insert = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = store.commit(id, 1, destination, insert);
    await expect(store.commit(id, 1, destination, insert)).rejects.toThrow(/in progress/);
    expect(() => store.discard(id, 1)).toThrow(/in progress/);
    expect(insert).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    expect(store.size).toBe(0);
  });

  it('keeps a failed Add bound to the same stable screenshot ID and destination for recovery', async () => {
    const store = new QuickCaptureStore();
    const id = store.add(source('kept'));
    const other = store.add(source('other'));
    await expect(
      store.commit(id, 1, destination, async () => {
        throw new Error('Write confirmation lost');
      }),
    ).rejects.toThrow(/confirmation lost/);
    expect(store.cards()[0]).toMatchObject({
      id,
      busy: false,
      destination,
      message: 'Write confirmation lost',
    });
    const wrongInsert = vi.fn();
    await expect(
      store.commit(id, 1, { ...destination, collectionId: 'elsewhere' }, wrongInsert),
    ).rejects.toThrow(/original destination/);
    expect(wrongInsert).not.toHaveBeenCalled();
    const retry = vi.fn(async (item) => {
      expect(item.id).toBe(id);
      expect(item.originalPng.toString()).toBe('kept');
    });
    await store.commit(id, 1, destination, retry);
    expect(store.cards().map((item) => item.id)).toEqual([other]);
  });

  it('keeps captures after copy failure and blocks stale previews after edited pixels change', async () => {
    const store = new QuickCaptureStore();
    const id = store.add(source('original'));
    await expect(
      store.use(id, 1, async () => {
        throw new Error('Clipboard busy');
      }),
    ).rejects.toThrow(/Clipboard busy/);
    expect(store.item(id, 1).originalPng.toString()).toBe('original');
    store.setDragPath(id, 1, '/temporary/v1.png');
    store.apply(id, 1, { png: Buffer.from('redacted'), annotations: [], previewDataUrl: 'redacted-preview' });
    expect(store.cards()[0]).toMatchObject({
      revision: 2,
      dragAvailable: false,
      previewDataUrl: 'redacted-preview',
    });
    expect(() => store.item(id, 1)).toThrow(/newer edits/);
    const copied: string[] = [];
    await store.use(id, 2, async (item) => {
      copied.push(item.renderedPng.toString());
    });
    expect(copied).toEqual(['redacted']);
    expect(store.item(id, 2).originalPng.toString()).toBe('original');
  });

  it('refuses edited evidence after an ambiguous Add and preserves the original retry input', async () => {
    const store = new QuickCaptureStore();
    const id = store.add(source('original'));
    await expect(
      store.commit(id, 1, destination, async () => {
        throw new Error('Could not confirm');
      }),
    ).rejects.toThrow();
    expect(() =>
      store.apply(id, 1, { png: Buffer.from('changed'), annotations: [], previewDataUrl: 'changed' }),
    ).toThrow(/Finish retrying Add/);
    expect(store.item(id, 1).renderedPng.toString()).toBe('original');
  });
});
