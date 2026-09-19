// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import path from 'node:path';
import {
  deliverClipboardWithFileHandoff,
  nativeClipboard,
  openWindowsFileHandoff,
} from './native-clipboard.js';

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
const png = Buffer.from('synthetic PNG bytes');
const bitmap = Buffer.from('synthetic bitmap');
const image = {
  isEmpty: () => false,
  toPNG: () => png,
  getSize: () => ({ width: 2, height: 2 }),
  toBitmap: () => bitmap,
} as NativeImage;
const emptyImage = { isEmpty: () => true } as NativeImage;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.clipboard.readText.mockResolvedValue('');
  mocks.clipboard.read.mockResolvedValue([]);
  mocks.nativeImage.createEmpty.mockReturnValue(emptyImage);
});

function item(type: string, blob: Blob) {
  return { types: [type], getType: vi.fn().mockResolvedValue(blob) };
}

function clipboardItem(data: Record<string, string | Blob>) {
  return {
    types: Object.keys(data),
    getType: vi.fn(async (type: string) => {
      const value = data[type];
      return typeof value === 'string' ? new Blob([value], { type }) : value;
    }),
  };
}

describe('main-process clipboard completion', () => {
  it('opens a verified Windows Markdown/PNG pair folder as the immediate file handoff', async () => {
    const selectFiles = vi.fn(async () => true);
    const directory = path.resolve('handoff');
    await expect(
      openWindowsFileHandoff(
        [path.join(directory, 'bundle.md'), path.join(directory, 'bundle.png')],
        selectFiles,
        'win32',
      ),
    ).resolves.toBe('opened');
    expect(selectFiles).toHaveBeenCalledWith([
      path.join(directory, 'bundle.md'),
      path.join(directory, 'bundle.png'),
    ]);
    selectFiles.mockResolvedValueOnce(false);
    await expect(
      openWindowsFileHandoff(
        [path.join(directory, 'bundle.md'), path.join(directory, 'bundle.png')],
        selectFiles,
        'win32',
      ),
    ).resolves.toBe('failed');
    selectFiles.mockRejectedValueOnce(new Error('Shell unavailable'));
    await expect(
      openWindowsFileHandoff(
        [path.join(directory, 'bundle.md'), path.join(directory, 'bundle.png')],
        selectFiles,
        'win32',
      ),
    ).resolves.toBe('failed');
  });

  it('does not open a folder off Windows or for an invalid pair', async () => {
    const selectFiles = vi.fn(async () => true);
    await expect(
      openWindowsFileHandoff(['bundle.md', 'bundle.png'], selectFiles, 'linux'),
    ).resolves.toBeUndefined();
    await expect(openWindowsFileHandoff(['bundle.md'], selectFiles, 'win32')).resolves.toBe('failed');
    await expect(
      openWindowsFileHandoff(['one.md', path.join('other', 'two.png')], selectFiles, 'win32'),
    ).resolves.toBe('failed');
    expect(selectFiles).not.toHaveBeenCalled();
  });

  it('still selects the generated pair when the Windows clipboard write rejects', async () => {
    const writeClipboard = vi.fn().mockRejectedValue(new Error('Clipboard locked'));
    const selectFiles = vi.fn().mockResolvedValue(true);
    await expect(
      deliverClipboardWithFileHandoff(
        writeClipboard,
        [path.join(path.resolve('handoff'), 'bundle.md'), path.join(path.resolve('handoff'), 'bundle.png')],
        selectFiles,
        'win32',
      ),
    ).resolves.toEqual({
      text: false,
      html: false,
      image: false,
      fileHandoff: 'opened',
    });
    expect(writeClipboard).toHaveBeenCalledOnce();
    expect(selectFiles).toHaveBeenCalledOnce();
  });

  it('propagates a clipboard failure when there is no Windows file handoff', async () => {
    const writeClipboard = vi.fn().mockRejectedValue(new Error('Clipboard locked'));
    await expect(deliverClipboardWithFileHandoff(writeClipboard, [], vi.fn(), 'win32')).rejects.toThrow(
      'Clipboard locked',
    );
  });

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

  it('reports only exact clipboard content after a combined write', async () => {
    const html = '<p>Markdown</p>';
    mocks.clipboard.readText.mockResolvedValue('Markdown');
    mocks.clipboard.read.mockResolvedValue([
      clipboardItem({
        'text/html': html,
        'image/png': new Blob([png], { type: 'image/png' }),
      }),
    ]);
    mocks.nativeImage.createFromBuffer.mockReturnValue(image);
    await expect(nativeClipboard.writeContext('Markdown', html, image)).resolves.toEqual({
      text: true,
      html: true,
      image: true,
    });

    mocks.clipboard.readText.mockResolvedValue('changed');
    mocks.clipboard.read.mockResolvedValue([]);
    await expect(nativeClipboard.writeContext('Markdown', html, image)).resolves.toEqual({
      text: false,
      html: false,
      image: false,
    });
    expect(mocks.clipboard.write).toHaveBeenCalledTimes(2);
  });

  it('serializes app-owned writes so a later fallback cannot overtake verification', async () => {
    let finish!: () => void;
    mocks.clipboard.write.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    const context = nativeClipboard.writeContext('Markdown', '<p>Markdown</p>', image);
    const fallback = nativeClipboard.writeText('fallback');
    await Promise.resolve();
    expect(mocks.clipboard.writeText).not.toHaveBeenCalled();
    finish();
    await context;
    await fallback;
    expect(mocks.clipboard.writeText).toHaveBeenCalledWith('fallback');
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
