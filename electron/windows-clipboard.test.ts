// @vitest-environment node
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  loadWindowsClipboardApi,
  readWindowsClipboardFiles,
  readWindowsClipboardFilesWhenAvailable,
  WINDOWS_CLIPBOARD_SNAPSHOT_MAX_FORMAT_BYTES,
  WINDOWS_CLIPBOARD_SNAPSHOT_MAX_TOTAL_BYTES,
  windowsFileClipboardAvailable,
  windowsDibV5Buffer,
  windowsDropFilesBuffer,
  windowsHtmlBuffer,
  windowsOwnerHandleValue,
  windowsUnicodeTextBuffer,
  withWindowsClipboardLock,
  writeWindowsClipboard,
  WindowsClipboardBusyError,
  WindowsClipboardChangedError,
  type WindowsClipboardApi,
} from './windows-clipboard.js';

it('reports file clipboard variants unavailable outside Windows', () => {
  expect(windowsFileClipboardAvailable('darwin')).toBe(false);
  expect(windowsFileClipboardAvailable('linux')).toBe(false);
});

interface MockNative {
  api: WindowsClipboardApi;
  clipboard: Map<number, number>;
  memory: Map<number, Buffer>;
  emptyClipboard: ReturnType<typeof vi.fn>;
  openClipboard: ReturnType<typeof vi.fn>;
  closeClipboard: ReturnType<typeof vi.fn>;
  setClipboardData: ReturnType<typeof vi.fn>;
  clipboardSequence: number;
  failSetFormat?: number;
  failAllocationAt?: number;
}

function nativeMock(initial: Array<[number, Buffer]> = []): MockNative {
  let nextHandle = 100;
  let allocations = 0;
  const memory = new Map<number, Buffer>();
  const clipboard = new Map<number, number>();
  for (const [format, bytes] of initial) {
    const handle = nextHandle++;
    memory.set(handle, Buffer.from(bytes));
    clipboard.set(format, handle);
  }
  const state = { clipboardSequence: 1 } as MockNative;
  const openClipboard = vi.fn(() => true);
  const closeClipboard = vi.fn(() => true);
  const emptyClipboard = vi.fn(() => {
    clipboard.clear();
    return true;
  });
  const setClipboardData = vi.fn((format: number, handle: unknown) => {
    if (state.failSetFormat === format) return null;
    clipboard.set(format, Number(handle));
    return handle;
  });
  const api: WindowsClipboardApi = {
    openClipboard,
    closeClipboard,
    emptyClipboard,
    getClipboardSequenceNumber: () => state.clipboardSequence,
    enumClipboardFormats: (previous) => {
      const formats = [...clipboard.keys()].sort((left, right) => left - right);
      return formats.find((format) => format > previous) ?? 0;
    },
    getClipboardData: (format) => clipboard.get(format) ?? null,
    setClipboardData,
    registerClipboardFormat: (name) => (name === 'HTML Format' ? 0xc001 : 0xc002),
    getClipboardFormatName: () => 0,
    isClipboardFormatAvailable: (format) => clipboard.has(format),
    getLastError: () => 0,
    setLastError: () => undefined,
    globalAlloc: (_flags, bytes) => {
      allocations += 1;
      if (state.failAllocationAt === allocations) return null;
      const handle = nextHandle++;
      memory.set(handle, Buffer.alloc(bytes));
      return handle;
    },
    globalFree: (handle) => {
      memory.delete(Number(handle));
      return null;
    },
    globalLock: (handle) => (memory.has(Number(handle)) ? handle : null),
    globalUnlock: () => true,
    globalSize: (handle) => memory.get(Number(handle))?.length ?? 0,
    copyMemory: (destination, source, bytes) => {
      const output = memory.get(Number(destination));
      const input = Buffer.isBuffer(source) ? source : memory.get(Number(source));
      if (!output || !input) throw new Error('Invalid mock memory copy.');
      input.copy(output, 0, 0, bytes);
    },
    copyImage: () => null,
    getObject: () => 0,
    deleteObject: () => true,
    dragQueryFile: () => 0,
  };
  Object.assign(state, {
    api,
    clipboard,
    memory,
    emptyClipboard,
    openClipboard,
    closeClipboard,
    setClipboardData,
  });
  return state;
}

