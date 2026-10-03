// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  macFilePair,
  writeMacClipboardFiles,
  readMacClipboardObservation,
  type RunOsascript,
} from './mac-clipboard.js';

const pair = ['/Users/me/Imnota/p/exports/bundle-1.md', '/Users/me/Imnota/p/exports/bundle-1.png'];

describe('macOS file clipboard', () => {
  it('passes only the mode and the two paths to osascript, never content', async () => {
    const run = vi.fn<RunOsascript>(
      async () => `${JSON.stringify(pair)}
`,
    );
    await expect(writeMacClipboardFiles(pair, {}, run)).resolves.toEqual(pair);
    const args = run.mock.calls[0]![0];
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
    expect(args.slice(4)).toEqual(['files', ...pair]);
    expect(args[3]).toContain('writeObjects');
  });

  it('asks for the Markdown text on the first item for files + text', async () => {
    const run = vi.fn<RunOsascript>(async () => JSON.stringify(pair));
    await writeMacClipboardFiles(pair, { withText: true }, run);
    expect(run.mock.calls[0]![0][4]).toBe('text');
  });

  it('rejects anything other than one absolute Markdown and PNG pair in one folder', () => {
    expect(() => macFilePair([pair[1]!, pair[0]!])).toThrow();
    expect(() => macFilePair(['bundle.md', 'bundle.png'])).toThrow();
    expect(() => macFilePair([pair[0]!, '/elsewhere/bundle-1.png'])).toThrow();
    expect(() => macFilePair([...pair, '/x/y.png'])).toThrow();
    expect(macFilePair(pair)).toEqual(pair);
  });

  it('refuses an unexpected read-back instead of reporting success', async () => {
    await expect(writeMacClipboardFiles(pair, {}, async () => '{"not":"a list"}')).rejects.toThrow(
      'unexpected file list',
    );
  });
});

it('reads only macOS format types and change count for consistency diagnostics', async () => {
  const observation = { changeCount: 42, types: ['public.file-url', 'public.utf8-plain-text'] };
  const run = vi.fn<RunOsascript>(async () => JSON.stringify(observation));
  await expect(readMacClipboardObservation(run)).resolves.toEqual(observation);
  const script = run.mock.calls[0]![0][3];
  expect(script).toContain('board.changeCount');
  expect(script).toContain('board.types');
  expect(script).not.toMatch(/clearContents|writeObjects|stringForType|readObjects/);
  await expect(readMacClipboardObservation(async () => '{"changeCount":0}')).rejects.toThrow(
    'invalid observation',
  );
});

it('allowlists and bounds native type names before any diagnostic can retain them', async () => {
  const result = await readMacClipboardObservation(async () =>
    JSON.stringify({
      changeCount: 43,
      types: [
        'public.file-url',
        'public.file-url',
        'public.utf8-plain-text',
        'dyn.secret-type-name',
        'secret'.repeat(10000),
      ],
    }),
  );
  expect(result).toEqual({
    changeCount: 43,
    types: ['public.file-url', 'public.utf8-plain-text'],
    redactedTypeCount: 2,
  });
  expect(JSON.stringify(result)).not.toContain('secret');
});
