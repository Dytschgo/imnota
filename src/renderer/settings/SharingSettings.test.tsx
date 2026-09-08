import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge } from '../../shared/types';
import type { HostedShareRecord } from '../../shared/workflow-bridge';
import { useAppStore } from '../store';
import { SettingsView } from './SettingsView';
import { SharingSettings } from './SharingSettings';

const active: HostedShareRecord = {
  id: 'active-share',
  url: 'https://app.imnota.xyz/s/activeabcdefghijklmnopq',
  title: 'Active prompt',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2099-01-31T00:00:00.000Z',
  byteSize: 128,
};
const expired: HostedShareRecord = {
  ...active,
  id: 'expired-share',
  title: 'Expired prompt',
  expiresAt: '2020-01-31T00:00:00.000Z',
};
const revoked: HostedShareRecord = {
  ...active,
  id: 'revoked-share',
  title: 'Revoked prompt',
  revokedAt: '2026-01-02T00:00:00.000Z',
};

function bridge(overrides: Partial<ImnotaBridge> = {}) {
  const value = {
    listHostedShares: vi.fn(async () => ({
      ok: true as const,
      value: { records: [], recoveryErrors: [], recoveryWarnings: [] },
    })),
    dismissHostedShareRecoveryWarning: vi.fn(async () => ({ ok: true as const, value: undefined })),
    revokeHostedShare: vi.fn(async ({ id }: { id: string }) => ({
      ok: true as const,
      value: { ...active, id, revokedAt: '2026-01-02T00:00:00.000Z' },
    })),
    copyText: vi.fn(async () => undefined),
    setSettings: vi.fn(async (patch) => ({ ...useAppStore.getState().settings, ...patch })),
    onUpdateStatus: vi.fn(() => () => undefined),
    getUpdateStatus: vi.fn(async () => ({ state: 'idle' as const })),
    ...overrides,
  } as unknown as ImnotaBridge;
  window.imnota = value;
  return value;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAppStore.setState({
    settings: {
      workspacePath: null,
      theme: 'system',
      interfaceScale: 1,
      openRecentOnLaunch: true,
      confirmBeforeDeletion: true,
      updateChannel: 'stable',
      sharingSenderName: '',
    },
  });
});

