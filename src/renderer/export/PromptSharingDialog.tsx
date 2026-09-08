import { AlertTriangle, CloudUpload, FolderOpen, Square } from 'lucide-react';
import type { PromptBundleProgress } from '../../shared/prompt-bundles';
import { Button, Modal } from '../components/ui';
import {
  PromptBundleCard,
  type PromptBundleActionRequest,
  type PromptBundleCardModel,
} from './PromptBundleCard';
import './prompt-bundles.css';

export interface PromptSharingDialogProps {
  bundles: readonly PromptBundleCardModel[];
  progress?: PromptBundleProgress;
  error?: { message: string };
  cleanupPending?: boolean;
  noContentMessage?: string;
  onClose(): void;
  onCopyFresh(request: PromptBundleActionRequest): void | Promise<void>;
  onPrepareFreshFiles(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyMarkdown?(request: PromptBundleActionRequest): void | Promise<void>;
  onCopyImage?(request: PromptBundleActionRequest): void | Promise<void>;
  onOpenFiles?(request: PromptBundleActionRequest): void | Promise<void>;
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
  progress,
  error,
  cleanupPending = false,
  noContentMessage,
  onClose,
  onCopyFresh,
  onPrepareFreshFiles,
  onCopyMarkdown,
  onCopyImage,
  onOpenFiles,
  onLoadPreview,
  onOpenExportFolder,
  onCancel,
  onRetryCleanup,
  onShareHosted,
}: PromptSharingDialogProps) {
  const busy = progress ? ['planning', 'rendering', 'writing', 'copying'].includes(progress.phase) : false;
  const current = progress?.bundleNumber ?? 0;
  const total = progress?.totalBundles ?? bundles.length;
  const progressValue =
    progress?.phase === 'complete'
      ? 100
      : busy && total
        ? Math.min(100, Math.round((current / total) * 100))
        : undefined;
  return (
    <Modal
      title="Share bundles"
      description="Copy the latest bundle, or choose a single format."
      onClose={onClose}
      closeTestId="prompt-sharing-close"
    >
      <section className="prompt-sharing-dialog" aria-busy={busy} data-testid="prompt-sharing-dialog">
        {progress && (
          <div className={`prompt-sharing-progress prompt-sharing-progress-${progress.phase}`} role="status">
            <div>
              <span>{progressLabel(progress)}</span>
              {progressValue !== undefined && <strong>{progressValue}%</strong>}
            </div>
            {progressValue !== undefined && (
              <progress value={progressValue} max={100} aria-label="Prompt export progress" />
            )}
          </div>
        )}
        {error && (
          <div className="prompt-sharing-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error.message}</span>
            {cleanupPending && onRetryCleanup && (
              <Button variant="soft" onClick={() => void onRetryCleanup()}>
                Retry cleanup
              </Button>
            )}
          </div>
        )}
        {!bundles.length && busy ? (
          <p className="prompt-sharing-empty">Reading the saved collection and preparing prompt cards…</p>
        ) : !bundles.length ? (
          <div className="prompt-sharing-empty">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <h3>No bundle to share</h3>
              <p>
                {noContentMessage ??
                  'Include at least one screenshot in this collection before preparing a prompt bundle.'}
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
                onCopyFresh={onCopyFresh}
                onPrepareFreshFiles={onPrepareFreshFiles}
                onCopyMarkdown={onCopyMarkdown}
                onCopyImage={onCopyImage}
                onOpenFiles={onOpenFiles}
                onLoadPreview={onLoadPreview}
              />
            ))}
          </div>
        )}
        <footer className="prompt-sharing-footer">
          <details className="prompt-sharing-info">
            <summary>Copying help</summary>
            <p>Copy Bundle includes image and Markdown. Check the receiving app after pasting.</p>
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
