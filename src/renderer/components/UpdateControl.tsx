import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UpdateChannel, UpdateStatus } from '../../shared/types';
import { Button, Modal } from './ui';
import { useAppStore } from '../store';
import { saveWorkspaceSettingsPatch } from '../settings/sharing-preferences';
import { workflowMessage } from '../app/workflow';

export function UpdateControl({
  onInstall,
  onDownload,
}: {
  onInstall?: () => Promise<void>;
  onDownload?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [confirmNightly, setConfirmNightly] = useState(false);
  const [actionError, setActionError] = useState('');
  const [channelUnconfirmed, setChannelUnconfirmed] = useState(false);
  const statusRevision = useRef(0);
  const channel = status.channel ?? useAppStore.getState().settings.updateChannel;
  const locked = busy || ['checking', 'downloading', 'downloaded'].includes(status.state);
  useEffect(() => {
    let active = true;
    const revisionAtMount = statusRevision.current;
    const unsubscribe = window.imnota.onUpdateStatus((next) => {
      statusRevision.current++;
      if (active) {
        setStatus(next);
        setChannelUnconfirmed(false);
      }
    });
    void window.imnota
      .getUpdateStatus()
      .then((next) => {
        if (active && statusRevision.current === revisionAtMount) setStatus(next);
      })
      .catch(() => {
        if (active && statusRevision.current === revisionAtMount)
          setStatus({ state: 'error', message: 'Update status is unavailable. Try checking again.' });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function run(action: () => Promise<void>) {
    statusRevision.current++;
    setBusy(true);
    setActionError('');
    try {
      await action();
    } catch (error) {
      const message = workflowMessage(
        error,
        'The update action did not complete. Review the current status.',
      );
      setActionError(message);
      const revision = statusRevision.current;
      try {
        const current = await window.imnota.getUpdateStatus();
        if (revision === statusRevision.current) {
          setStatus(current);
          setChannelUnconfirmed(false);
        }
      } catch (readError) {
        if (revision === statusRevision.current) setChannelUnconfirmed(true);
        setActionError(
          `${message} Current update status could not be confirmed. ${workflowMessage(readError, 'Reopen Settings to check the current channel.')}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function changeChannel(next: UpdateChannel) {
    setConfirmNightly(false);
    await run(async () => {
      const settings = await saveWorkspaceSettingsPatch({ updateChannel: next });
      useAppStore.getState().set({ settings });
      const revision = statusRevision.current;
      const current = await window.imnota.getUpdateStatus();
      if (revision === statusRevision.current) {
        setStatus(current);
        setChannelUnconfirmed(false);
      }
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
          data-testid="update-channel"
          value={channelUnconfirmed ? '' : channel}
          disabled={locked}
          onChange={(event) => {
            if (event.target.value === 'nightly') setConfirmNightly(true);
            else void changeChannel('stable');
          }}
        >
          {channelUnconfirmed && (
            <option value="" disabled>
              Channel unconfirmed
            </option>
          )}
          <option value="stable">Stable (recommended)</option>
          <option value="nightly">Nightly (preview)</option>
        </select>
      </label>
      {!channelUnconfirmed && channel === 'nightly' && (
        <p className="helper">
          Nightly builds may contain unfinished changes. Keep a backup of your workspace.
        </p>
      )}
      <p className="update-status" role="status" aria-live="polite">
        {message}
      </p>
      {actionError && <p role="alert">{actionError}</p>}
      <Button
        busy={busy || status.state === 'checking'}
        disabled={locked}
        onClick={() => void run(() => window.imnota.checkForUpdates())}
      >
        <RefreshCw size={16} />
        {status.state === 'error' ? 'Retry' : 'Check for updates'}
      </Button>
      {status.state === 'available' && (
        <Button
          disabled={locked}
          onClick={() => void run(onDownload ?? (() => window.imnota.downloadUpdate()))}
        >
          {status.terminalCommand
            ? 'Run update in Terminal'
            : status.manualDownload
              ? 'Open selected channel download'
              : 'Download update'}
        </Button>
      )}
      {status.state === 'available' && status.terminalCommand && (
        <div className="terminal-update-command">
          <p>
            Terminal downloads and verifies the update, then closes, replaces and reopens Imnota. A backup is
            retained.
          </p>
          <div>
            <code>{status.terminalCommand}</code>
            <Button
              variant="soft"
              onClick={() => void run(() => window.imnota.copyText(status.terminalCommand!))}
            >
              Copy command
            </Button>
          </div>
        </div>
      )}
      {status.state === 'downloading' && (
        <div
          className="update-progress"
          role="progressbar"
          aria-label="Update download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(status.percent ?? 0)}
        >
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(100, status.percent ?? 0)) / 100})` }} />
        </div>
      )}
      {status.state === 'not-available' && status.manualDownload && (
        <Button
          disabled={locked}
          onClick={() => void run(onDownload ?? (() => window.imnota.downloadUpdate()))}
        >
          Open selected channel download
        </Button>
      )}
      {status.state === 'downloaded' && (
        <Button
          disabled={busy || status.installing}
          onClick={() => void run(onInstall ?? (() => window.imnota.installUpdate()))}
        >
          {status.installing ? 'Preparing restart…' : 'Restart to install'}
        </Button>
      )}
      <details className="settings-disclosure update-disclosure">
        <summary>Update privacy and installation</summary>
        <p>Checking contacts GitHub for release information only. Your project files stay local.</p>
        <p>
          {status.terminalCommand
            ? 'Terminal downloads and verifies the update, then closes, replaces and reopens Imnota. A backup is retained.'
            : status.manualDownload
              ? 'This build opens the release download page. Replace the app after downloading; your workspace is kept separately.'
              : 'Updates download only when you choose them. Imnota restarts only when you choose to install.'}
        </p>
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
