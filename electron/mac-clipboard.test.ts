// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { macFilePair, writeMacClipboardFiles, type RunOsascript } from './mac-clipboard.js';

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
