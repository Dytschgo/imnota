import { describe, expect, it } from 'vitest';
import { resolveAppearance } from '../app/useAppearance';
import {
  DEFAULT_APPEARANCE,
  ONBOARDING_VERSION,
  shouldShowOnboarding,
  type AppearancePreferences,
} from './preferences';

describe('appearance resolution', () => {
  it('follows live system theme input while keeping accent independent from glass', () => {
    expect(
      resolveAppearance(
        { ...DEFAULT_APPEARANCE, accent: 'emerald', glassLevel: 'balanced' },
        { systemTheme: 'light', reducedTransparency: false, performanceConstrained: false },
      ),
    ).toMatchObject({ theme: 'light', accent: 'emerald', glassLevel: 'balanced' });
  });

  it('lets reduced transparency override glass and uses a conservative performance fallback', () => {
    const preferences: AppearancePreferences = {
      ...DEFAULT_APPEARANCE,
      glassLevel: 'strong',
    };
    expect(
      resolveAppearance(preferences, {
        systemTheme: 'dark',
        reducedTransparency: true,
        performanceConstrained: false,
      }),
    ).toMatchObject({ glassLevel: 'off', glassFallbackReason: 'reduced-transparency' });
    expect(
      resolveAppearance(preferences, {
        systemTheme: 'dark',
        reducedTransparency: false,
        performanceConstrained: true,
      }),
    ).toMatchObject({ glassLevel: 'off', glassFallbackReason: 'performance' });
  });

  it('lets accessibility and host fallbacks override automatic light image glass', () => {
    const preferences = { ...DEFAULT_APPEARANCE, backgroundImage: 'preset:graphite' };
    for (const [reducedTransparency, performanceConstrained, reason] of [
      [true, false, 'reduced-transparency'],
      [false, true, 'performance'],
    ] as const) {
      expect(
        resolveAppearance(preferences, { systemTheme: 'light', reducedTransparency, performanceConstrained }),
      ).toMatchObject({ glassLevel: 'off', glassFallbackReason: reason });
    }
    expect(
      resolveAppearance(preferences, {
        systemTheme: 'light',
        reducedTransparency: false,
        performanceConstrained: false,
      }),
    ).toMatchObject({ glassLevel: 'strong', requestedGlassLevel: 'off' });
    expect(
      resolveAppearance(preferences, {
        systemTheme: 'dark',
        reducedTransparency: false,
        performanceConstrained: false,
      }),
    ).toMatchObject({ glassLevel: 'off', requestedGlassLevel: 'off' });
  });

  it('lets an explicit keep-transparency preference dominate performance inference', () => {
    expect(
      resolveAppearance(
        { ...DEFAULT_APPEARANCE, glassLevel: 'strong', allowPerformanceFallback: false },
        { systemTheme: 'dark', reducedTransparency: false, performanceConstrained: true },
      ),
    ).toMatchObject({ glassLevel: 'strong', glassFallbackReason: 'none' });
  });
});

describe('onboarding profile gating', () => {
  const incomplete = { completed: false, completedVersion: 0 };

  it('shows only for a genuinely new profile', () => {
    expect(
      shouldShowOnboarding(incomplete, { settingsFileExists: false, migratedFromLegacyProfile: false }),
    ).toBe(true);
    expect(
      shouldShowOnboarding(incomplete, { settingsFileExists: true, migratedFromLegacyProfile: false }),
    ).toBe(false);
    expect(
      shouldShowOnboarding(incomplete, { settingsFileExists: false, migratedFromLegacyProfile: true }),
    ).toBe(false);
  });

  it('does not replay completed onboarding after an update', () => {
    expect(
      shouldShowOnboarding(
        { completed: true, completedVersion: ONBOARDING_VERSION },
        { settingsFileExists: true, migratedFromLegacyProfile: false },
        ONBOARDING_VERSION + 1,
      ),
    ).toBe(false);
  });
});