function hwnd(value = 0x1234n): Buffer {
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}

const pair = [
  path.win32.resolve('C:\\Temp\\handoff', 'prompt.md'),
  path.win32.resolve('C:\\Temp\\handoff', 'prompt.png'),
] as const;

describe('Windows clipboard payloads', () => {
  it('keeps three uncompressed dual-3440x1440 image representations within the bounded budget', () => {
    const dualDisplayRgbaBytes = 6880 * 1440 * 4;
    expect(dualDisplayRgbaBytes).toBeLessThanOrEqual(WINDOWS_CLIPBOARD_SNAPSHOT_MAX_FORMAT_BYTES);
    expect(dualDisplayRgbaBytes * 3).toBeLessThanOrEqual(WINDOWS_CLIPBOARD_SNAPSHOT_MAX_TOTAL_BYTES);
    expect(WINDOWS_CLIPBOARD_SNAPSHOT_MAX_FORMAT_BYTES).toBe(128 * 1024 * 1024);
    expect(WINDOWS_CLIPBOARD_SNAPSHOT_MAX_TOTAL_BYTES).toBe(384 * 1024 * 1024);
  });

  it('encodes the real HWND value rather than the Buffer address', () => {
    expect(windowsOwnerHandleValue(hwnd(0x12345678n))).toBe(0x12345678n);
    expect(() => windowsOwnerHandleValue(Buffer.alloc(8))).toThrow(/live native window/i);
  });

  it('builds a wide DROPFILES pair and bounded rich formats before touching the clipboard', () => {
    const drop = windowsDropFilesBuffer(pair);
    expect(drop.readUInt32LE(0)).toBe(20);
    expect(drop.readUInt32LE(16)).toBe(1);
    expect(drop.subarray(20).toString('utf16le')).toBe(`${pair.join('\0')}\0\0`);
    expect(windowsUnicodeTextBuffer('# Prompt').toString('utf16le')).toBe('# Prompt\0');
    const html = windowsHtmlBuffer('<p>Prompt</p>').toString('utf8');
    expect(html).toContain('<!--StartFragment--><p>Prompt</p><!--EndFragment-->');
    expect(html).toMatch(/StartHTML:\d{10}/);
    expect(windowsDibV5Buffer(Buffer.alloc(8), 2, 1)).toHaveLength(132);
  });

  it('leaves the prior clipboard untouched when preparation or OpenClipboard fails', async () => {
    const prior = windowsUnicodeTextBuffer('prior');
    const preparation = nativeMock([[13, prior]]);
    preparation.failAllocationAt = 1;
    await expect(writeWindowsClipboard(hwnd(), { filePaths: pair }, preparation.api)).rejects.toThrow(
      /GlobalAlloc/i,
    );
    expect(preparation.openClipboard).not.toHaveBeenCalled();
    expect(preparation.memory.get(preparation.clipboard.get(13)!)).toEqual(prior);

    const locked = nativeMock([[13, prior]]);
    locked.openClipboard.mockReturnValue(false);
    locked.api.getLastError = () => 5;
    const lockedWrite = writeWindowsClipboard(hwnd(), { filePaths: pair }, locked.api, {
      timeoutMs: 0,
    });
    await expect(lockedWrite).rejects.toMatchObject({
      name: 'WindowsClipboardBusyError',
      message: 'The clipboard is in use by another app. Try copying again.',
      nativeCode: 5,
      busyChecks: 1,
      elapsedMs: expect.any(Number),
    });
    expect(locked.emptyClipboard).not.toHaveBeenCalled();
    expect(locked.memory.get(locked.clipboard.get(13)!)).toEqual(prior);
    expect(locked.memory.size).toBe(1);
    expect(locked.closeClipboard).not.toHaveBeenCalled();
  });

  it('backs off default busy acquisition checks while preserving the two-second deadline', async () => {
    vi.useFakeTimers();
    try {
      const native = nativeMock();
      native.openClipboard.mockReturnValue(false);
      native.api.getLastError = () => 5;
      const transaction = vi.fn();
      const log = vi.fn();
      const locked = withWindowsClipboardLock(hwnd(), transaction, { log }, native.api);
      const rejection = expect(locked).rejects.toBeInstanceOf(WindowsClipboardBusyError);
      await vi.advanceTimersByTimeAsync(2_000);
      await rejection;
      expect(native.openClipboard).toHaveBeenCalledTimes(201);
      expect(transaction).not.toHaveBeenCalled();
      expect(native.closeClipboard).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/201 busy checks over 2000ms.*error 5/i));
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for acquisition before mutating and runs the write transaction once', async () => {
    const native = nativeMock();
    native.openClipboard.mockReturnValueOnce(false).mockReturnValueOnce(true);
    let lastError = 5;
    native.api.getLastError = () => lastError;
    native.api.setLastError = (code) => void (lastError = code);
    const yieldControl = vi.fn(async () => undefined);
    const log = vi.fn();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(101).mockReturnValue(103);
    await writeWindowsClipboard(hwnd(), { filePaths: pair }, native.api, {
      timeoutMs: 100,
      yieldControl,
      log,
      now,
    });
    expect(native.openClipboard).toHaveBeenCalledTimes(2);
    expect(native.emptyClipboard).toHaveBeenCalledOnce();
    expect(native.setClipboardData).toHaveBeenCalledOnce();
    expect(native.closeClipboard).toHaveBeenCalledOnce();
    expect(yieldControl).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/1 busy checks over 3ms/));
  });

  it('aborts without mutation or allocation leaks when the clipboard changes while waiting', async () => {
    const prior = windowsUnicodeTextBuffer('newer clipboard');
    const native = nativeMock([[13, prior]]);
    native.openClipboard.mockReturnValue(false);
    native.api.getLastError = () => 5;
    const yieldControl = vi.fn(async () => {
      native.clipboardSequence += 1;
    });
    await expect(
      writeWindowsClipboard(hwnd(), { filePaths: pair }, native.api, {
        timeoutMs: 100,
        yieldControl,
      }),
    ).rejects.toBeInstanceOf(WindowsClipboardChangedError);
    expect(native.openClipboard).toHaveBeenCalledOnce();
    expect(native.emptyClipboard).not.toHaveBeenCalled();
    expect(native.closeClipboard).not.toHaveBeenCalled();
    expect(native.clipboard.get(13)).toBeDefined();
    expect(native.memory.get(native.clipboard.get(13)!)).toEqual(prior);
    expect(native.memory.size).toBe(1);
  });

  it('does not retry a non-busy OpenClipboard failure and releases candidate allocations', async () => {
    const native = nativeMock();
    native.openClipboard.mockReturnValue(false);
    native.api.getLastError = () => 1_400;
    const yieldControl = vi.fn(async () => undefined);
    await expect(
      writeWindowsClipboard(hwnd(), { filePaths: pair }, native.api, { yieldControl }),
    ).rejects.toThrow('Windows could not access the clipboard. Try copying again.');
    expect(native.openClipboard).toHaveBeenCalledOnce();
    expect(yieldControl).not.toHaveBeenCalled();
    expect(native.emptyClipboard).not.toHaveBeenCalled();
    expect(native.closeClipboard).not.toHaveBeenCalled();
    expect(native.memory.size).toBe(0);
  });

  it('does not retry a non-busy transaction failure and always releases lock ownership', async () => {
    const native = nativeMock();
    const failure = new Error('Clipboard snapshot is unsupported.');
    const transaction = vi.fn(() => {
      throw failure;
    });
    await expect(withWindowsClipboardLock(hwnd(), transaction, {}, native.api)).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledOnce();
    expect(native.openClipboard).toHaveBeenCalledOnce();
    expect(native.closeClipboard).toHaveBeenCalledOnce();
    expect(native.emptyClipboard).not.toHaveBeenCalled();
  });

  it('restores the exact supported prior clipboard after a partial multi-format failure', async () => {
    const prior = windowsUnicodeTextBuffer('prior clipboard');
    const native = nativeMock([[13, prior]]);
    native.failSetFormat = 0xc001;
    await expect(
      writeWindowsClipboard(
        hwnd(),
        {
          filePaths: pair,
          markdown: '# Prompt',
          html: '<p>Prompt</p>',
          png: Buffer.from('png'),
          dibV5: Buffer.from('dib'),
        },
        native.api,
      ),
    ).rejects.toThrow(/rejected clipboard format/i);
    expect([...native.clipboard.keys()]).toEqual([13]);
    expect(native.memory.get(native.clipboard.get(13)!)).toEqual(prior);
    expect(native.emptyClipboard).toHaveBeenCalledTimes(2);
    expect(native.openClipboard).toHaveBeenCalledOnce();
    expect(native.closeClipboard).toHaveBeenCalledOnce();
  });

  it('fails closed on a prior handle format that cannot be restored safely', async () => {
    const native = nativeMock([[3, Buffer.from('metafile handle')]]);
    await expect(writeWindowsClipboard(hwnd(), { filePaths: pair }, native.api)).rejects.toThrow(
      /cannot be restored safely/i,
    );
    expect(native.emptyClipboard).not.toHaveBeenCalled();
  });

  it('bounds file-list readback before allocating path buffers', () => {
    const native = nativeMock();
    native.clipboard.set(15, 999);
    native.api.dragQueryFile = vi.fn((_drop, index) => (index === 0xffffffff ? 3 : 10));
    expect(readWindowsClipboardFiles(hwnd(), native.api)).toEqual([]);
    expect(native.api.dragQueryFile).toHaveBeenCalledTimes(1);
  });

  it('bounds product file readback acquisition without rewriting content', async () => {
    const native = nativeMock();
    native.openClipboard.mockReturnValueOnce(false).mockReturnValueOnce(true);
    native.api.getLastError = () => 5;
    const yieldControl = vi.fn(async () => void (native.clipboardSequence += 1));
    await expect(
      readWindowsClipboardFilesWhenAvailable(
        hwnd(),
        { timeoutMs: 100, yieldControl, log: vi.fn() },
        native.api,
      ),
    ).resolves.toEqual([]);
    expect(native.openClipboard).toHaveBeenCalledTimes(2);
    expect(native.emptyClipboard).not.toHaveBeenCalled();
    expect(native.setClipboardData).not.toHaveBeenCalled();
    expect(native.closeClipboard).toHaveBeenCalledOnce();
  });
});

it.runIf(process.platform === 'win32')('loads and invokes the bundled Koffi Win32 memory surface', () => {
  expect(windowsFileClipboardAvailable()).toBe(true);
  const api = loadWindowsClipboardApi();
  expect(api.getClipboardSequenceNumber()).toBeGreaterThanOrEqual(0);
  const handle = api.globalAlloc(0x42, 32);
  expect(handle).toBeTruthy();
  const pointer = api.globalLock(handle);
  expect(pointer).toBeTruthy();
  api.copyMemory(pointer, Buffer.from('native surface'), 14);
  api.globalUnlock(handle);
  expect(api.globalSize(handle)).toBeGreaterThanOrEqual(32);
  expect(api.globalFree(handle)).toBeFalsy();
});
