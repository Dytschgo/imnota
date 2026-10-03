// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preferenceSettingsEnvelope, resolvePreferenceSettings } from '../preference-settings';
import { DEFAULT_WORKSPACE_SETTINGS, resolveWorkspaceSettings } from '../workspace-settings';

const options = { isAbsolutePath: path.posix.isAbsolute };
const resolve = (persisted: unknown) => resolveWorkspaceSettings(persisted, options);

describe('persisted workspace settings', () => {
  it('loads a valid profile unchanged', () => {
    const stored = {
      workspacePath: '/home/ada/Imnota',
      interfaceScale: 1.25,
      openRecentOnLaunch: false,
      confirmBeforeDeletion: false,
      updateChannel: 'nightly',
      sharingSenderName: 'Ada',
    };
    expect(resolve(stored)).toEqual({ settings: stored, retained: {} });
  });

  it('never accepts a workspace root that is not an absolute path string', () => {
    for (const workspacePath of [
      42,
      true,
      {},
      ['/home/ada'],
      { toString: '/home/ada' },
      '',
      'relative/workspace',
      '../outside',
      '/home/ada\0/etc',
      `/${'a'.repeat(40_000)}`,
    ])
      expect(resolve({ workspacePath }).settings.workspacePath).toBeNull();
    expect(resolve({ workspacePath: null }).settings.workspacePath).toBeNull();
    expect(
      resolveWorkspaceSettings(
        { workspacePath: 'C:\\Users\\Ada\\Imnota' },
        { isAbsolutePath: path.win32.isAbsolute },
      ).settings.workspacePath,
    ).toBe('C:\\Users\\Ada\\Imnota');
  });

  it('replaces only the invalid fields with defaults', () => {
    const { settings } = resolve({
      workspacePath: '/home/ada/Imnota',
      interfaceScale: 'huge',
      openRecentOnLaunch: 'yes',
      confirmBeforeDeletion: false,
      updateChannel: 'beta',
      sharingSenderName: 7,
    });
    expect(settings).toEqual({
      ...DEFAULT_WORKSPACE_SETTINGS,
      workspacePath: '/home/ada/Imnota',
      confirmBeforeDeletion: false,
    });
    expect(resolve({ interfaceScale: 40, updateChannel: 'nightly' }).settings).toEqual({
      ...DEFAULT_WORKSPACE_SETTINGS,
      updateChannel: 'nightly',
    });
  });

  it('does not throw for any stored shape', () => {
    for (const persisted of [undefined, null, 'text', 3, [], [{ workspacePath: '/a' }]])
      expect(resolve(persisted)).toEqual({ settings: DEFAULT_WORKSPACE_SETTINGS, retained: {} });
  });

  it('retains keys from other builds and writes them back, without the preference envelope', () => {
    const preferences = resolvePreferenceSettings(undefined, false);
    const stored = JSON.parse(
      `{"workspacePath":"/home/ada/Imnota","futureFeature":{"enabled":true},"exportPresets":[{"id":"a"}],
        "__proto__":{"polluted":true},"toString":"kept","theme":"dark","preferenceProfile":"new",
        "preferences":${JSON.stringify(preferences.settings)}}`,
    ) as unknown;
    const { settings, retained } = resolve(stored);
    expect(Object.keys(retained).sort()).toEqual(['__proto__', 'exportPresets', 'futureFeature', 'toString']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(retained)).toBe(Object.prototype);

    const rewritten = JSON.parse(
      JSON.stringify(
        preferenceSettingsEnvelope(
          { ...retained, ...settings, interfaceScale: 1.5 },
          preferences.settings,
          preferences.profile,
        ),
      ),
    ) as Record<string, unknown>;
    expect(rewritten).toMatchObject({
      workspacePath: '/home/ada/Imnota',
      interfaceScale: 1.5,
      futureFeature: { enabled: true },
      exportPresets: [{ id: 'a' }],
      toString: 'kept',
      preferenceProfile: 'new',
    });
    expect(rewritten).not.toHaveProperty('theme');
    expect(resolve(rewritten).retained).toEqual(retained);
  });

  it('keeps the workspace when the stored preferences are invalid', () => {
    const stored = { workspacePath: '/home/ada/Imnota', preferences: { appearance: 'broken' } };
    expect(() => resolvePreferenceSettings(stored, true)).toThrow();
    expect(resolve(stored).settings.workspacePath).toBe('/home/ada/Imnota');
  });
});
