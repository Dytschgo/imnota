import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UpdateChannel, UpdateStatus } from '../../shared/types';
import { Button, Modal } from './ui';
import { useAppStore } from '../store';

export function UpdateControl() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [confirmNightly, setConfirmNightly] = useState(false);
  const statusRevision = useRef(0);
  const channel = status.channel ?? useAppStore.getState().settings.updateChannel;
  const locked = busy || ['checking', 'downloading', 'downloaded'].includes(status.state);
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = window.imnota.onUpdateStatus((next) => {
      statusRevision.current++;
      receivedEvent = true;
      if (active) setStatus(next);
    });
    void window.imnota
      .getUpdateStatus()
      .then((next) => {
        if (active && !receivedEvent) setStatus(next);
      })
      .catch(() => {
        if (active)
          setStatus({ state: 'error', message: 'Update status is unavailable. Try checking again.' });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch {
      setStatus({
        ...status,
        state: 'error',
        message: 'The update action failed. Check your connection and try again.',
      });
    } finally {
      setBusy(false);
    }
  }
  async function changeChannel(next: UpdateChannel) {
    setConfirmNightly(false);
    await run(async () => {
      const settings = await window.imnota.setSettings({ updateChannel: next });
      useAppStore.getState().set({ settings });
      const revision = statusRevision.current;
      const current = await window.imnota.getUpdateStatus();
      if (revision === statusRevision.current) setStatus(current);
    });
  }
  const message =
    status.message ??
    {
      idle: 'Check for a newer version of Imnota.',
      checking: 'Checking for updates…',
      'not-available': 'You’re on the latest version.',
      available: `Imnota ${status.version ?? ''} is available.`,
      downloading: `Downloading update… ${Math.round(status.percent ?? 0)}%`,
      downloaded: 'Update downloaded. Save your work before restarting.',
      error: 'Update failed. Try again.',
    }[status.state];
  return (
    <div className="settings-section update-settings">
      <h2>App updates {status.currentVersion && <small>· v{status.currentVersion}</small>}</h2>
      <label className="field">
        <span className="field-label">Update channel</span>
        <select
          value={channel}
          disabled={locked}
          onChange={(event) => {
            if (event.target.value === 'nightly') setConfirmNightly(true);
            else void changeChannel('stable');
          }}
        >
          <option value="stable">Stable (recommended)</option>
          <option value="nightly">Nightly (preview)</option>
        </select>
      </label>
      {channel === 'nightly' && (
        <p className="helper">
          Nightly builds may contain unfinished changes. Keep a backup of your workspace.
        </p>
      )}
      <p className="update-status" role="status" aria-live="polite">
        {message}
      </p>
      <Button
        busy={busy || status.state === 'checking'}
        disabled={locked}
        onClick={() => void run(() => window.imnota.checkForUpdates())}
      >
        <RefreshCw size={16} />
        Check for updates
      </Button>
      {status.state === 'available' && (
        <Button disabled={locked} onClick={() => void run(() => window.imnota.downloadUpdate())}>
          {status.manualDownload ? 'Open release download' : 'Download update'}
        </Button>
      )}
      {status.state === 'not-available' && status.manualDownload && (
        <Button disabled={locked} onClick={() => void run(() => window.imnota.downloadUpdate())}>
          Open selected channel download
        </Button>
      )}
      {status.state === 'downloaded' && (
        <Button disabled={busy} onClick={() => void run(() => window.imnota.installUpdate())}>
          Restart to install
        </Button>
      )}
      <details className="settings-disclosure update-disclosure">
        <summary>Update privacy and installation</summary>
        <p>Checking contacts GitHub for release information only. Your project files stay local.</p>
        {navigator.platform.toLowerCase().includes('mac') && (
          <p>
            This Mac build opens the download page. Replace the app with the new version; your workspace is
            kept separately.
          </p>
        )}
      </details>
      {confirmNightly && (
        <Modal
          title="Switch to Nightly?"
          description="Nightly builds may contain unfinished changes. Back up your workspace before switching. This checks for a build; it does not install it."
          onClose={() => setConfirmNightly(false)}
        >
          <div className="modal-form">
            <div className="modal-actions">
              <Button onClick={() => setConfirmNightly(false)}>Keep Stable</Button>
              <Button variant="primary" onClick={() => void changeChannel('nightly')}>
                Use Nightly
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
