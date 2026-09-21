// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  decodePngDataUrlForOcr,
  MAX_OCR_PNG_BYTES,
  recognizeOnDevicePngDataUrl,
  recognizePngWithWindowsOcr,
  WINDOWS_OCR_SCRIPT,
  WINDOWS_OCR_TIMEOUT_MS,
  windowsOcrAvailable,
  type WindowsOcrHost,
} from './windows-ocr.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const READABLE_TEXT_PNG = fileURLToPath(new URL('./fixtures/windows-ocr-readable-text.png', import.meta.url));
const runWindowsOcrIntegration =
  process.platform === 'win32' && process.env.IMNOTA_WINDOWS_OCR_INTEGRATION === '1';

function host(overrides: Partial<WindowsOcrHost> = {}): WindowsOcrHost {
  const files = new Map<string, string | Uint8Array>();
  return {
    platform: 'win32',
    powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    mkdtemp: async (prefix) => `${prefix}test`,
    writeFile: async (filePath, contents) => {
      files.set(filePath, contents);
    },
    rm: async () => undefined,
    execFile: async () => ({ stdout: 'Submit order\r\n' }),
    ...overrides,
  };
}

describe('on-device Windows OCR', () => {
  it('uses Windows.Media.Ocr locally, downscales to MaxImageDimension, and bounds Wait', async () => {
    expect(WINDOWS_OCR_SCRIPT).toContain('Windows.Media.Ocr.OcrEngine');
    expect(WINDOWS_OCR_SCRIPT).toContain('MaxImageDimension');
    expect(WINDOWS_OCR_SCRIPT).toContain('IAsyncOperation`1');
    expect(WINDOWS_OCR_SCRIPT).toContain('$netTask.Wait($timeoutMs)');
    expect(WINDOWS_OCR_SCRIPT).not.toContain('Wait(-1)');
    expect(WINDOWS_OCR_SCRIPT).not.toContain('http');
    expect(windowsOcrAvailable('linux')).toBe(false);
    expect(windowsOcrAvailable('darwin')).toBe(false);
    const execFile = vi.fn(async () => ({ stdout: 'Submit order\r\n' }));
    await expect(recognizePngWithWindowsOcr(PNG_BYTES, host({ execFile }))).resolves.toBe('Submit order');
    expect(execFile).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expect.arrayContaining(['-STA', '-File', String(WINDOWS_OCR_TIMEOUT_MS)]),
      expect.objectContaining({ encoding: 'utf8', windowsHide: true, timeout: WINDOWS_OCR_TIMEOUT_MS }),
    );
  });

  it('returns empty text outside Windows, for invalid images, and when the engine fails', async () => {
    const execFile = vi.fn(async () => ({ stdout: 'nope' }));
    await expect(recognizePngWithWindowsOcr(PNG_BYTES, host({ platform: 'linux', execFile }))).resolves.toBe(
      '',
    );
    await expect(recognizePngWithWindowsOcr(Buffer.from('not-png'), host({ execFile }))).resolves.toBe('');
    await expect(
      recognizePngWithWindowsOcr(PNG_BYTES, {
        ...host(),
        execFile: async () => {
          throw new Error('powershell missing');
        },
      }),
    ).resolves.toBe('');
    expect(execFile).not.toHaveBeenCalled();
    expect(decodePngDataUrlForOcr('data:image/jpeg;base64,AAAA')).toBeUndefined();
    expect(Buffer.from(decodePngDataUrlForOcr(PNG_DATA_URL) ?? []).equals(PNG_BYTES)).toBe(true);
    await expect(recognizeOnDevicePngDataUrl(PNG_DATA_URL, host())).resolves.toBe('Submit order');
  });

  it('skips oversized screenshots without spawning the engine', async () => {
    const execFile = vi.fn(async () => ({ stdout: 'huge' }));
    const huge = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_OCR_PNG_BYTES)]);
    await expect(recognizePngWithWindowsOcr(huge, host({ execFile }))).resolves.toBe('');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('crops source pixels before OCR when a crop rect is supplied', async () => {
    const cropped = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]);
    const cropPng = vi.fn(() => cropped);
    const writeFile = vi.fn(async () => undefined);
    const execFile = vi.fn(async () => ({ stdout: 'Cropped label' }));
    await expect(
      recognizePngWithWindowsOcr(
        PNG_BYTES,
        host({
          crop: { x: 10, y: 20, width: 40, height: 30 },
          cropPng,
          writeFile,
          execFile,
        }),
      ),
    ).resolves.toBe('Cropped label');
    expect(cropPng).toHaveBeenCalledWith(PNG_BYTES, { x: 10, y: 20, width: 40, height: 30 });
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('source.png'), cropped);
  });

  it.runIf(runWindowsOcrIntegration)(
    'recognizes readable text through the actual Windows.Media.Ocr engine',
    async () => {
      const text = await recognizePngWithWindowsOcr(await readFile(READABLE_TEXT_PNG));
      expect(text).toMatch(/IMNOTA OCR READY/i);
    },
    20_000,
  );
});
