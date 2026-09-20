import {
  normalizeShortcut,
  resolveShortcutBindings,
  type ShortcutBindings,
  type ShortcutPlatform,
} from '../src/shared/shortcuts.js';

export interface GlobalShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

const ELECTRON_KEYS: Record<string, string> = {
  Alt: 'Alt',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Backspace: 'Backspace',
  Ctrl: 'Control',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Escape: 'Escape',
  Home: 'Home',
  Meta: 'Command',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Shift: 'Shift',
  Space: 'Space',
  Tab: 'Tab',
};

export function shortcutPlatformFromProcess(platform: NodeJS.Platform): ShortcutPlatform {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

export function captureRegionBinding(bindings: ShortcutBindings, platform: NodeJS.Platform): string | null {
  return resolveShortcutBindings(bindings, shortcutPlatformFromProcess(platform))['capture.region'];
}

const OS_HELD_GLOBAL_CAPTURE: Record<ShortcutPlatform, ReadonlySet<string>> = {
  mac: new Set(['Meta+Shift+3', 'Meta+Shift+4', 'Meta+Shift+5']),
  windows: new Set(),
  linux: new Set(),
};

export function isOsHeldGlobalCaptureShortcut(binding: string, platform: ShortcutPlatform): boolean {
  const normalized = normalizeShortcut(binding, platform);
  return normalized !== null && OS_HELD_GLOBAL_CAPTURE[platform].has(normalized);
}

/** Binding to register globally, or null when capture is off, unsupported, cleared, or OS-owned. */
export function resolveCaptureGlobalShortcut(input: {
  bindings: ShortcutBindings;
  processPlatform: NodeJS.Platform;
  experimentalEnabled: boolean;
}): string | null {
  if (!input.experimentalEnabled) return null;
  if (input.processPlatform !== 'win32' && input.processPlatform !== 'darwin') return null;
  const binding = captureRegionBinding(input.bindings, input.processPlatform);
  if (!binding) return null;
  if (isOsHeldGlobalCaptureShortcut(binding, shortcutPlatformFromProcess(input.processPlatform))) return null;
  return binding;
}

/** Convert a stored Imnota binding to an Electron accelerator, or null if it cannot be registered. */
export function toElectronAccelerator(binding: string): string | null {
  const normalized = normalizeShortcut(binding, 'windows');
  if (!normalized) return null;
  const parts = normalized.split('+').map((part) => ELECTRON_KEYS[part] ?? part);
  if (parts.some((part) => !part)) return null;
  return parts.join('+');
}

/**
 * Registers only capture.region as a process-wide accelerator. Change, reset, and
 * clear replace or drop the previous registration. The callback is swapped in place
 * so a later window can receive the same accelerator without double-registering.
 */
export class CaptureGlobalShortcut {
  private accelerator: string | null = null;
  private trigger: () => void = () => undefined;
  private readonly fire = () => this.trigger();

  constructor(private readonly api: GlobalShortcutApi) {}

  sync(binding: string | null, onTrigger: () => void): boolean {
    this.trigger = onTrigger;
    const next = binding ? toElectronAccelerator(binding) : null;
    if (this.accelerator === next) return next === null || this.accelerator !== null;
    this.clear();
    if (!next) return true;
    if (!this.api.register(next, this.fire)) return false;
    this.accelerator = next;
    return true;
  }

  clear(): void {
    if (!this.accelerator) return;
    this.api.unregister(this.accelerator);
    this.accelerator = null;
  }

  get registeredAccelerator(): string | null {
    return this.accelerator;
  }
}
