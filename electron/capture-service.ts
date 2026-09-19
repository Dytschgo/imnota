import type { NativeImage } from 'electron';
import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';
import {
  MAX_CAPTURE_DIMENSION,
  MAX_CAPTURE_PIXELS,
  captureRectangleToImagePixels,
} from '../src/shared/capture.js';

export class CaptureServiceError extends Error {
  constructor(
    readonly kind: 'sources-unavailable' | 'empty-region',
    message: string,
  ) {
    super(message);
    this.name = 'CaptureServiceError';
  }
}

export interface CapturedDisplayImage {
  display: CaptureDisplay;
  png: Buffer;
  imageSize: { width: number; height: number };
}

export interface DesktopCaptureSource {
  display_id: string;
  thumbnail: NativeImage;
}

export interface CaptureServiceDependencies {
  physicalDisplaySize(display: CaptureDisplay): { width: number; height: number };
  getSources(options: {
    types: ['screen'];
    thumbnailSize: { width: number; height: number };
  }): Promise<DesktopCaptureSource[]>;
  createImage(png: Buffer): NativeImage;
  createBitmapImage(bitmap: Buffer, size: { width: number; height: number }): NativeImage;
}

interface CaptureCompositePart {
  capture: CapturedDisplayImage;
  source: CaptureRectangle;
  destination: CaptureRectangle;
}

interface CaptureCompositePlan {
  width: number;
  height: number;
  parts: CaptureCompositePart[];
}

function intersection(left: CaptureRectangle, right: CaptureRectangle): CaptureRectangle | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const edgeX = Math.min(left.x + left.width, right.x + right.width);
  const edgeY = Math.min(left.y + left.height, right.y + right.height);
  return edgeX > x && edgeY > y ? { x, y, width: edgeX - x, height: edgeY - y } : null;
}

/**
 * Use the densest intersected display as one output pixel grid. This preserves
 * detail from high-DPI sources while keeping cross-display DIP geometry aligned.
 */
export function captureCompositePlan(
  captures: readonly CapturedDisplayImage[],
  selection: CaptureRectangle,
): CaptureCompositePlan | null {
  if (
    ![selection.x, selection.y, selection.width, selection.height].every(Number.isFinite) ||
    selection.width <= 0 ||
    selection.height <= 0
  )
    return null;
  const intersected = captures.flatMap((capture) => {
    const area = intersection(selection, capture.display.bounds);
    return area ? [{ capture, area }] : [];
  });
  if (!intersected.length) return null;
  const scaleX = Math.max(
    ...intersected.map(({ capture }) => capture.imageSize.width / capture.display.bounds.width),
  );
  const scaleY = Math.max(
    ...intersected.map(({ capture }) => capture.imageSize.height / capture.display.bounds.height),
  );
  const width = Math.ceil(selection.width * scaleX);
  const height = Math.ceil(selection.height * scaleY);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_CAPTURE_DIMENSION ||
    height > MAX_CAPTURE_DIMENSION ||
    width * height > MAX_CAPTURE_PIXELS
  )
    return null;
  const parts = intersected.flatMap(({ capture, area }) => {
    const source = captureRectangleToImagePixels(
      {
        x: area.x - capture.display.bounds.x,
        y: area.y - capture.display.bounds.y,
        width: area.width,
        height: area.height,
      },
      capture.display.bounds,
      capture.imageSize,
    );
    if (!source) return [];
    const x = Math.floor((area.x - selection.x) * scaleX);
    const y = Math.floor((area.y - selection.y) * scaleY);
    const edgeX = Math.ceil((area.x + area.width - selection.x) * scaleX);
    const edgeY = Math.ceil((area.y + area.height - selection.y) * scaleY);
    return [{ capture, source, destination: { x, y, width: edgeX - x, height: edgeY - y } }];
  });
  return parts.length ? { width, height, parts } : null;
}

export class CaptureService {
  constructor(private readonly dependencies: CaptureServiceDependencies) {}

