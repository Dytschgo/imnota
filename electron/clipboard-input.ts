import { nativeImage, type BrowserWindow } from 'electron';
import {
  CLIPBOARD_IMAGE_LIMIT_MESSAGE,
  MAX_CLIPBOARD_PNG_LENGTH,
  clipboardPngDimensions,
} from '../src/shared/clipboard-context.js';
import type { PromptBundleManifestItem } from './prompt-bundle-store.js';
import { nativeClipboardFailure } from './clipboard-errors.js';
import { clipboardFailure, NativeWorkflowError } from './workflow-errors.js';

export function assertClipboardText(text: string): void {
  if (typeof text !== 'string' || text.length > 2_000_000)
    throw clipboardFailure('too-large', 'Context is too large to copy. Export the Markdown file instead.');
}

export function clipboardImage(imageDataUrl: string) {
  let size: { width: number; height: number };
  try {
    size = clipboardPngDimensions(imageDataUrl);
  } catch (error) {
    throw clipboardFailure(
      imageDataUrl.length > MAX_CLIPBOARD_PNG_LENGTH ||
        (error instanceof Error && error.message === CLIPBOARD_IMAGE_LIMIT_MESSAGE)
        ? 'too-large'
        : 'decode',
      error instanceof Error ? error.message : 'The annotated PNG could not be read.',
    );
  }
  try {
    const image = nativeImage.createFromDataURL(imageDataUrl);
    if (image.isEmpty() || image.getSize().width !== size.width || image.getSize().height !== size.height)
      throw clipboardFailure(
        'decode',
        'The annotated image could not be decoded. Use the exported PNG instead.',
      );
    return image;
  } catch (error) {
    if (error instanceof NativeWorkflowError) throw error;
    throw clipboardFailure(
      'decode',
      error instanceof Error ? error.message : 'The annotated image could not be decoded.',
    );
  }
}

export function validateDecodedPromptPng(
  png: Uint8Array,
  expected: Pick<PromptBundleManifestItem, 'width' | 'height'>,
): void {
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
    const size = image.getSize();
    if (!image.isEmpty() && size.width === expected.width && size.height === expected.height) return;
  } catch {
    // Decoder exceptions and dimension mismatches both reject the renderer's PNG.
  }
  throw new NativeWorkflowError(
    'invalid-input',
    'Prompt PNG could not be fully decoded at its reserved dimensions.',
  );
}

export function nativeClipboardOwnerHandle(owner: BrowserWindow | null): Buffer {
  try {
    if (!owner || owner.isDestroyed())
      throw clipboardFailure('rejected', 'A live Imnota window is required for clipboard access.');
    return owner.getNativeWindowHandle();
  } catch (error) {
    throw nativeClipboardFailure(error);
  }
}
