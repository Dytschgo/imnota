// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  mergePreferenceSettings,
  preferenceSettingsEnvelope,
  preferenceSettingsUpdateSchema,
  resolvePreferenceSettings,
} from '../preference-settings';
import { shouldShowOnboarding } from '../preferences';
import {
  BACKDROP_PRESETS,
  backdropPresetValue,
  appearanceBackdrop,
  type PreferenceSettings,
} from '../preferences';

describe('profile-aware preference settings', () => {
  it('migrates profiles without presets and preserves presets across unrelated updates and restarts', () => {
    const initial = resolvePreferenceSettings(undefined, false);
    const legacy = { ...initial.settings };
    Reflect.deleteProperty(legacy, 'exportPresets');
    expect(resolvePreferenceSettings({ preferences: legacy }, true).settings.exportPresets).toEqual([]);
    const preset = {
      id: 'review',
      name: 'Review',
      defaultFunction: 'rich' as const,
      includeRecognisedText: false,
    };
    const saved = mergePreferenceSettings(initial.settings, { exportPresets: [preset] });
    const patched = mergePreferenceSettings(saved, { promptExport: { includeRecognisedText: false } });
    const restarted = resolvePreferenceSettings(
      preferenceSettingsEnvelope({}, patched, initial.profile),
      true,
    );
    expect(restarted.settings.exportPresets).toEqual([preset]);
    expect(preferenceSettingsUpdateSchema.parse({ promptExport: {} })).toEqual({ promptExport: {} });
    expect(mergePreferenceSettings(patched, { exportPresets: [] }).exportPresets).toEqual([]);
  });

  it('rejects malformed, duplicate, and excessive presets before applying any preferences', () => {
    const current = resolvePreferenceSettings(undefined, false).settings;
    const preset = {
      id: 'review',
      name: 'Review',
      defaultFunction: 'rich' as const,
      includeRecognisedText: false,
    };
    for (const exportPresets of [
      [{ ...preset, name: ' ' }],
      [{ ...preset, name: 'x'.repeat(61) }],
      [preset, { ...preset, id: 'second', name: ' REVIEW ' }],
      [preset, { ...preset, name: 'Different' }],
      Array.from({ length: 21 }, (_, index) => ({ ...preset, id: String(index), name: String(index) })),
    ]) {
      expect(() =>
        mergePreferenceSettings(current, { nativeCopy: { defaultFunction: 'rich' }, exportPresets }),
      ).toThrow();
      expect(current.nativeCopy.defaultFunction).toBe('files');
      expect(current.exportPresets).toEqual([]);
    }
  });

  it.each([{}, { accent: 'amber' }, { lightBackgroundImage: '' }])(
    'keeps appearance updates sparse without inserting stored-profile defaults: %j',
    (appearance) => {
      expect(preferenceSettingsUpdateSchema.parse({ appearance })).toEqual({ appearance });
    },
  );

  it.each(BACKDROP_PRESETS)(
    'preserves %s through saving and restarting shared and separate theme preferences',
    (preset) => {
      const initial = resolvePreferenceSettings(undefined, false);
      const image = backdropPresetValue(preset);
      for (const useSameBackdropForBoth of [true, false]) {
        const settings = mergePreferenceSettings(initial.settings, {
          appearance: {
            backgroundImage: image,
            lightBackgroundImage: image,
            darkBackgroundImage: image,
            useSameBackdropForBoth,
          },
        });
        const restarted = resolvePreferenceSettings(
          preferenceSettingsEnvelope({}, settings, initial.profile),
          true,
        );
        expect(appearanceBackdrop(restarted.settings.appearance).image).toBe(image);
        expect(restarted.settings.appearance.useSameBackdropForBoth).toBe(true);
      }
    },
  );

  it('identifies a new profile before defaults are written', () => {
    const result = resolvePreferenceSettings(undefined, false);
    expect(result.profile).toEqual({
      settingsFileExists: false,
      migratedFromLegacyProfile: false,
      initializedAsNewProfile: true,
    });
    expect(shouldShowOnboarding(result.settings.onboarding, result.profile)).toBe(true);
    expect(result.settings.capture.experimentalRegionCapture).toBe(
      process.platform === 'win32' || process.platform === 'darwin',
    );
    expect(result.settings.workbench.screenshotFirstAdd).toBe(true);
    expect(result.settings.nativeCopy.defaultFunction).toBe('files');
    expect(result.settings.promptExport.includeRecognisedText).toBe(false);
    expect(result.settings.updates.whatsNewAcknowledgedVersion).toBeUndefined();
    expect(result.settings.agentAccess.enabled).toBe(false);
  });

  it('keeps older saved preferences compatible while adding capture opt-in', () => {
    const current = resolvePreferenceSettings(undefined, false).settings;
    const restored = resolvePreferenceSettings({ preferences: { ...current, capture: undefined } }, true);
    expect(restored.settings.capture.experimentalRegionCapture).toBe(false);
    const withoutWorkbench = resolvePreferenceSettings(
      { preferences: { ...current, workbench: undefined } },
      true,
    );
    expect(withoutWorkbench.settings.workbench.screenshotFirstAdd).toBe(true);
    const withoutNativeCopy = resolvePreferenceSettings(
      { preferences: { ...current, nativeCopy: undefined } },
      true,
    );
    expect(withoutNativeCopy.settings.nativeCopy.defaultFunction).toBe('files');
    const withoutPromptExport = resolvePreferenceSettings(
      { preferences: { ...current, promptExport: undefined } },
      true,
    );
    expect(withoutPromptExport.settings.promptExport.includeRecognisedText).toBe(false);
    expect(
      mergePreferenceSettings(current, { promptExport: { includeRecognisedText: false } }).promptExport,
    ).toEqual({ includeRecognisedText: false });
    expect(mergePreferenceSettings(current, { workbench: { screenshotFirstAdd: false } }).workbench).toEqual({
      screenshotFirstAdd: false,
    });
    expect(
      mergePreferenceSettings(current, { updates: { whatsNewAcknowledgedVersion: '0.2.8' } }).updates,
    ).toEqual({ whatsNewAcknowledgedVersion: '0.2.8' });
    const withoutAgentAccess = resolvePreferenceSettings(
      { preferences: { ...current, agentAccess: undefined } },
      true,
    );
    expect(withoutAgentAccess.settings.agentAccess.enabled).toBe(false);
    expect(mergePreferenceSettings(current, { agentAccess: { enabled: true } }).agentAccess).toEqual({
      enabled: true,
    });
  });

  it('defaults an unknown persisted native copy function without discarding unrelated preferences', () => {
    const current = resolvePreferenceSettings(undefined, false).settings;
    const restored = resolvePreferenceSettings(
      {
        preferences: {
          ...current,
          appearance: { ...current.appearance, mode: 'dark', accent: 'emerald' },
          backups: { ...current.backups, retentionCount: 7 },
          nativeCopy: { defaultFunction: 'future-native-format', futureField: true },
        },
      },
      true,
    );
    expect(restored.settings.nativeCopy).toEqual({ defaultFunction: 'files' });
    expect(restored.settings.appearance).toMatchObject({ mode: 'dark', accent: 'emerald' });
    expect(restored.settings.backups.retentionCount).toBe(7);
  });

  it('migrates the legacy theme without keeping a duplicate authority', () => {
    const result = resolvePreferenceSettings({ workspacePath: 'C:/work', theme: 'dark' }, true);
    expect(result.settings.appearance.mode).toBe('dark');
    expect(result.profile.migratedFromLegacyProfile).toBe(true);
    expect(result.settings.capture.experimentalRegionCapture).toBe(false);
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
    expect(
      mergePreferenceSettings(current, { nativeCopy: { defaultFunction: 'files-rich' } }).nativeCopy,
    ).toEqual({ defaultFunction: 'files-rich' });
    expect(() =>
      mergePreferenceSettings(current, {
        nativeCopy: { defaultFunction: 'paths' as 'files' },
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

  it('folds a retired per-theme backdrop into the single backdrop on load', () => {
    const base = resolvePreferenceSettings(undefined, false);
    const load = (appearance: Partial<PreferenceSettings['appearance']>) =>
      resolvePreferenceSettings(
        preferenceSettingsEnvelope({}, mergePreferenceSettings(base.settings, { appearance }), base.profile),
        true,
      ).settings.appearance;

    const split = load({
      backgroundImage: 'preset:indigo',
      backgroundOpacity: 0.3,
      useSameBackdropForBoth: false,
      lightBackgroundImage: 'preset:indigo',
      darkBackgroundImage: 'preset:emerald',
      lightBackgroundOpacity: 0.3,
      darkBackgroundOpacity: 0.6,
    });
    expect(split.useSameBackdropForBoth).toBe(true);
    expect(appearanceBackdrop(split)).toEqual({ image: 'preset:emerald', opacity: 0.6 });

    const lightOnly = load({
      useSameBackdropForBoth: false,
      lightBackgroundImage: 'preset:indigo',
      darkBackgroundImage: '',
      lightBackgroundOpacity: 0.25,
    });
    expect(appearanceBackdrop(lightOnly)).toEqual({ image: 'preset:indigo', opacity: 0.25 });

    const neither = load({
      useSameBackdropForBoth: false,
      lightBackgroundImage: '',
      darkBackgroundImage: '',
    });
    expect(appearanceBackdrop(neither).image).toBe('');
  });
});
