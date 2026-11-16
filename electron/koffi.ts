import { createRequire } from 'node:module';

export interface KoffiLibrary {
  func(name: string, result: string, parameters: readonly string[]): (...args: unknown[]) => unknown;
}

export interface KoffiModule {
  load(name: string): KoffiLibrary;
}

/**
 * Loads the bundled koffi build for this Windows architecture. `feature` names the
 * caller in the error, e.g. "Window enumeration is unavailable on ia32."
 */
export function loadKoffi(feature: string): KoffiModule {
  const packageName =
    process.arch === 'x64'
      ? '@koromix/koffi-win32-x64'
      : process.arch === 'arm64'
        ? '@koromix/koffi-win32-arm64'
        : undefined;
  if (!packageName) throw new Error(`${feature} is unavailable on ${process.arch}.`);
  return createRequire(import.meta.url)(packageName) as KoffiModule;
}
