import { clipboard, ClipboardItem, nativeImage, type NativeImage } from 'electron';
import type { ClipboardFormatsReport } from '../src/shared/workflow-bridge.js';

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
    await clipboard.writeText(text);
  },
  async writeImage(image: NativeImage): Promise<void> {
    await clipboard.write([new ClipboardItem({ 'image/png': pngBlob(image) })]);
  },
  /**
   * Writes all three formats in one native operation, then reads the clipboard
   * back so callers can report what the OS actually holds. Windows in
   * particular may keep only some formats; a read-back failure reports every
   * format as unverified (false) rather than claiming success.
   */
  async writeContext(text: string, html: string, image: NativeImage): Promise<ClipboardFormatsReport> {
    await clipboard.write([
      new ClipboardItem({ 'text/plain': text, 'text/html': html, 'image/png': pngBlob(image) }),
    ]);
    try {
      const types = new Set((await clipboard.read()).flatMap((item) => item.types));
      return { text: types.has('text/plain'), html: types.has('text/html'), image: types.has('image/png') };
    } catch {
      return { text: false, html: false, image: false };
    }
  },
};
