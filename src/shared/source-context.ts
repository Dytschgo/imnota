import { z } from 'zod';

/**
 * Where a screenshot came from, recorded locally at capture or import. It is stored in
 * project.json with the screenshot and, while the setting is on, written into exported
 * Markdown. Nothing here is sent anywhere by Imnota.
 *
 * Every field except the time is optional because platforms expose different things:
 * Window capture knows the window title; macOS also reports the owning app; Windows infers
 * a well-known app from the title suffix; Area and Display capture know only the display; and
 * no platform exposes a browser's URL without extra permissions, so `url` is only what the
 * user types.
 */
export interface ScreenshotSource {
  via: 'capture' | 'import';
  /** ISO 8601 time of the capture or import. */
  capturedAt: string;
  app?: string;
  windowTitle?: string;
  url?: string;
  /** For example "Display 2 of 3". */
  display?: string;
}

export const SOURCE_TEXT_LIMIT = 300;
export const SOURCE_URL_LIMIT = 2000;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** One printable line, without control or bidi override characters, within the limit. */
export function cleanSourceText(
  value: string | null | undefined,
  limit = SOURCE_TEXT_LIMIT,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, limit) : undefined;
}

/** Only absolute http(s) URLs are kept, so exported Markdown never carries a script or file link. */
export function cleanSourceUrl(value: string | null | undefined): string | undefined {
  const text = cleanSourceText(value, SOURCE_URL_LIMIT);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

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
    capturedAt: z.string().min(1).max(40),
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

/**
 * Apps whose Windows title ends in a fixed " - <App>" suffix. Windows capture has the window
 * title but not the process name, so only these well-known suffixes are recognised.
 */
const TITLE_SUFFIX_APPS = [
  'Google Chrome',
  'Microsoft Edge',
  'Mozilla Firefox',
  'Brave',
  'Opera',
  'Vivaldi',
  'Arc',
  'Visual Studio Code',
  'Cursor',
  'Windsurf',
  'Visual Studio',
  'Windows Terminal',
  'Slack',
  'Microsoft Teams',
  'Figma',
  'Notepad',
  'File Explorer',
];

export function appFromWindowTitle(title: string): string | undefined {
  for (const app of TITLE_SUFFIX_APPS) {
    for (const separator of [' - ', ' — ', ' – '])
      if (title.endsWith(`${separator}${app}`)) {
        // Edge appends " - Personal - Microsoft Edge"; the app is still the suffix.
        return app;
      }
  }
  return undefined;
}

export function createScreenshotSource(input: {
  via: ScreenshotSource['via'];
  now: Date;
  app?: string | null;
  windowTitle?: string | null;
  url?: string | null;
  display?: string | null;
}): ScreenshotSource {
  const windowTitle = cleanSourceText(input.windowTitle);
  const app = cleanSourceText(input.app) ?? (windowTitle ? appFromWindowTitle(windowTitle) : undefined);
  const source: ScreenshotSource = { via: input.via, capturedAt: input.now.toISOString() };
  if (app) source.app = app;
  if (windowTitle) source.windowTitle = windowTitle;
  const url = cleanSourceUrl(input.url);
  if (url) source.url = url;
  const display = cleanSourceText(input.display);
  if (display) source.display = display;
  return source;
}

/** Markdown-safe inline text: escapes characters that would start formatting or links. */
function inlineMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

function localTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return inlineMarkdown(cleanSourceText(iso) ?? '');
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )} (UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)})`;
}

/** The Source lines for a picture's Markdown header. Empty when there is nothing to say. */
export function sourceMarkdownLines(source: ScreenshotSource | undefined): string[] {
  if (!source) return [];
  // Fields may have been edited in the inspector, so each is cleaned again here.
  const app = cleanSourceText(source.app);
  const windowTitle = cleanSourceText(source.windowTitle);
  const url = cleanSourceUrl(source.url);
  const display = cleanSourceText(source.display);
  const lines: string[] = [];
  if (app) lines.push(`- App: ${inlineMarkdown(app)}`);
  if (windowTitle) lines.push(`- Window: ${inlineMarkdown(windowTitle)}`);
  if (url) lines.push(`- URL: <${url.replace(/[<>\s]/g, encodeURIComponent)}>`);
  if (display) lines.push(`- Display: ${inlineMarkdown(display)}`);
  lines.push(`- ${source.via === 'capture' ? 'Captured' : 'Imported'}: ${localTime(source.capturedAt)}`);
  return ['Source:', ...lines];
}
