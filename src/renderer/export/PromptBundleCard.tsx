import { AlertTriangle, Check, Copy, FileImage, FileText, FolderOpen } from 'lucide-react';
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
  const busy = ['preparing', 'writing', 'copying'].includes(bundle.state);
  const request = requestFor(bundle);
  const fallbacksReady = Boolean(bundle.artifactSessionId) && !busy && !disabled;
  return (
    <article
      data-testid="prompt-bundle-card"
      data-bundle-number={bundle.bundleNumber}
      className="prompt-bundle-card"
      aria-labelledby={`prompt-bundle-${bundle.bundleNumber}`}
      aria-busy={busy}
    >
      <button
        type="button"
        className="prompt-bundle-preview"
        aria-label={`Open full-resolution preview for Prompt ${bundle.bundleNumber}`}
        disabled={disabled || !onLoadPreview || busy}
        onClick={() => void onLoadPreview?.(request)}
      >
        {bundle.previewDataUrl ? (
          <img src={bundle.previewDataUrl} alt={`First screenshot in Prompt ${bundle.bundleNumber}`} />
        ) : (
          <FileImage size={24} aria-hidden="true" />
        )}
        <span className="prompt-bundle-index" aria-hidden="true">
          {String(bundle.bundleNumber).padStart(2, '0')}
        </span>
      </button>
      <div className="prompt-bundle-body">
        <div className="prompt-bundle-heading">
          <div>
            <h3 id={`prompt-bundle-${bundle.bundleNumber}`}>Prompt {bundle.bundleNumber}</h3>
            <p>{pictureLabel(bundle.pictureNumbers)}</p>
          </div>
          {bundle.state === 'copied' && (
            <span className="prompt-bundle-state prompt-bundle-state-success">
              <Check size={13} aria-hidden="true" /> Copied
            </span>
          )}
        </div>
        <dl className="prompt-bundle-facts">
          <div>
            <dt>Screenshots</dt>
            <dd>{bundle.screenshotCount}</dd>
          </div>
          <div>
            <dt>Excluded</dt>
            <dd>{bundle.excludedCount}</dd>
          </div>
          <div>
            <dt>Canvas</dt>
            <dd>
              {bundle.width} × {bundle.height}
            </dd>
          </div>
        </dl>
        <p className="prompt-bundle-size">{formatBytes(bundle.estimatedBytes)}</p>
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
        <div className="prompt-bundle-primary">
          {bundle.delivery === 'clipboard' ? (
            <Button
              data-testid={`copy-prompt-${bundle.bundleNumber}`}
              variant="primary"
              busy={busy}
              disabled={disabled}
              onClick={() => void onCopyFresh(request)}
            >
              <Copy size={15} aria-hidden="true" />
              Copy fresh prompt
            </Button>
          ) : (
            <Button
              variant="primary"
              busy={busy}
              disabled={disabled}
              onClick={() => void onPrepareFreshFiles(request)}
            >
              <FolderOpen size={15} aria-hidden="true" />
              Prepare fresh files
            </Button>
          )}
        </div>
        <div
          className="prompt-bundle-fallbacks"
          aria-label={`Prompt ${bundle.bundleNumber} fallback actions`}
        >
          <Button
            variant="ghost"
            disabled={!fallbacksReady || !onCopyMarkdown}
            onClick={() => void onCopyMarkdown?.(request)}
          >
            <FileText size={14} aria-hidden="true" /> Markdown
          </Button>
          <Button
            variant="ghost"
            disabled={!fallbacksReady || !onCopyImage}
            onClick={() => void onCopyImage?.(request)}
          >
            <FileImage size={14} aria-hidden="true" /> Image
          </Button>
          <Button
            variant="ghost"
            disabled={!fallbacksReady || !onOpenFiles}
            onClick={() => void onOpenFiles?.(request)}
          >
            <FolderOpen size={14} aria-hidden="true" /> Files
          </Button>
        </div>
      </div>
    </article>
  );
}
