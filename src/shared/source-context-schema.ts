import { z } from 'zod';
import {
  cleanSourceText,
  cleanSourceUrl,
  SOURCE_TEXT_LIMIT,
  SOURCE_URL_LIMIT,
  type ScreenshotSource,
} from './source-context.js';

// Kept apart from ./source-context.js so renderer Markdown helpers do not load zod.
const optionalText = z
  .string()
  .max(SOURCE_TEXT_LIMIT)
  .optional()
  .catch(undefined)
  .transform((value) => cleanSourceText(value));

/** Lenient on read: a damaged source record is dropped instead of making the project unreadable. */
export const screenshotSourceSchema = z
  .object({
    via: z.enum(['capture', 'import']),
    capturedAt: z.iso.datetime({ offset: true }).max(40),
    app: optionalText,
    windowTitle: optionalText,
    url: z
      .string()
      .max(SOURCE_URL_LIMIT)
      .optional()
      .catch(undefined)
      .transform((value) => cleanSourceUrl(value)),
    display: optionalText,
  })
  .transform((value) => {
    const source: ScreenshotSource = { via: value.via, capturedAt: value.capturedAt };
    if (value.app) source.app = value.app;
    if (value.windowTitle) source.windowTitle = value.windowTitle;
    if (value.url) source.url = value.url;
    if (value.display) source.display = value.display;
    return source;
  });
