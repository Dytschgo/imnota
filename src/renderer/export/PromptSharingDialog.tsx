import { AlertTriangle, FolderOpen, Square } from 'lucide-react';
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
}

function progressLabel(progress: PromptBundleProgress): string {
  if (progress.message) return progress.message;
  if (progress.bundleNumber && progress.totalBundles)
    return `Preparing Prompt ${progress.bundleNumber} of ${progress.totalBundles}`;
  return progress.phase === 'cancelled' ? 'Export cancelled' : 'Preparing prompt bundles';
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
}: PromptSharingDialogProps) {
  const busy = progress ? ['planning', 'rendering', 'writing', 'copying'].includes(progress.phase) : false;
  const current = progress?.bundleNumber ?? 0;
  const total = progress?.totalBundles ?? bundles.length;
  const progressValue = total ? Math.min(100, Math.round((current / total) * 100)) : undefined;
  return (
    <Modal
      title="Share prompt bundles"
      description="Each primary Copy Prompt action creates a fresh export from saved collection state. Some apps may paste only the text or only the image."
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
              <h3>No prompt bundle to share</h3>
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
          <p>After pasting, confirm that both Markdown and image are present in the receiving app.</p>
          <div>
            {onOpenExportFolder && (
              <Button variant="ghost" disabled={busy} onClick={() => void onOpenExportFolder()}>
                <FolderOpen size={14} aria-hidden="true" /> Open export folder
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
