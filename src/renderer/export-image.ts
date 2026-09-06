import Konva from 'konva';
import { isTextAnnotation, textAnnotationNoteNumbers } from '../shared/annotation-order';
import {
  NOTE_BADGE_GAP,
  NOTE_BADGE_HEIGHT,
  noteBadgeWidth,
  textAnnotationLayout,
  type TextWidthMeasurer,
} from '../shared/annotation-geometry';
import { EXPORT_SAFETY_MARGIN, expandedExportBounds, exportBounds, type ImageBounds } from '../shared/crop';
import type { Annotation, ImagePayload } from '../shared/types';
import { createBrowserTextMeasurer, exportContrastColor } from './canvas/annotation-layout';
import { pixelatedRegion } from './pixelate';

export interface AnnotatedImageRender {
  dataUrl: string;
  width: number;
  height: number;
  /** Final output rectangle in source-world coordinates; x/y may be negative. */
  bounds: ImageBounds;
  /** The source-visible rectangle before annotation expansion. */
  sourceBounds: ImageBounds;
}

export interface AnnotatedImageRenderOptions {
  margin?: number;
}

/** Package builders should use the same limits during split/readability preflight. */
export const ANNOTATED_IMAGE_RENDER_LIMITS = Object.freeze({
  maxDimension: 16_384,
  maxPixels: 48_000_000,
  maxTextCharacters: 10_000,
  maxFontSize: 4_096,
});

export class AnnotatedImageRenderLimitError extends Error {
  readonly code = 'ANNOTATED_IMAGE_RENDER_LIMIT';

  constructor(message: string) {
    super(message);
    this.name = 'AnnotatedImageRenderLimitError';
  }
}

export function assertAnnotatedImageRenderBounds(bounds: ImageBounds): void {
  const { width, height } = bounds;
  const pixels = width * height;
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    throw new AnnotatedImageRenderLimitError(
      'The annotated image has invalid or non-finite geometry. Reset the outlying annotation and try again.',
    );
  if (
    width > ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension ||
    height > ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension ||
    pixels > ANNOTATED_IMAGE_RENDER_LIMITS.maxPixels
  )
    throw new AnnotatedImageRenderLimitError(
      `The annotated image would be ${width} × ${height} (${(pixels / 1_000_000).toFixed(1)} MP), ` +
        `above the safe render limit of ${ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension}px per side and ` +
        `${ANNOTATED_IMAGE_RENDER_LIMITS.maxPixels / 1_000_000} MP. Move distant annotations closer, reduce oversized text, or split the prompt before rendering.`,
    );
}

function assertFiniteInput(image: ImagePayload, annotations: readonly Annotation[]): void {
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1)
    throw new AnnotatedImageRenderLimitError(
      'The source image dimensions are invalid. Re-import the screenshot and try again.',
    );
  const fields = ['x', 'y', 'width', 'height', 'rotation', 'strokeWidth', 'fontSize'] as const;
  for (const annotation of annotations) {
    for (const field of fields) {
      const value = annotation[field];
      if (value !== undefined && !Number.isFinite(value))
        throw new AnnotatedImageRenderLimitError(
          `Annotation ${annotation.id} has an invalid ${field} value. Reset that annotation and try again.`,
        );
    }
    if (annotation.points?.some((point) => !Number.isFinite(point)))
      throw new AnnotatedImageRenderLimitError(
        `Annotation ${annotation.id} has invalid path coordinates. Reset that annotation and try again.`,
      );
    if ((annotation.text?.length ?? 0) > ANNOTATED_IMAGE_RENDER_LIMITS.maxTextCharacters)
      throw new AnnotatedImageRenderLimitError(
        `Annotation ${annotation.id} contains more than ${ANNOTATED_IMAGE_RENDER_LIMITS.maxTextCharacters.toLocaleString()} characters. Shorten or split that note before rendering.`,
      );
    if ((annotation.fontSize ?? 0) > ANNOTATED_IMAGE_RENDER_LIMITS.maxFontSize)
      throw new AnnotatedImageRenderLimitError(
        `Annotation ${annotation.id} uses a font size above ${ANNOTATED_IMAGE_RENDER_LIMITS.maxFontSize}px. Reduce that font size before rendering.`,
      );
    if (
      Math.abs(annotation.width ?? 0) > ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension ||
      Math.abs(annotation.height ?? 0) > ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension
    )
      throw new AnnotatedImageRenderLimitError(
        `Annotation ${annotation.id} is larger than ${ANNOTATED_IMAGE_RENDER_LIMITS.maxDimension}px on one side. Resize it before rendering.`,
      );
  }
}

