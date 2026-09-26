import { createRequire } from 'node:module';
import path from 'node:path';
import { MAX_CAPTURE_PIXELS } from '../src/shared/capture.js';

const CF_BITMAP = 2;
const CF_HDROP = 15;
const CF_DIBV5 = 17;
const REGISTERED_FORMAT_MIN = 0xc000;
const GMEM_MOVEABLE_ZEROINIT = 0x42;
const IMAGE_BITMAP = 0;
const LR_CREATEDIBSECTION = 0x2000;
const DROPFILES_BYTES = 20;
const ERROR_ACCESS_DENIED = 5;
const MAX_SNAPSHOT_FORMATS = 64;
/**
 * A two-display 6880x1440 BGRA surface is about 40 MB. Keep enough room for
 * each representation and three common image representations while retaining
 * a hard ceiling below the application's full 64 MP capture allocation.
 */
export const WINDOWS_CLIPBOARD_SNAPSHOT_MAX_FORMAT_BYTES = Math.min(
  128 * 1024 * 1024,
  MAX_CAPTURE_PIXELS * 4,
);
export const WINDOWS_CLIPBOARD_SNAPSHOT_MAX_TOTAL_BYTES = WINDOWS_CLIPBOARD_SNAPSHOT_MAX_FORMAT_BYTES * 3;
const MAX_WINDOWS_PATH_CHARACTERS = 32_767;

const STANDARD_GLOBAL_FORMATS = new Set([1, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17]);
const SAFE_REGISTERED_GLOBAL_FORMATS = new Set([
  'HTML Format',
  'PNG',
  'text/html',
  'text/plain',
  'image/png',
  'Preferred DropEffect',
  'FileName',
  'FileNameW',
  'Shell IDList Array',
  'Chromium Web Custom MIME Data Format',
  // Chromium writes these as serialized bytes in movable HGLOBAL allocations,
  // not live handles. Preserve them with the content if a write rolls back.
  'Chromium internal source RFH token',
  'Chromium internal source URL',
]);
// OLE ownership metadata points back to the previous clipboard owner. EmptyClipboard
// releases that owner, so a byte clone cannot recreate these broker references.
const TRANSIENT_OLE_FORMATS = new Set(['dataobject', 'ole private data', 'wine marshalled dataobject']);
type NativeHandle = unknown;

interface KoffiLibrary {
  func(name: string, result: string, parameters: readonly string[]): (...args: unknown[]) => unknown;
}

interface KoffiModule {
  load(name: string): KoffiLibrary;
}

export interface WindowsClipboardApi {
  openClipboard(owner: bigint | number): boolean;
  closeClipboard(): boolean;
  emptyClipboard(): boolean;
  getClipboardSequenceNumber(): number;
  enumClipboardFormats(previous: number): number;
  getClipboardData(format: number): NativeHandle;
  setClipboardData(format: number, handle: NativeHandle): NativeHandle;
  registerClipboardFormat(name: string): number;
  getClipboardFormatName(format: number, output: Buffer, characters: number): number;
  isClipboardFormatAvailable(format: number): boolean;
  getLastError(): number;
  setLastError(code: number): void;
  globalAlloc(flags: number, bytes: number): NativeHandle;
  globalFree(handle: NativeHandle): NativeHandle;
  globalLock(handle: NativeHandle): NativeHandle;
  globalUnlock(handle: NativeHandle): boolean;
  globalSize(handle: NativeHandle): number;
  copyMemory(destination: NativeHandle, source: NativeHandle, bytes: number): void;
  copyImage(handle: NativeHandle, type: number, width: number, height: number, flags: number): NativeHandle;
  getObject(handle: NativeHandle, bytes: number, output: Buffer): number;
  deleteObject(handle: NativeHandle): boolean;
  dragQueryFile(drop: NativeHandle, index: number, output: Buffer | null, characters: number): number;
}

export interface WindowsClipboardPayload {
  filePaths: readonly [string, string];
  markdown?: string;
  html?: string;
  png?: Buffer;
  dibV5?: Buffer;
}

