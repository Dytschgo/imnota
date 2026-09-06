import type { AnnotationKind } from '../../shared/types';
import {
  conservativeTextWidth,
  type TextMeasureStyle,
  type TextWidthMeasurer,
} from '../../shared/annotation-geometry';
export {
  NOTE_BADGE_GAP,
  NOTE_BADGE_HEIGHT,
  conservativeTextWidth,
  noteBadgeWidth,
  textAnnotationLayout,
  type TextLayout,
  type TextMeasureStyle,
  type TextWidthMeasurer,
} from '../../shared/annotation-geometry';

export type CanvasTheme = 'light' | 'dark';

export const ANNOTATION_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
  '#3ec6e0',
  '#3b82f6',
  '#6857f5',
  '#111827',
  '#ffffff',
] as const;

/** Real browser glyph measurement shared by live layout and export preflight. */
export function createBrowserTextMeasurer(): TextWidthMeasurer {
  if (typeof document === 'undefined') return conservativeTextWidth;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return conservativeTextWidth;
  return (text: string, style: TextMeasureStyle) => {
    context.font = `${style.fontStyle} ${style.fontSize}px ${style.fontFamily}`;
    const metrics = context.measureText(text);
    const width = Math.max(
      metrics.width,
      (metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? 0),
    );
    return Number.isFinite(width) ? width : conservativeTextWidth(text, style);
  };
}

function normalizedHex(color: string | undefined): string | null {
  if (!color) return null;
  const value = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value))
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  return null;
}

export function themeTextColor(theme: CanvasTheme): string {
  return theme === 'dark' ? '#ffffff' : '#111827';
}

/** Black/white are semantic text defaults; chromatic overrides stay unchanged. */
export function liveTextColor(color: string | undefined, theme: CanvasTheme): string {
  const normalized = normalizedHex(color);
  if (!normalized || normalized === '#ffffff' || normalized === '#000000' || normalized === '#111827')
    return themeTextColor(theme);
  return color!;
}

export function semanticAnnotationColor(kind: AnnotationKind, theme: CanvasTheme): string {
  if (kind === 'text') return themeTextColor(theme);
  if (kind === 'highlight') return '#f59e0b';
  if (kind === 'step' || kind === 'callout') return '#6857f5';
  if (kind === 'blur') return '#0b0d12';
  return '#ef4444';
}

export interface EdgePanVelocity {
  x: number;
  y: number;
}

function axisVelocity(position: number, length: number, threshold: number, maximum: number): number {
  if (position < threshold) {
    const proximity = Math.min(1, Math.max(0, (threshold - position) / threshold));
    return -maximum * proximity * proximity;
  }
  if (position > length - threshold) {
    const proximity = Math.min(1, Math.max(0, (position - (length - threshold)) / threshold));
    return maximum * proximity * proximity;
  }
  return 0;
}

/** Quadratic ramp: gentle at the threshold, progressively faster at the edge. */
export function edgePanVelocity(
  pointer: { x: number; y: number },
  viewport: { width: number; height: number },
  threshold = 72,
  maximum = 18,
): EdgePanVelocity {
  return {
    x: axisVelocity(pointer.x, viewport.width, threshold, maximum),
    y: axisVelocity(pointer.y, viewport.height, threshold, maximum),
  };
}

function luminanceChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastWithWhite(red: number, green: number, blue: number): number {
  const luminance =
    0.2126 * luminanceChannel(red) + 0.7152 * luminanceChannel(green) + 0.0722 * luminanceChannel(blue);
  return 1.05 / (luminance + 0.05);
}

/** Darkens a hex intent only as much as needed for a white export surface. */
export function exportContrastColor(color: string | undefined, minimumContrast = 4.5): string {
  const normalized = normalizedHex(color);
  if (!normalized) return '#b42318';
  let red = Number.parseInt(normalized.slice(1, 3), 16);
  let green = Number.parseInt(normalized.slice(3, 5), 16);
  let blue = Number.parseInt(normalized.slice(5, 7), 16);
  while (contrastWithWhite(red, green, blue) < minimumContrast && (red > 0 || green > 0 || blue > 0)) {
    red = Math.max(0, Math.floor(red * 0.9));
    green = Math.max(0, Math.floor(green * 0.9));
    blue = Math.max(0, Math.floor(blue * 0.9));
  }
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
