import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UpdateControl } from './UpdateControl';
import type { ImnotaBridge, UpdateStatus } from '../../shared/types';
import { useAppStore } from '../store';
afterEach(cleanup);
function setup() {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, updateChannel: 'stable' } });
  let listener: (status: UpdateStatus) => void = () => {};
  const check = vi.fn(async () => {
    listener({ state: 'not-available', currentVersion: '0.2.0' });
  });
  const setSettings = vi.fn(async (patch) => {
    const settings = { ...useAppStore.getState().settings, ...patch };
    listener({ state: 'checking', currentVersion: '0.2.0', channel: settings.updateChannel });
    return settings;
  });
  window.imnota = {
    onUpdateStatus: (fn: typeof listener) => {
      listener = fn;
      return () => {};
    },
    getUpdateStatus: async () => ({ state: 'idle', currentVersion: '0.2.0' }),
    checkForUpdates: check,
    setSettings,
    downloadUpdate: vi.fn(async () => {}),
    installUpdate: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
  } as unknown as ImnotaBridge;
  return { check, setSettings, emit: (status: UpdateStatus) => listener(status) };
}
it('checks on demand and shows the up-to-date result', async () => {
  const api = setup();
  render(<UpdateControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await waitFor(() => expect(api.check).toHaveBeenCalledOnce());
  expect(await screen.findByText('You’re on the latest version.')).toBeInTheDocument();
});

it('requires confirmation before nightly and supports cancelling without changing settings', async () => {
  const api = setup();
  render(<UpdateControl />);
  await screen.findByText(/v0.2.0/);
  fireEvent.change(screen.getByRole('combobox', { name: 'Update channel' }), {
    target: { value: 'nightly' },
  });
  expect(screen.getByRole('dialog')).toHaveTextContent('Back up your workspace');
  expect(api.setSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep Stable' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveValue('stable');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nightly' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use Nightly' }));
  await waitFor(() => expect(api.setSettings).toHaveBeenCalledWith({ updateChannel: 'nightly' }));
  expect(window.imnota.downloadUpdate).not.toHaveBeenCalled();
});

it('disables channel changes while checking, downloading or awaiting installation', async () => {
  const api = setup();
  render(<UpdateControl />);
  for (const state of ['checking', 'downloading', 'downloaded'] as const) {
    await act(async () => api.emit({ state, channel: 'stable' }));
    expect(screen.getByRole('combobox')).toBeDisabled();
  }
});

it('shows a manual selected-channel download instead of silently downgrading', async () => {
  const api = setup();
  render(<UpdateControl />);
  await act(async () =>
    api.emit({
      state: 'not-available',
      channel: 'stable',
      manualDownload: true,
      message: 'Automatic downgrades are disabled.',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open selected channel download' }));
  await waitFor(() => expect(window.imnota.downloadUpdate).toHaveBeenCalledOnce());
});
it('shows actionable failure and allows retry', async () => {
  const api = setup();
  api.check.mockRejectedValueOnce(new Error('offline'));
  render(<UpdateControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByText(/The update action failed/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});

it('moves from available through download progress to a ready-to-install action', async () => {
  const api = setup();
  render(<UpdateControl />);
  await act(async () => api.emit({ state: 'available', version: '0.3.0' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
  await waitFor(() => expect(window.imnota.downloadUpdate).toHaveBeenCalledOnce());

  await act(async () => api.emit({ state: 'downloading', percent: 47 }));
  expect(screen.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute(
    'aria-valuenow',
    '47',
  );

  await act(async () => api.emit({ state: 'downloaded', version: '0.3.0' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restart to install' }));
  await waitFor(() => expect(window.imnota.installUpdate).toHaveBeenCalledOnce());
});

it('copies and runs the supplied Terminal command for an available upgrade', async () => {
  const api = setup();
  const command = 'curl -fsSL https://updates.example/imnota | sh';
  render(<UpdateControl />);
  await act(async () =>
    api.emit({ state: 'available', version: '0.3.0', terminalCommand: command, manualDownload: true }),
  );

  expect(screen.getByText(command)).toBeInTheDocument();
  expect(screen.getAllByText(/Terminal downloads and verifies the update/)).toHaveLength(2);
  expect(screen.queryByText(/This build opens the release download page/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
  await waitFor(() => expect(window.imnota.copyText).toHaveBeenCalledWith(command));
  fireEvent.click(screen.getByRole('button', { name: 'Run update in Terminal' }));
  await waitFor(() => expect(window.imnota.downloadUpdate).toHaveBeenCalledOnce());
});
