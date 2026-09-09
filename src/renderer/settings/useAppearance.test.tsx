import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accentTokens, cssBackgroundImage, useAppearance } from '../app/useAppearance';
import { DEFAULT_APPEARANCE, type GlassLevel } from './preferences';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.removeAttribute('data-glass-level');
  vi.restoreAllMocks();
});

describe('useAppearance', () => {
  it('reacts to operating-system theme changes while system mode is active', () => {
    let light = false;
    const listeners = new Map<string, Set<() => void>>();
    window.matchMedia = vi.fn((query: string) => ({
      get matches() {
        return query.includes('color-scheme') ? light : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => {
        listeners.set(query, new Set([...(listeners.get(query) ?? []), listener]));
      },
      removeEventListener: (_event: string, listener: () => void) => listeners.get(query)?.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useAppearance(DEFAULT_APPEARANCE));
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('indigo');

    light = true;
    act(() => listeners.get('(prefers-color-scheme: light)')?.forEach((listener) => listener()));
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves only local uploaded data and allowlisted bundled backdrops', () => {
    expect(cssBackgroundImage('preset:emerald')).toMatch(/^url\("https?:\/\/.*backdrops\/emerald\.png"\)$/);
    expect(cssBackgroundImage('https://example.com/backdrop.png')).toBe('none');
    expect(cssBackgroundImage('data:image/png;base64,AA==')).toContain('data:image/png;base64,AA==');
  });

  it('removes the backdrop URL before paint when glass is off or falls back to solid', () => {
    const root = document.createElement('div');
    const { rerender } = renderHook(
      ({ glassLevel, performanceConstrained }: { glassLevel: GlassLevel; performanceConstrained: boolean }) =>
        useAppearance(
          {
            ...DEFAULT_APPEARANCE,
            mode: 'dark',
            glassLevel,
            backgroundImage: 'preset:graphite',
            backgroundOpacity: 0.5,
          },
          { root, performanceConstrained },
        ),
      { initialProps: { glassLevel: 'off' as GlassLevel, performanceConstrained: false } },
    );
    expect(root.dataset.background).toBe('none');
    expect(root.style.getPropertyValue('--imnota-background-image')).toBe('none');
    expect(root.style.getPropertyValue('--imnota-background-opacity')).toBe('0');

    rerender({ glassLevel: 'balanced', performanceConstrained: true });
    expect(root.dataset.background).toBe('none');
    expect(root.style.getPropertyValue('--imnota-background-image')).toBe('none');
  });

  it('derives light image glass without changing saved dark or native desktop choices', async () => {
    const root = document.createElement('div');
    const setDesktopGlass = vi.fn().mockResolvedValue({ ok: true, value: { active: false } });
    const previous = window.imnota;
    window.imnota = { ...previous, setDesktopGlass };
    const preferences = {
      ...DEFAULT_APPEARANCE,
      mode: 'light' as const,
      desktopGlass: true,
      backgroundImage: 'preset:graphite',
    };
    const { result, rerender, unmount } = renderHook(
      ({ mode, image }: { mode: 'light' | 'dark'; image: string }) =>
        useAppearance({ ...preferences, mode, backgroundImage: image }, { root }),
      { initialProps: { mode: 'light' as 'light' | 'dark', image: preferences.backgroundImage } },
    );
    await act(async () => undefined);
    expect(result.current.glassLevel).toBe('strong');
    expect(root.dataset.background).toBe('active');
    expect(root.dataset.desktopGlass).toBe('off');
    expect(setDesktopGlass).toHaveBeenLastCalledWith({ enabled: false });
    expect(preferences.glassLevel).toBe('off');
    rerender({ mode: 'dark', image: preferences.backgroundImage });
    expect(result.current.glassLevel).toBe('off');
    expect(root.dataset.background).toBe('none');
    rerender({ mode: 'light', image: 'data:image/png;base64,AA==' });
    expect(root.dataset.backgroundSource).toBe('upload');
    rerender({ mode: 'light', image: '' });
    expect(result.current.glassLevel).toBe('off');
    expect(root.dataset.background).toBe('none');
    await act(async () => undefined);
    unmount();
    window.imnota = previous;
  });

  it('selects the saved theme-specific backdrop as System changes', () => {
    let light = false;
    const listeners = new Set<() => void>();
    window.matchMedia = vi.fn((query: string) => ({
      get matches() {
        return query.includes('color-scheme') ? light : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    const root = document.createElement('div');
    renderHook(() =>
      useAppearance(
        {
          ...DEFAULT_APPEARANCE,
          glassLevel: 'balanced',
          useSameBackdropForBoth: false,
          darkBackgroundImage: 'preset:graphite',
          darkBackgroundOpacity: 0.35,
          lightBackgroundImage: 'preset:amber',
          lightBackgroundOpacity: 0.7,
        },
        { root },
      ),
    );
    expect(root.style.getPropertyValue('--imnota-background-image')).toContain('graphite.png');
    expect(root.style.getPropertyValue('--imnota-background-opacity')).toBe('0.35');
    expect(root.dataset.backgroundSource).toBe('preset');

    light = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(root.style.getPropertyValue('--imnota-background-image')).toContain('amber.png');
    expect(root.style.getPropertyValue('--imnota-background-opacity')).toBe('0.7');
  });

  it('injects darker light-mode accent hover, stronger soft, and onAccent', () => {
    const root = document.createElement('div');
    const { rerender } = renderHook(
      ({ mode, accent }: { mode: 'light' | 'dark'; accent: 'indigo' | 'graphite' }) =>
        useAppearance({ ...DEFAULT_APPEARANCE, mode, accent }, { root }),
      { initialProps: { mode: 'dark' as 'light' | 'dark', accent: 'indigo' as 'indigo' | 'graphite' } },
    );

    const darkIndigo = accentTokens('indigo', 'dark');
    expect(root.style.getPropertyValue('--imnota-accent')).toBe(darkIndigo.base);
    expect(root.style.getPropertyValue('--imnota-accent-hover')).toBe('#8b7cf6');
    expect(root.style.getPropertyValue('--imnota-accent-soft')).toBe(darkIndigo.soft);
    expect(root.style.getPropertyValue('--imnota-on-accent')).toBe('#ffffff');

    rerender({ mode: 'light', accent: 'indigo' });
    const lightIndigo = accentTokens('indigo', 'light');
    expect(root.style.getPropertyValue('--imnota-accent-hover')).toBe('#4e3ee6');
    expect(root.style.getPropertyValue('--imnota-accent-soft')).toBe('rgba(78, 62, 230, 0.2)');
    expect(root.style.getPropertyValue('--imnota-accent-soft')).toBe(lightIndigo.soft);
    expect(root.style.getPropertyValue('--imnota-on-accent')).toBe('#ffffff');

    rerender({ mode: 'light', accent: 'graphite' });
    const lightGraphite = accentTokens('graphite', 'light');
    expect(root.style.getPropertyValue('--imnota-accent')).toBe('#4b5565');
    expect(root.style.getPropertyValue('--imnota-accent-hover')).toBe(lightGraphite.hover);
    expect(root.style.getPropertyValue('--imnota-on-accent')).toBe('#ffffff');
  });
});
