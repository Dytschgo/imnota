import { createRequire } from 'node:module';
import type { CaptureRectangle } from '../src/shared/capture.js';
import type { NativeCaptureWindow } from './capture-windows.js';

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const GW_HWNDNEXT = 2;
const MAX_ENUMERATED_WINDOWS = 128;

type NativeHandle = unknown;

interface KoffiLibrary {
  func(name: string, result: string, parameters: readonly string[]): (...args: unknown[]) => unknown;
}

interface KoffiModule {
  load(name: string): KoffiLibrary;
}

interface WindowsWindowApi {
  getDesktopWindow(): NativeHandle;
  getTopWindow(hwnd: NativeHandle): NativeHandle;
  getWindow(hwnd: NativeHandle, command: number): NativeHandle;
  isWindowVisible(hwnd: NativeHandle): boolean;
  isIconic(hwnd: NativeHandle): boolean;
  getWindowRect(hwnd: NativeHandle, output: Buffer): boolean;
  dwmGetWindowAttribute(hwnd: NativeHandle, attribute: number, output: Buffer, bytes: number): number;
  getWindowText(hwnd: NativeHandle, output: Buffer, characters: number): number;
  getClassName(hwnd: NativeHandle, output: Buffer, characters: number): number;
  getWindowLongPtr(hwnd: NativeHandle, index: number): number;
  getWindowThreadProcessId(hwnd: NativeHandle, processId: Buffer): number;
  getCurrentProcessId(): number;
}

let apiCache: WindowsWindowApi | undefined;

function truthyHandle(handle: NativeHandle): boolean {
  return handle !== null && handle !== undefined && handle !== 0 && handle !== 0n;
}

function numberResult(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

function handleId(handle: NativeHandle): string {
  if (typeof handle === 'bigint' || typeof handle === 'number') return String(handle);
  return String(numberResult(handle));
}

function loadKoffi(): KoffiModule {
  const packageName =
    process.arch === 'x64'
      ? '@koromix/koffi-win32-x64'
      : process.arch === 'arm64'
        ? '@koromix/koffi-win32-arm64'
        : undefined;
  if (!packageName) throw new Error(`Window enumeration is unavailable on ${process.arch}.`);
  return createRequire(import.meta.url)(packageName) as KoffiModule;
}

function loadWindowsWindowApi(): WindowsWindowApi {
  if (process.platform !== 'win32') throw new Error('Window bounds are available only on Windows.');
  if (apiCache) return apiCache;
  const koffi = loadKoffi();
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const fn = (library: KoffiLibrary, name: string, result: string, parameters: readonly string[]) =>
    library.func(name, result, parameters);
  const GetDesktopWindow = fn(user32, 'GetDesktopWindow', 'void *', []);
  const GetTopWindow = fn(user32, 'GetTopWindow', 'void *', ['void *']);
  const GetWindow = fn(user32, 'GetWindow', 'void *', ['void *', 'uint32_t']);
  const IsWindowVisible = fn(user32, 'IsWindowVisible', 'bool', ['void *']);
  const IsIconic = fn(user32, 'IsIconic', 'bool', ['void *']);
  const GetWindowRect = fn(user32, 'GetWindowRect', 'bool', ['void *', 'void *']);
  const DwmGetWindowAttribute = fn(dwmapi, 'DwmGetWindowAttribute', 'long', [
    'void *',
    'uint32_t',
    'void *',
    'uint32_t',
  ]);
  const GetWindowTextW = fn(user32, 'GetWindowTextW', 'int', ['void *', 'void *', 'int']);
  const GetClassNameW = fn(user32, 'GetClassNameW', 'int', ['void *', 'void *', 'int']);
  const GetWindowLongPtrW = fn(user32, 'GetWindowLongPtrW', 'intptr_t', ['void *', 'int']);
  const GetWindowThreadProcessId = fn(user32, 'GetWindowThreadProcessId', 'uint32_t', ['void *', 'void *']);
  const GetCurrentProcessId = fn(kernel32, 'GetCurrentProcessId', 'uint32_t', []);
  apiCache = {
    getDesktopWindow: () => GetDesktopWindow(),
    getTopWindow: (hwnd) => GetTopWindow(hwnd),
    getWindow: (hwnd, command) => GetWindow(hwnd, command),
    isWindowVisible: (hwnd) => Boolean(IsWindowVisible(hwnd)),
    isIconic: (hwnd) => Boolean(IsIconic(hwnd)),
    getWindowRect: (hwnd, output) => Boolean(GetWindowRect(hwnd, output)),
    dwmGetWindowAttribute: (hwnd, attribute, output, bytes) =>
      numberResult(DwmGetWindowAttribute(hwnd, attribute, output, bytes)),
    getWindowText: (hwnd, output, characters) => numberResult(GetWindowTextW(hwnd, output, characters)),
    getClassName: (hwnd, output, characters) => numberResult(GetClassNameW(hwnd, output, characters)),
    getWindowLongPtr: (hwnd, index) => numberResult(GetWindowLongPtrW(hwnd, index)),
    getWindowThreadProcessId: (hwnd, processId) => numberResult(GetWindowThreadProcessId(hwnd, processId)),
    getCurrentProcessId: () => numberResult(GetCurrentProcessId()),
  };
  return apiCache;
}

function readRect(buffer: Buffer): CaptureRectangle | null {
  const left = buffer.readInt32LE(0);
  const top = buffer.readInt32LE(4);
  const right = buffer.readInt32LE(8);
  const bottom = buffer.readInt32LE(12);
  const width = right - left;
  const height = bottom - top;
  if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  return { x: left, y: top, width, height };
}

function readUtf16(apiRead: (output: Buffer, characters: number) => number): string {
  const output = Buffer.alloc(512 * 2);
  const length = Math.max(0, Math.min(apiRead(output, 512), 511));
  return output.toString('utf16le', 0, length * 2);
}

function physicalWindowBounds(api: WindowsWindowApi, hwnd: NativeHandle): CaptureRectangle | null {
  const extended = Buffer.alloc(16);
  if (api.dwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, extended, 16) === 0) {
    const bounds = readRect(extended);
    if (bounds) return bounds;
  }
  const fallback = Buffer.alloc(16);
  return api.getWindowRect(hwnd, fallback) ? readRect(fallback) : null;
}