export class WindowsClipboardBusyError extends Error {
  constructor(
    message: string,
    readonly nativeCode: number,
    readonly busyChecks: number,
    readonly elapsedMs: number,
  ) {
    super(message);
    this.name = 'WindowsClipboardBusyError';
  }
}

export class WindowsClipboardChangedError extends Error {
  constructor(
    message: string,
    readonly initialSequence: number,
    readonly currentSequence: number,
    readonly busyChecks: number,
  ) {
    super(message);
    this.name = 'WindowsClipboardChangedError';
  }
}

export class WindowsClipboardOpenError extends Error {
  constructor(
    message: string,
    readonly nativeCode: number,
  ) {
    super(message);
    this.name = 'WindowsClipboardOpenError';
  }
}

export interface WindowsClipboardLockOptions {
  timeoutMs?: number;
  requireStableSequence?: boolean;
  context?: string;
  now?: () => number;
  yieldControl?: () => Promise<void>;
  log?: (message: string) => void;
}

interface ClipboardMemory {
  format: number;
  handle: NativeHandle;
  kind: 'global' | 'bitmap';
}

let apiCache: WindowsClipboardApi | undefined;

function truthyHandle(handle: NativeHandle): boolean {
  return handle !== null && handle !== undefined && handle !== 0 && handle !== 0n;
}

