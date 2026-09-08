import { AlertTriangle, Check, ChevronDown, Copy, FileImage, FileText, FolderOpen } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui';
import './prompt-bundles.css';

// Intent: a developer moving a visual brief into an agent needs one unmistakable fresh-copy action and honest fallbacks.
// Hierarchy: prompt identity and primary action lead; dimensions, counts, and compatibility details recede.
// Palette/depth/surfaces: existing graphite/indigo tokens, borders-only layering, and semantic amber/green states.
// Typography/spacing: existing system workbench type with weight-led hierarchy on a compact 4px rhythm.

export type PromptBundleCardState =
  'idle' | 'preparing' | 'writing' | 'copying' | 'copied' | 'cancelled' | 'error';

export interface PromptBundleCardModel {
  planId: string;
  artifactSessionId?: string;
  bundleNumber: number;
  pictureNumbers: readonly number[];
  screenshotCount: number;
  textCount?: number;
  excludedCount: number;
  width: number;
  height: number;
  estimatedBytes?: number;
  previewDataUrl?: string;
  delivery: 'clipboard' | 'file-only';
  warning?: string;
  state: PromptBundleCardState;
  error?: string;
}

export interface PromptBundleActionRequest {
  planId: string;
  artifactSessionId?: string;
  bundleNumber: number;
}

