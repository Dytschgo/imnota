import { describe, expect, it } from 'vitest';
import { describeCopyDelivery, describeCopyMessage } from './clipboard-delivery';

describe('clipboard variant reporting', () => {
  it('reports rich formats without claiming receiver behavior', () => {
    expect(describeCopyDelivery('rich', { text: true, html: true, image: true, files: false }, true)).toEqual(
      { outcome: 'combined' },
    );
    expect(describeCopyMessage('rich', { text: true, html: true, image: true, files: false })).toMatch(
      /may paste only one format/i,
    );
  });

  it('reports exact file-list readback separately from plain paths', () => {
    expect(
      describeCopyDelivery('files', { text: false, html: false, image: false, files: true }, true),
    ).toMatchObject({
      outcome: 'files',
      warning: expect.stringMatching(/receiving app.*decides/i),
    });
    expect(
      describeCopyDelivery('files', { text: false, html: false, image: false, files: false }, true),
    ).toMatchObject({ outcome: 'files', warning: expect.stringContaining('Copy file paths') });
  });

  it('lists every confirmed files-rich representation without promising a combined paste', () => {
    const placed = { text: true, html: true, image: true, files: true };
    expect(describeCopyDelivery('files-rich', placed, true)).toMatchObject({
      outcome: 'files',
      warning: expect.stringMatching(/files, Markdown, HTML and image.*chooses/i),
    });
    expect(describeCopyMessage('files-rich', placed)).toMatch(/may choose only one representation/i);
  });

  it('points partial rich copies at exact separate fallbacks', () => {
    expect(
      describeCopyDelivery('rich', { text: true, html: true, image: false, files: false }, true),
    ).toMatchObject({
      outcome: 'markdown',
      warning: expect.stringMatching(/Image was not confirmed.*Copy PNG or Open files/i),
    });
    expect(
      describeCopyDelivery('rich', { text: false, html: false, image: true, files: false }, true),
    ).toMatchObject({
      outcome: 'image',
      warning: expect.stringMatching(/Markdown was not confirmed.*Copy Markdown or Open files/i),
    });
    expect(
      describeCopyDelivery('rich', { text: false, html: false, image: false, files: false }, true),
    ).toMatchObject({
      outcome: 'files',
      warning: expect.stringMatching(
        /Markdown and image were not confirmed.*Copy Markdown, Copy PNG, or Open files/,
      ),
    });
  });

  it('does not claim Markdown + image when read-back fails', () => {
    expect(describeCopyDelivery('rich', undefined, true)).toMatchObject({
      outcome: 'files',
      warning: expect.stringMatching(/could not be confirmed.*Copy Markdown, Copy PNG, or Open files/),
    });
    expect(describeCopyMessage('rich', { text: true, html: true, image: false, files: false })).toMatch(
      /Image was not confirmed/i,
    );
    expect(describeCopyMessage('rich', { text: false, html: false, image: true, files: false })).toMatch(
      /Markdown was not confirmed/i,
    );
  });
});
