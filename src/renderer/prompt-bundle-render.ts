import {
  DEFAULT_PROMPT_BUNDLE_LIMITS,
  encodedOverflowBreak,
  type PromptBundle,
  type PromptBundleDelivery,
} from '../shared/prompt-bundles';

export interface DecodedPromptPng {
  source: unknown;
  width: number;
  height: number;
  release(): void;
}

export interface PromptCanvasContext {
  fillStyle: string;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  drawImage(source: unknown, x: number, y: number, width: number, height: number): void;
}

export interface PromptCanvasSurface {
  context: PromptCanvasContext;
  toPngDataUrl(): string;
  destroy(): void;
}

export interface PromptBundleRenderEnvironment {
  createSurface(width: number, height: number): PromptCanvasSurface;
  decodePng(dataUrl: string): Promise<DecodedPromptPng>;
  yieldControl(): Promise<void>;
}

export interface ComposedPromptBundle {
  kind: 'composed';
  dataUrl: string;
  width: number;
  height: number;
  encodedCharacters: number;
  delivery: PromptBundleDelivery;
  warning?: string;
}

export interface PromptBundleEncodedOverflow {
  kind: 'encoded-overflow';
  encodedCharacters: number;
  breakBeforeScreenshotId: string;
  message: string;
}

export type PromptBundleComposition = ComposedPromptBundle | PromptBundleEncodedOverflow;

export interface ResolvedPromptPicturePng {
  dataUrl: string;
  width: number;
  height: number;
  release?(): void;
}

export interface ComposePromptBundleOptions {
  maxClipboardPngCharacters?: number;
  maxCanvasEdge?: number;
  maxCanvasPixels?: number;
  environment?: PromptBundleRenderEnvironment;
  /** Resolve only the current bundle picture. The composer releases it before requesting the next. */
  resolvePicturePng?(picture: PromptBundle['pictures'][number]): Promise<ResolvedPromptPicturePng>;
}

const FILE_ONLY_WARNING =
  'This full-resolution prompt exceeds safe clipboard limits. Use the saved PNG and Markdown files instead.';
const DEFAULT_MAX_CANVAS_EDGE = 16_384;
const DEFAULT_MAX_CANVAS_PIXELS = 64_000_000;

function browserEnvironment(): PromptBundleRenderEnvironment {
  return {
    createSurface(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const nativeContext = canvas.getContext('2d');
      if (!nativeContext) throw new Error('Prompt bundle composition is unavailable on this device.');
      const context: PromptCanvasContext = {
        get fillStyle() {
          return String(nativeContext.fillStyle);
        },
        set fillStyle(value: string) {
          nativeContext.fillStyle = value;
        },
        get font() {
          return nativeContext.font;
        },
        set font(value: string) {
          nativeContext.font = value;
        },
        get textBaseline() {
          return nativeContext.textBaseline;
        },
        set textBaseline(value: CanvasTextBaseline) {
          nativeContext.textBaseline = value;
        },
        fillRect: (x, y, itemWidth, itemHeight) => nativeContext.fillRect(x, y, itemWidth, itemHeight),
        fillText: (text, x, y, maxWidth) => nativeContext.fillText(text, x, y, maxWidth),
        drawImage: (source, x, y, itemWidth, itemHeight) =>
          nativeContext.drawImage(source as CanvasImageSource, x, y, itemWidth, itemHeight),
      };
      return {
        context,
        toPngDataUrl: () => canvas.toDataURL('image/png'),
        destroy: () => {
          canvas.width = 0;
          canvas.height = 0;
        },
      };
    },
    async decodePng(dataUrl) {
      if (!dataUrl.startsWith('data:image/png;base64,'))
        throw new Error('Prompt screenshot is not a PNG data URL.');
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => {
          image.src = '';
        },
      };
    },
    yieldControl: () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
  };
}

function labelFor(pictureNumber: number, title: string, originalFilename: string): string {
  const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim() || originalFilename;
  return `Picture ${pictureNumber} — ${cleanTitle}`;
}

/**
 * Compose already-rendered, expanded, contrast-safe screenshot PNGs. This module
 * deliberately does not render annotations; the canvas export helper owns that.
 */
