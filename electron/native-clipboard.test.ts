// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { nativeClipboard } from './native-clipboard.js';

const mocks = vi.hoisted(() => ({
  clipboard: { readText: vi.fn(), read: vi.fn(), writeText: vi.fn(), write: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn(), createEmpty: vi.fn() },
}));
vi.mock('electron', () => ({
  ...mocks,
  ClipboardItem: class {
    constructor(public data: Record<string, Blob | string>) {}
  },
}));
beforeEach(() => vi.resetAllMocks());
const png = Buffer.from('synthetic PNG bytes');
const image = { isEmpty: () => false, toPNG: () => png } as NativeImage;
const emptyImage = { isEmpty: () => true } as NativeImage;

function item(type: string, blob: Blob) {
  return { types: [type], getType: vi.fn().mockResolvedValue(blob) };
}

describe('main-process clipboard completion', () => {
  it.each([
    ['text', () => nativeClipboard.writeText('Markdown'), mocks.clipboard.writeText],
    ['image', () => nativeClipboard.writeImage(image), mocks.clipboard.write],
    [
      'context',
      () => nativeClipboard.writeContext('Markdown', '<p>Markdown</p>', image),
      mocks.clipboard.write,
    ],
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

  it('writes Markdown, HTML and exact PNG bytes in one atomic native operation', async () => {
    await nativeClipboard.writeContext('Markdown', '<p>Markdown</p>', image);
    expect(mocks.clipboard.write).toHaveBeenCalledOnce();
    const items = mocks.clipboard.write.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0].data)).toEqual(['text/plain', 'text/html', 'image/png']);
    expect(items[0].data['text/plain']).toBe('Markdown');
    expect(items[0].data['text/html']).toBe('<p>Markdown</p>');
    const blob: Blob = items[0].data['image/png'];
    expect(blob.type).toBe('image/png');
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(png);
    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('writes an image without retaining stale text formats', async () => {
    await nativeClipboard.writeImage(image);
    const items = mocks.clipboard.write.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0].data)).toEqual(['image/png']);
  });

  it('reads text and HTML asynchronously, including missing HTML', async () => {
    mocks.clipboard.readText.mockResolvedValueOnce('Markdown');
    await expect(nativeClipboard.readText()).resolves.toBe('Markdown');
    mocks.clipboard.read.mockResolvedValueOnce([item('text/html', new Blob(['<p>Markdown</p>']))]);
    await expect(nativeClipboard.readHTML()).resolves.toBe('<p>Markdown</p>');
    mocks.clipboard.read.mockResolvedValueOnce([]);
    await expect(nativeClipboard.readHTML()).resolves.toBe('');
  });

  it('prefers PNG to JPEG, falls back to JPEG and returns an empty image when absent', async () => {
    const jpeg = item('image/jpeg', new Blob(['JPEG']));
    const preferred = item('image/png', new Blob([png]));
    mocks.nativeImage.createFromBuffer.mockReturnValue(image);
    mocks.nativeImage.createEmpty.mockReturnValue(emptyImage);
    mocks.clipboard.read.mockResolvedValueOnce([jpeg, preferred]);
    await expect(nativeClipboard.readImage()).resolves.toBe(image);
    expect(jpeg.getType).not.toHaveBeenCalled();
    expect(mocks.nativeImage.createFromBuffer).toHaveBeenLastCalledWith(png);
    mocks.clipboard.read.mockResolvedValueOnce([jpeg]);
    await expect(nativeClipboard.readImage()).resolves.toBe(image);
    expect(mocks.nativeImage.createFromBuffer).toHaveBeenLastCalledWith(Buffer.from('JPEG'));
    mocks.clipboard.read.mockResolvedValueOnce([]);
    await expect(nativeClipboard.readImage()).resolves.toBe(emptyImage);
  });

  it.each([
    [() => nativeClipboard.readText(), mocks.clipboard.readText],
    [() => nativeClipboard.readHTML(), mocks.clipboard.read],
    [() => nativeClipboard.readImage(), mocks.clipboard.read],
  ] as const)('propagates native read failure', async (read, nativeRead) => {
    nativeRead.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await expect(read()).rejects.toThrow('Clipboard unavailable');
  });

  it('propagates lazy payload failures and rejects a non-blob payload', async () => {
    const broken = {
      types: ['image/png'],
      getType: vi.fn().mockRejectedValueOnce(new Error('Image unavailable')),
    };
    mocks.clipboard.read.mockResolvedValueOnce([broken]);
    await expect(nativeClipboard.readImage()).rejects.toThrow('Image unavailable');
    broken.getType.mockResolvedValueOnce({ title: 'bookmark', url: 'https://example.com' });
    mocks.clipboard.read.mockResolvedValueOnce([broken]);
    await expect(nativeClipboard.readImage()).rejects.toThrow('invalid media payload');
  });
});
