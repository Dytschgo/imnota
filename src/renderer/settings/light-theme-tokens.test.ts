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

// Test-only opaque hex/numeric OKLCH tokens. Reject out-of-gamut colors instead
// of guessing browser gamut mapping. Public-domain Oklab conversion equations:
// https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
function linearChannels(color: string): number[] {
  if (/^#[\da-f]{6}$/i.test(color))
    return [1, 3, 5].map((offset) => channel(Number.parseInt(color.slice(offset, offset + 2), 16)));
  const match = /^oklch\((\d*\.?\d+) (\d*\.?\d+) (\d*\.?\d+|none)\)$/.exec(color);
  if (!match) throw new Error(`Unsupported test color: ${color}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (match[3] === 'none' ? 0 : Number(match[3])) * (Math.PI / 180);
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (rgb.some((value) => !Number.isFinite(value) || value < -1e-7 || value > 1 + 1e-7))
    throw new Error(`Test color must be in the sRGB gamut: ${color}`);
  return rgb;
}

function relativeLuminance(color: string): number {
  const [r, g, b] = linearChannels(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

  it.each([
    ['oklch(0 0 none)', 0],
    ['oklch(1 0 none)', 1],
    ['oklch(0.5 0 none)', 0.125],
  ] as const)('calculates the reference luminance of %s', (color, expected) => {
    expect(relativeLuminance(color)).toBeCloseTo(expected, 6);
  });

  it('matches the CSS Color 4 in-gamut chromatic reference', () => {
    // https://www.w3.org/TR/css-color-4/#color-conversion-code
    expect(relativeLuminance('oklch(0.65 0.15 270)')).toBeCloseTo(relativeLuminance('#6c88ea'), 2);
    expect(() => relativeLuminance('oklch(0.5 0.5 150)')).toThrow('sRGB gamut');
  });

  it('meets WCAG AA contrast on solid light surfaces', () => {
    expect(light['--imnota-accent-hover']).toBe(indigoHover);
    const backgrounds = [light['--surface'], light['--surface-2'], light['--bg']];
    for (const background of backgrounds) {
      expect(contrastRatio(light['--ink-2'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--ink-3'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--ink-4'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--danger'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--text-cyan'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light['--text-success'], background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(indigoHover, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
