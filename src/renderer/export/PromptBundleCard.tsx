import { AlertTriangle, Check, ChevronDown, Copy, FileImage, FileText, FolderOpen } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
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
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsMenuId = useId().replace(/:/g, '');
  const busy = ['preparing', 'writing', 'copying'].includes(bundle.state);
  const request = requestFor(bundle);
  const fallbacksReady = Boolean(bundle.artifactSessionId) && !busy && !disabled;
  const copied = bundle.state === 'copied';

  useEffect(() => {
    if (!optionsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setOptionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOptionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [optionsOpen]);

  const runOption = (action?: (request: PromptBundleActionRequest) => void | Promise<void>) => {
    setOptionsOpen(false);
    void action?.(request);
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
        <div className="prompt-bundle-primary">
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
              onClick={() => setOptionsOpen((open) => !open)}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
            {optionsOpen && (
              <div
                id={optionsMenuId}
                className="prompt-bundle-options-menu"
                role="menu"
                aria-label={`Bundle ${bundle.bundleNumber} options`}
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
                  disabled={!onOpenFiles || !fallbacksReady}
                  onClick={() => runOption(onOpenFiles)}
                >
                  <FolderOpen size={14} aria-hidden="true" /> Open files
                </button>
              </div>
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
        <details className="prompt-bundle-info">
          <summary>About copying</summary>
          <p>Copy Bundle uses the latest image and Markdown. Options copies one format.</p>
        </details>
      </div>
    </article>
  );
}
