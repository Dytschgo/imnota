import { useEffect, useMemo, useState } from 'react';
import type { AccentPreset, AppearancePreferences, GlassLevel } from '../../shared/preferences';

export type ResolvedTheme = 'light' | 'dark';
export type GlassFallbackReason = 'none' | 'user-disabled' | 'reduced-transparency' | 'performance';

export interface AppearanceEnvironment {
  systemTheme: ResolvedTheme;
  reducedTransparency: boolean;
  performanceConstrained: boolean;
}

export interface EffectiveAppearance {
  theme: ResolvedTheme;
  accent: AccentPreset;
  requestedGlassLevel: GlassLevel;
  glassLevel: GlassLevel;
  glassFallbackReason: GlassFallbackReason;
}

export interface UseAppearanceOptions {
  /** Conservative host signal only. This hook intentionally performs no hardware inference. */
  performanceConstrained?: boolean;
  root?: HTMLElement | null;
}

const ACCENTS: Record<
  AccentPreset,
  { base: string; hover: string; softDark: string; softLight: string; onAccent: string }
> = {
  graphite: {
    base: '#7d8798',
    hover: '#a5adba',
    softDark: 'rgba(148, 159, 177, 0.16)',
    softLight: 'rgba(76, 87, 104, 0.12)',
    onAccent: '#0b0d12',
  },
  indigo: {
    base: '#6857f5',
    hover: '#8b7cf6',
    softDark: 'rgba(104, 87, 245, 0.18)',
    softLight: 'rgba(86, 69, 222, 0.12)',
    onAccent: '#ffffff',
  },
  emerald: {
    base: '#159668',
    hover: '#35b989',
    softDark: 'rgba(21, 150, 104, 0.18)',
    softLight: 'rgba(13, 128, 87, 0.12)',
    onAccent: '#ffffff',
  },
  amber: {
    base: '#c77c11',
    hover: '#e5a33b',
    softDark: 'rgba(199, 124, 17, 0.18)',
    softLight: 'rgba(170, 98, 5, 0.13)',
    onAccent: '#17130b',
  },
};

const GLASS: Record<GlassLevel, { alpha: string; blur: string; saturation: string }> = {
  off: { alpha: '1', blur: '0px', saturation: '100%' },
  subtle: { alpha: '0.92', blur: '10px', saturation: '108%' },
  balanced: { alpha: '0.82', blur: '18px', saturation: '115%' },
  strong: { alpha: '0.7', blur: '28px', saturation: '124%' },
};

function mediaMatches(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  );
}

export function resolveAppearance(
  preferences: AppearancePreferences,
  environment: AppearanceEnvironment,
): EffectiveAppearance {
  const theme = preferences.mode === 'system' ? environment.systemTheme : preferences.mode;
  if (preferences.glassLevel === 'off') {
    return {
      theme,
      accent: preferences.accent,
      requestedGlassLevel: preferences.glassLevel,
      glassLevel: 'off',
      glassFallbackReason: 'user-disabled',
    };
  }
  if (environment.reducedTransparency) {
    return {
      theme,
      accent: preferences.accent,
      requestedGlassLevel: preferences.glassLevel,
      glassLevel: 'off',
      glassFallbackReason: 'reduced-transparency',
    };
  }
  if (preferences.allowPerformanceFallback && environment.performanceConstrained) {
    return {
      theme,
      accent: preferences.accent,
      requestedGlassLevel: preferences.glassLevel,
      glassLevel: 'off',
      glassFallbackReason: 'performance',
    };
  }
  return {
    theme,
    accent: preferences.accent,
    requestedGlassLevel: preferences.glassLevel,
    glassLevel: preferences.glassLevel,
    glassFallbackReason: 'none',
  };
}

function subscribeMedia(query: MediaQueryList, listener: () => void) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  if (typeof query.addListener === 'function') {
    query.addListener(listener);
    return () => query.removeListener(listener);
  }
  return () => undefined;
}

export function useAppearance(
  preferences: AppearancePreferences,
  options: UseAppearanceOptions = {},
): EffectiveAppearance {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    mediaMatches('(prefers-color-scheme: light)') ? 'light' : 'dark',
  );
  const [reducedTransparency, setReducedTransparency] = useState(() =>
    mediaMatches('(prefers-reduced-transparency: reduce)'),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const color = window.matchMedia('(prefers-color-scheme: light)');
    const transparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const updateColor = () => setSystemTheme(color.matches ? 'light' : 'dark');
    const updateTransparency = () => setReducedTransparency(transparency.matches);
    updateColor();
    updateTransparency();
    const unsubscribeColor = subscribeMedia(color, updateColor);
    const unsubscribeTransparency = subscribeMedia(transparency, updateTransparency);
    return () => {
      unsubscribeColor();
      unsubscribeTransparency();
    };
  }, []);

  const effective = useMemo(
    () =>
      resolveAppearance(preferences, {
        systemTheme,
        reducedTransparency,
        performanceConstrained: options.performanceConstrained ?? false,
      }),
    [options.performanceConstrained, preferences, reducedTransparency, systemTheme],
  );

  useEffect(() => {
    const root = options.root ?? (typeof document === 'undefined' ? null : document.documentElement);
    if (!root) return;
    const accent = ACCENTS[effective.accent];
    const glass = GLASS[effective.glassLevel];
    root.dataset.theme = effective.theme;
    root.dataset.accent = effective.accent;
    root.dataset.glassLevel = effective.glassLevel;
    root.dataset.glassRequested = effective.requestedGlassLevel;
    root.dataset.glassFallback = effective.glassFallbackReason;
    root.style.colorScheme = effective.theme;
    root.style.setProperty('--imnota-accent', accent.base);
    root.style.setProperty('--imnota-accent-hover', accent.hover);
    root.style.setProperty(
      '--imnota-accent-soft',
      effective.theme === 'dark' ? accent.softDark : accent.softLight,
    );
    root.style.setProperty('--imnota-on-accent', accent.onAccent);
    root.style.setProperty('--imnota-glass-alpha', glass.alpha);
    root.style.setProperty('--imnota-glass-opacity', `${Number(glass.alpha) * 100}%`);
    root.style.setProperty('--imnota-glass-blur', glass.blur);
    root.style.setProperty('--imnota-glass-saturation', glass.saturation);
    // Compatibility aliases let the current indigo-named shell adopt presets before its global tokens are renamed.
    root.style.setProperty('--indigo', accent.base);
    root.style.setProperty('--indigo-light', accent.hover);
  }, [effective, options.root]);

  return effective;
}
