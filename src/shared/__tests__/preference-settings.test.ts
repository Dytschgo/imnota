import { describe, expect, it } from 'vitest';
import {
  mergePreferenceSettings,
  preferenceSettingsEnvelope,
  resolvePreferenceSettings,
} from '../preference-settings';
import { shouldShowOnboarding } from '../preferences';
import { appearanceBackdrop } from '../preferences';

describe('profile-aware preference settings', () => {
  it('identifies a new profile before defaults are written', () => {
    const result = resolvePreferenceSettings(undefined, false);
    expect(result.profile).toEqual({
      settingsFileExists: false,
      migratedFromLegacyProfile: false,
      initializedAsNewProfile: true,
    });
    expect(shouldShowOnboarding(result.settings.onboarding, result.profile)).toBe(true);
  });

  it('migrates the legacy theme without keeping a duplicate authority', () => {
    const result = resolvePreferenceSettings({ workspacePath: 'C:/work', theme: 'dark' }, true);
    expect(result.settings.appearance.mode).toBe('dark');
    expect(result.profile.migratedFromLegacyProfile).toBe(true);
    expect(shouldShowOnboarding(result.settings.onboarding, result.profile)).toBe(false);
    expect(
      preferenceSettingsEnvelope({ workspacePath: 'C:/work', theme: 'dark' }, result.settings),
    ).toMatchObject({
      workspacePath: 'C:/work',
      preferences: { appearance: { mode: 'dark' } },
    });
    expect(Object.hasOwn(preferenceSettingsEnvelope({ theme: 'dark' }, result.settings), 'theme')).toBe(
      false,
    );
  });

  it('deep-merges scoped updates and validates unsupported values', () => {
    const current = resolvePreferenceSettings(undefined, false).settings;
    const next = mergePreferenceSettings(current, {
      appearance: { accent: 'emerald' },
      shortcuts: { bindings: { 'prompt.copy': 'Ctrl+Shift+P' } },
    });
    expect(next.appearance).toMatchObject({ mode: 'system', accent: 'emerald' });
    expect(next.shortcuts.bindings).toEqual({ 'prompt.copy': 'Ctrl+Shift+P' });
    expect(() =>
      mergePreferenceSettings(current, {
        appearance: { accent: 'violet' as 'indigo' },
      }),
    ).toThrow();
  });

  it('keeps a persisted new profile eligible for unfinished onboarding after restart', () => {
    const initial = resolvePreferenceSettings(undefined, false);
    const persisted = preferenceSettingsEnvelope({}, initial.settings, initial.profile);
    const restarted = resolvePreferenceSettings(persisted, true);
    expect(restarted.profile).toMatchObject({
      settingsFileExists: true,
      initializedAsNewProfile: true,
    });
    expect(shouldShowOnboarding(restarted.settings.onboarding, restarted.profile)).toBe(true);
  });

  it('keeps supported local backdrops while clearing legacy remote backdrop URLs', () => {
    const base = resolvePreferenceSettings(undefined, false).settings;
    const remote = resolvePreferenceSettings(
      {
        preferences: {
          ...base,
          appearance: { ...base.appearance, backgroundImage: 'https://example.com/a.png' },
        },
      },
      true,
    );
    expect(remote.settings.appearance.backgroundImage).toBe('');

    const preset = resolvePreferenceSettings(
      { preferences: { ...base, appearance: { ...base.appearance, backgroundImage: 'preset:amber' } } },
      true,
    );
    expect(preset.settings.appearance.backgroundImage).toBe('preset:amber');
  });

  it('migrates a shared backdrop into the new per-theme format without changing its result', () => {
    const base = resolvePreferenceSettings(undefined, false).settings;
    const legacy = resolvePreferenceSettings(
      {
        preferences: {
          ...base,
          appearance: {
            mode: 'system',
            accent: 'indigo',
            glassLevel: 'balanced',
            allowPerformanceFallback: true,
            backgroundImage: 'preset:indigo',
            backgroundOpacity: 0.55,
          },
        },
      },
      true,
    );
    expect(legacy.settings.appearance).toMatchObject({
      backgroundImage: 'preset:indigo',
      backgroundOpacity: 0.55,
      useSameBackdropForBoth: true,
      themeBackdropsInitialized: false,
      lightBackgroundImage: '',
      darkBackgroundImage: '',
    });
  });

  it('keeps per-theme local backdrops while removing only unsafe remote values', () => {
    const base = resolvePreferenceSettings(undefined, false).settings;
    const result = resolvePreferenceSettings(
      {
        preferences: {
          ...base,
          appearance: {
            ...base.appearance,
            useSameBackdropForBoth: false,
            lightBackgroundImage: 'preset:emerald',
            darkBackgroundImage: 'https://example.com/unsafe.png',
          },
        },
      },
      true,
    );
    expect(result.settings.appearance.lightBackgroundImage).toBe('preset:emerald');
    expect(result.settings.appearance.darkBackgroundImage).toBe('');
  });

  it('keeps an explicit per-theme No image after returning through shared mode', () => {
    const base = resolvePreferenceSettings(undefined, false).settings;
    const separate = mergePreferenceSettings(base, {
      appearance: {
        backgroundImage: 'preset:indigo',
        backgroundOpacity: 0.55,
        useSameBackdropForBoth: false,
        themeBackdropsInitialized: true,
        lightBackgroundImage: 'preset:indigo',
        darkBackgroundImage: 'preset:indigo',
        lightBackgroundOpacity: 0.55,
        darkBackgroundOpacity: 0.55,
      },
    });
    const lightOff = mergePreferenceSettings(separate, { appearance: { lightBackgroundImage: '' } });
    expect(appearanceBackdrop(lightOff.appearance, 'light').image).toBe('');
    expect(appearanceBackdrop(lightOff.appearance, 'dark').image).toBe('preset:indigo');

    const shared = mergePreferenceSettings(lightOff, {
      appearance: { useSameBackdropForBoth: true, backgroundImage: '' },
    });
    const restoredSeparate = mergePreferenceSettings(shared, {
      appearance: { useSameBackdropForBoth: false },
    });
    expect(appearanceBackdrop(restoredSeparate.appearance, 'light').image).toBe('');
    expect(appearanceBackdrop(restoredSeparate.appearance, 'dark').image).toBe('preset:indigo');
  });
});
