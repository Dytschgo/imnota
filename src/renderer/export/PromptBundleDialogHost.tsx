import { workflowMessage } from '../app/workflow';
import type { PromptBundleProgress } from '../../shared/prompt-bundles';
import { PromptBundlePreview } from './PromptBundlePreview';
import type { PromptBundleActionRequest, PromptBundleCardModel } from './PromptBundleCard';
import { PromptSharingDialog } from './PromptSharingDialog';
import { HostedShareDialog } from './HostedShareDialog';
import { useState } from 'react';
import type { HostedShareArtifacts, PromptBundleRetryResult } from './prompt-export-controller-core';
import type { PromptBundleControllerError } from './prompt-export-controller-core';
import type { WindowsCopyVariantId } from '../../shared/workflow-bridge';
import type { ShortcutPlatform } from '../../shared/shortcuts';

type PromptActionError = PromptBundleControllerError;

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
  copyVariant(
    selection: PromptBundleActionRequest,
    variant: WindowsCopyVariantId,
  ): Promise<PromptActionResult>;
  prepareFreshFiles(selection?: PromptBundleActionRequest): Promise<PromptActionResult>;
  copyMarkdown(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  copyImage(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  openFiles(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  copyPaths(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  openFolder(): Promise<PromptActionResult>;
  cancel(): Promise<PromptActionResult>;
  loadPreview(selection: PromptBundleActionRequest): Promise<PromptActionResult>;
  clearPreview(): void;
  retry(): Promise<PromptBundleRetryResult>;
  canRetry: boolean;
  retryCleanup(): Promise<PromptActionResult>;
  prepareHostedShare(): Promise<
    { ok: true; value: HostedShareArtifacts } | { ok: false; error: PromptBundleControllerError }
  >;
}

export function PromptBundleDialogHost({
  controller,
  onError,
  fileClipboardAvailable = false,
  platform = 'windows',
  defaultCopyVariant = 'files',
  onDefaultCopyVariantChange,
}: {
  controller: PromptBundleUiController;
  onError(message: string): void;
  fileClipboardAvailable?: boolean;
  platform?: ShortcutPlatform;
  defaultCopyVariant?: WindowsCopyVariantId;
  onDefaultCopyVariantChange?(variant: WindowsCopyVariantId): Promise<void>;
}) {
  const [hostedArtifacts, setHostedArtifacts] = useState<HostedShareArtifacts>();
  const [preferenceError, setPreferenceError] = useState<string>();
  // Bundle failures are shown once, inside the dialog, with the appropriate recovery action.
  const run = async (action: Promise<PromptActionResult>) => {
    await action;
  };
  if (!controller.isOpen) return null;
  return (
    <>
      <PromptSharingDialog
        hidden={Boolean(controller.preview || hostedArtifacts)}
        bundles={controller.cards}
        fileClipboardAvailable={fileClipboardAvailable}
        platform={platform}
        defaultCopyVariant={defaultCopyVariant}
        progress={controller.progress}
        error={controller.error}
        preferenceError={preferenceError}
        cleanupPending={controller.cleanupPending}
        noContentMessage={controller.noContentMessage}
        onClose={() => {
          setPreferenceError(undefined);
          controller.close();
        }}
        onCopyFresh={(selection) => run(controller.copyFresh(selection))}
        onCopyVariant={(selection, variant) => run(controller.copyVariant(selection, variant))}
        onSelectCopyVariant={async (_selection, variant) => {
          setPreferenceError(undefined);
          try {
            await onDefaultCopyVariantChange?.(variant);
          } catch (reason) {
            setPreferenceError(
              workflowMessage(
                reason,
                'The primary copy action save could not be confirmed. Review the current choice before trying again.',
              ),
            );
          }
        }}
        onPrepareFreshFiles={(selection) => run(controller.prepareFreshFiles(selection))}
        onCopyMarkdown={(selection) => run(controller.copyMarkdown(selection))}
        onCopyImage={(selection) => run(controller.copyImage(selection))}
        onOpenFiles={(selection) => run(controller.openFiles(selection))}
        onCopyPaths={(selection) => run(controller.copyPaths(selection))}
        onOpenExportFolder={() => run(controller.openFolder())}
        onCancel={() => run(controller.cancel())}
        onRebuild={() => run(controller.prepareFreshFiles())}
        onRetry={
          controller.canRetry
            ? async () => {
                const result = await controller.retry();
                if (result.ok && 'value' in result) setHostedArtifacts(result.value);
              }
            : undefined
        }
        onRetryCleanup={() => run(controller.retryCleanup())}
        onShareHosted={async () => {
          const result = await controller.prepareHostedShare();
          if (result.ok) setHostedArtifacts(result.value);
          // The controller reports preparation failures in the sharing dialog.
        }}
        onLoadPreview={(selection) => run(controller.loadPreview(selection))}
      />
      {hostedArtifacts && (
        <HostedShareDialog
          artifacts={hostedArtifacts}
          onClose={() => setHostedArtifacts(undefined)}
          onError={onError}
        />
      )}
      {controller.preview && (
        <PromptBundlePreview
          key={controller.preview.dataUrl}
          preview={controller.preview}
          onClose={controller.clearPreview}
        />
      )}
    </>
  );
}
