/**
 * "Copy for terminal": plain text that pastes into an agent CLI (Claude Code, Codex, Copilot CLI)
 * running in Windows Terminal, a WSL shell, macOS/Linux terminals or an SSH session. Terminals do
 * not reliably accept pasted images, so the hand-off names the saved files instead.
 *
 * Every path is quoted, because export set names contain spaces. Windows paths use double
 * quotes (a Windows file name cannot contain `"`, and backslashes stay literal); POSIX and WSL
 * paths use single quotes, which keep every character literal. Control characters are removed so
 * a crafted title cannot inject terminal escape sequences, and the text has no trailing newline,
 * so pasting into a shell prompt never runs anything by itself.
 */

export type TerminalPathStyle = 'windows' | 'posix';

export interface TerminalHandoffInput {
  markdownPath: string;
  /** Absent for a text-only bundle. */
  pngPath?: string;
  /** The saved bundle Markdown; the summary is derived from its headings. */
  markdown: string;
  /** Native paths of the machine that saved the bundle. */
  style: TerminalPathStyle;
  /** Windows only: translate C:\ paths to /mnt/c/ for a WSL shell. */
  wsl?: boolean;
}

const MAX_SUMMARY_LINE = 160;
const MAX_LISTED_TITLES = 4;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** One line of plain, printable text without terminal control or bidi override characters. */
export function terminalSafeLine(value: string, maximum = MAX_SUMMARY_LINE): string {
  const line = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  return line.length > maximum ? `${line.slice(0, maximum - 1).trimEnd()}…` : line;
}

/**
 * Translate a Windows path to the path a WSL shell sees: drive paths map to /mnt/<drive>/, and
 * `\\wsl$\<distro>\…` or `\\wsl.localhost\<distro>\…` map to the distribution's own path. Other
 * network (UNC) paths have no WSL equivalent and return null.
 */
export function toWslPath(windowsPath: string): string | null {
  const normalized = windowsPath.replace(/\//g, '\\');
  const drive = /^(?:\\\\\?\\)?([A-Za-z]):\\(.*)$/.exec(normalized);
  if (drive) {
    const rest = drive[2]!.split('\\').filter(Boolean).join('/');
    return `/mnt/${drive[1]!.toLowerCase()}${rest ? `/${rest}` : ''}`;
  }
  const distro = /^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+\\(.*)$/i.exec(normalized);
  if (distro) return `/${distro[1]!.split('\\').filter(Boolean).join('/')}`;
  return null;
}

export function quoteTerminalPath(filePath: string, style: TerminalPathStyle): string {
  const clean = filePath.replace(CONTROL_CHARACTERS, '');
  if (style === 'windows') return `"${clean.replace(/"/g, '')}"`;
  return `'${clean.replace(/'/g, `'\\''`)}'`;
}

/** Two or three summary lines from the saved Markdown: collection and bundle, then picture titles. */
export function terminalHandoffSummary(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const title = lines.find((line) => /^# /.test(line))?.slice(2) ?? 'Imnota bundle';
  const position = lines.find((line) => /^Bundle \d+ of \d+$/.test(line.trim()))?.trim();
  const pictures = lines
    .filter((line) => /^## (Picture|Drawing) \d+ — /.test(line))
    .map((line) => line.slice(line.indexOf(' — ') + 3).trim());
  const summary = [terminalSafeLine(`Imnota: ${title}${position ? ` (${position.toLowerCase()})` : ''}`)];
  if (pictures.length) {
    const listed = pictures.slice(0, MAX_LISTED_TITLES).join('; ');
    const more = pictures.length > MAX_LISTED_TITLES ? `; +${pictures.length - MAX_LISTED_TITLES} more` : '';
    summary.push(
      terminalSafeLine(
        `${pictures.length === 1 ? '1 picture' : `${pictures.length} pictures`}: ${listed}${more}`,
      ),
    );
  } else summary.push('Text only, no pictures.');
  summary.push('Read the Markdown for the annotated feedback; view the PNG for the marked-up screenshots.');
  return summary;
}

export class TerminalPathError extends Error {}

/** The complete hand-off: summary lines, then one quoted path per line. No trailing newline. */
export function formatTerminalHandoff(input: TerminalHandoffInput): string {
  const translate = (filePath: string) => {
    if (!input.wsl) return quoteTerminalPath(filePath, input.style);
    if (input.style !== 'windows') throw new TerminalPathError('WSL paths are only offered on Windows.');
    const translated = toWslPath(filePath);
    if (!translated)
      throw new TerminalPathError(
        'This bundle is on a network path that WSL cannot open. Copy for terminal instead.',
      );
    return quoteTerminalPath(translated, 'posix');
  };
  const lines = [...terminalHandoffSummary(input.markdown), `Markdown: ${translate(input.markdownPath)}`];
  if (input.pngPath) lines.push(`Image: ${translate(input.pngPath)}`);
  return lines.join('\n');
}
