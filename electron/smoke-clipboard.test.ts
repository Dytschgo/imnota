// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readWindowsClipboardFilesForSmoke } from './smoke-clipboard.js';

describe('smoke clipboard availability', () => {
  it('waits only after an explicit busy result and logs resolved contention', async () => {
    const readFiles = vi
      .fn<(owner: Buffer) => string[]>()
      .mockImplementationOnce(() => {
        throw new Error('Windows clipboard is busy (5).');
      })
      .mockReturnValue(['C:\\prompt.md', 'C:\\prompt.png']);
    const yieldControl = vi.fn(async () => undefined);
    const log = vi.fn();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(101).mockReturnValue(103);
    await expect(
      readWindowsClipboardFilesForSmoke(Buffer.alloc(8), 'Files + rich copy', {
        readFiles,
        yieldControl,
        log,
        now,
      }),
    ).resolves.toEqual(['C:\\prompt.md', 'C:\\prompt.png']);
    expect(yieldControl).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/1 busy checks over 3ms/));
  });

  it('fails at the contention deadline with the native code', async () => {
    const readFiles = vi.fn((): string[] => {
      throw new Error('Windows clipboard is busy (5).');
    });
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValue(110);
    await expect(
      readWindowsClipboardFilesForSmoke(Buffer.alloc(8), 'Onboarding copy', {
        timeoutMs: 10,
        now,
        readFiles,
      }),
    ).rejects.toThrow(/Onboarding copy.*1 availability checks over 10ms \(5\)/i);
    expect(readFiles).toHaveBeenCalledOnce();
  });

  it('does not retry a content or decoding failure', async () => {
    const failure = new Error('Clipboard file list is malformed.');
    const readFiles = vi.fn((): string[] => {
      throw failure;
    });
    const yieldControl = vi.fn(async () => undefined);
    await expect(
      readWindowsClipboardFilesForSmoke(Buffer.alloc(8), 'Exact readback', {
        readFiles,
        yieldControl,
      }),
    ).rejects.toBe(failure);
    expect(readFiles).toHaveBeenCalledOnce();
    expect(yieldControl).not.toHaveBeenCalled();
  });
});