export interface PromptBundleCardProps {
  bundle: PromptBundleCardModel;
  disabled?: boolean;
  onCopyFresh(request: PromptBundleActionRequest): void | Promise<void>;
  onPrepareFreshFiles(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyMarkdown?(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyImage?(request: PromptBundleActionRequest): void | Promise<void>;
  onOpenFiles?(request: PromptBundleActionRequest): void | Promise<void>;
  onLoadPreview?(request: PromptBundleActionRequest): void | Promise<void>;
}

function requestFor(bundle: PromptBundleCardModel): PromptBundleActionRequest {
  return {
    planId: bundle.planId,
    artifactSessionId: bundle.artifactSessionId,
    bundleNumber: bundle.bundleNumber,
  };
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return 'Size calculated on export';
  if (bytes < 1024) return `${Math.round(bytes)} B estimated`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB estimated`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB estimated`;
}

function pictureLabel(numbers: readonly number[]): string {
  if (!numbers.length) return 'No pictures';
  return `${numbers.length === 1 ? 'Picture' : 'Pictures'} ${numbers.join(', ')}`;
}

export function PromptBundleCard({
  bundle,
  disabled = false,
  onCopyFresh,
  onPrepareFreshFiles,
  onCopyMarkdown,
  onCopyImage,
  onOpenFiles,
  onLoadPreview,
}: PromptBundleCardProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number }>();
  const optionsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionsMenuId = useId().replace(/:/g, '');
  const busy = ['preparing', 'writing', 'copying'].includes(bundle.state);
  const request = requestFor(bundle);
  const copied = bundle.state === 'copied';
  const dialog = optionsRef.current?.closest<HTMLElement>('[role="dialog"]');
  const menuPortal = dialog ?? (typeof document === 'undefined' ? undefined : document.body);

  useLayoutEffect(() => {
    if (!optionsOpen) return;
    const menu = menuRef.current;
    if (!menu) return;
    menu.setAttribute('popover', 'manual');
    let nativePopoverOpen = false;
    try {
      if (typeof menu.showPopover === 'function') {
        menu.showPopover();
        nativePopoverOpen = true;
      }
    } catch {
      // A browser without the Popover API keeps the fixed-position fallback visible.
    }
    const positionMenu = () => {
      const trigger = optionsRef.current?.querySelector<HTMLElement>('button');
      const dialogBounds = dialog?.getBoundingClientRect() ?? {
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
      };
      if (!trigger) return;
      const triggerBounds = trigger.getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      const inset = 8;
      const bounds = {
        left: Math.max(inset, dialogBounds.left),
        right: Math.min(window.innerWidth - inset, dialogBounds.right),
        top: Math.max(inset, dialogBounds.top),
        bottom: Math.min(window.innerHeight - inset, dialogBounds.bottom),
      };
      const menuWidth = menuBounds.width || 156;
      const menuHeight = menuBounds.height || 98;
      const roomBelow = bounds.bottom - triggerBounds.bottom;
      const top =
        roomBelow >= menuHeight + 6
          ? triggerBounds.bottom + 6
          : Math.max(bounds.top, triggerBounds.top - menuHeight - 6);
      const left = Math.min(
        Math.max(bounds.left, triggerBounds.right - menuWidth),
        Math.max(bounds.left, bounds.right - menuWidth),
      );
      setMenuPosition({ left: Math.round(left), top: Math.round(top) });
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        !optionsRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setOptionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOptionsOpen(false);
      optionsRef.current?.querySelector<HTMLElement>('button')?.focus();
    };
    positionMenu();
    menu.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
    dialog?.addEventListener('keydown', closeOnEscape, true);
    return () => {
      if (nativePopoverOpen) menu.hidePopover?.();
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('resize', positionMenu);
      dialog?.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [dialog, optionsOpen]);

  const runOption = (action?: (request: PromptBundleActionRequest) => void | Promise<void>) => {
    setOptionsOpen(false);
    void action?.(request);
  };

  const toggleOptions = () => {
    if (optionsOpen) {
      setOptionsOpen(false);
      return;
    }
    setMenuPosition(undefined);
    setOptionsOpen(true);
  };

  return (
    <article
      data-testid="prompt-bundle-card"
      data-bundle-number={bundle.bundleNumber}
      className="prompt-bundle-card"
      aria-labelledby={`prompt-bundle-${bundle.bundleNumber}`}
      aria-busy={busy}
    >
      <div className="prompt-bundle-media">
        <button
          type="button"
          className="prompt-bundle-preview"
          aria-label={`Open full-resolution preview for Bundle ${bundle.bundleNumber}`}
          disabled={disabled || !onLoadPreview || busy || !bundle.pictureNumbers.length}
          onClick={() => void onLoadPreview?.(request)}
        >
          {bundle.previewDataUrl ? (
            <img src={bundle.previewDataUrl} alt={`First screenshot in Bundle ${bundle.bundleNumber}`} />
          ) : (
            <FileImage size={24} aria-hidden="true" />
          )}
          <span className="prompt-bundle-index" aria-hidden="true">
            {String(bundle.bundleNumber).padStart(2, '0')}
          </span>
        </button>
        <div className={`prompt-bundle-primary${copied ? ' is-copied' : ''}`}>
          {bundle.delivery === 'clipboard' ? (
            <Button
              data-testid={`copy-bundle-${bundle.bundleNumber}`}
              className={`prompt-bundle-copy${copied ? ' is-copied' : ''}`}
              variant="primary"
              busy={busy}
              disabled={disabled}
              title={copied ? 'Copy the latest bundle again' : undefined}
              onClick={() => void onCopyFresh(request)}
            >
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy Bundle'}
            </Button>
          ) : (
            <Button
              className="prompt-bundle-copy"
              variant="primary"
              busy={busy}
              disabled={disabled}
              onClick={() => void onPrepareFreshFiles(request)}
            >
              <FolderOpen size={15} aria-hidden="true" />
              Prepare files
            </Button>
          )}
          <div className="prompt-bundle-options" ref={optionsRef}>
            <Button
              variant="ghost"
              aria-label="Copy options"
              aria-haspopup="menu"
              aria-expanded={optionsOpen}
              aria-controls={optionsOpen ? optionsMenuId : undefined}
              disabled={busy || disabled}
              onClick={toggleOptions}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
            {optionsOpen &&
              menuPortal &&
              createPortal(
                <div
                  ref={menuRef}
                  id={optionsMenuId}
                  className="prompt-bundle-options-menu"
                  role="menu"
                  aria-label={`Bundle ${bundle.bundleNumber} options`}
                  style={menuPosition ? { left: menuPosition.left, top: menuPosition.top } : undefined}
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!onCopyMarkdown}
                    onClick={() => runOption(onCopyMarkdown)}
                  >
                    <FileText size={14} aria-hidden="true" /> Copy Markdown
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!onCopyImage || !bundle.pictureNumbers.length}
                    onClick={() => runOption(onCopyImage)}
                  >
                    <FileImage size={14} aria-hidden="true" /> Copy PNG
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!onOpenFiles}
                    onClick={() => runOption(onOpenFiles)}
                  >
                    <FolderOpen size={14} aria-hidden="true" /> Open files
                  </button>
                </div>,
                menuPortal,
              )}
          </div>
        </div>
      </div>
      <div className="prompt-bundle-body">
        <div className="prompt-bundle-heading">
          <div>
            <h3 id={`prompt-bundle-${bundle.bundleNumber}`}>Bundle {bundle.bundleNumber}</h3>
            <p>{bundle.pictureNumbers.length ? pictureLabel(bundle.pictureNumbers) : 'Text only'}</p>
          </div>
        </div>
        <details className="prompt-bundle-details">
          <summary>Bundle details</summary>
          <dl className="prompt-bundle-facts">
            <div>
              <dt>Visuals</dt>
              <dd>{bundle.screenshotCount}</dd>
            </div>
            <div>
              <dt>Text</dt>
              <dd>{bundle.textCount ?? 0}</dd>
            </div>
            <div>
              <dt>Excluded</dt>
              <dd>{bundle.excludedCount}</dd>
            </div>
            <div>
              <dt>Canvas</dt>
              <dd>{bundle.width && bundle.height ? `${bundle.width} × ${bundle.height}` : 'None'}</dd>
            </div>
          </dl>
          <p className="prompt-bundle-size">{formatBytes(bundle.estimatedBytes)}</p>
        </details>
        {(bundle.warning || bundle.delivery === 'file-only') && (
          <p className="prompt-bundle-warning">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              {bundle.warning ??
                'This full-resolution prompt exceeds safe clipboard limits. Use the saved files instead.'}
            </span>
          </p>
        )}
        {bundle.error && (
          <p className="prompt-bundle-error" role="alert">
            {bundle.error}
          </p>
        )}
      </div>
    </article>
  );
}