  async captureDisplay(display: CaptureDisplay): Promise<CapturedDisplayImage> {
    const requested = this.dependencies.physicalDisplaySize(display);
    if (
      requested.width < 1 ||
      requested.height < 1 ||
      requested.width > MAX_CAPTURE_DIMENSION ||
      requested.height > MAX_CAPTURE_DIMENSION ||
      requested.width * requested.height > MAX_CAPTURE_PIXELS
    )
      throw new CaptureServiceError(
        'sources-unavailable',
        'The selected display has unsupported dimensions.',
      );
    // Never use desktopCapturer's 150x150 default. Electron does not promise
    // this exact size, so imageSize below remains the crop authority.
    let sources: DesktopCaptureSource[];
    try {
      sources = await this.dependencies.getSources({ types: ['screen'], thumbnailSize: requested });
    } catch {
      throw new CaptureServiceError(
        'sources-unavailable',
        'The operating system did not provide a screen capture source.',
      );
    }
    const source = sources.find((candidate) => candidate.display_id === String(display.id));
    let imageSize: { width: number; height: number };
    try {
      if (!source || source.thumbnail.isEmpty())
        throw new CaptureServiceError(
          'sources-unavailable',
          'No capture source is available for the selected display.',
        );
      imageSize = source.thumbnail.getSize();
    } catch (error) {
      if (error instanceof CaptureServiceError) throw error;
      throw new CaptureServiceError('sources-unavailable', 'The screen capture source could not be read.');
    }
    if (
      imageSize.width !== requested.width ||
      imageSize.height !== requested.height ||
      imageSize.width < 1 ||
      imageSize.height < 1 ||
      imageSize.width > MAX_CAPTURE_DIMENSION ||
      imageSize.height > MAX_CAPTURE_DIMENSION ||
      imageSize.width * imageSize.height > MAX_CAPTURE_PIXELS
    )
      throw new CaptureServiceError(
        'sources-unavailable',
        'The display capture was not returned at full display resolution.',
      );
    try {
      const png = source.thumbnail.toPNG();
      if (!Buffer.isBuffer(png) || png.byteLength === 0) throw new Error('The screen capture PNG is empty.');
      return { display, png, imageSize };
    } catch {
      throw new CaptureServiceError(
        'sources-unavailable',
        'The display capture could not be encoded as a PNG.',
      );
    }
  }

  crop(capture: CapturedDisplayImage, selection: CaptureRectangle): Buffer {
    const crop = captureRectangleToImagePixels(selection, capture.display.bounds, capture.imageSize);
    if (!crop)
      throw new CaptureServiceError('empty-region', 'Select a non-empty area before saving the capture.');
    try {
      const image = this.dependencies.createImage(capture.png);
      if (image.isEmpty()) throw new Error('The screen capture PNG could not be decoded.');
      const png = image.crop(crop).toPNG();
      if (!Buffer.isBuffer(png) || png.byteLength === 0) throw new Error('The selected PNG is empty.');
      return png;
    } catch {
      throw new CaptureServiceError(
        'sources-unavailable',
        'The selected screen area could not be prepared as a PNG.',
      );
    }
  }

  compose(captures: readonly CapturedDisplayImage[], selection: CaptureRectangle): Buffer {
    const plan = captureCompositePlan(captures, selection);
    if (!plan)
      throw new CaptureServiceError('empty-region', 'Select a supported non-empty area before saving.');
    try {
      // Electron bitmaps are BGRA. Transparent pixels represent uncovered gaps
      // in irregular monitor layouts without inventing desktop content.
      const bitmap = Buffer.alloc(plan.width * plan.height * 4);
      for (const part of plan.parts) {
        let image = this.dependencies.createImage(part.capture.png).crop(part.source);
        if (part.source.width !== part.destination.width || part.source.height !== part.destination.height)
          image = image.resize({
            width: part.destination.width,
            height: part.destination.height,
            quality: 'best',
          });
        const sourceBitmap = image.toBitmap();
        const expectedBytes = part.destination.width * part.destination.height * 4;
        if (sourceBitmap.byteLength !== expectedBytes) throw new Error('Unexpected capture bitmap size.');
        for (let row = 0; row < part.destination.height; row += 1) {
          const sourceStart = row * part.destination.width * 4;
          const targetStart = ((part.destination.y + row) * plan.width + part.destination.x) * 4;
          sourceBitmap.copy(bitmap, targetStart, sourceStart, sourceStart + part.destination.width * 4);
        }
      }
      const composed = this.dependencies.createBitmapImage(bitmap, {
        width: plan.width,
        height: plan.height,
      });
      const png = composed.toPNG();
      if (composed.isEmpty() || !Buffer.isBuffer(png) || png.byteLength === 0)
        throw new Error('The composed capture PNG is empty.');
      return png;
    } catch {
      throw new CaptureServiceError(
        'sources-unavailable',
        'The selected screen area could not be composed as a PNG.',
      );
    }
  }
}