function readNativeWindow(
  api: WindowsWindowApi,
  hwnd: NativeHandle,
  currentProcessId: number,
  toDipRect: (rect: CaptureRectangle) => CaptureRectangle,
): NativeCaptureWindow | null {
  const physical = physicalWindowBounds(api, hwnd);
  if (!physical) return null;
  const cloaked = Buffer.alloc(4);
  const pid = Buffer.alloc(4);
  api.getWindowThreadProcessId(hwnd, pid);
  const exStyle = api.getWindowLongPtr(hwnd, GWL_EXSTYLE) >>> 0;
  const toolWindow = (exStyle & WS_EX_TOOLWINDOW) !== 0 && (exStyle & WS_EX_APPWINDOW) === 0;
  api.dwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4);
  const bounds = toDipRect(physical);
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
  return {
    id: `window:${handleId(hwnd)}`,
    title: readUtf16((output, characters) => api.getWindowText(hwnd, output, characters)),
    className: readUtf16((output, characters) => api.getClassName(hwnd, output, characters)),
    bounds,
    visible: api.isWindowVisible(hwnd),
    cloaked: cloaked.readUInt32LE(0) !== 0,
    toolWindow,
    minimized: api.isIconic(hwnd),
    currentProcess: pid.readUInt32LE(0) === currentProcessId,
  };
}

/** Best-effort Windows window list for overlay hover. Empty when koffi or USER32 is unavailable. */
export function tryListWindowsCaptureWindows(
  toDipRect: (rect: CaptureRectangle) => CaptureRectangle,
): NativeCaptureWindow[] {
  try {
    const api = loadWindowsWindowApi();
    const currentProcessId = api.getCurrentProcessId();
    const desktop = api.getDesktopWindow();
    if (!truthyHandle(desktop)) return [];
    const windows: NativeCaptureWindow[] = [];
    const seen = new Set<string>();
    let hwnd = api.getTopWindow(desktop);
    while (truthyHandle(hwnd) && windows.length < MAX_ENUMERATED_WINDOWS) {
      const id = handleId(hwnd);
      if (id && !seen.has(id)) {
        seen.add(id);
        const native = readNativeWindow(api, hwnd, currentProcessId, toDipRect);
        if (native) windows.push(native);
      }
      hwnd = api.getWindow(hwnd, GW_HWNDNEXT);
    }
    return windows;
  } catch {
    return [];
  }
}
