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
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): CaptureDisplay;
  physicalDisplaySize(display: CaptureDisplay): { width: number; height: number };
  getSources(options: {
    types: ['screen'];
    thumbnailSize: { width: number; height: number };
  }): Promise<DesktopCaptureSource[]>;
  createImage(png: Buffer): NativeImage;
}

export class CaptureService {
  constructor(private readonly dependencies: CaptureServiceDependencies) {}

  async captureCursorDisplay(): Promise<CapturedDisplayImage> {
    return this.captureDisplay(
      this.dependencies.getDisplayNearestPoint(this.dependencies.getCursorScreenPoint()),
    );
  }

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
}
