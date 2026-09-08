import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge, WorkspaceSettings } from '../../shared/types';
import { useAppStore } from '../store';
import {
  normalizeSharingSenderName,
  useSharingSenderName,
  validateSharingSenderName,
} from './sharing-preferences';

const settings = (sharingSenderName?: string): WorkspaceSettings => ({
  workspacePath: null,
  theme: 'system',
  interfaceScale: 1,
  openRecentOnLaunch: true,
  confirmBeforeDeletion: true,
  updateChannel: 'stable',
  ...(sharingSenderName === undefined ? {} : { sharingSenderName }),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAppStore.setState({ settings: settings() });
});

describe('sharing sender-name preferences', () => {
  it('matches the service normalization and printable 80-code-point boundary', () => {
    expect(normalizeSharingSenderName('  Jose\u0301  ')).toBe('José');
    expect(validateSharingSenderName('🙂'.repeat(80))).toEqual({ ok: true, value: '🙂'.repeat(80) });
    expect(validateSharingSenderName('x'.repeat(81))).toMatchObject({ ok: false });
    expect(validateSharingSenderName('Dylan\u202e')).toMatchObject({ ok: false });
    expect(validateSharingSenderName('')).toEqual({ ok: true, value: '' });
  });

  it('normalizes and persists a name, then clears the optional persisted value', async () => {
    useAppStore.setState({ settings: settings('Previous') });
    const setSettings = vi.fn(async (patch: Partial<WorkspaceSettings>) => ({
      ...useAppStore.getState().settings,
      ...patch,
    }));
    window.imnota = { setSettings } as unknown as ImnotaBridge;
    const { result } = renderHook(() => useSharingSenderName());

    act(() => result.current.setSenderName('  Jose\u0301  '));
    await act(async () => expect(await result.current.saveSenderName()).toBe(true));
    expect(setSettings).toHaveBeenLastCalledWith({ sharingSenderName: 'José' });
    expect(result.current.senderName).toBe('José');
    expect(useAppStore.getState().settings.sharingSenderName).toBe('José');

    act(() => result.current.setSenderName('   '));
    await act(async () => expect(await result.current.saveSenderName()).toBe(true));
    expect(setSettings).toHaveBeenLastCalledWith({ sharingSenderName: undefined });
    expect(useAppStore.getState().settings.sharingSenderName).toBeUndefined();
  });

  it('deduplicates blur and submit saves and preserves the store on failure', async () => {
    useAppStore.setState({ settings: settings('Saved') });
    let finish!: (value: WorkspaceSettings) => void;
    const setSettings = vi
      .fn<(patch: Partial<WorkspaceSettings>) => Promise<WorkspaceSettings>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('disk full'));
    window.imnota = { setSettings } as unknown as ImnotaBridge;
    const { result } = renderHook(() => useSharingSenderName());

    act(() => result.current.setSenderName('Dylan'));
    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = result.current.saveSenderName();
      duplicate = result.current.saveSenderName();
    });
    expect(first).toBe(duplicate);
    await waitFor(() => expect(setSettings).toHaveBeenCalledOnce());
    finish(settings('Dylan'));
    await act(async () => expect(await first).toBe(true));

    act(() => result.current.setSenderName('Later'));
    await act(async () => expect(await result.current.saveSenderName()).toBe(false));
    expect(result.current.error).toContain('previous name is still active');
    expect(useAppStore.getState().settings.sharingSenderName).toBe('Dylan');
  });

  it('queues a return to the persisted value behind a different pending save', async () => {
    useAppStore.setState({ settings: settings('Alpha') });
    let finishFirst!: (value: WorkspaceSettings) => void;
    const setSettings = vi
      .fn<(patch: Partial<WorkspaceSettings>) => Promise<WorkspaceSettings>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementationOnce(async (patch) => settings(patch.sharingSenderName));
    window.imnota = { setSettings } as unknown as ImnotaBridge;
    const { result } = renderHook(() => useSharingSenderName());

    act(() => result.current.setSenderName('Beta'));
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.saveSenderName();
    });
    await waitFor(() => expect(setSettings).toHaveBeenCalledOnce());
    act(() => result.current.setSenderName('Alpha'));
    let second!: Promise<boolean>;
    act(() => {
      second = result.current.saveSenderName();
    });
    finishFirst(settings('Beta'));
    await act(async () => {
      expect(await first).toBe(true);
      expect(await second).toBe(true);
    });
    expect(setSettings.mock.calls).toEqual([
      [{ sharingSenderName: 'Beta' }],
      [{ sharingSenderName: 'Alpha' }],
    ]);
    expect(useAppStore.getState().settings.sharingSenderName).toBe('Alpha');
  });
});
