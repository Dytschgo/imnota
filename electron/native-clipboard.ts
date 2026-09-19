import { clipboard, ClipboardItem, nativeImage, type NativeImage } from 'electron';
import path from 'node:path';
import type { ClipboardFormatsReport } from '../src/shared/workflow-bridge.js';
import {
  readWindowsClipboardFilesWhenAvailable,
  windowsDibV5Buffer,
  writeWindowsClipboard,
} from './windows-clipboard.js';

let writeQueue: Promise<void> = Promise.resolve();

function windowsFilePair(filePaths: readonly string[]): readonly [string, string] {
  if (
    filePaths.length !== 2 ||
    path.extname(filePaths[0]).toLowerCase() !== '.md' ||
    path.extname(filePaths[1]).toLowerCase() !== '.png'
  )
    throw new Error('Windows file copy requires one Markdown file and one PNG file.');
  const directories = new Set(filePaths.map((filePath) => path.dirname(path.resolve(filePath))));
  if (directories.size !== 1)
    throw new Error('Windows file copy requires the generated pair to share one directory.');
  return [path.resolve(filePaths[0]), path.resolve(filePaths[1])];
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

/** Chromium adds this metadata when HTML crosses the macOS pasteboard boundary. */
export function platformClipboardHtml(html: string, platform = process.platform): string {
  return platform === 'darwin' ? `<meta charset='utf-8'>${html}` : html;
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
    html: htmlResult.status === 'fulfilled' && htmlResult.value === platformClipboardHtml(html),
    image: imageResult.status === 'fulfilled' && sameImage(imageResult.value, image),
    files: false,
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
  async writeWindowsFiles(
    owner: Buffer,
    filePaths: readonly string[],
    context?: { text: string; html: string; image: NativeImage },
  ): Promise<ClipboardFormatsReport> {
    if (process.platform !== 'win32')
      throw new Error('The file clipboard comparison is available only on Windows.');
    const pair = windowsFilePair(filePaths);
    return serializeWrite(async () => {
      await writeWindowsClipboard(owner, {
        filePaths: pair,
        ...(context
          ? {
              markdown: context.text,
              html: context.html,
              png: context.image.toPNG(),
              dibV5: windowsDibV5Buffer(
                context.image.toBitmap(),
                context.image.getSize().width,
                context.image.getSize().height,
              ),
            }
          : {}),
      });
      const files = await (async () => {
        try {
          return await readWindowsClipboardFilesWhenAvailable(owner);
        } catch {
          return [];
        }
      })();
      const filesMatch =
        files.length === pair.length &&
        files.every((file, index) => path.resolve(file).toLowerCase() === pair[index].toLowerCase());
      if (!context) return { text: false, html: false, image: false, files: filesMatch };
      const verified = await verifiedContext(context.text, context.html, context.image);
      return { ...verified, files: filesMatch };
    });
  },
};
