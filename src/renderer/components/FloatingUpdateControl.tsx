import { AlertTriangle, Check, Download, ExternalLink } from 'lucide-react';
import type { UpdateStatus } from '../../shared/types';
import { IconButton } from './ui';

export interface FloatingUpdateControlProps {
  status: UpdateStatus | null;
  onDownload(): void | Promise<void>;
  onInstall(): void | Promise<void>;
  onRetry(): void | Promise<void>;
  /** `nav` sits beside About in the workspace navigation; `floating` is the lower-left fallback while navigation is hidden. */
  placement?: 'nav' | 'floating';
}

export function FloatingUpdateControl({
  status,
  onDownload,
  onInstall,
  onRetry,
  placement = 'floating',
}: FloatingUpdateControlProps) {
  if (
    !status ||
    ['idle', 'checking'].includes(status.state) ||
    (status.state === 'not-available' && !status.manualDownload)
  )
    return null;

  const downloading = status.state === 'downloading';
  const downloaded = status.state === 'downloaded';
  const failed = status.state === 'error';
  const available = status.state === 'available';
  const percent = Math.round(status.percent ?? 0);
  const channelLabel = status.sourceChannel ?? status.channel;
  const label = failed
    ? 'Retry update check'
    : downloaded
      ? 'Restart to update'
      : downloading
        ? `Downloading update, ${percent}% complete`
        : status.terminalCommand
          ? 'Run update in Terminal'
          : status.manualDownload
            ? 'Open download'
            : 'Download update';

  return (
    <div
      className={`floating-update floating-update-${placement} floating-update-${status.state}`}
      data-testid="update-indicator"
    >
      <div className="floating-update-popover" role="status">
        <strong>
          {status.version ? `Update ${status.version}` : 'Imnota update'}
          {channelLabel ? ` · ${channelLabel}` : ''}
        </strong>
        <p>
          {failed
            ? (status.message ?? 'The update check failed.')
            : downloaded
              ? 'Downloaded. Restart Imnota to install it.'
              : downloading
                ? `Downloading… ${percent}%`
                : (status.message ??
                  `A newer ${channelLabel ?? ''} version is available. Nothing downloads until you choose to.`)}
        </p>
        {status.releaseNotes?.trim() && (
          <div className="floating-update-notes">
            <strong>What’s changed</strong>
            <pre>{status.releaseNotes.trim()}</pre>
          </div>
        )}
        {status.releaseUrl && (
          <a href={status.releaseUrl} target="_blank" rel="noreferrer">
            View release details <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </div>
      <IconButton
        className="floating-update-button"
        label={label}
        onClick={() =>
          void (failed
            ? onRetry()
            : downloaded
              ? onInstall()
              : available || status.manualDownload
                ? onDownload()
                : undefined)
        }
      >
        {failed ? (
          <AlertTriangle size={18} aria-hidden="true" />
        ) : downloaded ? (
          <Check size={18} aria-hidden="true" />
        ) : downloading ? (
          <span className="floating-update-progress" aria-hidden="true">
            {percent}%
          </span>
        ) : (
          <Download size={18} aria-hidden="true" />
        )}
      </IconButton>
      {downloading && <span className="floating-update-percent">{percent}%</span>}
    </div>
  );
}
