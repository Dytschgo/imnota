// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  MAC_SCREEN_RECORDING_SETTINGS_URL,
  macBundleIdentifier,
  repairMacScreenRecordingPermission,
  type MacPermissionRepairHost,
} from './mac-capture-permission.js';

function host(overrides: Partial<MacPermissionRepairHost> = {}) {
  const calls: string[] = [];
  const value: MacPermissionRepairHost = {
    bundleIdentifier: async () => 'com.dytschgo.imnota',
    run: vi.fn(async (file, args) => {
      calls.push(`${file} ${args.join(' ')}`);
    }),
    requestScreenAccess: vi.fn(async () => {
      calls.push('request');
    }),
    openSettings: vi.fn(async (url) => {
      calls.push(`open ${url}`);
    }),
    ...overrides,
  };
  return { value, calls };
}

describe('macOS Screen Recording repair', () => {
  it('resets only Imnota, asks for access again, then opens the Screen Recording page', async () => {
    const { value, calls } = host();
    await expect(repairMacScreenRecordingPermission(value)).resolves.toEqual({ reset: true });
    expect(calls).toEqual([
      '/usr/bin/tccutil reset ScreenCapture com.dytschgo.imnota',
      'request',
      `open ${MAC_SCREEN_RECORDING_SETTINGS_URL}`,
    ]);
  });

  it('still opens Settings when the reset or the access request fails', async () => {
    const { value, calls } = host({
      run: async () => {
        throw new Error('tccutil failed');
      },
      requestScreenAccess: async () => {
        throw new Error('denied');
      },
    });
    await expect(repairMacScreenRecordingPermission(value)).resolves.toEqual({ reset: false });
    expect(calls).toEqual([`open ${MAC_SCREEN_RECORDING_SETTINGS_URL}`]);
  });

  it('reads the bundle identifier from Info.plist and falls back safely', async () => {
    const plist =
      '<dict><key>CFBundleName</key><string>Imnota</string><key>CFBundleIdentifier</key>\n<string>com.dytschgo.imnota.local</string></dict>';
    await expect(
      macBundleIdentifier('/Applications/Imnota.app/Contents/Resources', async () => plist),
    ).resolves.toBe('com.dytschgo.imnota.local');
    await expect(
      macBundleIdentifier('/nowhere', async () => {
        throw new Error('missing');
      }),
    ).resolves.toBe('com.dytschgo.imnota');
    await expect(
      macBundleIdentifier('/x', async () => '<key>CFBundleIdentifier</key><string>bad id; rm</string>'),
    ).resolves.toBe('com.dytschgo.imnota');
  });
});
