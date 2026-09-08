import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The private static service client is exercised through its browser module.
import { mountOwnerConsole } from '../../share-service/public/owner.js';
// @ts-expect-error The private static page has no TypeScript declaration.
import { ownerPage } from '../../share-service/src/owner-page.js';

const shareId = '123e4567-e89b-42d3-a456-426614174000';
const unsafeTitle = '<img src=x onerror=alert(1)> Release handoff';
const checkedAt = '2026-09-08T12:00:00.000Z';

function response(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function overview() {
  return {
    checkedAt,
    service: { database: 'available' },
    shares: { total: 1, active: 1, expiring: 0, expired: 0, revoked: 0, cleanupEligible: 0 },
    pairing: { total: 0, waiting: 0, consumed: 0, expired: 0, cleanupEligible: 0 },
    storage: {
      recordedBytes: 8,
      metadataBytes: 2,
      reservedBytes: 4,
      filesystemBytes: 8,
      capacityBytes: 10,
    },
    retention: { cleanupGraceMs: 60_000, cleanupIntervalMs: 60_000 },
  };
}

function share() {
  return {
    id: shareId,
    title: unsafeTitle,
    reference: 'share-174000',
    createdAt: checkedAt,
    expiresAt: '2026-09-09T12:00:00.000Z',
    revokedAt: null,
    byteSize: 8,
    metadataBytes: 2,
    storedBytes: 10,
    hasArchive: false,
    artifactCount: 1,
    expiresSoon: false,
    status: 'active',
    usage: { pageViews: 0, markdownRequests: 0, pngRequests: 0, zipRequests: 0, lastAccessedAt: null },
  };
}

function mount(fetchMock: ReturnType<typeof vi.fn>) {
  const body = /<body>([\s\S]*)<\/body>/.exec(ownerPage())?.[1];
  if (!body) throw new Error('Owner page markup has no body.');
  document.body.innerHTML = body;
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  vi.stubGlobal('fetch', fetchMock);
  return mountOwnerConsole();
}

function standardFetch(deleteStatus = 204) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/owner/session' && init?.method === 'DELETE')
      return deleteStatus === 204
        ? ({ status: 204 } as Response)
        : response({ error: { message: 'Network problem' } }, deleteStatus);
    if (path === '/api/owner/session') return response({ authenticated: true, csrfToken: 'csrf' });
    if (path === '/api/owner/overview') return response(overview());
    if (path.startsWith('/api/owner/shares')) return response({ shares: [share()], nextCursor: null });
    if (path === '/api/owner/pairings') return response({ pairings: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('owner console browser behavior', () => {
  it('renders a title as text, keeps the full UUID in the drawer, and clears private UI on session reset', async () => {
    const controller = mount(standardFetch());
    expect(controller).toBeDefined();
    await screen.findByText(unsafeTitle);
    expect(document.querySelector('.share-title')?.textContent).toBe(unsafeTitle);
    expect(document.querySelector('.share-title img')).toBeNull();

    const shareButton = document.querySelector<HTMLButtonElement>('.table-link');
    expect(shareButton).toHaveAccessibleName(`${unsafeTitle}, share-174000`);
    fireEvent.click(shareButton!);
    expect(document.querySelector<HTMLDialogElement>('[data-detail-dialog]')?.open).toBe(true);
    expect(screen.getByText(shareId)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke share' }));
    expect(document.querySelector<HTMLDialogElement>('[data-revoke-dialog]')?.open).toBe(true);
    expect(
      screen.getByText(
        `You are revoking ${unsafeTitle} (share-174000). This immediately disables the shared link.`,
      ),
    ).toBeInTheDocument();

    controller?.showLogin();
    expect(document.querySelector('[data-dashboard]')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector<HTMLDialogElement>('[data-detail-dialog]')?.open).toBe(false);
    expect(document.querySelector<HTMLDialogElement>('[data-revoke-dialog]')?.open).toBe(false);
    expect(document.querySelector('[data-share-list]')?.textContent).toBe('');
    expect(document.querySelector('[data-share-detail]')?.textContent).toBe('');
  });

  it('retains the session and offers retry feedback when sign out fails', async () => {
    mount(standardFetch(500));
    await screen.findByText(unsafeTitle);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Sign out was not completed. Try again.'),
    );
    expect(document.querySelector('[data-dashboard]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-login]')?.hasAttribute('hidden')).toBe(true);
  });

  it('ignores a stale session response and renders the native accounted-quota progress state', async () => {
    let resolveSession: (value: Response) => void = () => undefined;
    const pendingSession = new Promise<Response>((resolve) => {
      resolveSession = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/owner/session') return pendingSession;
      return Promise.resolve(response({}));
    });
    const controller = mount(fetchMock);
    controller?.showLogin();
    resolveSession(response({ authenticated: true, csrfToken: 'csrf' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('[data-dashboard]')?.hasAttribute('hidden')).toBe(true);

    mount(standardFetch());
    await screen.findByText(unsafeTitle);
    const progress = document.querySelector<HTMLProgressElement>('progress.storage-meter');
    expect(progress).not.toBeNull();
    expect(progress?.max).toBe(10);
    expect(progress?.value).toBe(10);
    expect(
      screen.getByText('Over configured limit by 4 B. New uploads may be rejected.'),
    ).toBeInTheDocument();
  });
});
