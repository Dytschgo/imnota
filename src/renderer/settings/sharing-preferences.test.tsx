import { COMMITTED_WRITE_WARNING } from '../../shared/write-outcome';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharingSenderNameSchema } from '../../shared/schema';
import type { ImnotaBridge, WorkspaceSettings } from '../../shared/types';
import { useAppStore } from '../store';
import {
  normalizeSharingSenderName,
  useSharingSenderName,
  validateSharingSenderName,
} from './sharing-preferences';

const settings = (sharingSenderName?: string): WorkspaceSettings => ({
  workspacePath: null,
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

  it('accepts and rejects exactly what the settings schema does, with the same messages', () => {
    const tooLong = 'Keep the sender name to 80 characters or fewer.';
    const unprintable = 'Use a plain sender name without control or formatting characters.';
    const cases: Array<[string, string | null]> = [
      ['', null],
      ['   ', null],
      ['  Ada Lovelace  ', null],
      ['José', null],
      ['🙂'.repeat(80), null],
      [`  ${'x'.repeat(80)}  `, null],
      ['é'.repeat(80), null],
      ['x'.repeat(81), tooLong],
      ['🙂'.repeat(81), tooLong],
      [`${'x'.repeat(81)}‮`, tooLong],
      ['Dylan‮', unprintable],
      ['Ada⁦', unprintable],
      ['Ada‍Lovelace', unprintable],
      ['Ada\tLovelace', unprintable],
      ['Ada\u0000', unprintable],
      ['Ada﻿ Lovelace', unprintable],
      ['Ada', unprintable],
    ];
    for (const [input, error] of cases) {
      const parsed = sharingSenderNameSchema.safeParse(input);
      expect(parsed.success, JSON.stringify(input)).toBe(error === null);
      expect(validateSharingSenderName(input), JSON.stringify(input)).toEqual(
        parsed.success ? { ok: true, value: parsed.data } : { ok: false, error },
      );
    }
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

it('reads back committed settings and shows the durability warning without retrying the save', async () => {
  useAppStore.setState({ settings: settings('Before') });
  const setSettings = vi.fn().mockRejectedValue(new Error(COMMITTED_WRITE_WARNING));
  const getSettings = vi.fn().mockResolvedValue(settings('After'));
  window.imnota = { setSettings, getSettings } as unknown as ImnotaBridge;
  const { result } = renderHook(() => useSharingSenderName());
  act(() => result.current.setSenderName('After'));
  await act(async () => expect(await result.current.saveSenderName()).toBe(false));
  expect(useAppStore.getState().settings.sharingSenderName).toBe('After');
  expect(result.current.error).toBe(COMMITTED_WRITE_WARNING);
  expect(result.current.error).not.toContain('previous name');
  expect(setSettings).toHaveBeenCalledOnce();
  expect(getSettings).toHaveBeenCalledOnce();
});
