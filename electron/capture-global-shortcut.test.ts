import { describe, expect, it, vi } from 'vitest';
import {
  CaptureGlobalShortcut,
  captureRegionBinding,
  isOsHeldGlobalCaptureShortcut,
  resolveCaptureGlobalShortcut,
  shortcutPlatformFromProcess,
  toElectronAccelerator,
} from './capture-global-shortcut.js';

describe('capture global shortcut', () => {
  it('maps stored bindings to Electron accelerators', () => {
    expect(toElectronAccelerator('Ctrl+Shift+5')).toBe('Control+Shift+5');
    expect(toElectronAccelerator('Meta+Shift+5')).toBe('Command+Shift+5');
    expect(toElectronAccelerator('Ctrl+Shift+ArrowUp')).toBe('Control+Shift+Up');
    expect(toElectronAccelerator('')).toBeNull();
    expect(shortcutPlatformFromProcess('darwin')).toBe('mac');
    expect(shortcutPlatformFromProcess('win32')).toBe('windows');
    expect(captureRegionBinding({}, 'win32')).toBe('Ctrl+Shift+5');
    expect(captureRegionBinding({}, 'darwin')).toBe('Ctrl+Shift+5');
    expect(isOsHeldGlobalCaptureShortcut('Meta+Shift+5', 'mac')).toBe(true);
    expect(isOsHeldGlobalCaptureShortcut('Ctrl+Shift+5', 'windows')).toBe(false);
    expect(
      resolveCaptureGlobalShortcut({
        bindings: {},
        processPlatform: 'win32',
        experimentalEnabled: true,
      }),
    ).toBe('Ctrl+Shift+5');
    expect(
      resolveCaptureGlobalShortcut({
        bindings: {},
        processPlatform: 'win32',
        experimentalEnabled: false,
      }),
    ).toBeNull();
    expect(
      resolveCaptureGlobalShortcut({
        bindings: {},
        processPlatform: 'linux',
        experimentalEnabled: true,
      }),
    ).toBeNull();
    expect(
      resolveCaptureGlobalShortcut({
        bindings: {},
        processPlatform: 'darwin',
        experimentalEnabled: true,
      }),
    ).toBe('Ctrl+Shift+5');
    expect(
      resolveCaptureGlobalShortcut({
        bindings: { 'capture.region': 'Meta+Shift+5' },
        processPlatform: 'darwin',
        experimentalEnabled: true,
      }),
    ).toBeNull();
    expect(
      resolveCaptureGlobalShortcut({
        bindings: { 'capture.region': 'Ctrl+Shift+S' },
        processPlatform: 'darwin',
        experimentalEnabled: true,
      }),
    ).toBe('Ctrl+Shift+S');
  });

  it('registers, replaces, and clears the capture accelerator', () => {
    const api = {
      register: vi.fn<(accelerator: string, callback: () => void) => boolean>(() => true),
      unregister: vi.fn<(accelerator: string) => void>(),
    };
    const shortcut = new CaptureGlobalShortcut(api);
    const first = vi.fn();
    expect(shortcut.sync('Ctrl+Shift+5', first)).toBe(true);
    expect(api.register).toHaveBeenCalledExactlyOnceWith('Control+Shift+5', expect.any(Function));
    api.register.mock.calls[0]?.[1]();
    expect(first).toHaveBeenCalledOnce();

    const second = vi.fn();
    expect(shortcut.sync('Ctrl+Shift+S', second)).toBe(true);
    expect(api.unregister).toHaveBeenCalledExactlyOnceWith('Control+Shift+5');
    expect(api.register).toHaveBeenLastCalledWith('Control+Shift+S', expect.any(Function));
    api.register.mock.calls.at(-1)?.[1]();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    expect(shortcut.sync(null, second)).toBe(true);
    expect(api.unregister).toHaveBeenLastCalledWith('Control+Shift+S');
    expect(shortcut.registeredAccelerator).toBeNull();
  });

  it('keeps one registration when the binding is unchanged and retries after a failed register', () => {
    const api = {
      register: vi.fn<(accelerator: string, callback: () => void) => boolean>(() => false),
      unregister: vi.fn<(accelerator: string) => void>(),
    };
    const shortcut = new CaptureGlobalShortcut(api);
    expect(shortcut.sync('Ctrl+Shift+5', () => undefined)).toBe(false);
    expect(api.register).toHaveBeenCalledOnce();
    expect(shortcut.registeredAccelerator).toBeNull();

    api.register.mockReturnValue(true);
    expect(shortcut.sync('Ctrl+Shift+5', () => undefined)).toBe(true);
    expect(shortcut.sync('Ctrl+Shift+5', () => undefined)).toBe(true);
    expect(api.register).toHaveBeenCalledTimes(2);
    expect(api.unregister).not.toHaveBeenCalled();
  });
});
