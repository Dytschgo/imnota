import type { Annotation } from './types.js';

export const VISIBLE_TEXT_HEADING = '### Visible text';

export interface ScreenshotTextRecognizer {
  recognize(input: { pngDataUrl: string; screenshotId: string }): Promise<string | null | undefined>;
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

/** Best-effort OCR for export Markdown. Never throws; never writes into project files. */
export async function recognisedScreenshotText(input: {
  includeRecognisedText: boolean;
  annotations?: readonly Pick<Annotation, 'kind'>[];
  pngDataUrl: string;
  screenshotId: string;
  recognizer?: ScreenshotTextRecognizer;
}): Promise<string | undefined> {
  if (!input.includeRecognisedText || !input.recognizer) return undefined;
  if (screenshotHasRedaction(input.annotations)) return undefined;
  try {
    const text = await input.recognizer.recognize({
      pngDataUrl: input.pngDataUrl,
      screenshotId: input.screenshotId,
    });
    const trimmed = text?.replace(/\r\n?/g, '\n').trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}