describe('SharingSettings', () => {
  it('mounts and fetches history only when the Sharing category is active', async () => {
    const native = bridge();
    render(<SettingsView />);
    expect(native.listHostedShares).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Workspace & privacy' }));
    expect(native.listHostedShares).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sharing' }));
    expect(await screen.findByTestId('sharing-settings')).toBeInTheDocument();
    await waitFor(() => expect(native.listHostedShares).toHaveBeenCalledOnce());
    expect(screen.getByText('No links saved on this device')).toBeInTheDocument();
  });

  it('persists the normalized sender name on blur and reports save failure without changing the store', async () => {
    useAppStore.setState((state) => ({ settings: { ...state.settings, sharingSenderName: 'Previous' } }));
    const setSettings = vi
      .fn<ImnotaBridge['setSettings']>()
      .mockResolvedValueOnce({ ...useAppStore.getState().settings, sharingSenderName: 'Dylan' })
      .mockRejectedValueOnce(new Error('disk full'));
    bridge({ setSettings });
    render(<SharingSettings />);
    const input = screen.getByTestId('sharing-sender-name');
    expect(input).toHaveValue('Previous');
    fireEvent.change(input, { target: { value: '  Dylan  ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ sharingSenderName: 'Dylan' }));
    expect(input).toHaveValue('Dylan');

    fireEvent.change(input, { target: { value: 'Later' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent('previous name is still active');
    expect(useAppStore.getState().settings.sharingSenderName).toBe('Dylan');
    expect(input).toHaveValue('Later');
  });

  it('shows load failure, retries to an empty state, and surfaces copy failure', async () => {
    const listHostedShares = vi
      .fn<ImnotaBridge['listHostedShares']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'network-failure', message: 'History is unavailable.', retryable: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { records: [], recoveryErrors: [], recoveryWarnings: [] },
      });
    const native = bridge({ listHostedShares });
    render(<SharingSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('History is unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No links saved on this device')).toBeInTheDocument();
    expect(native.listHostedShares).toHaveBeenCalledTimes(2);

    cleanup();
    bridge({
      listHostedShares: vi.fn(async () => ({
        ok: true as const,
        value: { records: [active], recoveryErrors: [], recoveryWarnings: [] },
      })),
      copyText: vi.fn(async () => {
        throw new Error('clipboard');
      }),
    });
    render(<SharingSettings />);
    await screen.findByText('Active prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('link could not be copied');
  });

  it('keeps unavailable rows inactive and requires confirmation before revoking an active link', async () => {
    const revokeHostedShare = vi
      .fn<ImnotaBridge['revokeHostedShare']>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'network-failure', message: 'Revocation is offline.', retryable: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...active, revokedAt: '2026-01-02T00:00:00.000Z' },
      });
    const native = bridge({
      listHostedShares: vi.fn(async () => ({
        ok: true as const,
        value: { records: [active, expired, revoked], recoveryErrors: [], recoveryWarnings: [] },
      })),
      revokeHostedShare,
    });
    render(<SharingSettings />);
    await screen.findByText('Active prompt');
    const expiredRow = screen.getByText('Expired prompt').closest('article')!;
    const revokedRow = screen.getByText('Revoked prompt').closest('article')!;
    expect(within(expiredRow).queryByRole('button')).not.toBeInTheDocument();
    expect(within(expiredRow).queryByRole('link')).not.toBeInTheDocument();
    expect(within(revokedRow).queryByRole('button')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const confirmation = screen.getByRole('dialog', { name: 'Revoke this hosted link?' });
    expect(revokeHostedShare).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Revoke link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revocation is offline.');
    expect(native.revokeHostedShare).toHaveBeenCalledTimes(1);

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(native.revokeHostedShare).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Revoke this hosted link?' })).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText('revoked')).toHaveLength(2);
  });

  it('persists warning dismissal and ignores a late refresh that would restore it', async () => {
    const warning = { id: `recovery:${'a'.repeat(64)}`, message: 'Earlier upload needs attention.' };
    let finishRefresh!: (value: Awaited<ReturnType<ImnotaBridge['listHostedShares']>>) => void;
    const listHostedShares = vi
      .fn<ImnotaBridge['listHostedShares']>()
      .mockResolvedValueOnce({
        ok: true,
        value: { records: [active], recoveryErrors: [warning.message], recoveryWarnings: [warning] },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
      );
    const dismiss = vi.fn(async () => ({ ok: true as const, value: undefined }));
    bridge({ listHostedShares, dismissHostedShareRecoveryWarning: dismiss });
    render(<SharingSettings />);
    await screen.findByText(warning.message);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith({ id: warning.id }));
    await waitFor(() => expect(screen.queryByText(warning.message)).not.toBeInTheDocument());
    finishRefresh({
      ok: true,
      value: { records: [active], recoveryErrors: [warning.message], recoveryWarnings: [warning] },
    });
    await Promise.resolve();
    expect(screen.queryByText(warning.message)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('clears loading after revoke invalidates a pending refresh', async () => {
    let finishRefresh!: (value: Awaited<ReturnType<ImnotaBridge['listHostedShares']>>) => void;
    const listHostedShares = vi
      .fn<ImnotaBridge['listHostedShares']>()
      .mockResolvedValueOnce({
        ok: true,
        value: { records: [active], recoveryErrors: [], recoveryWarnings: [] },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
      );
    bridge({ listHostedShares });
    render(<SharingSettings />);
    await screen.findByText('Active prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Revoke this hosted link?' })).getByRole('button', {
        name: 'Revoke link',
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    finishRefresh({
      ok: true,
      value: { records: [active], recoveryErrors: [], recoveryWarnings: [] },
    });
    await Promise.resolve();
    expect(screen.getByText('revoked')).toBeInTheDocument();
  });
});
