// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { nativeClipboard } from './native-clipboard.js';

const clipboard = vi.hoisted(() => ({
  readText: vi.fn(),
  readHTML: vi.fn(),
  readImage: vi.fn(),
  writeText: vi.fn(),
  writeImage: vi.fn(),
  write: vi.fn(),
}));
vi.mock('electron', () => ({ clipboard }));
beforeEach(() => vi.resetAllMocks());

const image = { isEmpty: () => false } as NativeImage;

describe('main-process clipboard completion', () => {
  it.each([
    ['text', () => nativeClipboard.writeText('Markdown'), clipboard.writeText],
    ['image', () => nativeClipboard.writeImage(image), clipboard.writeImage],
    ['context', () => nativeClipboard.writeContext('Markdown', '<p>Markdown</p>', image), clipboard.write],
  ] as const)('waits for the %s write and propagates native failure', async (_name, write, nativeWrite) => {
    let complete!: () => void;
    nativeWrite.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    let settled = false;
    const pending = write().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    await pending;
    expect(settled).toBe(true);

    nativeWrite.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await expect(write()).rejects.toThrow('Clipboard unavailable');
  });

  it('writes all context formats together in one native operation', async () => {
    await nativeClipboard.writeContext('Markdown', '<p>Markdown</p>', image);
    expect(clipboard.write).toHaveBeenCalledExactlyOnceWith({
      text: 'Markdown',
      html: '<p>Markdown</p>',
      image,
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboard.writeImage).not.toHaveBeenCalled();
  });

  it.each([
    [() => nativeClipboard.readText(), clipboard.readText, 'Markdown'],
    [() => nativeClipboard.readHTML(), clipboard.readHTML, '<p>Markdown</p>'],
    [() => nativeClipboard.readImage(), clipboard.readImage, image],
  ] as const)(
    'returns asynchronous native content and propagates read failure',
    async (read, nativeRead, value) => {
      nativeRead.mockResolvedValueOnce(value);
      await expect(read()).resolves.toBe(value);
      nativeRead.mockRejectedValueOnce(new Error('Clipboard unavailable'));
      await expect(read()).rejects.toThrow('Clipboard unavailable');
    },
  );
});
