import { z } from 'zod';
import {
  BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH,
  DEFAULT_PREFERENCE_SETTINGS,
  isAllowedBackgroundImage,
  type PreferenceSettings,
  type PreferenceSettingsResult,
} from './preferences.js';
import type { PreferenceSettingsUpdate } from './workflow-bridge.js';
import { SHORTCUT_ACTIONS } from './shortcuts.js';

const shortcutValueSchema = z.string().max(100).nullable();
const shortcutActionIds = new Set<string>(SHORTCUT_ACTIONS.map((action) => action.id));
const shortcutBindingsSchema = z.record(z.string(), shortcutValueSchema).superRefine((bindings, context) => {
  for (const actionId of Object.keys(bindings))
    if (!shortcutActionIds.has(actionId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported shortcut action: ${actionId}`,
      });
});

export const preferenceSettingsSchema = z
  .object({
    appearance: z
      .object({
        mode: z.enum(['system', 'light', 'dark']),
        accent: z.enum(['graphite', 'indigo', 'emerald', 'amber']),
        glassLevel: z.enum(['off', 'subtle', 'balanced', 'strong']),
        allowPerformanceFallback: z.boolean(),
        backgroundImage: z
          .string()
          .max(BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH)
          .refine(isAllowedBackgroundImage, 'Choose a bundled backdrop or a local image file.')
          .default(''),
        backgroundOpacity: z.number().min(0).max(1).default(0.42),
        useSameBackdropForBoth: z.boolean().default(true),
        themeBackdropsInitialized: z.boolean().default(false),
        lightBackgroundImage: z
          .string()
          .max(BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH)
          .refine(isAllowedBackgroundImage, 'Choose a bundled backdrop or a local image file.')
          .default(''),
        darkBackgroundImage: z
          .string()
          .max(BACKGROUND_IMAGE_MAX_DATA_URL_LENGTH)
          .refine(isAllowedBackgroundImage, 'Choose a bundled backdrop or a local image file.')
          .default(''),
        lightBackgroundOpacity: z.number().min(0).max(1).default(0.42),
        darkBackgroundOpacity: z.number().min(0).max(1).default(0.42),
        desktopGlass: z.boolean().optional(),
      })
      .strict(),
    shortcuts: z.object({ bindings: shortcutBindingsSchema }).strict(),
    onboarding: z
      .object({ completed: z.boolean(), completedVersion: z.number().int().nonnegative() })
      .strict(),
  })
  .strict();

export const preferenceSettingsUpdateSchema = z
  .object({
    // Zod 4 applies inner defaults even inside optional fields. Patches must contain only supplied keys.
    appearance: preferenceSettingsSchema.shape.appearance
      .extend({
        backgroundImage: preferenceSettingsSchema.shape.appearance.shape.backgroundImage.unwrap(),
        backgroundOpacity: preferenceSettingsSchema.shape.appearance.shape.backgroundOpacity.unwrap(),
        useSameBackdropForBoth:
          preferenceSettingsSchema.shape.appearance.shape.useSameBackdropForBoth.unwrap(),
        themeBackdropsInitialized:
          preferenceSettingsSchema.shape.appearance.shape.themeBackdropsInitialized.unwrap(),
        lightBackgroundImage: preferenceSettingsSchema.shape.appearance.shape.lightBackgroundImage.unwrap(),
        darkBackgroundImage: preferenceSettingsSchema.shape.appearance.shape.darkBackgroundImage.unwrap(),
        lightBackgroundOpacity:
          preferenceSettingsSchema.shape.appearance.shape.lightBackgroundOpacity.unwrap(),
        darkBackgroundOpacity: preferenceSettingsSchema.shape.appearance.shape.darkBackgroundOpacity.unwrap(),
      })
      .partial()
      .strict()
      .optional(),
    shortcuts: z.object({ bindings: shortcutBindingsSchema.optional() }).strict().optional(),
    onboarding: preferenceSettingsSchema.shape.onboarding.partial().strict().optional(),
  })
  .strict();

function cloneDefaults(): PreferenceSettings {
  return {
    appearance: { ...DEFAULT_PREFERENCE_SETTINGS.appearance },
    shortcuts: { bindings: { ...DEFAULT_PREFERENCE_SETTINGS.shortcuts.bindings } },
    onboarding: { ...DEFAULT_PREFERENCE_SETTINGS.onboarding },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Remove only legacy external background URLs while retaining compatible local preferences. */
function normalizePersistedPreferences(value: unknown): Record<string, unknown> {
  const preferences = record(value);
  const appearance = record(preferences.appearance);
  const sanitized = Object.fromEntries(
    ['backgroundImage', 'lightBackgroundImage', 'darkBackgroundImage'].map((key) => [
      key,
      typeof appearance[key] === 'string' && !isAllowedBackgroundImage(appearance[key])
        ? ''
        : appearance[key],
    ]),
  );
  return { ...preferences, appearance: { ...appearance, ...sanitized } };
}

/** Resolve profile provenance before any caller persists defaults. */
export function resolvePreferenceSettings(
  persistedValue: unknown,
  settingsFileExists: boolean,
): PreferenceSettingsResult {
  if (!settingsFileExists)
    return {
      settings: cloneDefaults(),
      profile: {
        settingsFileExists: false,
        migratedFromLegacyProfile: false,
        initializedAsNewProfile: true,
      },
    };

  const persisted = record(persistedValue);
  if ('preferences' in persisted) {
    const profileKind = z.enum(['new', 'migrated']).safeParse(persisted.preferenceProfile);
    return {
      settings: preferenceSettingsSchema.parse(normalizePersistedPreferences(persisted.preferences)),
      profile: {
        settingsFileExists: true,
        migratedFromLegacyProfile: profileKind.success && profileKind.data === 'migrated',
        initializedAsNewProfile: profileKind.success && profileKind.data === 'new',
      },
    };
  }

  const settings = cloneDefaults();
  const legacyTheme = z.enum(['system', 'light', 'dark']).safeParse(persisted.theme);
  if (legacyTheme.success) settings.appearance.mode = legacyTheme.data;
  return {
    settings,
    profile: { settingsFileExists: true, migratedFromLegacyProfile: true },
  };
}

export function mergePreferenceSettings(
  current: PreferenceSettings,
  rawUpdate: PreferenceSettingsUpdate,
): PreferenceSettings {
  const update = preferenceSettingsUpdateSchema.parse(rawUpdate);
  return preferenceSettingsSchema.parse({
    appearance: { ...current.appearance, ...update.appearance },
    shortcuts: {
      ...current.shortcuts,
      ...update.shortcuts,
      bindings: { ...current.shortcuts.bindings, ...update.shortcuts?.bindings },
    },
    onboarding: { ...current.onboarding, ...update.onboarding },
  });
}

/** Persist one authoritative appearance mode under preferences, never a second legacy theme field. */
export function preferenceSettingsEnvelope(
  applicationSettings: Readonly<Record<string, unknown>>,
  preferences: PreferenceSettings,
  profile?: PreferenceSettingsResult['profile'],
): Record<string, unknown> {
  const rest = { ...applicationSettings };
  delete rest.theme;
  delete rest.preferences;
  delete rest.preferenceProfile;
  return {
    ...rest,
    preferences: preferenceSettingsSchema.parse(preferences),
    preferenceProfile:
      profile?.initializedAsNewProfile === true
        ? 'new'
        : profile?.migratedFromLegacyProfile
          ? 'migrated'
          : 'new',
  };
}
