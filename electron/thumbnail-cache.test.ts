// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ThumbnailCache, thumbnailSize } from './thumbnail-cache.js';

const version = { mtimeMs: 1, size: 100 };
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('thumbnail sizing', () => {
  it.each([
    [
      { width: 3840, height: 2160 },
      { width: 220, height: 124 },
    ],
    [
      { width: 100, height: 30000 },
      { width: 1, height: 220 },
    ],
    [
      { width: 30000, height: 100 },
      { width: 220, height: 1 },
    ],
    [
      { width: 220, height: 440 },
      { width: 110, height: 220 },
    ],
    [
      { width: 40, height: 20 },
      { width: 40, height: 20 },
    ],
  ])('bounds both dimensions without enlarging small originals: %o', (source, expected) => {
    expect(thumbnailSize(source)).toEqual(expected);
  });

  it('rejects invalid source dimensions before asking the native decoder to resize', () => {
    for (const width of [0, -1, Infinity, NaN, 1.5])
      expect(() => thumbnailSize({ width, height: 100 })).toThrow('invalid dimensions');
  });
});

describe('thumbnail cache', () => {
  it('reuses a preview only while both file timestamp and byte size match', async () => {
    const decode = vi.fn(async () => `preview-${decode.mock.calls.length}`);
    const cache = new ThumbnailCache(decode);
    await expect(cache.get('image.png', version)).resolves.toBe('preview-1');
    await expect(cache.get('image.png', version)).resolves.toBe('preview-1');
    await expect(cache.get('image.png', { ...version, mtimeMs: 2 })).resolves.toBe('preview-2');
    await expect(cache.get('image.png', { ...version, mtimeMs: 2, size: 200 })).resolves.toBe('preview-3');
    expect(decode).toHaveBeenCalledTimes(3);
  });

  it('evicts the least recently used preview when the encoded byte budget is exhausted', async () => {
    const decode = vi.fn(async (file: string) => file.repeat(4));
    const cache = new ThumbnailCache(decode, { entries: 300, bytes: 8 });
    await cache.get('a', version);
    await cache.get('b', version);
    await cache.get('a', version);
    await cache.get('c', version);
    await cache.get('a', version);
    expect(decode.mock.calls.map(([file]) => file)).toEqual(['a', 'b', 'c']);
    await cache.get('b', version);
    expect(decode.mock.calls.map(([file]) => file)).toEqual(['a', 'b', 'c', 'b']);
  });

  it('also bounds the number of tiny entries and never caches an oversized result', async () => {
    const decode = vi.fn(async (file: string) => file);
    const cache = new ThumbnailCache(decode, { entries: 2, bytes: 10 });
    for (const file of ['a', 'b', 'c', 'a']) await cache.get(file, version);
    expect(decode).toHaveBeenCalledTimes(4);
    const large = 'oversized preview';
    await expect(cache.get(large, version)).resolves.toBe(large);
    await expect(cache.get(large, version)).resolves.toBe(large);
    expect(decode).toHaveBeenCalledTimes(6);
    await cache.get('a', version);
    expect(decode).toHaveBeenCalledTimes(6);
  });

  it('shares an in-flight preview, caps native decoding at two, and releases capacity after failures', async () => {
    const releases = new Map<string, { resolve: (value: string) => void; reject: (reason: Error) => void }>();
    let active = 0;
    let peak = 0;
    const decode = vi.fn(async (file: string) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        return await new Promise<string>((resolve, reject) => releases.set(file, { resolve, reject }));
      } finally {
        active -= 1;
      }
    });
    const cache = new ThumbnailCache(decode);
    const first = cache.get('a', version);
    const duplicate = cache.get('a', version);
    const failed = cache.get('b', version);
    const rejected = expect(failed).rejects.toThrow('damaged image');
    const queued = cache.get('c', version);
    await nextTurn();
    expect(decode.mock.calls.map(([file]) => file)).toEqual(['a', 'b']);
    releases.get('b')!.reject(new Error('damaged image'));
    await rejected;
    await nextTurn();
    expect(decode.mock.calls.map(([file]) => file)).toEqual(['a', 'b', 'c']);
    releases.get('a')!.resolve('preview a');
    releases.get('c')!.resolve('preview c');
    await expect(Promise.all([first, duplicate, queued])).resolves.toEqual([
      'preview a',
      'preview a',
      'preview c',
    ]);
    expect(peak).toBe(2);
    const retry = cache.get('b', version);
    await nextTurn();
    releases.get('b')!.resolve('repaired preview');
    await expect(retry).resolves.toBe('repaired preview');
  });
});
