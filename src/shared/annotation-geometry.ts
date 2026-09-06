import type { Annotation } from './types';

export const NOTE_BADGE_GAP = 8;
export const NOTE_BADGE_HEIGHT = 20;

export interface TextMeasureStyle {
  fontFamily: string;
  fontSize: number;
  fontStyle: string;
}

export type TextWidthMeasurer = (text: string, style: TextMeasureStyle) => number;

export interface TextLayout {
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  padding: number;
  lineCount: number;
  wrappedText: string;
}

function graphemes(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

/** DOM-free fallback; browser renderers inject CanvasRenderingContext2D.measureText. */
export const conservativeTextWidth: TextWidthMeasurer = (text, style) =>
  graphemes(text).length * style.fontSize * 1.2;

function measuredLines(
  text: string,
  usableWidth: number,
  style: TextMeasureStyle,
  measureWidth: TextWidthMeasurer,
): string[] {
  const result: string[] = [];
  for (const paragraph of (text || ' ').split('\n')) {
    const characters = graphemes(paragraph || ' ');
    let line = '';
    for (const character of characters) {
      const candidate = line + character;
      if (line && measureWidth(candidate, style) > usableWidth) {
        result.push(line);
        line = character;
      } else line = candidate;
    }
    result.push(line);
  }
  return result;
}

/** Uses injected real glyph metrics and grapheme wrapping so wide/custom glyphs cannot be clipped. */
export function textAnnotationLayout(
  annotation: Annotation,
  measureWidth: TextWidthMeasurer = conservativeTextWidth,
): TextLayout {
  const padding = annotation.kind === 'callout' ? 10 : 6;
  const width = Math.max(72, Math.abs(annotation.width ?? (annotation.kind === 'callout' ? 240 : 260)));
  const fontSize = Math.max(8, annotation.fontSize ?? (annotation.kind === 'callout' ? 18 : 24));
  const lineHeight = fontSize * 1.25;
  const style = {
    fontFamily: annotation.fontFamily ?? 'Arial',
    fontSize,
    fontStyle: annotation.fontStyle ?? 'normal',
  };
  const lines = measuredLines(annotation.text ?? '', Math.max(1, width - padding * 2), style, measureWidth);
  const widestLine = Math.max(...lines.map((line) => measureWidth(line, style)), 0);
  const measuredWidth = Math.max(width, Math.ceil(widestLine + padding * 2));
  const lineCount = lines.length;
  const measuredHeight = Math.ceil(lineCount * lineHeight + padding * 2);
  return {
    width: measuredWidth,
    height: Math.max(Math.abs(annotation.height ?? 0), measuredHeight),
    fontSize,
    lineHeight,
    padding,
    lineCount,
    wrappedText: lines.join('\n'),
  };
}

export function noteBadgeWidth(noteNumber: number): number {
  return 48 + String(noteNumber).length * 7;
}
