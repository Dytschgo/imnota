import { describe, expect, it } from 'vitest';
import type { ScreenshotRecord } from '../../shared/types';
import { screenshotSaveError } from './workflow';

const screenshot = (id: string, position: number, extra: Partial<ScreenshotRecord> = {}) =>
  ({
    id,
    position,
    collectionId: 'current',
    title: 'Checkout',
    originalFilename: 'screen.png',
    ...extra,
  }) as ScreenshotRecord;

describe('screenshotSaveError', () => {
  it('retains native error details and identifies the pre-exclusion picture, title and filename', () => {
    const target = screenshot('target', 2);
    const all = [
      target,
      screenshot('other', 0, { collectionId: 'other' }),
      screenshot('excluded', 1, { includeInExport: false }),
    ];
    expect(screenshotSaveError(target, all, new Error('Disk full'))).toContain(
      'Picture 2 — Checkout (screen.png). Disk full',
    );
    expect(all[0]).toBe(target);
  });

  it('does not invent a number for a missing screenshot or duplicate a filename title', () => {
    expect(screenshotSaveError(screenshot('missing', 0, { title: 'screen.png' }), [], null)).toContain(
      'Screenshot — screen.png. The save failed.',
    );
  });
});