export async function composePromptBundle(
  bundle: PromptBundle,
  options: ComposePromptBundleOptions = {},
): Promise<PromptBundleComposition> {
  if (!bundle.pictures.length) throw new Error('A visual prompt bundle needs at least one screenshot.');
  const maxCharacters =
    options.maxClipboardPngCharacters ?? DEFAULT_PROMPT_BUNDLE_LIMITS.maxEstimatedPngCharacters;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1)
    throw new Error('Maximum clipboard PNG characters must be a positive integer.');
  const maxCanvasEdge = options.maxCanvasEdge ?? DEFAULT_MAX_CANVAS_EDGE;
  const maxCanvasPixels = options.maxCanvasPixels ?? DEFAULT_MAX_CANVAS_PIXELS;
  if (
    !Number.isSafeInteger(maxCanvasEdge) ||
    maxCanvasEdge < 1 ||
    !Number.isSafeInteger(maxCanvasPixels) ||
    maxCanvasPixels < 1
  )
    throw new Error('Prompt canvas safety limits must be positive integers.');
  if (
    bundle.layout.width > maxCanvasEdge ||
    bundle.layout.height > maxCanvasEdge ||
    bundle.layout.width * bundle.layout.height > maxCanvasPixels
  )
    throw new Error(
      'The full-resolution prompt exceeds local canvas safety limits. Save the expanded screenshot and Markdown separately.',
    );
  const environment = options.environment ?? browserEnvironment();
  const resolvePicturePng =
    options.resolvePicturePng ??
    (async (picture: PromptBundle['pictures'][number]): Promise<ResolvedPromptPicturePng> => {
      if (!picture.dataUrl)
        throw new Error(`Rendered PNG is not available for Picture ${picture.pictureNumber}.`);
      return { dataUrl: picture.dataUrl, width: picture.width, height: picture.height };
    });
  const surface = environment.createSurface(bundle.layout.width, bundle.layout.height);
  try {
    const context = surface.context;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, bundle.layout.width, bundle.layout.height);
    context.fillStyle = '#17191f';
    context.font = '600 24px sans-serif';
    context.textBaseline = 'top';

    for (const [index, picture] of bundle.pictures.entries()) {
      const item = bundle.layout.items[index];
      if (!item || item.screenshotId !== picture.screenshotId)
        throw new Error('Prompt bundle layout does not match its screenshot order.');
      context.fillText(
        labelFor(picture.pictureNumber, picture.title, picture.originalFilename),
        item.x,
        item.labelY,
        item.width,
      );
      const resolved = await resolvePicturePng(picture);
      try {
        if (
          resolved.width !== picture.width ||
          resolved.height !== picture.height ||
          !resolved.dataUrl.startsWith('data:image/png;base64,')
        )
          throw new Error(
            `Rendered dimensions changed for Picture ${picture.pictureNumber}. Export it again.`,
          );
        const decoded = await environment.decodePng(resolved.dataUrl);
        try {
          if (decoded.width !== picture.width || decoded.height !== picture.height)
            throw new Error(
              `Rendered dimensions changed for Picture ${picture.pictureNumber}. Export it again.`,
            );
          context.drawImage(decoded.source, item.x, item.imageY, picture.width, picture.height);
        } finally {
          decoded.release();
        }
      } finally {
        resolved.release?.();
      }
      await environment.yieldControl();
    }

    const dataUrl = surface.toPngDataUrl();
    if (!dataUrl.startsWith('data:image/png;base64,'))
      throw new Error('The composed prompt could not be encoded as PNG.');
    if (dataUrl.length > maxCharacters) {
      const breakBeforeScreenshotId = encodedOverflowBreak(bundle);
      if (breakBeforeScreenshotId)
        return {
          kind: 'encoded-overflow',
          encodedCharacters: dataUrl.length,
          breakBeforeScreenshotId,
          message: 'The encoded prompt is too large. Split it at the suggested screenshot and compose again.',
        };
      return {
        kind: 'composed',
        dataUrl,
        width: bundle.layout.width,
        height: bundle.layout.height,
        encodedCharacters: dataUrl.length,
        delivery: 'file-only',
        warning: FILE_ONLY_WARNING,
      };
    }
    return {
      kind: 'composed',
      dataUrl,
      width: bundle.layout.width,
      height: bundle.layout.height,
      encodedCharacters: dataUrl.length,
      delivery: bundle.delivery,
      warning: bundle.warning,
    };
  } finally {
    surface.destroy();
  }
}
