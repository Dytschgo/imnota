import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppearance } from '../app/useAppearance';
import { DEFAULT_APPEARANCE } from './preferences';

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
});
