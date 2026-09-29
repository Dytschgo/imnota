import { AlertTriangle, CloudUpload, FolderOpen, Square } from 'lucide-react';
import type { PromptBundleProgress } from '../../shared/prompt-bundles';
import type { WindowsCopyVariantId } from '../../shared/workflow-bridge';
import { Button, Modal } from '../components/ui';
import {
  PromptBundleCard,
  type PromptBundleActionRequest,
  type PromptBundleCardModel,
} from './PromptBundleCard';
import './prompt-bundles.css';

export interface PromptSharingDialogProps {
  hidden?: boolean;
  fileClipboardAvailable?: boolean;
  defaultCopyVariant?: WindowsCopyVariantId;
  bundles: readonly PromptBundleCardModel[];
  progress?: PromptBundleProgress;
  error?: { message: string; technicalDetails?: string };
  preferenceError?: string;
  cleanupPending?: boolean;
  noContentMessage?: string;
  onClose(): void;
  onCopyFresh(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyVariant?(request: PromptBundleActionRequest, variant: WindowsCopyVariantId): void | Promise<void>;
  onSelectCopyVariant?(
    request: PromptBundleActionRequest,
    variant: WindowsCopyVariantId,
  ): void | Promise<void>;
  onPrepareFreshFiles(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyMarkdown?(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyImage?(request: PromptBundleActionRequest): void | Promise<void>;
  onOpenFiles?(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyPaths?(request: PromptBundleActionRequest): void | Promise<void>;
  onLoadPreview?(request: PromptBundleActionRequest): void | Promise<void>;
  onOpenExportFolder?(): void | Promise<void>;
  onCancel?(): void | Promise<void>;
  onRetryCleanup?(): void | Promise<void>;
  onShareHosted?(): void | Promise<void>;
}

function progressLabel(progress: PromptBundleProgress): string {
  if (progress.phase === 'complete') return progress.message ?? 'Export complete';
  if (progress.phase === 'cancelled') return progress.message ?? 'Export cancelled';
  if (progress.phase === 'error') return progress.message ?? 'Export failed';
  if (progress.message) return progress.message;
  if (progress.bundleNumber && progress.totalBundles) {
    const action = {
      checking: 'Loading saved',
      planning: 'Preparing',
      rendering: 'Rendering',
      writing: 'Writing',
      copying: 'Copying',
    }[progress.phase];
    return `${action} Bundle ${progress.bundleNumber} of ${progress.totalBundles}`;
  }
  return 'Preparing bundles';
}

export function PromptSharingDialog({
  bundles,
  hidden = false,
  fileClipboardAvailable = false,
  defaultCopyVariant = 'files',
  progress,
  error,
  preferenceError,
  cleanupPending = false,
  noContentMessage,
  onClose,
  onCopyFresh,
  onCopyVariant,
  onSelectCopyVariant,
  onPrepareFreshFiles,
  onCopyMarkdown,
  onCopyImage,
  onOpenFiles,
  onCopyPaths,
  onLoadPreview,
  onOpenExportFolder,
  onCancel,
  onRetryCleanup,
  onShareHosted,
}: PromptSharingDialogProps) {
  const busy = progress
    ? ['checking', 'planning', 'rendering', 'writing', 'copying'].includes(progress.phase)
    : false;
  // bundleNumber is the item being processed, not completed work, and rendering can
  // split the plan again before writing starts, so it is not shown as a percentage.
  const progressValue = progress?.phase === 'complete' ? 100 : undefined;
  const showProgressBar =
    progress && ['planning', 'rendering', 'writing', 'complete'].includes(progress.phase);
  const rebuildBundle = bundles.find((bundle) => bundle.state === 'error') ?? bundles[0];
  return (
    <Modal
      hidden={hidden}
      title="Share bundles"
      description="Copy a bundle to your clipboard, or pick a single format from its menu."
      onClose={onClose}
      closeTestId="prompt-sharing-close"
    >
      <section className="prompt-sharing-dialog" aria-busy={busy} data-testid="prompt-sharing-dialog">
        {progress && !(error && progress.phase === 'error') && (
          <div className={`prompt-sharing-progress prompt-sharing-progress-${progress.phase}`} role="status">
            <div>
              <span>{progressLabel(progress)}</span>
              {progressValue !== undefined && <strong>{progressValue}%</strong>}
            </div>
            {showProgressBar && (
              <progress value={progressValue} max={100} aria-label="Prompt export progress" />
            )}
          </div>
        )}
        {error && (
          <div className="prompt-sharing-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <div className="prompt-sharing-error-content">
              <span>{error.message}</span>
              {error.technicalDetails && (
                <details>
                  <summary>Technical details</summary>
                  <p>{error.technicalDetails}</p>
                </details>
              )}
            </div>
            {cleanupPending
              ? onRetryCleanup && (
                  <Button variant="soft" onClick={() => void onRetryCleanup()}>
                    Retry cleanup
                  </Button>
                )
              : rebuildBundle && (
                  <Button
                    variant="soft"
                    onClick={() =>
                      void onPrepareFreshFiles({
                        planId: rebuildBundle.planId,
                        artifactSessionId: rebuildBundle.artifactSessionId,
                        bundleNumber: rebuildBundle.bundleNumber,
                      })
                    }
                  >
                    Rebuild bundles
                  </Button>
                )}
          </div>
        )}
        {preferenceError && (
          <div className="prompt-sharing-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{preferenceError}</span>
          </div>
        )}
        {!bundles.length && busy ? (
          <p className="prompt-sharing-empty">Reading the saved collection and preparing prompt cards…</p>
        ) : !bundles.length && error ? null : !bundles.length ? (
          <div className="prompt-sharing-empty">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <h3>Nothing to export yet</h3>
              <p>
                {noContentMessage ??
                  'Include a picture, text note or drawing in this collection before preparing bundles.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="prompt-bundle-list">
            {bundles.map((bundle) => (
              <PromptBundleCard
                key={`${bundle.planId}:${bundle.bundleNumber}`}
                bundle={bundle}
                disabled={busy}
                fileClipboardAvailable={fileClipboardAvailable}
                defaultCopyVariant={defaultCopyVariant}
                errorReported={Boolean(error)}
                onCopyFresh={onCopyFresh}
                onCopyVariant={onCopyVariant}
                onSelectCopyVariant={onSelectCopyVariant}
                onPrepareFreshFiles={onPrepareFreshFiles}
                onCopyMarkdown={onCopyMarkdown}
                onCopyImage={onCopyImage}
                onOpenFiles={onOpenFiles}
                onCopyPaths={onCopyPaths}
                onLoadPreview={onLoadPreview}
              />
            ))}
          </div>
        )}
        <footer className="prompt-sharing-footer">
          <details className="prompt-sharing-info">
            <summary>Copying help</summary>
            <p>
              {fileClipboardAvailable
                ? 'The native copy menu changes the primary copy action. The receiving app decides which clipboard formats it accepts. '
                : 'Rich copy places text and image formats on the clipboard. '}
              File paths remain a separate plain-text fallback, and files open only when you choose an Open
              action.
            </p>
          </details>
          <div>
            {onOpenExportFolder && (
              <Button variant="ghost" disabled={busy} onClick={() => void onOpenExportFolder()}>
                <FolderOpen size={14} aria-hidden="true" /> Open export folder
              </Button>
            )}
            {onShareHosted && (
              <Button variant="soft" disabled={busy || !bundles.length} onClick={() => void onShareHosted()}>
                <CloudUpload size={14} aria-hidden="true" /> Share online
              </Button>
            )}
            {busy && onCancel && (
              <Button variant="soft" onClick={() => void onCancel()}>
                <Square size={12} aria-hidden="true" /> Cancel
              </Button>
            )}
          </div>
        </footer>
      </section>
    </Modal>
  );
}
