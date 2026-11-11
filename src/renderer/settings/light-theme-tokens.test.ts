import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accentTokens } from '../app/useAppearance';

function themeCustomProperties(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing selector ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const block = css.slice(open + 1, close);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) {
    tokens[`--${match[1]}`] = match[2].trim();
  }
  return tokens;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(value)) throw new Error(`Expected hex color, received ${hex}`);
  return (
    0.2126 * channel(Number.parseInt(value.slice(0, 2), 16)) +
    0.7152 * channel(Number.parseInt(value.slice(2, 4), 16)) +
    0.0722 * channel(Number.parseInt(value.slice(4, 6), 16))
  );
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('light theme tokens', () => {
  const css = readFileSync(resolve('src/renderer/styles.css'), 'utf8');
  const light = themeCustomProperties(css, ":root[data-theme='light']");
  const indigoHover = accentTokens('indigo', 'light').hover;

  it('keeps existing cyan and success text roles', () => {
    expect(light['--text-cyan']).toBe('#0369a1');
    expect(light['--text-success']).toBe('#15803d');
  });

  it('meets WCAG AA contrast on solid light surfaces', () => {
    expect(light['--imnota-accent-hover']).toBe(indigoHover);
    const backgrounds = [light['--surface'], light['--bg']];
    for (const background of backgrounds) {
      expect(contrastRatio(light['--ink-2'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--ink-3'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--ink-4'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--danger'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(indigoHover, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
