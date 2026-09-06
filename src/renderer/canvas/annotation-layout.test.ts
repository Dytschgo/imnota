import { describe, expect, test } from 'vitest';
import {
  edgePanVelocity,
  exportContrastColor,
  liveTextColor,
  textAnnotationLayout,
} from './annotation-layout';

describe('annotation canvas helpers', () => {
  test('ramps edge panning gently and progressively', () => {
    const middle = edgePanVelocity({ x: 500, y: 300 }, { width: 1000, height: 600 });
    const near = edgePanVelocity({ x: 950, y: 300 }, { width: 1000, height: 600 });
    const edge = edgePanVelocity({ x: 1000, y: 300 }, { width: 1000, height: 600 });
    expect(middle).toEqual({ x: 0, y: 0 });
    expect(near.x).toBeGreaterThan(0);
    expect(edge.x).toBeGreaterThan(near.x);
    expect(edge.x).toBeLessThanOrEqual(18);
  });

  test('maps semantic text between themes without changing a chromatic override', () => {
    expect(liveTextColor('#ffffff', 'light')).toBe('#111827');
    expect(liveTextColor('#111827', 'dark')).toBe('#ffffff');
    expect(liveTextColor('#ef4444', 'dark')).toBe('#ef4444');
  });

  test('grows wrapped text beyond a stale stored height', () => {
    const layout = textAnnotationLayout({
      id: 'text',
      kind: 'text',
      x: 0,
      y: 0,
      width: 120,
      height: 20,
      fontSize: 20,
      text: 'A deliberately long annotation that wraps onto several lines',
      zIndex: 0,
    });
    expect(layout.height).toBeGreaterThan(80);
  });

  test.each([
    ['long W glyphs', 'WWWWWWWWWW', 20],
    ['CJK wide glyphs', '界界界界界界界界界界', 18],
    ['emoji graphemes', '🧑‍💻🧑‍💻🧑‍💻🧑‍💻🧑‍💻', 24],
  ])('uses injected real-width metrics for %s', (_label, text, glyphWidth) => {
    const measure = (candidate: string) => Array.from(candidate).length * glyphWidth;
    const layout = textAnnotationLayout(
      {
        id: 'wide',
        kind: 'text',
        x: 0,
        y: 0,
        width: 72,
        height: 10,
        fontSize: 16,
        fontFamily: 'Custom Wide',
        text,
        zIndex: 0,
      },
      measure,
    );
    expect(layout.lineCount).toBeGreaterThan(1);
    expect(layout.wrappedText).toContain('\n');
    expect(layout.height).toBeGreaterThan(50);
  });

  test('normalizes pale export colors to readable equivalents', () => {
    expect(exportContrastColor('#ffffff')).not.toBe('#ffffff');
    expect(exportContrastColor('#22c55e')).not.toBe('#22c55e');
    expect(exportContrastColor('#111827')).toBe('#111827');
  });
});
