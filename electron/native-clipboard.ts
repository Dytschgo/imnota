import { clipboard, ClipboardItem, nativeImage, type NativeImage } from 'electron';
import path from 'node:path';
import type { ClipboardFormatsReport } from '../src/shared/workflow-bridge.js';

let writeQueue: Promise<void> = Promise.resolve();

export async function openWindowsFileHandoff(
  filePaths: readonly string[],
  selectFiles: (filePaths: readonly [string, string]) => Promise<boolean>,
  platform = process.platform,
): Promise<'opened' | 'failed' | undefined> {
  if (platform !== 'win32' || !filePaths.length) return undefined;
  if (
    filePaths.length !== 2 ||
    path.extname(filePaths[0]).toLowerCase() !== '.md' ||
    path.extname(filePaths[1]).toLowerCase() !== '.png'
  )
    return 'failed';
  const directories = new Set(filePaths.map((filePath) => path.dirname(path.resolve(filePath))));
  if (directories.size !== 1) return 'failed';
  try {
    return (await selectFiles([filePaths[0], filePaths[1]])) ? 'opened' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function deliverClipboardWithFileHandoff(
  writeClipboard: () => Promise<ClipboardFormatsReport>,
  filePaths: readonly string[],
  selectFiles: (filePaths: readonly [string, string]) => Promise<boolean>,
  platform = process.platform,
): Promise<ClipboardFormatsReport> {
  let placed: ClipboardFormatsReport;
  let writeError: unknown;
  try {
    placed = await writeClipboard();
  } catch (error) {
    placed = { text: false, html: false, image: false };
    writeError = error;
  }
  const fileHandoff = await openWindowsFileHandoff(filePaths, selectFiles, platform);
  if (writeError && !fileHandoff) throw writeError;
  return fileHandoff ? { ...placed, fileHandoff } : placed;
}

async function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const previous = writeQueue;
  let release!: () => void;
  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function readBlob(types: string[]): Promise<Blob | undefined> {
  const items = await clipboard.read();
  for (const type of types) {
    const item = items.find((candidate) => candidate.types.includes(type));
    if (!item) continue;
    const payload = await item.getType(type);
    if (!('arrayBuffer' in payload)) throw new Error('The clipboard returned an invalid media payload.');
    return payload;
  }
}

function pngBlob(image: NativeImage): Blob {
  return new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
}

function sameImage(left: NativeImage, right: NativeImage): boolean {
  if (left.isEmpty() || right.isEmpty()) return false;
  const leftSize = left.getSize();
  const rightSize = right.getSize();
  return (
    leftSize.width === rightSize.width &&
    leftSize.height === rightSize.height &&
    left.toBitmap().equals(right.toBitmap())
  );
}

async function verifiedContext(
  text: string,
  html: string,
  image: NativeImage,
): Promise<ClipboardFormatsReport> {
  const [textResult, htmlResult, imageResult] = await Promise.allSettled([
    clipboard.readText(),
    readBlob(['text/html']).then((blob) => blob?.text()),
    readBlob(['image/png', 'image/jpeg']).then(async (blob) =>
      blob ? nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())) : nativeImage.createEmpty(),
    ),
  ]);
  return {
    text: textResult.status === 'fulfilled' && textResult.value === text,
    html: htmlResult.status === 'fulfilled' && htmlResult.value === html,
    image: imageResult.status === 'fulfilled' && sameImage(imageResult.value, image),
  };
}

/** Main-process clipboard boundary; callers wait for native reads and writes. */
export const nativeClipboard = {
  async readText(): Promise<string> {
    return await clipboard.readText();
  },
  async readHTML(): Promise<string> {
    const blob = await readBlob(['text/html']);
    return blob ? await blob.text() : '';
  },
  async readImage(): Promise<NativeImage> {
    const blob = await readBlob(['image/png', 'image/jpeg']);
    return blob
      ? nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
      : nativeImage.createEmpty();
  },
  async writeText(text: string): Promise<void> {
    await serializeWrite(() => clipboard.writeText(text));
  },
  async writeImage(image: NativeImage): Promise<void> {
    await serializeWrite(() => clipboard.write([new ClipboardItem({ 'image/png': pngBlob(image) })]));
  },
  /**
   * Writes all requested formats in one native operation, then reads the clipboard
   * back so callers can report what the OS actually holds. Windows in
   * particular may keep only some formats; a read-back failure reports every
   * format as unverified (false) rather than claiming success.
   */
  async writeContext(text: string, html: string, image: NativeImage): Promise<ClipboardFormatsReport> {
    return serializeWrite(async () => {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': text,
          'text/html': html,
          'image/png': pngBlob(image),
        }),
      ]);
      return verifiedContext(text, html, image);
    });
  },
};
