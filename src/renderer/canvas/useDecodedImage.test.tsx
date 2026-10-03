import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDecodedImage } from './useDecodedImage';
afterEach(() => vi.restoreAllMocks());
it('exposes decode failure and retries even when the payload URL is unchanged', () => {
  const images: HTMLImageElement[] = [];
  vi.spyOn(window, 'Image').mockImplementation(function () {
    const image = document.createElement('img');
    images.push(image);
    return image;
  });
  const { result, rerender, unmount } = renderHook(({ url }) => useDecodedImage(url), {
    initialProps: { url: 'bad' },
  });
  act(() => images[0].dispatchEvent(new Event('error')));
  expect(result.current.decodeFailed).toBe(true);
  expect(result.current.imageObj).toBeNull();
  act(() => result.current.retryDecode());
  expect(result.current.decodeFailed).toBe(false);
  act(() => images[1].dispatchEvent(new Event('load')));
  expect(result.current.imageObj).toBe(images[1]);
  rerender({ url: 'other' });
  expect(result.current.imageObj).toBeNull();
  act(() => images[1].dispatchEvent(new Event('error')));
  expect(result.current.decodeFailed).toBe(false);
  unmount();
});
