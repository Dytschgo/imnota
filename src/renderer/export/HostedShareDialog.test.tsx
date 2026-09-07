import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge } from '../../shared/types';
import type { HostedShareRecord } from '../../shared/workflow-bridge';
import { HostedShareDialog } from './HostedShareDialog';

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
  url: 'https://app.imnota.xyz/s/expiredabcdefghijklmnop',
  title: 'Expired prompt',
  expiresAt: '2020-01-31T00:00:00.000Z',
};
const revoked: HostedShareRecord = {
  ...active,
  id: 'revoked-share',
  url: 'https://app.imnota.xyz/s/revokedabcdefghijklmnop',
  title: 'Revoked prompt',
  revokedAt: '2026-01-02T00:00:00.000Z',
};

const artifacts = {
  title: 'Final prompt',
  sessionId: 'final-session',
  bundleNumbers: [1, 2],
  imageCount: 1,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function bridge(overrides: Partial<ImnotaBridge> = {}) {
  const value = {
    listHostedShares: vi.fn(async () => ({
      ok: true as const,
      value: { records: [], recoveryErrors: [] },
    })),
    createHostedShare: vi.fn(async () => ({ ok: true as const, value: active })),
    cancelHostedShare: vi.fn(async () => ({ ok: true as const, value: undefined })),
    revokeHostedShare: vi.fn(async () => ({
      ok: true as const,
      value: { ...active, revokedAt: '2026-01-02T00:00:00.000Z' },
    })),
    openHostedSharePairing: vi.fn(async () => ({ ok: true as const, value: undefined })),
    copyText: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ImnotaBridge;
  window.imnota = value;
  return value;
}

function approveAndPublish() {
  fireEvent.change(screen.getByLabelText('2. One-use pairing code'), {
    target: { value: 'a'.repeat(43) },
  });
  fireEvent.click(screen.getByLabelText(/I understand that anyone with the link can read these files/i));
  fireEvent.click(screen.getByRole('button', { name: 'Publish HTTPS link' }));
}

describe('HostedShareDialog', () => {
  it('requires explicit approval and never uploads artifacts on mount or pairing-code entry', async () => {
    const native = bridge();
    render(<HostedShareDialog artifacts={artifacts} onClose={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(native.listHostedShares).toHaveBeenCalledOnce());

    const publish = screen.getByRole('button', { name: 'Publish HTTPS link' });
    expect(screen.getByText(/hosting provider may record visits and share URLs/i)).toBeInTheDocument();
    expect(publish).toBeDisabled();
    fireEvent.change(screen.getByLabelText('2. One-use pairing code'), {
      target: { value: 'a'.repeat(43) },
    });
    expect(native.createHostedShare).not.toHaveBeenCalled();
    expect(publish).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand that anyone with the link can read these files/i));
    expect(publish).toBeEnabled();
    expect(native.createHostedShare).not.toHaveBeenCalled();
  });

  it('cancels the exact in-flight request while keeping the dialog open', async () => {
    let finish!: (value: Awaited<ReturnType<ImnotaBridge['createHostedShare']>>) => void;
    const pending = new Promise<Awaited<ReturnType<ImnotaBridge['createHostedShare']>>>(
      (resolve) => (finish = resolve),
    );
    const createHostedShare = vi.fn<ImnotaBridge['createHostedShare']>(() => pending);
    const native = bridge({ createHostedShare });
    const onClose = vi.fn();
    render(<HostedShareDialog artifacts={artifacts} onClose={onClose} onError={vi.fn()} />);
    approveAndPublish();
    const cancel = await screen.findByRole('button', { name: /Cancel upload/i });
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(cancel);

    const requestId = createHostedShare.mock.calls[0]![0].requestId;
    await waitFor(() => expect(native.cancelHostedShare).toHaveBeenCalledWith({ requestId }));
    expect(screen.getByRole('dialog', { name: 'Publish a hosted prompt' })).toBeInTheDocument();
    finish({
      ok: false,
      error: { code: 'session-cancelled', message: 'Hosted share upload cancelled.', retryable: true },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Hosted share upload cancelled.');
  });

  it('shows every history row, expiry state, and recovery warnings without hiding intact links', async () => {
    bridge({
      listHostedShares: vi.fn(async () => ({
        ok: true as const,
        value: {
          records: [active, expired, revoked],
          recoveryErrors: ['A previous receipt timed out.'],
        },
      })),
    });
    render(<HostedShareDialog artifacts={artifacts} onClose={vi.fn()} onError={vi.fn()} />);

    const history = await screen.findByText('Local share history (3)');
    const details = history.closest('details');
    expect(details).not.toBeNull();
    expect(within(details!).getByText(/Active prompt · expires/)).toBeInTheDocument();
    expect(within(details!).getByText('Expired prompt · expired')).toBeInTheDocument();
    expect(within(details!).getByText('Revoked prompt · revoked')).toBeInTheDocument();
    expect(within(details!).getByRole('button', { name: 'Expired' })).toBeDisabled();
    expect(within(details!).getByRole('button', { name: 'Revoked' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('A previous receipt timed out.');
  });

  it('requires revoke confirmation, supports cancel, and surfaces revoke failure after upload success', async () => {
    const revokeHostedShare = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'network-failure' as const, message: 'Revocation service is offline.', retryable: true },
    }));
    const native = bridge({ revokeHostedShare });
    render(<HostedShareDialog artifacts={artifacts} onClose={vi.fn()} onError={vi.fn()} />);
    approveAndPublish();
    await screen.findByRole('heading', { name: 'Hosted prompt is ready' });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    const confirmation = screen.getByRole('dialog', { name: 'Revoke this hosted link?' });
    expect(revokeHostedShare).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep link' }));
    expect(screen.queryByRole('dialog', { name: 'Revoke this hosted link?' })).not.toBeInTheDocument();
    expect(revokeHostedShare).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Revoke this hosted link?' })).getByRole('button', {
        name: 'Revoke link',
      }),
    );
    await waitFor(() => expect(native.revokeHostedShare).toHaveBeenCalledWith({ id: active.id }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revocation service is offline.');
    expect(screen.getByRole('heading', { name: 'Hosted prompt is ready' })).toBeInTheDocument();
  });

  it('keeps history visible and reports an error when revoking a historical link fails', async () => {
    const revokeHostedShare = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'network-failure' as const,
        message: 'Historical link could not be revoked.',
        retryable: true,
      },
    }));
    bridge({
      listHostedShares: vi.fn(async () => ({
        ok: true as const,
        value: { records: [active], recoveryErrors: [] },
      })),
      revokeHostedShare,
    });
    render(<HostedShareDialog artifacts={artifacts} onClose={vi.fn()} onError={vi.fn()} />);

    const historySummary = await screen.findByText('Local share history (1)');
    const history = historySummary.closest('details')!;
    fireEvent.click(within(history).getByRole('button', { name: 'Revoke' }));
    const confirmation = screen.getByRole('dialog', { name: 'Revoke this hosted link?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Revoke link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Historical link could not be revoked.');
    expect(screen.getByText('Local share history (1)')).toBeInTheDocument();
    expect(within(history).getByText(/Active prompt · expires/)).toBeInTheDocument();
  });

  it.each([
    [expired, 'Hosted prompt has expired', /can no longer be opened/],
    [revoked, 'Hosted prompt was revoked', /can no longer be opened/],
  ])('does not describe an unavailable successful share as ready: %s', async (record, heading, message) => {
    bridge({ createHostedShare: vi.fn(async () => ({ ok: true as const, value: record })) });
    render(<HostedShareDialog artifacts={artifacts} onClose={vi.fn()} onError={vi.fn()} />);
    approveAndPublish();

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open link' })).not.toBeInTheDocument();
  });
});
