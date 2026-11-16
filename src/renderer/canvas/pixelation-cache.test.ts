import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../../shared/types';
import { createPixelationCache } from './pixelation-cache';

function image(width = 400, height = 300) {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

function pixelation(id: string, patch: Partial<Annotation> = {}): Annotation {
  return {
    id,
    kind: 'pixelate',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    blurIntensity: 14,
    zIndex: 0,
    ...patch,
  };
}

function fakePixelate() {
  return vi.fn((_: HTMLImageElement, annotation: Annotation) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.abs(annotation.width ?? 1);
    canvas.height = Math.abs(annotation.height ?? 1);
    return canvas;
  });
}

describe('pixelation cache', () => {
  it('builds each region once and reuses it for unchanged annotations', () => {
    const pixelate = fakePixelate();
    const cache = createPixelationCache(pixelate);
    const source = image();
    const annotations = [
      pixelation('a'),
      pixelation('b', { x: 200 }),
      { ...pixelation('c'), kind: 'rectangle' as const },
    ];
    const first = cache.regions(source, annotations);
    const second = cache.regions(
      source,
      annotations.map((annotation) => ({ ...annotation })),
    );
    expect(pixelate).toHaveBeenCalledTimes(2);
    expect([...first.keys()]).toEqual(['a', 'b']);
    expect(second.get('a')).toBe(first.get('a'));
    expect(second.get('b')).toBe(first.get('b'));
  });

  it.each([
    ['position', { x: 11 }],
    ['size', { width: 120 }],
    ['block size', { blurIntensity: 20 }],
  ])('rebuilds only the annotation whose %s changed', (_, patch) => {
    const pixelate = fakePixelate();
    const cache = createPixelationCache(pixelate);
    const source = image();
    const before = cache.regions(source, [pixelation('a'), pixelation('b', { x: 200 })]);
    const after = cache.regions(source, [pixelation('a', patch), pixelation('b', { x: 200 })]);
    expect(pixelate).toHaveBeenCalledTimes(3);
    expect(after.get('a')).not.toBe(before.get('a'));
    expect(after.get('b')).toBe(before.get('b'));
  });

  it('treats a mirrored drag and its normalized commit as the same region', () => {
    const pixelate = fakePixelate();
    const cache = createPixelationCache(pixelate);
    const source = image();
    const draft = cache.regions(source, [pixelation('a', { x: 110, y: 100, width: -100, height: -80 })]);
    const committed = cache.regions(source, [pixelation('a')]);
    expect(pixelate).toHaveBeenCalledTimes(1);
    expect(committed.get('a')).toBe(draft.get('a'));
  });

  it('rebuilds every region for a different image', () => {
    const pixelate = fakePixelate();
    const cache = createPixelationCache(pixelate);
    const before = cache.regions(image(), [pixelation('a')]);
    const after = cache.regions(image(), [pixelation('a')]);
    expect(pixelate).toHaveBeenCalledTimes(2);
    expect(after.get('a')).not.toBe(before.get('a'));
  });

  it('releases only regions that are no longer in use, and everything on clear', () => {
    const cache = createPixelationCache(fakePixelate());
    const source = image();
    const before = cache.regions(source, [pixelation('a'), pixelation('b', { x: 200 })]);
    const after = cache.regions(source, [pixelation('a', { width: 60 })]);
    // Nothing is released until the replacement is committed.
    expect(before.get('a')!.width).toBe(100);
    cache.retain(after);
    expect(cache.size).toBe(1);
    expect([before.get('a')!.width, before.get('b')!.height]).toEqual([0, 0]);
    expect(after.get('a')!.width).toBe(60);
    cache.clear();
    expect(cache.size).toBe(0);
    expect([after.get('a')!.width, after.get('a')!.height]).toEqual([0, 0]);
  });
});
