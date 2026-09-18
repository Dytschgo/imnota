import { describe, expect, it } from 'vitest';
import { describeCombinedCopyMessage, describeCombinedDelivery } from './clipboard-delivery';

describe('combined clipboard delivery reporting', () => {
  it('claims a combined copy only when the clipboard confirmed text and image', () => {
    expect(describeCombinedDelivery({ text: true, html: true, image: true }, true)).toEqual({
      outcome: 'combined',
    });
    expect(describeCombinedDelivery(undefined, true)).toEqual({ outcome: 'combined' });
    expect(describeCombinedDelivery({ text: true, html: true, image: true }, false)).toEqual({
      outcome: 'markdown',
    });
  });

  it('names the missing format and its separate fallback', () => {
    expect(describeCombinedDelivery({ text: true, html: true, image: false }, true)).toMatchObject({
      outcome: 'markdown',
      warning: expect.stringContaining('Copy image'),
    });
    expect(describeCombinedDelivery({ text: false, html: false, image: true }, true)).toMatchObject({
      outcome: 'image',
      warning: expect.stringContaining('Copy Markdown'),
    });
    expect(describeCombinedDelivery({ text: false, html: false, image: false }, true)).toMatchObject({
      outcome: 'files',
      warning: expect.stringContaining('separately'),
    });
  });

  it('describes the compact combined copy without overclaiming', () => {
    expect(describeCombinedCopyMessage({ text: true, html: true, image: true })).toMatch(
      /some apps accept only one/,
    );
    expect(describeCombinedCopyMessage({ text: true, html: false, image: false })).toMatch(/Only the text/);
    expect(describeCombinedCopyMessage({ text: false, html: false, image: true })).toMatch(/Only the image/);
    expect(describeCombinedCopyMessage({ text: false, html: false, image: false })).toMatch(
      /could not confirm/,
    );
  });
});
