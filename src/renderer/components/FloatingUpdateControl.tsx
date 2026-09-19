import { Download, ExternalLink, LoaderCircle, RefreshCw, RotateCw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { UpdateStatus } from '../../shared/types';
import { IconButton } from './ui';

export interface FloatingUpdateControlProps {
  status: UpdateStatus | null;
  onCheck(): void | Promise<void>;
  onDownload(): void | Promise<void>;
  onInstall(): void | Promise<void>;
  onRetry(): void | Promise<void>;
  /** `nav` sits beside About; `topbar` sits by navigation history when the side navigation is hidden. */
  placement?: 'nav' | 'topbar';
}

export function FloatingUpdateControl({
  status,
  onCheck,
  onDownload,
  onInstall,
  onRetry,
  placement = 'topbar',
}: FloatingUpdateControlProps) {
  const controlRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const suppressNextFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>();
  const popoverId = useId().replace(/:/g, '');
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

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };
  const openPopover = () => {
    cancelClose();
    setOpen(true);
  };
  const close = (returnFocus = false) => {
    cancelClose();
    setOpen(false);
    if (returnFocus && buttonRef.current && document.activeElement !== buttonRef.current) {
      suppressNextFocus.current = true;
      buttonRef.current.focus();
    }
  };
  const scheduleClose = () => {
    cancelClose();
    if (isWithinControl(document.activeElement)) return;
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const isWithinControl = (target: EventTarget | null) =>
    target instanceof Node && (controlRef.current?.contains(target) || popoverRef.current?.contains(target));

  useLayoutEffect(() => {
    if (!open) return;
    const positionPopover = () => {
      const trigger = buttonRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const margin = 12;
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const left = Math.min(Math.max(margin, trigger.left), window.innerWidth - width - margin);
      const above = trigger.top - height >= margin || window.innerHeight - trigger.bottom < height;
      const top = above
        ? Math.max(margin, trigger.top - height)
        : Math.min(window.innerHeight - height - margin, trigger.bottom);
      setPopoverStyle({ left, top, visibility: 'visible' });
    };
    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
  }, [open, current.releaseNotes, current.releaseUrl]);

  useLayoutEffect(() => () => cancelClose(), []);

  return (
    <>
      <div
        ref={controlRef}
        className={`floating-update floating-update-${placement} floating-update-${current.state}`}
        data-testid="update-indicator"
        onPointerEnter={openPopover}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          if (suppressNextFocus.current) {
            suppressNextFocus.current = false;
            return;
          }
          openPopover();
        }}
        onBlur={(event) => {
          if (!isWithinControl(event.relatedTarget)) close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && open) {
            event.preventDefault();
            popoverRef.current?.focus();
          }
          if (event.key === 'Tab' && open && !event.shiftKey) {
            event.preventDefault();
            popoverRef.current?.focus();
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            close(true);
          }
        }}
      >
        <IconButton
          ref={buttonRef}
          className="floating-update-button"
          label={label}
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
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
            <RotateCw size={18} aria-hidden="true" />
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
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            className="floating-update-popover"
            role="dialog"
            aria-label="Update status"
            tabIndex={-1}
            style={popoverStyle ?? { visibility: 'hidden' }}
            onPointerEnter={cancelClose}
            onPointerLeave={scheduleClose}
            onFocus={cancelClose}
            onBlur={(event) => {
              if (!isWithinControl(event.relatedTarget)) close();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
              }
            }}
          >
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
          </div>,
          document.body,
        )}
    </>
  );
}
