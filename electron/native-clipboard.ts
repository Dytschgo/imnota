import { clipboard, type NativeImage } from 'electron';

/** Main-process clipboard boundary; callers wait for native reads and writes. */
export const nativeClipboard = {
  async readText(): Promise<string> {
    return await clipboard.readText();
  },
  async readHTML(): Promise<string> {
    return await clipboard.readHTML();
  },
  async readImage(): Promise<NativeImage> {
    return await clipboard.readImage();
  },
  async writeText(text: string): Promise<void> {
    await clipboard.writeText(text);
  },
  async writeImage(image: NativeImage): Promise<void> {
    await clipboard.writeImage(image);
  },
  async writeContext(text: string, html: string, image: NativeImage): Promise<void> {
    await clipboard.write({ text, html, image });
  },
};
