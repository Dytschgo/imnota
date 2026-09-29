import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * JavaScript for Automation run by /usr/bin/osascript. Electron can place only one
 * pasteboard item, so two files need AppKit's writeObjects with one file URL per
 * item. Receivers such as chat composers then attach both files. The Markdown text
 * can be added to the first item for "files + text", read from the file itself so
 * no content passes through process arguments.
 */
const WRITE_FILES_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
  const withText = argv[0] === 'text';
  const paths = argv.slice(1);
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  const urls = paths.map((file) => $.NSURL.fileURLWithPath(file));
  if (!pasteboard.writeObjects($(urls))) throw new Error('The pasteboard rejected the files.');
  if (withText) {
    const text = $.NSString.stringWithContentsOfFileEncodingError(paths[0], $.NSUTF8StringEncoding, null);
    const item = pasteboard.pasteboardItems.objectAtIndex(0);
    if (text.isNil() || !item.setStringForType(text, 'public.utf8-plain-text'))
      throw new Error('The pasteboard rejected the Markdown text.');
  }
  const read = pasteboard.readObjectsForClassesOptions(
    $([$.NSURL]),
    $({ NSPasteboardURLReadingFileURLsOnlyKey: true }),
  );
  const kept = [];
  for (let index = 0; index < read.count; index++) kept.push(read.objectAtIndex(index).path.js);
  return JSON.stringify(kept);
}
`;

export type RunOsascript = (args: readonly string[]) => Promise<string>;

const nativeOsascript: RunOsascript = (args) =>
  new Promise((resolve, reject) =>
    execFile('/usr/bin/osascript', [...args], { timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  );

/** One Markdown file and one PNG in the same folder, as generated for a bundle. */
export function macFilePair(filePaths: readonly string[]): readonly [string, string] {
  if (
    filePaths.length !== 2 ||
    path.extname(filePaths[0]).toLowerCase() !== '.md' ||
    path.extname(filePaths[1]).toLowerCase() !== '.png' ||
    !filePaths.every((file) => path.isAbsolute(file))
  )
    throw new Error('macOS file copy requires one absolute Markdown file and one PNG file.');
  if (path.dirname(filePaths[0]) !== path.dirname(filePaths[1]))
    throw new Error('macOS file copy requires the generated pair to share one folder.');
  return [filePaths[0], filePaths[1]];
}

/**
 * Put the generated Markdown and PNG on the macOS clipboard as files and return the
 * file paths the pasteboard actually kept.
 */
export async function writeMacClipboardFiles(
  filePaths: readonly string[],
  options: { withText?: boolean } = {},
  run: RunOsascript = nativeOsascript,
): Promise<string[]> {
  const pair = macFilePair(filePaths);
  const output = await run([
    '-l',
    'JavaScript',
    '-e',
    WRITE_FILES_SCRIPT,
    options.withText ? 'text' : 'files',
    ...pair,
  ]);
  const kept: unknown = JSON.parse(output.trim() || '[]');
  if (!Array.isArray(kept) || !kept.every((entry) => typeof entry === 'string'))
    throw new Error('The macOS clipboard returned an unexpected file list.');
  return kept;
}

const READ_FILES_SCRIPT = `
ObjC.import('AppKit');
function run() {
  const read = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions(
    $([$.NSURL]),
    $({ NSPasteboardURLReadingFileURLsOnlyKey: true }),
  );
  const kept = [];
  for (let index = 0; index < read.count; index++) kept.push(read.objectAtIndex(index).path.js);
  return JSON.stringify(kept);
}
`;

/** File paths currently on the macOS clipboard, for verification. */
export async function readMacClipboardFiles(run: RunOsascript = nativeOsascript): Promise<string[]> {
  const kept: unknown = JSON.parse((await run(['-l', 'JavaScript', '-e', READ_FILES_SCRIPT])).trim() || '[]');
  if (!Array.isArray(kept) || !kept.every((entry) => typeof entry === 'string'))
    throw new Error('The macOS clipboard returned an unexpected file list.');
  return kept;
}