function exportStroke(annotation: Annotation): string {
  return exportContrastColor(annotation.stroke ?? '#ef4444', 3);
}

function exportFill(annotation: Annotation): string | undefined {
  if (!annotation.fill || annotation.fill === 'transparent') return undefined;
  return exportContrastColor(annotation.fill, 3);
}

function baseConfig(annotation: Annotation, bounds: ImageBounds) {
  return {
    x: annotation.x - bounds.x,
    y: annotation.y - bounds.y,
    rotation: annotation.rotation ?? 0,
    opacity: annotation.kind === 'blur' ? 1 : (annotation.opacity ?? 1),
    stroke: exportStroke(annotation),
    strokeWidth: annotation.strokeWidth ?? 4,
    fill: exportFill(annotation),
  };
}

function addSource(
  layer: Konva.Layer,
  bitmap: HTMLImageElement,
  image: ImagePayload,
  bounds: ImageBounds,
  sourceBounds: ImageBounds,
) {
  const group = new Konva.Group({
    clipX: sourceBounds.x - bounds.x,
    clipY: sourceBounds.y - bounds.y,
    clipWidth: sourceBounds.width,
    clipHeight: sourceBounds.height,
  });
  group.add(
    new Konva.Image({
      image: bitmap,
      x: -bounds.x,
      y: -bounds.y,
      width: image.width,
      height: image.height,
      imageSmoothingEnabled: false,
    }),
  );
  layer.add(group);
}

function addPixelation(
  layer: Konva.Layer,
  bitmap: HTMLImageElement,
  annotation: Annotation,
  image: ImagePayload,
  bounds: ImageBounds,
  sourceBounds: ImageBounds,
) {
  const sampledBounds = exportBounds(image.width, image.height, [{ ...annotation, kind: 'crop' }]);
  const group = new Konva.Group({
    clipX: sourceBounds.x - bounds.x,
    clipY: sourceBounds.y - bounds.y,
    clipWidth: sourceBounds.width,
    clipHeight: sourceBounds.height,
  });
  group.add(
    new Konva.Image({
      image: pixelatedRegion(bitmap, annotation),
      x: sampledBounds.x - bounds.x,
      y: sampledBounds.y - bounds.y,
      width: sampledBounds.width,
      height: sampledBounds.height,
      imageSmoothingEnabled: false,
      opacity: 1,
    }),
  );
  layer.add(group);
}

function addBadge(group: Konva.Group, x: number, noteNumber: number) {
  const badgeWidth = noteBadgeWidth(noteNumber);
  const badge = new Konva.Group({ x, y: 0 });
  badge.add(
    new Konva.Rect({
      width: badgeWidth,
      height: NOTE_BADGE_HEIGHT,
      fill: '#111827',
      stroke: '#ffffff',
      strokeWidth: 1,
      cornerRadius: 5,
    }),
  );
  badge.add(
    new Konva.Text({
      text: `Note ${noteNumber}`,
      width: badgeWidth,
      height: NOTE_BADGE_HEIGHT,
      align: 'center',
      verticalAlign: 'middle',
      fill: '#ffffff',
      fontFamily: 'Arial',
      fontSize: 11,
      fontStyle: 'bold',
    }),
  );
  group.add(badge);
}

