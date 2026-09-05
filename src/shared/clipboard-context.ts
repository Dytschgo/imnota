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
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length, prefix.length + 44)), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('The annotated PNG could not be read. Export it again.');
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte))
    throw new Error('The annotated PNG could not be read. Export it again.');
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  checkClipboardDimensions(width, height);
  return { width, height };
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
