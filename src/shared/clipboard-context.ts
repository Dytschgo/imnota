import { PNG_HEADER_BYTES, readPngHeader } from './png.js';

export const MAX_CLIPBOARD_EDGE = 8192;
export const MAX_CLIPBOARD_PIXELS = 16_000_000;
export const MAX_CLIPBOARD_PNG_LENGTH = 32_000_000;
export const CLIPBOARD_IMAGE_LIMIT_MESSAGE =
  'These images are too large to combine at full resolution. Copy individual images or attach the exported PNG files instead.';

export function checkClipboardDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('The annotated PNG has invalid dimensions. Export it again.');
  if (width > MAX_CLIPBOARD_EDGE || height > MAX_CLIPBOARD_EDGE || width * height > MAX_CLIPBOARD_PIXELS)
    throw new Error(CLIPBOARD_IMAGE_LIMIT_MESSAGE);
}

/** Read the PNG header before allocating a decoded bitmap, in either process. */
export function clipboardPngDimensions(dataUrl: string): { width: number; height: number } {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix) || dataUrl.length > MAX_CLIPBOARD_PNG_LENGTH)
    throw new Error('The annotated PNG is invalid or too large. Use the exported PNG files instead.');
  let header: ReturnType<typeof readPngHeader>;
  try {
    // Decode only the signature and IHDR chunk before allocating anything larger.
    const base64 = dataUrl.slice(prefix.length, prefix.length + (PNG_HEADER_BYTES / 3) * 4);
    header = readPngHeader(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  } catch {
    header = undefined;
  }
  if (!header) throw new Error('The annotated PNG could not be read. Export it again.');
  checkClipboardDimensions(header.width, header.height);
  return { width: header.width, height: header.height };
}

export function contactSheetLayout(sizes: Array<{ width: number; height: number }>) {
  if (!sizes.length) throw new Error('No screenshots are selected. Copy the Markdown text instead.');
  if (sizes.length > 20) throw new Error(CLIPBOARD_IMAGE_LIMIT_MESSAGE);
  sizes.forEach(({ width, height }) => checkClipboardDimensions(width, height));
  let y = 16;
  const items = sizes.map(({ width, height }) => {
    const item = { x: 16, y: y + 40, labelY: y + 24, width, height };
    y += 40 + height + 16;
    return item;
  });
  const width = Math.max(...sizes.map((s) => s.width)) + 32;
  checkClipboardDimensions(width, y);
  return { width, height: y, items };
}

/** Deliberately plain generated HTML, never interpreted imported Markdown. */
export function clipboardContextHtml(markdown: string): string {
  const escaped = markdown.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
  return `<pre>${escaped}</pre>`;
}
