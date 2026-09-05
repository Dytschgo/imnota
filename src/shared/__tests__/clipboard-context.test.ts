import { expect, it } from 'vitest';
import { clipboardContextHtml, clipboardPngDimensions, contactSheetLayout } from '../clipboard-context';

function header(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
}
it('reads dimensions before decoding and rejects oversized or damaged headers', () => {
  expect(clipboardPngDimensions(header(100, 200))).toEqual({ width: 100, height: 200 });
  expect(() => clipboardPngDimensions(header(100000, 100000))).toThrow(/too large/);
  expect(() => clipboardPngDimensions(header(0, 10))).toThrow(/invalid/);
  expect(() => clipboardPngDimensions('data:image/png;base64,aGVsbG8=')).toThrow(/could not be read/);
  expect(() => clipboardPngDimensions('file:///private.png')).toThrow(/invalid/);
});
it('lays out references in order at their full resolution', () => {
  const layout = contactSheetLayout([
    { width: 100, height: 200 },
    { width: 300, height: 400 },
  ]);
  expect(layout).toEqual({
    width: 332,
    height: 728,
    items: [
      { x: 16, y: 56, labelY: 40, width: 100, height: 200 },
      { x: 16, y: 312, labelY: 296, width: 300, height: 400 },
    ],
  });
});
it('refuses empty or excessive sheets instead of silently shrinking them', () => {
  expect(() => contactSheetLayout([])).toThrow(/No screenshots/);
  expect(() => contactSheetLayout(Array(21).fill({ width: 1, height: 1 }))).toThrow(/too large/);
  expect(() => contactSheetLayout(Array(5).fill({ width: 3840, height: 2160 }))).toThrow(/too large/);
});
it('escapes imported text into inert HTML without links or executable markup', () => {
  const html = clipboardContextHtml('<script>alert("x")</script> & [link](https://example.com)');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<a');
  expect(html).toContain('&amp;');
});
