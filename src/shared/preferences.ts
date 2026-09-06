import type { ShortcutBindings } from './shortcuts';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type AccentPreset = 'graphite' | 'indigo' | 'emerald' | 'amber';
export type GlassLevel = 'off' | 'subtle' | 'balanced' | 'strong';

export interface AppearancePreferences {
  mode: AppearanceMode;
  accent: AccentPreset;
  glassLevel: GlassLevel;
  allowPerformanceFallback: boolean;
}

export interface ShortcutPreferences {
  bindings: ShortcutBindings;
}

export interface OnboardingPreferences {
  completed: boolean;
  completedVersion: number;
}

export interface PreferenceSettings {
  appearance: AppearancePreferences;
  shortcuts: ShortcutPreferences;
  onboarding: OnboardingPreferences;
}

export interface SettingsProfileProvenance {
  settingsFileExists: boolean;
  migratedFromLegacyProfile: boolean;
}

export interface PreferenceSettingsResult {
  settings: PreferenceSettings;
  profile: SettingsProfileProvenance;
}

export const ONBOARDING_VERSION = 1;

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  mode: 'system',
  accent: 'indigo',
  glassLevel: 'off',
  allowPerformanceFallback: true,
};

export const DEFAULT_ONBOARDING: OnboardingPreferences = {
  completed: false,
  completedVersion: 0,
};

export const DEFAULT_PREFERENCE_SETTINGS: PreferenceSettings = {
  appearance: DEFAULT_APPEARANCE,
  shortcuts: { bindings: {} },
  onboarding: DEFAULT_ONBOARDING,
};

export function shouldShowOnboarding(
  onboarding: OnboardingPreferences,
  profile: SettingsProfileProvenance,
  currentVersion = ONBOARDING_VERSION,
): boolean {
  if (onboarding.completed || onboarding.completedVersion >= currentVersion) return false;
  return !profile.settingsFileExists && !profile.migratedFromLegacyProfile;
}

export function completedOnboarding(version = ONBOARDING_VERSION): OnboardingPreferences {
  return { completed: true, completedVersion: version };
}
