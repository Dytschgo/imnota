import { useEffect, useMemo, useState } from 'react';
import {
  appearanceBackdrop,
  isAllowedBackgroundImage,
  isBackdropPreset,
  type AccentPreset,
  type AppearancePreferences,
  type BackdropPreset,
  type GlassLevel,
} from '../../shared/preferences';

export type ResolvedTheme = 'light' | 'dark';
export type GlassFallbackReason = 'none' | 'user-disabled' | 'reduced-transparency' | 'performance';

export interface AppearanceEnvironment {
  systemTheme: ResolvedTheme;
  reducedTransparency: boolean;
  performanceConstrained: boolean;
}

export interface EffectiveAppearance {
  desktopGlassStatus?: 'active' | 'fallback' | 'off';
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

export interface AccentTokens {
  base: string;
  hover: string;
  soft: string;
  onAccent: string;
}

const ACCENTS: Record<AccentPreset, Record<ResolvedTheme, AccentTokens>> = {
  graphite: {
    dark: {
      base: '#7d8798',
      hover: '#a5adba',
      soft: 'rgba(148, 159, 177, 0.16)',
      onAccent: '#0b0d12',
    },
    light: {
      base: '#4b5565',
      hover: '#384150',
      soft: 'rgba(75, 85, 101, 0.2)',
      onAccent: '#ffffff',
    },
  },
  indigo: {
    dark: {
      base: '#6857f5',
      hover: '#8b7cf6',
      soft: 'rgba(104, 87, 245, 0.18)',
      onAccent: '#ffffff',
    },
    light: {
      base: '#6857f5',
      hover: '#4e3ee6',
      soft: 'rgba(78, 62, 230, 0.2)',
      onAccent: '#ffffff',
    },
  },
  emerald: {
    dark: {
      base: '#159668',
      hover: '#35b989',
      soft: 'rgba(21, 150, 104, 0.18)',
      onAccent: '#ffffff',
    },
    light: {
      base: '#0e7450',
      hover: '#0b5e41',
      soft: 'rgba(14, 116, 80, 0.2)',
      onAccent: '#ffffff',
    },
  },
  amber: {
    dark: {
      base: '#c77c11',
      hover: '#e5a33b',
      soft: 'rgba(199, 124, 17, 0.18)',
      onAccent: '#17130b',
    },
    light: {
      base: '#8f5407',
      hover: '#6f4005',
      soft: 'rgba(143, 84, 7, 0.2)',
      onAccent: '#ffffff',
    },
  },
};

export function accentTokens(preset: AccentPreset, theme: ResolvedTheme): AccentTokens {
  return ACCENTS[preset][theme];
}

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

export function backdropPresetUrl(preset: BackdropPreset): string {
  const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || './';
  const path = `${base.endsWith('/') ? base : `${base}/`}backdrops/${preset}.png`;
  return typeof document === 'undefined' ? path : new URL(path, document.baseURI).href;
}

export function cssBackgroundImage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !isAllowedBackgroundImage(trimmed)) return 'none';
  if (isBackdropPreset(trimmed))
    return `url("${backdropPresetUrl(trimmed.slice('preset:'.length) as BackdropPreset)}")`;
  const escaped = trimmed
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replace(/[\r\n]/g, '');
  return `url("${escaped}")`;
}

export function resolveAppearance(
  preferences: AppearancePreferences,
  environment: AppearanceEnvironment,
): EffectiveAppearance {
  const theme = preferences.mode === 'system' ? environment.systemTheme : preferences.mode;
  const image = appearanceBackdrop(preferences, theme).image;
  const automaticLightGlass = theme === 'light' && Boolean(image) && isAllowedBackgroundImage(image);
  const glassLevel =
    automaticLightGlass && preferences.glassLevel === 'off' ? 'strong' : preferences.glassLevel;
  if (glassLevel === 'off') {
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
    glassLevel,
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
  const [desktopActive, setDesktopActive] = useState(false);

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
    let current = true;
    setDesktopActive(false);
    const enabled = Boolean(
      preferences.desktopGlass &&
      !appearanceBackdrop(preferences, effective.theme).image &&
      effective.glassLevel !== 'off',
    );
    if (typeof window.imnota?.setDesktopGlass === 'function') {
      void window.imnota
        .setDesktopGlass({ enabled })
        .then((result) => {
          if (current) setDesktopActive(result.ok && result.value.active);
        })
        .catch(() => {
          if (current) setDesktopActive(false);
        });
    }
    return () => {
      current = false;
    };
  }, [effective.glassLevel, effective.theme, preferences]);

  useEffect(() => {
    const root = options.root ?? (typeof document === 'undefined' ? null : document.documentElement);
    if (!root) return;
    const accent = accentTokens(effective.accent, effective.theme);
    const glass = GLASS[effective.glassLevel];
    root.dataset.theme = effective.theme;
    root.dataset.accent = effective.accent;
    root.dataset.glassLevel = effective.glassLevel;
    root.dataset.glassRequested = effective.requestedGlassLevel;
    root.dataset.glassFallback = effective.glassFallbackReason;
    root.style.colorScheme = effective.theme;
    root.style.setProperty('--imnota-accent', accent.base);
    root.style.setProperty('--imnota-accent-hover', accent.hover);
    root.style.setProperty('--imnota-accent-soft', accent.soft);
    root.style.setProperty('--imnota-on-accent', accent.onAccent);
    root.style.setProperty('--imnota-glass-alpha', glass.alpha);
    root.style.setProperty('--imnota-glass-opacity', `${Number(glass.alpha) * 100}%`);
    root.style.setProperty('--imnota-glass-blur', glass.blur);
    root.style.setProperty('--imnota-glass-saturation', glass.saturation);
    const backdrop = appearanceBackdrop(preferences, effective.theme);
    const backdropActive = effective.glassLevel !== 'off' && Boolean(backdrop.image);
    root.dataset.background = backdropActive ? 'active' : 'none';
    root.dataset.backgroundSource = backdropActive
      ? isBackdropPreset(backdrop.image)
        ? 'preset'
        : 'upload'
      : 'none';
    root.dataset.desktopGlass = desktopActive
      ? 'active'
      : preferences.desktopGlass && !backdrop.image
        ? 'fallback'
        : 'off';
    root.style.setProperty('--imnota-desktop-tint', `${Math.max(15, backdrop.opacity * 100)}%`);
    root.style.setProperty(
      '--imnota-background-image',
      backdropActive ? cssBackgroundImage(backdrop.image) : 'none',
    );
    root.style.setProperty('--imnota-background-opacity', backdropActive ? String(backdrop.opacity) : '0');
    // Compatibility aliases let the current indigo-named shell adopt presets before its global tokens are renamed.
    root.style.setProperty('--indigo', accent.base);
    root.style.setProperty('--indigo-light', accent.hover);
  }, [effective, options.root, preferences, desktopActive]);

  return {
    ...effective,
    desktopGlassStatus: desktopActive
      ? 'active'
      : preferences.desktopGlass && !appearanceBackdrop(preferences, effective.theme).image
        ? 'fallback'
        : 'off',
  };
}
