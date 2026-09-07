import { exportToBlob, getNonDeletedElements, restore } from '@excalidraw/excalidraw';
import type { ImagePayload } from '../../shared/types';

const EMPTY_WIDTH = 160;
const EMPTY_HEIGHT = 120;
const EXPORT_PADDING = 24;
const MAX_EXPORT_SIDE = 4096;
const MAX_EXPORT_PIXELS = 16_000_000;

export type DrawingSource = {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

const ALLOWED_ELEMENT_TYPES = new Set([
  'arrow',
  'diamond',
  'ellipse',
  'frame',
  'freedraw',
  'line',
  'rectangle',
  'text',
]);

export class DrawingSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawingSourceError';
  }
}

export function isAllowedDrawingElement(element: unknown): boolean {
  const type = element && typeof element === 'object' ? (element as { type?: unknown }).type : undefined;
  return typeof type === 'string' && ALLOWED_ELEMENT_TYPES.has(type);
}

/** Validates the local-only subset before it reaches Excalidraw or an exporter. */
export function parseDrawingSource(source: string): Required<DrawingSource> {
  if (!source.trim()) return { elements: [], appState: {}, files: {} };

  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object')
      throw new DrawingSourceError('Drawing source is not an object.');

    const drawing = parsed as DrawingSource;
    if (!Array.isArray(drawing.elements))
      throw new DrawingSourceError('Drawing source does not contain an elements array.');
    if (drawing.appState !== undefined && (!drawing.appState || typeof drawing.appState !== 'object'))
      throw new DrawingSourceError('Drawing source has an invalid app state.');
    if (drawing.files !== undefined && (!drawing.files || typeof drawing.files !== 'object'))
      throw new DrawingSourceError('Drawing source has invalid files.');
    if (drawing.files && Object.keys(drawing.files).length > 0)
      throw new DrawingSourceError('Images and other binary files are not supported in local drawings.');

    if (!drawing.elements.every(isAllowedDrawingElement))
      throw new DrawingSourceError('Drawing source contains an unsupported element type.');

    return { elements: drawing.elements, appState: drawing.appState ?? {}, files: {} };
  } catch {
    throw new DrawingSourceError(
      'This drawing could not be read safely. Its original source was left unchanged.',
    );
  }
}

function emptyDrawing(): ImagePayload {
  const canvas = document.createElement('canvas');
  canvas.width = EMPTY_WIDTH;
  canvas.height = EMPTY_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable for drawing export.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, EMPTY_WIDTH, EMPTY_HEIGHT);

  return {
    filename: 'drawing.png',
    dataUrl: canvas.toDataURL('image/png'),
    width: EMPTY_WIDTH,
    height: EMPTY_HEIGHT,
  };
}

function exportDimensions(width: number, height: number) {
  // Excalidraw supplies bounds with exportPadding already included. Its scale
  // transforms the drawing, but the callback must scale the canvas dimensions too.
  const maximumScale = Math.min(
    MAX_EXPORT_SIDE / Math.max(width, height),
    Math.sqrt(MAX_EXPORT_PIXELS / (width * height)),
  );
  const scale = Math.min(2, maximumScale);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

/**
 * Produces the persisted preview for a genuine Excalidraw scene. The exporter
 * determines the content bounds, including arrows connected to moved shapes.
 */
export async function renderDrawing(source: string): Promise<ImagePayload> {
  const parsed = parseDrawingSource(source);
  const restored = restore(
    {
      elements: parsed.elements,
      appState: parsed.appState,
      files: parsed.files,
    } as Parameters<typeof restore>[0],
    null,
    null,
    { repairBindings: true },
  );
  const elements = getNonDeletedElements(restored.elements);

  if (!elements.length) return emptyDrawing();

  const blob = await exportToBlob({
    elements,
    appState: {
      ...restored.appState,
      exportBackground: true,
      exportEmbedScene: false,
      exportWithDarkMode: false,
      viewBackgroundColor: '#ffffff',
    },
    files: restored.files,
    exportPadding: EXPORT_PADDING,
    getDimensions: exportDimensions,
    mimeType: 'image/png',
    quality: 1,
  });
  const dataUrl = await blobToDataUrl(blob);

  return {
    filename: 'drawing.png',
    dataUrl,
    width: await imageDimension(dataUrl, 'width'),
    height: await imageDimension(dataUrl, 'height'),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read drawing export.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function imageDimension(dataUrl: string, property: 'width' | 'height'): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Could not measure drawing export.'));
    image.onload = () => resolve(image[property]);
    image.src = dataUrl;
  });
}
