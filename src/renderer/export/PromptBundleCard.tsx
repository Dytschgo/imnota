import { AlertTriangle, Check, ChevronDown, Copy, FileImage, FileText, FolderOpen } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui';
import type { WindowsCopyVariantId } from '../../shared/workflow-bridge';
import './prompt-bundles.css';

export type PromptBundleCardState =
  'idle' | 'preparing' | 'writing' | 'copying' | 'copied' | 'cancelled' | 'error';

export type PromptDeliveryOutcome = 'combined' | 'markdown' | 'image' | 'paths' | 'files';

const outcomeLabels: Record<PromptDeliveryOutcome, string> = {
  combined: 'Markdown + image prepared',
  markdown: 'Markdown copied',
  image: 'Image copied',
  paths: 'File paths copied',
  files: 'Files ready',
};

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
  outcome?: PromptDeliveryOutcome;
  filenames?: readonly string[];
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
  onCopyVariant?(request: PromptBundleActionRequest, variant: WindowsCopyVariantId): void | Promise<void>;
  onPrepareFreshFiles(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyMarkdown?(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyImage?(request: PromptBundleActionRequest): void | Promise<void>;
  onOpenFiles?(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyPaths?(request: PromptBundleActionRequest): void | Promise<void>;
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
  onCopyVariant,
  onPrepareFreshFiles,
  onCopyMarkdown,
  onCopyImage,
  onOpenFiles,
  onCopyPaths,
  onLoadPreview,
}: PromptBundleCardProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number }>();
  const optionsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreFocusAfterOption = useRef(false);
  const optionsMenuId = useId().replace(/:/g, '');
  const busy = ['preparing', 'writing', 'copying'].includes(bundle.state);
  const copied = bundle.state === 'copied';
  const request = requestFor(bundle);
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
      // Browsers without the Popover API retain the fixed-position menu.
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

  useLayoutEffect(() => {
    if (optionsOpen || !restoreFocusAfterOption.current) return;
    restoreFocusAfterOption.current = false;
    const trigger = optionsRef.current?.querySelector<HTMLButtonElement>('button');
    if (trigger && !trigger.disabled) return void trigger.focus();
    const fallback = dialog?.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
    );
    (fallback ?? dialog)?.focus();
  }, [busy, dialog, disabled, optionsOpen]);

  const runOption = (action?: (selection: PromptBundleActionRequest) => void | Promise<void>) => {
    restoreFocusAfterOption.current = true;
    setOptionsOpen(false);
    void action?.(request);
  };
  const toggleOptions = () => {
    if (optionsOpen) setOptionsOpen(false);
    else {
      setMenuPosition(undefined);
      setOptionsOpen(true);
    }
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
            <div className="prompt-bundle-variants" aria-label="Windows copy comparison">
              <Button
                data-testid={`copy-bundle-${bundle.bundleNumber}`}
                className={`prompt-bundle-copy${copied ? ' is-copied' : ''}`}
                variant="primary"
                busy={busy}
                disabled={disabled}
                title="Markdown text, HTML, and PNG formats"
                onClick={() => void onCopyFresh(request)}
              >
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                Rich copy
              </Button>
              {bundle.pictureNumbers.length > 0 && (
                <>
                  <Button
                    variant="soft"
                    disabled={disabled || !onCopyVariant}
                    title="Markdown and PNG as file attachments"
                    onClick={() => void onCopyVariant?.(request, 'files')}
                  >
                    Copy files
                  </Button>
                  <Button
                    variant="soft"
                    disabled={disabled || !onCopyVariant}
                    title="File attachments plus Markdown, HTML, and PNG formats"
                    onClick={() => void onCopyVariant?.(request, 'files-rich')}
                  >
                    Files + rich copy
                  </Button>
                </>
              )}
            </div>
          ) : (
            <Button
              className="prompt-bundle-copy"
              variant="primary"
              busy={busy}
              disabled={disabled}
              onClick={() => void onPrepareFreshFiles(request)}
            >
              <FolderOpen size={15} aria-hidden="true" /> Prepare files
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
                    disabled={!onCopyPaths}
                    onClick={() => runOption(onCopyPaths)}
                  >
                    <Copy size={14} aria-hidden="true" /> Copy file paths
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!onOpenFiles}
                    onClick={() => runOption(onOpenFiles)}
                  >
                    <FolderOpen size={14} aria-hidden="true" /> Open files
                  </button>
                  <button type="button" role="menuitem" onClick={() => runOption(onPrepareFreshFiles)}>
                    <FolderOpen size={14} aria-hidden="true" /> Prepare fresh files
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
          {bundle.outcome && (
            <span className="prompt-bundle-state prompt-bundle-state-success" role="status">
              <Check size={13} aria-hidden="true" /> {outcomeLabels[bundle.outcome]}
            </span>
          )}
        </div>
        {bundle.filenames?.length ? (
          <details className="prompt-bundle-files">
            <summary>Generated files ({bundle.filenames.length})</summary>
            <ul>
              {bundle.filenames.map((filename) => (
                <li key={filename}>{filename}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <div
          className="prompt-bundle-fallbacks"
          aria-label={`Bundle ${bundle.bundleNumber} fallback actions`}
        >
          <Button
            variant="ghost"
            disabled={busy || disabled || !onCopyMarkdown}
            onClick={() => void onCopyMarkdown?.(request)}
          >
            <FileText size={14} aria-hidden="true" /> Copy Markdown only
          </Button>
          <Button
            variant="ghost"
            disabled={busy || disabled || !onCopyImage || !bundle.pictureNumbers.length}
            onClick={() => void onCopyImage?.(request)}
          >
            <FileImage size={14} aria-hidden="true" /> Copy image only
          </Button>
          <Button
            variant="ghost"
            disabled={busy || disabled || !onOpenFiles}
            onClick={() => void onOpenFiles?.(request)}
          >
            <FolderOpen size={14} aria-hidden="true" /> Open files
          </Button>
          <Button
            variant="ghost"
            disabled={busy || disabled || !onCopyPaths}
            onClick={() => void onCopyPaths?.(request)}
          >
            <Copy size={14} aria-hidden="true" /> Copy file paths
          </Button>
          {bundle.delivery === 'clipboard' && (
            <Button
              variant="ghost"
              disabled={busy || disabled}
              onClick={() => void onPrepareFreshFiles(request)}
            >
              <FolderOpen size={14} aria-hidden="true" /> Prepare fresh files
            </Button>
          )}
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
