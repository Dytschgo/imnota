import type { PromptBundleProgress } from '../../shared/prompt-bundles';
import { Modal } from '../components/ui';
import type { PromptBundleActionRequest, PromptBundleCardModel } from './PromptBundleCard';
import { PromptSharingDialog } from './PromptSharingDialog';
import { HostedShareDialog } from './HostedShareDialog';
import { useState } from 'react';
import type { HostedShareArtifacts } from './prompt-export-controller-core';
import type { PromptBundleControllerError } from './prompt-export-controller-core';

interface PromptActionError {
  message: string;
}

type PromptActionResult = { ok: true } | { ok: false; error: PromptActionError };

export interface PromptBundleUiController {
  cards: readonly PromptBundleCardModel[];
  progress?: PromptBundleProgress;
  error?: PromptActionError;
  isOpen: boolean;
  cleanupPending: boolean;
  noContentMessage?: string;
  preview?: { bundleNumber: number; dataUrl: string; width: number; height: number };
  close(): void;
  copyFresh(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  prepareFreshFiles(selection?: PromptBundleActionRequest): Promise<PromptActionResult>;
  copyMarkdown(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  copyImage(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  openFiles(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  openFolder(): Promise<PromptActionResult>;
  cancel(): Promise<PromptActionResult>;
  loadPreview(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  clearPreview(): void;
  retryCleanup(): Promise<PromptActionResult>;
  prepareHostedShare(): Promise<
    { ok: true; value: HostedShareArtifacts } | { ok: false; error: PromptBundleControllerError }
  >;
}

export function PromptBundleDialogHost({
  controller,
  onError,
}: {
  controller: PromptBundleUiController;
  onError(message: string): void;
}) {
  const [hostedArtifacts, setHostedArtifacts] = useState<HostedShareArtifacts>();
  const run = async (action: Promise<PromptActionResult>) => {
    const result = await action;
    if (!result.ok) onError(result.error.message);
  };
  if (!controller.isOpen) return null;
  return (
    <>
      {!controller.preview && !hostedArtifacts && (
        <PromptSharingDialog
          bundles={controller.cards}
          progress={controller.progress}
          error={controller.error}
          cleanupPending={controller.cleanupPending}
          noContentMessage={controller.noContentMessage}
          onClose={controller.close}
          onCopyFresh={(selection) => run(controller.copyFresh(selection))}
          onPrepareFreshFiles={(selection) => run(controller.prepareFreshFiles(selection))}
          onCopyMarkdown={(selection) => run(controller.copyMarkdown(selection))}
          onCopyImage={(selection) => run(controller.copyImage(selection))}
          onOpenFiles={(selection) => run(controller.openFiles(selection))}
          onOpenExportFolder={() => run(controller.openFolder())}
          onCancel={() => run(controller.cancel())}
          onRetryCleanup={() => run(controller.retryCleanup())}
          onShareHosted={async () => {
            const result = await controller.prepareHostedShare();
            if (result.ok) setHostedArtifacts(result.value);
            else onError(result.error.message);
          }}
          onLoadPreview={(selection) => run(controller.loadPreview(selection))}
        />
      )}
      {hostedArtifacts && (
        <HostedShareDialog
          artifacts={hostedArtifacts}
          onClose={() => setHostedArtifacts(undefined)}
          onError={onError}
        />
      )}
      {controller.preview && (
        <Modal
          title={`Prompt ${controller.preview.bundleNumber} preview`}
          description={`${controller.preview.width} × ${controller.preview.height}px. Only this full-resolution preview is held in memory.`}
          onClose={controller.clearPreview}
          closeTestId="prompt-preview-close"
        >
          <div className="prompt-large-preview" data-testid="prompt-large-preview">
            <img
              src={controller.preview.dataUrl}
              alt={`Full-resolution Prompt ${controller.preview.bundleNumber}`}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