function addText(
  layer: Konva.Layer,
  annotation: Annotation,
  bounds: ImageBounds,
  noteNumber: number,
  measureText: TextWidthMeasurer,
) {
  const layout = textAnnotationLayout(annotation, measureText);
  const fill = exportContrastColor(
    annotation.fill === 'transparent'
      ? annotation.stroke
      : (annotation.fill ?? annotation.stroke ?? '#111827'),
    4.5,
  );
  const group = new Konva.Group({
    x: annotation.x - bounds.x,
    y: annotation.y - bounds.y,
    rotation: annotation.rotation ?? 0,
    opacity: annotation.opacity ?? 1,
  });
  group.add(
    new Konva.Text({
      text: layout.wrappedText,
      width: layout.width,
      height: layout.height,
      padding: layout.padding,
      wrap: 'none',
      lineHeight: 1.25,
      fontSize: layout.fontSize,
      fontFamily: annotation.fontFamily ?? 'Arial',
      fontStyle: annotation.fontStyle,
      align: annotation.align,
      fill,
      stroke: '#ffffff',
      strokeWidth: 3,
      lineJoin: 'round',
      fillAfterStrokeEnabled: true,
    }),
  );
  addBadge(group, layout.width + NOTE_BADGE_GAP, noteNumber);
  layer.add(group);
}

function addCallout(
  layer: Konva.Layer,
  annotation: Annotation,
  bounds: ImageBounds,
  noteNumber: number,
  measureText: TextWidthMeasurer,
) {
  const layout = textAnnotationLayout(annotation, measureText);
  const fill = exportContrastColor(annotation.fill ?? annotation.stroke ?? '#6857f5', 4.5);
  const group = new Konva.Group({
    x: annotation.x - bounds.x,
    y: annotation.y - bounds.y,
    rotation: annotation.rotation ?? 0,
    opacity: annotation.opacity ?? 1,
  });
  group.add(new Konva.Rect({ width: layout.width, height: layout.height, fill, cornerRadius: 8 }));
  group.add(
    new Konva.Text({
      text: layout.wrappedText,
      width: layout.width,
      height: layout.height,
      padding: layout.padding,
      wrap: 'none',
      lineHeight: 1.25,
      fill: '#ffffff',
      fontSize: layout.fontSize,
      fontFamily: annotation.fontFamily ?? 'Arial',
      fontStyle: annotation.fontStyle,
      align: annotation.align,
      verticalAlign: 'middle',
    }),
  );
  addBadge(group, layout.width + NOTE_BADGE_GAP, noteNumber);
  layer.add(group);
}

function addStep(layer: Konva.Layer, annotation: Annotation, bounds: ImageBounds) {
  const width = Math.max(2, Math.abs(annotation.width ?? 48));
  const height = Math.max(2, Math.abs(annotation.height ?? 48));
  const group = new Konva.Group({
    x: annotation.x - bounds.x,
    y: annotation.y - bounds.y,
    rotation: annotation.rotation ?? 0,
    opacity: annotation.opacity ?? 1,
  });
  group.add(
    new Konva.Ellipse({
      x: width / 2,
      y: height / 2,
      radiusX: width / 2,
      radiusY: height / 2,
      fill: exportContrastColor(annotation.fill ?? '#6857f5', 4.5),
      stroke: '#ffffff',
      strokeWidth: 2,
    }),
  );
  group.add(
    new Konva.Text({
      text: String(annotation.stepNumber ?? 1),
      width,
      height,
      fontSize: Math.min(width, height) * 0.46,
      fontStyle: 'bold',
      fill: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
    }),
  );
  layer.add(group);
}

