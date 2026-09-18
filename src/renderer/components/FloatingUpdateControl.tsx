import { Check, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '../../shared/types';
import { IconButton } from './ui';

export interface FloatingUpdateControlProps {
  status: UpdateStatus | null;
  onCheck(): void | Promise<void>;
  onDownload(): void | Promise<void>;
  onInstall(): void | Promise<void>;
  onRetry(): void | Promise<void>;
  /** `nav` sits beside About in the workspace navigation; `floating` is the lower-left fallback while navigation is hidden. */
  placement?: 'nav' | 'floating';
}

export function FloatingUpdateControl({
  status,
  onCheck,
  onDownload,
  onInstall,
  onRetry,
  placement = 'floating',
}: FloatingUpdateControlProps) {
  const current = status ?? { state: 'idle' as const };
  const downloading = current.state === 'downloading';
  const checking = current.state === 'checking';
  const downloaded = current.state === 'downloaded';
  const failed = current.state === 'error';
  const available = current.state === 'available';
  const manualDownload = current.manualDownload === true;
  const percent = Math.round(current.percent ?? 0);
  const channelLabel = current.sourceChannel ?? current.channel;
  const label = failed
    ? 'Retry update check'
    : downloaded
      ? 'Restart to update'
      : checking
        ? 'Checking for updates'
        : downloading
          ? `Downloading update, ${percent}% complete`
          : current.terminalCommand
            ? 'Run update in Terminal'
            : manualDownload
              ? 'Open download'
              : available
                ? 'Download update'
                : 'Check for updates';

  return (
    <div
      className={`floating-update floating-update-${placement} floating-update-${current.state}`}
      data-testid="update-indicator"
    >
      <div className="floating-update-popover" role="status">
        <strong>
          {current.version ? `Update ${current.version}` : 'Imnota updates'}
          {channelLabel ? ` · ${channelLabel}` : ''}
        </strong>
        <p>
          {failed
            ? (current.message ?? 'The update check failed.')
            : downloaded
              ? 'Downloaded. Restart Imnota to install it.'
              : downloading
                ? `Downloading… ${percent}%`
                : checking
                  ? 'Checking for updates…'
                  : (current.message ??
                    (available || manualDownload
                      ? `A newer ${channelLabel ?? ''} version is available. Nothing downloads until you choose to.`
                      : 'Check for a newer version of Imnota.'))}
        </p>
        {current.releaseNotes?.trim() && (
          <div className="floating-update-notes">
            <strong>What’s changed</strong>
            <pre>{current.releaseNotes.trim()}</pre>
          </div>
        )}
        {current.releaseUrl && (
          <a href={current.releaseUrl} target="_blank" rel="noreferrer">
            View release details <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </div>
      <IconButton
        className="floating-update-button"
        label={label}
        disabled={checking || downloading || current.installing === true}
        onClick={() =>
          void (failed
            ? onRetry()
            : downloaded
              ? onInstall()
              : available || manualDownload
                ? onDownload()
                : onCheck())
        }
      >
        {failed ? (
          <RefreshCw size={18} aria-hidden="true" />
        ) : downloaded ? (
          <Check size={18} aria-hidden="true" />
        ) : downloading ? (
          <span className="floating-update-progress" aria-hidden="true">
            {percent}%
          </span>
        ) : checking ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : available || manualDownload ? (
          <Download size={18} aria-hidden="true" />
        ) : (
          <RefreshCw size={18} aria-hidden="true" />
        )}
      </IconButton>
      {downloading && <span className="floating-update-percent">{percent}%</span>}
    </div>
  );
}
