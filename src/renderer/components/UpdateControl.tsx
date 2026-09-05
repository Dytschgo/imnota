import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '../../shared/types';
import { Button } from './ui';

export function UpdateControl() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = window.imnota.onUpdateStatus((next) => {
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
        state: 'error',
        message: 'The update action failed. Check your connection and try again.',
      });
    } finally {
      setBusy(false);
    }
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
    <div className="settings-section">
      <h2>App updates {status.currentVersion && <small>· v{status.currentVersion}</small>}</h2>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <Button
        busy={busy || status.state === 'checking'}
        disabled={status.state === 'downloading' || status.state === 'downloaded'}
        onClick={() => void run(() => window.imnota.checkForUpdates())}
      >
        <RefreshCw size={16} />
        Check for updates
      </Button>
      {status.state === 'available' && (
        <Button onClick={() => void run(() => window.imnota.downloadUpdate())}>Download update</Button>
      )}
      {status.state === 'downloaded' && (
        <Button onClick={() => void run(() => window.imnota.installUpdate())}>Restart to install</Button>
      )}
      <p>Checking contacts GitHub for release information only. Your project files stay local.</p>
      {navigator.platform.toLowerCase().includes('mac') && (
        <p>
          This Mac build opens the download page. Replace the app with the new version; your workspace is kept
          separately.
        </p>
      )}
    </div>
  );
}
