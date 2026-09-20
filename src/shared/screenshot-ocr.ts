import { exportBounds } from './crop.js';
import type { Annotation } from './types.js';

export const VISIBLE_TEXT_HEADING = '### Visible text';

export interface VisibleTextCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotTextRecognizer {
  recognize(input: {
    pngDataUrl: string;
    screenshotId: string;
    crop?: VisibleTextCrop;
  }): Promise<string | null | undefined>;
}

export function screenshotHasRedaction(
  annotations: readonly Pick<Annotation, 'kind'>[] | undefined,
): boolean {
  return (annotations ?? []).some(
    (annotation) => annotation.kind === 'blur' || annotation.kind === 'pixelate',
  );
}

export function visibleTextMarkdownLines(text: string | undefined): string[] {
  const trimmed = text?.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) return [];
  return [VISIBLE_TEXT_HEADING, '', trimmed, ''];
}

/** Last crop wins. Omit when the crop is the full source so IPC stays smaller. */
export function visibleTextCropRect(
  width: number | undefined,
  height: number | undefined,
  annotations: readonly Pick<Annotation, 'kind'>[] | undefined,
): VisibleTextCrop | undefined {
  if (
    !annotations?.length ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    (width ?? 0) < 1 ||
    (height ?? 0) < 1
  )
    return undefined;
  const bounds = exportBounds(width!, height!, annotations as Annotation[]);
  if (bounds.x === 0 && bounds.y === 0 && bounds.width === width && bounds.height === height)
    return undefined;
  return bounds;
}

/** Best-effort OCR for export Markdown. Never throws; never writes into project files. */
export async function recognisedScreenshotText(input: {
  includeRecognisedText: boolean;
  annotations?: readonly Annotation[];
  pngDataUrl: string;
  screenshotId: string;
  nativeWidth?: number;
  nativeHeight?: number;
  recognizer?: ScreenshotTextRecognizer;
  /** Export-wide cancellation or time budget. The native request may finish later but is ignored. */
  signal?: AbortSignal;
}): Promise<string | undefined> {
  if (!input.includeRecognisedText || !input.recognizer) return undefined;
  if (screenshotHasRedaction(input.annotations)) return undefined;
  if (input.signal?.aborted) return undefined;
  const crop = visibleTextCropRect(input.nativeWidth, input.nativeHeight, input.annotations);
  try {
    const recognition = input.recognizer.recognize({
      pngDataUrl: input.pngDataUrl,
      screenshotId: input.screenshotId,
      ...(crop ? { crop } : {}),
    });
    const text = input.signal
      ? await Promise.race([
          recognition,
          new Promise<undefined>((resolve) =>
            input.signal!.addEventListener('abort', () => resolve(undefined), { once: true }),
          ),
        ])
      : await recognition;
    const trimmed = text?.replace(/\r\n?/g, '\n').trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}
