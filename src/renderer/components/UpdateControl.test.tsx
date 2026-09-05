import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UpdateControl } from './UpdateControl';
import type { ImnotaBridge, UpdateStatus } from '../../shared/types';
afterEach(cleanup);
function setup() {
  let listener: (status: UpdateStatus) => void = () => {};
  const check = vi.fn(async () => {
    listener({ state: 'not-available', currentVersion: '0.2.0' });
  });
  window.imnota = {
    onUpdateStatus: (fn: typeof listener) => {
      listener = fn;
      return () => {};
    },
    getUpdateStatus: async () => ({ state: 'idle', currentVersion: '0.2.0' }),
    checkForUpdates: check,
    downloadUpdate: vi.fn(async () => {}),
    installUpdate: vi.fn(async () => {}),
  } as unknown as ImnotaBridge;
  return { check, emit: (status: UpdateStatus) => listener(status) };
}
it('checks on demand and shows the up-to-date result', async () => {
  const api = setup();
  render(<UpdateControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await waitFor(() => expect(api.check).toHaveBeenCalledOnce());
  expect(await screen.findByText('You’re on the latest version.')).toBeInTheDocument();
});
it('shows actionable failure and allows retry', async () => {
  const api = setup();
  api.check.mockRejectedValueOnce(new Error('offline'));
  render(<UpdateControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByText(/The update action failed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});
