import type { ShortcutBindings } from './shortcuts.js';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type AccentPreset = 'graphite' | 'indigo' | 'emerald' | 'amber';
export type GlassLevel = 'off' | 'subtle' | 'balanced' | 'strong';

export const BACKDROP_PRESETS = ['graphite', 'indigo', 'emerald', 'amber'] as const;
export type BackdropPreset = (typeof BACKDROP_PRESETS)[number];
export const BACKGROUND_IMAGE_MAX_BYTES = 5_500_000;
// Base64 expands binary data by roughly a third. The additional allowance covers the data URL header.
export const BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH = Math.ceil(BACKGROUND_IMAGE_MAX_BYTES / 3) * 4 + 128;
export const BACKGROUND_IMAGE_MAX_DIMENSION = 3_840;
export const BACKGROUND_IMAGE_MAX_PIXELS = 12_000_000;

export function backdropPresetValue(preset: BackdropPreset): `preset:${BackdropPreset}` {
  return `preset:${preset}`;
}

export function isBackdropPreset(value: string): value is `preset:${BackdropPreset}` {
  return BACKDROP_PRESETS.some((preset) => value === backdropPresetValue(preset));
}

export function isAllowedBackgroundImage(value: string): boolean {
  return (
    value === '' ||
    isBackdropPreset(value) ||
    (value.length <= BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH &&
      /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value))
  );
}

export interface AppearancePreferences {
  mode: AppearanceMode;
  accent: AccentPreset;
  glassLevel: GlassLevel;
  allowPerformanceFallback: boolean;
  backgroundImage: string;
  backgroundOpacity: number;
  /**
   * A legacy shared backdrop remains the source of truth while this is true.
   * Theme-specific values let a dark image and a light image coexist without
   * changing existing saved preferences.
   */
  useSameBackdropForBoth: boolean;
  lightBackgroundImage: string;
  darkBackgroundImage: string;
  lightBackgroundOpacity: number;
  darkBackgroundOpacity: number;
  desktopGlass?: boolean;
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
  initializedAsNewProfile?: boolean;
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
  backgroundImage: '',
  backgroundOpacity: 0.42,
  useSameBackdropForBoth: true,
  lightBackgroundImage: '',
  darkBackgroundImage: '',
  lightBackgroundOpacity: 0.42,
  darkBackgroundOpacity: 0.42,
};

export type ResolvedBackdropTheme = Exclude<AppearanceMode, 'system'>;

/** Resolve a backdrop without mutating the shared legacy preference. */
export function appearanceBackdrop(
  appearance: AppearancePreferences,
  theme: ResolvedBackdropTheme,
): { image: string; opacity: number } {
  if (appearance.useSameBackdropForBoth)
    return { image: appearance.backgroundImage, opacity: appearance.backgroundOpacity };
  return theme === 'dark'
    ? {
        image: appearance.darkBackgroundImage || appearance.backgroundImage,
        opacity: appearance.darkBackgroundOpacity,
      }
    : {
        image: appearance.lightBackgroundImage || appearance.backgroundImage,
        opacity: appearance.lightBackgroundOpacity,
      };
}

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
  return (
    profile.initializedAsNewProfile === true ||
    (!profile.settingsFileExists && !profile.migratedFromLegacyProfile)
  );
}

export function completedOnboarding(version = ONBOARDING_VERSION): OnboardingPreferences {
  return { completed: true, completedVersion: version };
}
