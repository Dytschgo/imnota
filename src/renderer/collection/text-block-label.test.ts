import { describe, expect, it } from 'vitest';
import { textBlockLabel } from './text-block-label';

describe('textBlockLabel', () => {
  it.each([
    ['# Summary', 'Summary'],
    ['###   Steps to reproduce', 'Steps to reproduce'],
    ['> Quoted context', 'Quoted context'],
    ['- [x] Done item', 'Done item'],
    ['* Bullet', 'Bullet'],
    ['#hashtag stays', '#hashtag stays'],
    ['1. Numbered steps keep their number', '1. Numbered steps keep their number'],
    ['Plain first line', 'Plain first line'],
  ])('labels %j as %j', (preview, label) => {
    expect(textBlockLabel(preview)).toBe(label);
  });

  it('falls back when the first line is only a marker or missing', () => {
    expect(textBlockLabel('#')).toBe('Text block');
    expect(textBlockLabel(undefined)).toBe('Text block');
    expect(textBlockLabel('   ', 'Untitled')).toBe('Untitled');
  });
});
