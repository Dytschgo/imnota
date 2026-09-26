import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptBundleDialogHost, type PromptBundleUiController } from './PromptBundleDialogHost';
import { PromptSharingDialog } from './PromptSharingDialog';

afterEach(cleanup);

const baseProps = {
  fileClipboardAvailable: true,
  onClose: vi.fn(),
  onCopyFresh: vi.fn(),
  onPrepareFreshFiles: vi.fn(),
};

it('shows a useful empty state without offering a misleading copy action', () => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      noContentMessage="No screenshots are included. Turn one on first."
    />,
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('No screenshots are included. Turn one on first.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy Bundle' })).not.toBeInTheDocument();
});

it('reports typed progress, offers cancellation, and avoids receiver-detection claims', () => {
  const onCancel = vi.fn();
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      progress={{ phase: 'rendering', bundleNumber: 2, totalBundles: 4 }}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Rendering Bundle 2 of 4');
  expect(screen.queryByText('No prompt bundle to share')).not.toBeInTheDocument();
  expect(screen.getByText(/Reading the saved collection/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog')).toHaveTextContent(/native copy menu changes the primary copy action/i);
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/receiver detected|attachment received/i);
});

it('reports completed exports at 100% regardless of the last bundle number', () => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      progress={{ phase: 'complete', bundleNumber: 1, totalBundles: 6 }}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('Export complete');
  expect(screen.getByRole('status')).toHaveTextContent('100%');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '100');
  expect(screen.getByTestId('prompt-sharing-dialog')).toHaveAttribute('aria-busy', 'false');
  expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).not.toHaveTextContent(/preparing/i);
});

it('shows repeat copying without a generation percentage', () => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      progress={{ phase: 'copying', bundleNumber: 1, totalBundles: 4, message: 'Copying Bundle 1' }}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('Copying Bundle 1');
  expect(screen.getByRole('status')).not.toHaveTextContent(/preparing|%/i);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByTestId('prompt-sharing-dialog')).toHaveAttribute('aria-busy', 'true');
});

it('shows saved-bundle validation without generation progress', () => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      progress={{ phase: 'checking', message: 'Loading saved bundles' }}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('Loading saved bundles');
  expect(screen.getByRole('status')).not.toHaveTextContent(/preparing|%/i);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByTestId('prompt-sharing-dialog')).toHaveAttribute('aria-busy', 'true');
});

it.each([
  ['cancelled', 'Export cancelled'],
  ['error', 'Export failed'],
] as const)('does not present %s progress as active preparation', (phase, label) => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      progress={{ phase, bundleNumber: 1, totalBundles: 6 }}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole('status')).toHaveTextContent(label);
  expect(screen.getByRole('status')).not.toHaveTextContent(/preparing/i);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
});

it('offers explicit retry when native export cleanup is still pending', () => {
  const onRetryCleanup = vi.fn();
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      error={{ message: 'The previous export session could not be cleaned up.' }}
      cleanupPending
      onRetryCleanup={onRetryCleanup}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('could not be cleaned up');
  fireEvent.click(screen.getByRole('button', { name: 'Retry cleanup' }));
  expect(onRetryCleanup).toHaveBeenCalledOnce();
});

it('reports a rejected default change inside the open sharing dialog and keeps the prior action', async () => {
  const success = async () => ({ ok: true as const });
  const controller: PromptBundleUiController = {
    cards: [
      {
        planId: 'plan-current',
        artifactSessionId: 'session-current',
        bundleNumber: 1,
        pictureNumbers: [1],
        screenshotCount: 1,
        excludedCount: 0,
        width: 1280,
        height: 800,
        delivery: 'clipboard',
        state: 'idle',
      },
    ],
    isOpen: true,
    cleanupPending: false,
    close: vi.fn(),
    copyFresh: vi.fn(success),
    copyVariant: vi.fn(success),
    prepareFreshFiles: vi.fn(success),
    copyMarkdown: vi.fn(success),
    copyImage: vi.fn(success),
    openFiles: vi.fn(success),
    copyPaths: vi.fn(success),
    openFolder: vi.fn(success),
    cancel: vi.fn(success),
    loadPreview: vi.fn(success),
    clearPreview: vi.fn(),
    retryCleanup: vi.fn(success),
    prepareHostedShare: vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'unexpected' as const,
        message: 'Not used',
        retryable: false,
        fallbackAvailable: false,
      },
    })),
  };
  const onError = vi.fn();
  render(
    <PromptBundleDialogHost
      controller={controller}
      onError={onError}
      fileClipboardAvailable
      defaultCopyVariant="files"
      onDefaultCopyVariantChange={vi.fn(async () => Promise.reject(new Error('disk full')))}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Copy options' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rich copy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('previous choice is still active');
  expect(screen.getByRole('button', { name: 'Copy files' })).toBeEnabled();
  expect(onError).not.toHaveBeenCalled();
});
