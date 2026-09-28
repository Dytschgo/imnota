import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const MAC_SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

const FALLBACK_BUNDLE_ID = 'com.dytschgo.imnota';

/** The running app's bundle identifier, read from its Info.plist. */
export async function macBundleIdentifier(
  resourcesPath: string = process.resourcesPath,
  read: (file: string) => Promise<string> = (file) => readFile(file, 'utf8'),
): Promise<string> {
  try {
    const plist = await read(path.join(resourcesPath, '..', 'Info.plist'));
    const match = /<key>CFBundleIdentifier<\/key>\s*<string>([A-Za-z0-9.-]+)<\/string>/.exec(plist);
    return match?.[1] ?? FALLBACK_BUNDLE_ID;
  } catch {
    return FALLBACK_BUNDLE_ID;
  }
}

export interface MacPermissionRepairHost {
  bundleIdentifier(): Promise<string>;
  /** Runs a fixed system executable with arguments; never a shell. */
  run(file: string, args: readonly string[]): Promise<void>;
  /** Asks macOS for screen access, so Imnota is listed and prompts again. */
  requestScreenAccess(): Promise<void>;
  openSettings(url: string): Promise<void>;
}

export const nativeMacPermissionRepairHost = (
  requestScreenAccess: () => Promise<void>,
  openSettings: (url: string) => Promise<void>,
): MacPermissionRepairHost => ({
  bundleIdentifier: () => macBundleIdentifier(),
  run: (file, args) =>
    new Promise((resolve, reject) =>
      execFile(file, [...args], { timeout: 10_000 }, (error) => (error ? reject(error) : resolve())),
    ),
  requestScreenAccess,
  openSettings,
});

/**
 * Ad-hoc signed builds get a new code signature with every update, so macOS
 * keeps showing Imnota as allowed while denying the new binary. Resetting only
 * Imnota's own Screen Recording entry lets macOS ask again for this build.
 */
export async function repairMacScreenRecordingPermission(
  host: MacPermissionRepairHost,
): Promise<{ reset: boolean }> {
  const bundleId = await host.bundleIdentifier();
  let reset = false;
  try {
    await host.run('/usr/bin/tccutil', ['reset', 'ScreenCapture', bundleId]);
    reset = true;
  } catch {
    // Settings still opens, and the user can remove the stale entry by hand.
  }
  try {
    await host.requestScreenAccess();
  } catch {
    // A refused request still leaves the Settings page as the next step.
  }
  await host.openSettings(MAC_SCREEN_RECORDING_SETTINGS_URL);
  return { reset };
}