function numberResult(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

function loadKoffi(): KoffiModule {
  const packageName =
    process.arch === 'x64'
      ? '@koromix/koffi-win32-x64'
      : process.arch === 'arm64'
        ? '@koromix/koffi-win32-arm64'
        : undefined;
  if (!packageName) throw new Error(`Windows file clipboard is unavailable on ${process.arch}.`);
  return createRequire(import.meta.url)(packageName) as KoffiModule;
}

export function windowsFileClipboardAvailable(platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  try {
    loadWindowsClipboardApi();
    return true;
  } catch {
    return false;
  }
}

export function loadWindowsClipboardApi(): WindowsClipboardApi {
  if (process.platform !== 'win32') throw new Error('Windows file clipboard is available only on Windows.');
  if (apiCache) return apiCache;
  const koffi = loadKoffi();
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const shell32 = koffi.load('shell32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  const fn = (library: KoffiLibrary, name: string, result: string, parameters: readonly string[]) =>
    library.func(name, result, parameters);
  const OpenClipboard = fn(user32, 'OpenClipboard', 'bool', ['uintptr_t']);
  const CloseClipboard = fn(user32, 'CloseClipboard', 'bool', []);
  const EmptyClipboard = fn(user32, 'EmptyClipboard', 'bool', []);
  const GetClipboardSequenceNumber = fn(user32, 'GetClipboardSequenceNumber', 'uint32_t', []);
  const EnumClipboardFormats = fn(user32, 'EnumClipboardFormats', 'uint32_t', ['uint32_t']);
  const GetClipboardData = fn(user32, 'GetClipboardData', 'void *', ['uint32_t']);
  const SetClipboardData = fn(user32, 'SetClipboardData', 'void *', ['uint32_t', 'void *']);
  const RegisterClipboardFormatW = fn(user32, 'RegisterClipboardFormatW', 'uint32_t', ['str16']);
  const GetClipboardFormatNameW = fn(user32, 'GetClipboardFormatNameW', 'int', ['uint32_t', 'void *', 'int']);
  const IsClipboardFormatAvailable = fn(user32, 'IsClipboardFormatAvailable', 'bool', ['uint32_t']);
  const CopyImage = fn(user32, 'CopyImage', 'void *', ['void *', 'uint32_t', 'int', 'int', 'uint32_t']);
  const GetLastError = fn(kernel32, 'GetLastError', 'uint32_t', []);
  const SetLastError = fn(kernel32, 'SetLastError', 'void', ['uint32_t']);
  const GlobalAlloc = fn(kernel32, 'GlobalAlloc', 'void *', ['uint32_t', 'size_t']);
  const GlobalFree = fn(kernel32, 'GlobalFree', 'void *', ['void *']);
  const GlobalLock = fn(kernel32, 'GlobalLock', 'void *', ['void *']);
  const GlobalUnlock = fn(kernel32, 'GlobalUnlock', 'bool', ['void *']);
  const GlobalSize = fn(kernel32, 'GlobalSize', 'size_t', ['void *']);
  const RtlMoveMemory = fn(kernel32, 'RtlMoveMemory', 'void', ['void *', 'void *', 'size_t']);
  const DragQueryFileW = fn(shell32, 'DragQueryFileW', 'uint32_t', [
    'void *',
    'uint32_t',
    'void *',
    'uint32_t',
  ]);
  const DeleteObject = fn(gdi32, 'DeleteObject', 'bool', ['void *']);
  const GetObjectW = fn(gdi32, 'GetObjectW', 'int', ['void *', 'int', 'void *']);
  apiCache = {
    openClipboard: (owner) => Boolean(OpenClipboard(owner)),
    closeClipboard: () => Boolean(CloseClipboard()),
    emptyClipboard: () => Boolean(EmptyClipboard()),
    getClipboardSequenceNumber: () => numberResult(GetClipboardSequenceNumber()),
    enumClipboardFormats: (previous) => numberResult(EnumClipboardFormats(previous)),
    getClipboardData: (format) => GetClipboardData(format),
    setClipboardData: (format, handle) => SetClipboardData(format, handle),
    registerClipboardFormat: (name) => numberResult(RegisterClipboardFormatW(name)),
    getClipboardFormatName: (format, output, characters) =>
      numberResult(GetClipboardFormatNameW(format, output, characters)),
    isClipboardFormatAvailable: (format) => Boolean(IsClipboardFormatAvailable(format)),
    getLastError: () => numberResult(GetLastError()),
    setLastError: (code) => void SetLastError(code),
    globalAlloc: (flags, bytes) => GlobalAlloc(flags, bytes),
    globalFree: (handle) => GlobalFree(handle),
    globalLock: (handle) => GlobalLock(handle),
    globalUnlock: (handle) => Boolean(GlobalUnlock(handle)),
    globalSize: (handle) => numberResult(GlobalSize(handle)),
    copyMemory: (destination, source, bytes) => void RtlMoveMemory(destination, source, bytes),
    copyImage: (handle, type, width, height, flags) => CopyImage(handle, type, width, height, flags),
    getObject: (handle, bytes, output) => numberResult(GetObjectW(handle, bytes, output)),
    deleteObject: (handle) => Boolean(DeleteObject(handle)),
    dragQueryFile: (drop, index, output, characters) =>
      numberResult(DragQueryFileW(drop, index, output, characters)),
  };
  return apiCache;
}

export function windowsDropFilesBuffer(filePaths: readonly string[]): Buffer {
  if (
    !filePaths.length ||
    filePaths.some((filePath) => !path.win32.isAbsolute(filePath) || filePath.includes('\0'))
  )
    throw new Error('Windows clipboard files must use absolute paths without null characters.');
  const names = Buffer.from(`${filePaths.join('\0')}\0\0`, 'utf16le');
  const output = Buffer.alloc(DROPFILES_BYTES + names.length);
  output.writeUInt32LE(DROPFILES_BYTES, 0);
  output.writeUInt32LE(1, 16);
  names.copy(output, DROPFILES_BYTES);
  return output;
}

export function windowsUnicodeTextBuffer(text: string): Buffer {
  if (text.includes('\0')) throw new Error('Clipboard text cannot contain null characters.');
  return Buffer.from(`${text}\0`, 'utf16le');
}

export function windowsHtmlBuffer(html: string): Buffer {
  const fragment = `<!--StartFragment-->${html}<!--EndFragment-->`;
  const document = `<html><body>${fragment}</body></html>`;
  const headerTemplate =
    'Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n';
  const startHtml = Buffer.byteLength(headerTemplate, 'utf8');
  const startFragment = startHtml + Buffer.byteLength('<html><body><!--StartFragment-->', 'utf8');
  const endFragment = startFragment + Buffer.byteLength(html, 'utf8');
  const endHtml = startHtml + Buffer.byteLength(document, 'utf8');
  const offset = (value: number) => String(value).padStart(10, '0');
  const header = headerTemplate
    .replace('StartHTML:0000000000', `StartHTML:${offset(startHtml)}`)
    .replace('EndHTML:0000000000', `EndHTML:${offset(endHtml)}`)
    .replace('StartFragment:0000000000', `StartFragment:${offset(startFragment)}`)
    .replace('EndFragment:0000000000', `EndFragment:${offset(endFragment)}`);
  return Buffer.from(`${header}${document}\0`, 'utf8');
}

export function windowsDibV5Buffer(bitmap: Buffer, width: number, height: number): Buffer {
  const pixelBytes = width * height * 4;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error('Clipboard bitmap dimensions are invalid.');
  if (bitmap.length !== pixelBytes) throw new Error('Clipboard bitmap bytes do not match their dimensions.');
  const header = Buffer.alloc(124);
  header.writeUInt32LE(124, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(-height, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(3, 16);
  header.writeUInt32LE(pixelBytes, 20);
  header.writeUInt32LE(0x00ff0000, 40);
  header.writeUInt32LE(0x0000ff00, 44);
  header.writeUInt32LE(0x000000ff, 48);
  header.writeUInt32LE(0xff000000, 52);
  header.writeUInt32LE(0x73524742, 56);
  header.writeUInt32LE(4, 108);
  return Buffer.concat([header, bitmap]);
}

function allocateGlobal(api: WindowsClipboardApi, bytes: Buffer): NativeHandle {
  if (!bytes.length) throw new Error('Clipboard payload is empty.');
  const handle = api.globalAlloc(GMEM_MOVEABLE_ZEROINIT, bytes.length);
  if (!truthyHandle(handle)) throw new Error(`GlobalAlloc failed (${api.getLastError()}).`);
  const pointer = api.globalLock(handle);
  if (!truthyHandle(pointer)) {
    api.globalFree(handle);
    throw new Error(`GlobalLock failed (${api.getLastError()}).`);
  }
  try {
    api.copyMemory(pointer, bytes, bytes.length);
  } finally {
    api.globalUnlock(handle);
  }
  if (api.globalSize(handle) < bytes.length) {
    api.globalFree(handle);
    throw new Error('Windows returned a smaller clipboard allocation than requested.');
  }
  return handle;
}

function cloneGlobal(api: WindowsClipboardApi, source: NativeHandle): NativeHandle {
  const size = api.globalSize(source);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Clipboard memory cannot be copied safely.');
  const sourcePointer = api.globalLock(source);
  if (!truthyHandle(sourcePointer)) throw new Error('Clipboard memory cannot be locked safely.');
  try {
    const clone = api.globalAlloc(GMEM_MOVEABLE_ZEROINIT, size);
    if (!truthyHandle(clone)) throw new Error('Clipboard backup allocation failed.');
    const clonePointer = api.globalLock(clone);
    if (!truthyHandle(clonePointer)) {
      api.globalFree(clone);
      throw new Error('Clipboard backup allocation could not be locked.');
    }
    try {
      api.copyMemory(clonePointer, sourcePointer, size);
    } finally {
      api.globalUnlock(clone);
    }
    return clone;
  } finally {
    api.globalUnlock(source);
  }
}

function registeredFormatName(api: WindowsClipboardApi, format: number): string {
  const output = Buffer.alloc(512);
  const characters = api.getClipboardFormatName(format, output, output.length / 2);
  return characters > 0 ? output.subarray(0, characters * 2).toString('utf16le') : '';
}

function freeMemory(api: WindowsClipboardApi, memory: ClipboardMemory): void {
  if (!truthyHandle(memory.handle)) return;
  if (memory.kind === 'bitmap') api.deleteObject(memory.handle);
  else api.globalFree(memory.handle);
}

function captureClipboard(api: WindowsClipboardApi): ClipboardMemory[] {
  const snapshot: ClipboardMemory[] = [];
  let previous = 0;
  let totalBytes = 0;
  let hasTransientOleFormat = false;
  try {
    while (true) {
      api.setLastError(0);
      const format = api.enumClipboardFormats(previous);
      if (!format) {
        const error = api.getLastError();
        if (error) throw new Error(`Clipboard format enumeration failed (${error}).`);
        break;
      }
      previous = format;
      if (snapshot.length >= MAX_SNAPSHOT_FORMATS)
        throw new Error('The existing clipboard contains too many formats to restore safely.');
      const registeredName = format >= REGISTERED_FORMAT_MIN ? registeredFormatName(api, format) : '';
      if (TRANSIENT_OLE_FORMATS.has(registeredName.toLowerCase())) {
        hasTransientOleFormat = true;
        continue;
      }
      const source = api.getClipboardData(format);
      if (!truthyHandle(source)) throw new Error(`Clipboard format ${format} could not be captured.`);
      if (format === CF_BITMAP) {
        const bitmapInfo = Buffer.alloc(process.arch === 'x64' || process.arch === 'arm64' ? 32 : 24);
        if (api.getObject(source, bitmapInfo.length, bitmapInfo) !== bitmapInfo.length)
          throw new Error('The existing clipboard bitmap dimensions could not be read safely.');
        const bitmapBytes = Math.abs(bitmapInfo.readInt32LE(8)) * Math.abs(bitmapInfo.readInt32LE(12));
        if (
          !Number.isSafeInteger(bitmapBytes) ||
          bitmapBytes <= 0 ||
          bitmapBytes > WINDOWS_CLIPBOARD_SNAPSHOT_MAX_FORMAT_BYTES
        )
          throw new Error('The existing clipboard bitmap is too large to restore safely.');
        totalBytes += bitmapBytes;
        if (totalBytes > WINDOWS_CLIPBOARD_SNAPSHOT_MAX_TOTAL_BYTES)
          throw new Error('The existing clipboard is too large to restore safely.');
        const bitmap = api.copyImage(source, IMAGE_BITMAP, 0, 0, LR_CREATEDIBSECTION);
        if (!truthyHandle(bitmap)) throw new Error('The existing clipboard bitmap could not be captured.');
        snapshot.push({ format, handle: bitmap, kind: 'bitmap' });
        continue;
      }
      if (
        !STANDARD_GLOBAL_FORMATS.has(format) &&
        !(format >= REGISTERED_FORMAT_MIN && SAFE_REGISTERED_GLOBAL_FORMATS.has(registeredName))
      )
        throw new Error(
          registeredName
            ? `Clipboard format “${registeredName}” cannot be restored safely.`
            : `Clipboard format ${format} cannot be restored safely.`,
        );
      const bytes = api.globalSize(source);
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > WINDOWS_CLIPBOARD_SNAPSHOT_MAX_FORMAT_BYTES)
        throw new Error(`Clipboard format ${format} is too large to restore safely.`);
      totalBytes += bytes;
      if (totalBytes > WINDOWS_CLIPBOARD_SNAPSHOT_MAX_TOTAL_BYTES)
        throw new Error('The existing clipboard is too large to restore safely.');
      snapshot.push({ format, handle: cloneGlobal(api, source), kind: 'global' });
    }
    if (hasTransientOleFormat && !snapshot.length)
      throw new Error('The existing OLE clipboard has no content format to restore safely.');
    return snapshot;
  } catch (error) {
    for (const memory of snapshot) freeMemory(api, memory);
    throw error;
  }
}

function releaseAll(api: WindowsClipboardApi, entries: ClipboardMemory[]): void {
  for (const entry of entries.splice(0)) freeMemory(api, entry);
}

function restoreClipboard(api: WindowsClipboardApi, snapshot: ClipboardMemory[]): void {
  if (!api.emptyClipboard()) throw new Error(`Clipboard recovery could not begin (${api.getLastError()}).`);
  for (let index = 0; index < snapshot.length; index++) {
    const memory = snapshot[index];
    if (!truthyHandle(api.setClipboardData(memory.format, memory.handle))) {
      snapshot.splice(0, index);
      throw new Error(`Clipboard recovery failed for format ${memory.format} (${api.getLastError()}).`);
    }
    memory.handle = null;
  }
  snapshot.length = 0;
}

export function windowsOwnerHandleValue(owner: Buffer): bigint | number {
  if ((owner.length !== 4 && owner.length !== 8) || owner.every((byte) => byte === 0))
    throw new Error('A live native window is required to own the Windows clipboard.');
  return owner.length === 8 ? owner.readBigUInt64LE() : owner.readUInt32LE();
}

/** Acquires one clipboard lock, then runs the transaction exactly once. */
export async function withWindowsClipboardLock<T>(
  owner: Buffer,
  transaction: (api: WindowsClipboardApi) => T,
  options: WindowsClipboardLockOptions = {},
  api = loadWindowsClipboardApi(),
): Promise<T> {
  const ownerValue = windowsOwnerHandleValue(owner);
  const timeoutMs = options.timeoutMs ?? 2_000;
  const requireStableSequence = options.requireStableSequence ?? false;
  const context = options.context ?? 'Windows clipboard';
  const now = options.now ?? Date.now;
  const yieldControl =
    options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
  const log = options.log ?? (() => undefined);
  const logDiagnostic = (message: string) => {
    try {
      log(message);
    } catch {
      // Diagnostics must never change clipboard transaction outcomes.
    }
  };
  const started = now();
  const initialSequence = api.getClipboardSequenceNumber();
  let busyChecks = 0;
  const ensureStableSequence = () => {
    if (!busyChecks || !requireStableSequence) return;
    const currentSequence = api.getClipboardSequenceNumber();
    if (currentSequence === initialSequence) return;
    logDiagnostic(
      `${context} cancelled after ${busyChecks} busy checks because the clipboard sequence changed from ${initialSequence} to ${currentSequence}.`,
    );
    throw new WindowsClipboardChangedError(
      'The clipboard changed while Imnota was waiting. Try copying again.',
      initialSequence,
      currentSequence,
      busyChecks,
    );
  };
  while (true) {
    ensureStableSequence();
    if (api.openClipboard(ownerValue)) {
      let result: T;
      try {
        ensureStableSequence();
        result = transaction(api);
      } finally {
        api.closeClipboard();
      }
      if (busyChecks)
        logDiagnostic(
          `${context} acquired the Windows clipboard after ${busyChecks} busy checks over ${now() - started}ms.`,
        );
      return result;
    }
    const nativeCode = api.getLastError();
    if (nativeCode !== ERROR_ACCESS_DENIED) {
      logDiagnostic(`${context} could not be opened; OpenClipboard returned error ${nativeCode}.`);
      throw new WindowsClipboardOpenError(
        'Windows could not access the clipboard. Try copying again.',
        nativeCode,
      );
    }
    busyChecks += 1;
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      logDiagnostic(
        `${context} timed out after ${busyChecks} busy checks over ${elapsed}ms; OpenClipboard returned error ${nativeCode}.`,
      );
      throw new WindowsClipboardBusyError(
        'The clipboard is in use by another app. Try copying again.',
        nativeCode,
        busyChecks,
        elapsed,
      );
    }
    await yieldControl();
  }
}

export async function writeWindowsClipboard(
  owner: Buffer,
  payload: WindowsClipboardPayload,
  api = loadWindowsClipboardApi(),
  lockOptions: WindowsClipboardLockOptions = {},
): Promise<void> {
  const formats: Array<{ format: number; bytes: Buffer }> = [
    { format: CF_HDROP, bytes: windowsDropFilesBuffer(payload.filePaths) },
  ];
  if (
    payload.markdown !== undefined ||
    payload.html !== undefined ||
    payload.png !== undefined ||
    payload.dibV5
  ) {
    if (
      payload.markdown === undefined ||
      payload.html === undefined ||
      payload.png === undefined ||
      payload.dibV5 === undefined
    )
      throw new Error('The combined Windows clipboard variant requires text, HTML, PNG, and bitmap bytes.');
    const htmlFormat = api.registerClipboardFormat('HTML Format');
    const pngFormat = api.registerClipboardFormat('PNG');
    if (!htmlFormat || !pngFormat) throw new Error('Windows clipboard formats could not be registered.');
    formats.push(
      { format: 13, bytes: windowsUnicodeTextBuffer(payload.markdown) },
      { format: htmlFormat, bytes: windowsHtmlBuffer(payload.html) },
      { format: pngFormat, bytes: payload.png },
      { format: CF_DIBV5, bytes: payload.dibV5 },
    );
  }
  const candidates: ClipboardMemory[] = [];
  try {
    for (const { format, bytes } of formats)
      candidates.push({ format, handle: allocateGlobal(api, bytes), kind: 'global' });
  } catch (error) {
    releaseAll(api, candidates);
    throw error;
  }
  let snapshot: ClipboardMemory[] = [];
  try {
    await withWindowsClipboardLock(
      owner,
      (lockedApi) => {
        snapshot = captureClipboard(lockedApi);
        if (!lockedApi.emptyClipboard())
          throw new Error(`Windows clipboard could not be cleared (${lockedApi.getLastError()}).`);
        for (let index = 0; index < candidates.length; index++) {
          const candidate = candidates[index];
          if (!truthyHandle(lockedApi.setClipboardData(candidate.format, candidate.handle))) {
            const failure = new Error(
              `Windows rejected clipboard format ${candidate.format} (${lockedApi.getLastError()}).`,
            );
            try {
              restoreClipboard(lockedApi, snapshot);
            } catch (restoreError) {
              throw new AggregateError(
                [failure, restoreError],
                'The clipboard write failed and recovery was incomplete.',
              );
            }
            throw failure;
          }
          candidate.handle = null;
        }
      },
      {
        ...lockOptions,
        context: lockOptions.context ?? 'Windows clipboard write',
        requireStableSequence: true,
      },
      api,
    );
  } finally {
    releaseAll(api, candidates);
    releaseAll(api, snapshot);
  }
}

function readWindowsClipboardFilesLocked(api: WindowsClipboardApi): string[] {
  if (!api.isClipboardFormatAvailable(CF_HDROP)) return [];
  const drop = api.getClipboardData(CF_HDROP);
  if (!truthyHandle(drop)) return [];
  const count = api.dragQueryFile(drop, 0xffffffff, null, 0);
  if (count !== 2) return [];
  const files: string[] = [];
  for (let index = 0; index < count; index++) {
    const length = api.dragQueryFile(drop, index, null, 0);
    if (length <= 0 || length > MAX_WINDOWS_PATH_CHARACTERS) return [];
    const output = Buffer.alloc((length + 1) * 2);
    const copied = api.dragQueryFile(drop, index, output, length + 1);
    if (copied !== length) return [];
    files.push(output.subarray(0, length * 2).toString('utf16le'));
  }
  return files;
}

export function readWindowsClipboardFiles(owner: Buffer, api = loadWindowsClipboardApi()): string[] {
  const ownerValue = windowsOwnerHandleValue(owner);
  if (!api.openClipboard(ownerValue)) throw new Error(`Windows clipboard is busy (${api.getLastError()}).`);
  try {
    return readWindowsClipboardFilesLocked(api);
  } finally {
    api.closeClipboard();
  }
}

export async function readWindowsClipboardFilesWhenAvailable(
  owner: Buffer,
  options: WindowsClipboardLockOptions = {},
  api = loadWindowsClipboardApi(),
): Promise<string[]> {
  return withWindowsClipboardLock(
    owner,
    readWindowsClipboardFilesLocked,
    { ...options, context: options.context ?? 'Windows clipboard readback' },
    api,
  );
}
