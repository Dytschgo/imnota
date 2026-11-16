import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { hasPngSignature } from '../src/shared/png.js';
import { decodePngDataUrl, maxPngDataUrlLength } from './png-data-url.js';

const execFileDefault = promisify(execFileCallback);

/** Keep OCR off the export critical path for huge captures; Copy Bundle still succeeds. */
export const MAX_OCR_PNG_BYTES = 20 * 1024 * 1024;
export const MAX_OCR_DATA_URL_CHARACTERS = maxPngDataUrlLength(MAX_OCR_PNG_BYTES);
export const WINDOWS_OCR_TIMEOUT_MS = 10_000;

export const WINDOWS_OCR_SCRIPT = [
  'param([string]$pngPath, [int]$timeoutMs = 10000)',
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$timeoutMs = [Math]::Max(1, $timeoutMs)',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.ToString().Contains('IAsyncOperation`1') })[0]",
  'function Await($WinRtTask, $ResultType) {',
  '  $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))',
  '  if (-not $netTask.Wait($timeoutMs)) { throw "OCR timed out." }',
  '  $netTask.Result',
  '}',
  '[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Graphics.Imaging.BitmapTransform,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
  '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
  'if (-not $engine) { return }',
  '$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($pngPath)) ([Windows.Storage.StorageFile])',
  '$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
  '$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
  '$transform = [Windows.Graphics.Imaging.BitmapTransform]::new()',
  '$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension',
  'if ($decoder.PixelWidth -gt $max -or $decoder.PixelHeight -gt $max) {',
  '  $scale = [Math]::Min($max / $decoder.PixelWidth, $max / $decoder.PixelHeight)',
  '  $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelWidth * $scale))',
  '  $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight * $scale))',
  '}',
  '$bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])',
  '$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
  '[Console]::Out.Write($result.Text)',
].join('\n');

export interface WindowsOcrExecResult {
  stdout: string;
  stderr?: string;
}

export interface OcrCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowsOcrHost {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  powershellPath?: string;
  crop?: OcrCropRect;
  cropPng?(png: Uint8Array, crop: OcrCropRect): Uint8Array;
  mkdtemp?(prefix: string): Promise<string>;
  writeFile?(filePath: string, contents: string | Uint8Array): Promise<void>;
  rm?(target: string): Promise<void>;
  execFile?(
    file: string,
    args: readonly string[],
    options: { timeout: number; windowsHide?: boolean; encoding: 'utf8' },
  ): Promise<WindowsOcrExecResult>;
}

export function windowsOcrAvailable(platform = process.platform): boolean {
  return platform === 'win32';
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

export function decodePngDataUrlForOcr(pngDataUrl: string): Uint8Array | undefined {
  if (typeof pngDataUrl !== 'string' || pngDataUrl.length > MAX_OCR_DATA_URL_CHARACTERS) return undefined;
  const png = decodePngDataUrl(pngDataUrl, MAX_OCR_DATA_URL_CHARACTERS);
  return png && png.length <= MAX_OCR_PNG_BYTES && hasPngSignature(png) ? png : undefined;
}

function pngForOcr(png: Uint8Array, host: WindowsOcrHost): Uint8Array | undefined {
  if (!hasPngSignature(png) || png.length > MAX_OCR_PNG_BYTES) return undefined;
  if (!host.crop || !host.cropPng) return png;
  try {
    const cropped = host.cropPng(png, host.crop);
    if (cropped && hasPngSignature(cropped) && cropped.length <= MAX_OCR_PNG_BYTES) return cropped;
  } catch {
    return png;
  }
  return png;
}

/** On-device Windows.Media.Ocr. Empty string on failure; never uploads. */
export async function recognizePngWithWindowsOcr(
  png: Uint8Array,
  host: WindowsOcrHost = {},
): Promise<string> {
  const platform = host.platform ?? process.platform;
  const bytes = pngForOcr(png, host);
  if (!windowsOcrAvailable(platform) || !bytes) return '';
  const directory = await (host.mkdtemp ?? ((prefix) => fs.mkdtemp(prefix)))(
    path.join(os.tmpdir(), 'imnota-ocr-'),
  );
  const pngPath = path.join(directory, 'source.png');
  const scriptPath = path.join(directory, 'recognize.ps1');
  const timeoutMs = host.timeoutMs ?? WINDOWS_OCR_TIMEOUT_MS;
  try {
    const writeFile = host.writeFile ?? ((filePath, contents) => fs.writeFile(filePath, contents));
    await writeFile(pngPath, bytes);
    await writeFile(scriptPath, WINDOWS_OCR_SCRIPT);
    const execFile =
      host.execFile ?? (async (file, args, options) => execFileDefault(file, [...args], options));
    const { stdout } = await execFile(
      host.powershellPath ?? windowsPowershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        pngPath,
        String(timeoutMs),
      ],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
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