function addAnnotation(
  layer: Konva.Layer,
  bitmap: HTMLImageElement,
  image: ImagePayload,
  annotation: Annotation,
  bounds: ImageBounds,
  sourceBounds: ImageBounds,
  noteNumber: number | undefined,
  measureText: TextWidthMeasurer,
) {
  if (annotation.kind === 'crop') return;
  if ((annotation.kind === 'text' || annotation.kind === 'callout') && !isTextAnnotation(annotation)) return;
  const width = Math.max(2, Math.abs(annotation.width ?? 20));
  const height = Math.max(2, Math.abs(annotation.height ?? 20));
  const config = baseConfig(annotation, bounds);
  switch (annotation.kind) {
    case 'arrow':
      layer.add(
        new Konva.Arrow({
          ...config,
          points: annotation.points ?? [0, 0, annotation.width ?? 10, annotation.height ?? 10],
          pointerLength: 12,
          pointerWidth: 10,
          pointerAtEnding: annotation.arrowhead !== false,
          fill: config.stroke,
        }),
      );
      return;
    case 'line':
    case 'pen':
      layer.add(
        new Konva.Line({
          ...config,
          points: annotation.points ?? [0, 0, annotation.width ?? 10, annotation.height ?? 10],
          lineCap: 'round',
          lineJoin: 'round',
        }),
      );
      return;
    case 'ellipse':
      layer.add(
        new Konva.Ellipse({
          ...config,
          x: annotation.x - bounds.x + width / 2,
          y: annotation.y - bounds.y + height / 2,
          radiusX: width / 2,
          radiusY: height / 2,
        }),
      );
      return;
    case 'text':
      addText(layer, annotation, bounds, noteNumber ?? 1, measureText);
      return;
    case 'callout':
      addCallout(layer, annotation, bounds, noteNumber ?? 1, measureText);
      return;
    case 'step':
      addStep(layer, annotation, bounds);
      return;
    case 'pixelate':
      addPixelation(layer, bitmap, annotation, image, bounds, sourceBounds);
      return;
    case 'blur':
      layer.add(new Konva.Rect({ ...config, width, height, fill: '#0b0d12', opacity: 1 }));
      return;
    default:
      layer.add(
        new Konva.Rect({
          ...config,
          width,
          height,
          cornerRadius: annotation.kind === 'rounded-rectangle' ? 8 : 0,
        }),
      );
  }
}

/** Render at native source scale on a white, annotation-expanded output surface. */
export async function renderAnnotatedImageWithDimensions(
  image: ImagePayload,
  annotations: Annotation[],
  options: AnnotatedImageRenderOptions = {},
): Promise<AnnotatedImageRender> {
  assertFiniteInput(image, annotations);
  await document.fonts?.ready;
  const measureText = createBrowserTextMeasurer();
  const sourceBounds = exportBounds(image.width, image.height, annotations);
  const bounds = expandedExportBounds(
    image.width,
    image.height,
    annotations,
    options.margin ?? EXPORT_SAFETY_MARGIN,
    measureText,
  );
  assertAnnotatedImageRenderBounds(bounds);
  const bitmap = new Image();
  bitmap.src = image.dataUrl;
  await bitmap.decode();
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: bounds.width, height: bounds.height });
  const layer = new Konva.Layer();
  stage.add(layer);
  try {
    layer.add(new Konva.Rect({ x: 0, y: 0, width: bounds.width, height: bounds.height, fill: '#ffffff' }));
    addSource(layer, bitmap, image, bounds, sourceBounds);
    const noteNumbers = textAnnotationNoteNumbers(annotations);
    for (const annotation of [...annotations].sort((left, right) => left.zIndex - right.zIndex))
      addAnnotation(
        layer,
        bitmap,
        image,
        annotation,
        bounds,
        sourceBounds,
        noteNumbers.get(annotation.id),
        measureText,
      );
    layer.draw();
    return {
      dataUrl: stage.toDataURL({ pixelRatio: 1 }),
      width: bounds.width,
      height: bounds.height,
      bounds,
      sourceBounds,
    };
  } finally {
    stage.destroy();
  }
}

/** Backward-compatible data-URL API used by the current App and context builder. */
export async function renderAnnotatedImage(image: ImagePayload, annotations: Annotation[]): Promise<string> {
  return (await renderAnnotatedImageWithDimensions(image, annotations)).dataUrl;
}
