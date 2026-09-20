import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileDefault = promisify(execFileCallback);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

/** Keep OCR off the export critical path for huge captures; Copy Bundle still succeeds. */
export const MAX_OCR_PNG_BYTES = 20 * 1024 * 1024;
export const MAX_OCR_DATA_URL_CHARACTERS = PNG_DATA_URL_PREFIX.length + Math.ceil(MAX_OCR_PNG_BYTES / 3) * 4;
const DEFAULT_TIMEOUT_MS = 45_000;

export const WINDOWS_OCR_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
  'function Await($WinRtTask, $ResultType) {',
  '  $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))',
  '  $netTask.Wait(-1) | Out-Null',
  '  $netTask.Result',
  '}',
  '[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
  '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
  'if (-not $engine) { return }',
  '$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($args[0])) ([Windows.Storage.StorageFile])',
  '$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
  '$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
  '$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
  'if ($bitmap.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8 -or $bitmap.BitmapAlphaMode -eq [Windows.Graphics.Imaging.BitmapAlphaMode]::Straight) {',
  '  $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)',
  '}',
  '$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
  '[Console]::Out.Write($result.Text)',
].join('\n');

export interface WindowsOcrExecResult {
  stdout: string;
  stderr?: string;
}

export interface WindowsOcrHost {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  powershellPath?: string;
  mkdtemp?(prefix: string): Promise<string>;
  writeFile?(filePath: string, contents: string | Uint8Array): Promise<void>;
  rm?(target: string): Promise<void>;
  execFile?(
    file: string,
    args: readonly string[],
    options: { timeout: number; windowsHide?: boolean; encoding: 'utf8' },
  ): Promise<WindowsOcrExecResult>;
}

function windowsPowershellPath(): string {
  return path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    Buffer.from(bytes.subarray(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)
  );
}

export function decodePngDataUrlForOcr(pngDataUrl: string): Uint8Array | undefined {
  if (typeof pngDataUrl !== 'string' || pngDataUrl.length > MAX_OCR_DATA_URL_CHARACTERS) return undefined;
  const match = PNG_DATA_URL.exec(pngDataUrl);
  if (!match) return undefined;
  try {
    const png = Buffer.from(match[1], 'base64');
    if (png.length < PNG_SIGNATURE.length || png.length > MAX_OCR_PNG_BYTES || !isPng(png)) return undefined;
    return png;
  } catch {
    return undefined;
  }
}

/** On-device Windows.Media.Ocr. Empty string on failure; never uploads. */
export async function recognizePngWithWindowsOcr(
  png: Uint8Array,
  host: WindowsOcrHost = {},
): Promise<string> {
  const platform = host.platform ?? process.platform;
  if (platform !== 'win32' || png.length > MAX_OCR_PNG_BYTES || !isPng(png)) return '';
  const directory = await (host.mkdtemp ?? ((prefix) => fs.mkdtemp(prefix)))(
    path.join(os.tmpdir(), 'imnota-ocr-'),
  );
  const pngPath = path.join(directory, 'source.png');
  const scriptPath = path.join(directory, 'recognize.ps1');
  try {
    const writeFile = host.writeFile ?? ((filePath, contents) => fs.writeFile(filePath, contents));
    await writeFile(pngPath, png);
    await writeFile(scriptPath, WINDOWS_OCR_SCRIPT);
    const execFile =
      host.execFile ?? (async (file, args, options) => execFileDefault(file, [...args], options));
    const { stdout } = await execFile(
      host.powershellPath ?? windowsPowershellPath(),
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, pngPath],
      { timeout: host.timeoutMs ?? DEFAULT_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
    );
    return String(stdout ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .trim();
  } catch {
    return '';
  } finally {
    await (host.rm ?? ((target) => fs.rm(target, { recursive: true, force: true })))(directory).catch(
      () => undefined,
    );
  }
}

export async function recognizeOnDevicePngDataUrl(
  pngDataUrl: string,
  host: WindowsOcrHost = {},
): Promise<string> {
  const png = decodePngDataUrlForOcr(pngDataUrl);
  if (!png) return '';
  return recognizePngWithWindowsOcr(png, host);
}
