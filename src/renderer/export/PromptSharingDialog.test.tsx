import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  expect(screen.queryByRole('button', { name: 'Copy bundle' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  expect(screen.getByRole('status')).not.toHaveTextContent('%');
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog')).toHaveTextContent(/copy format changes the main action/i);
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/receiver detected|attachment received/i);
});

it.each(['rendering', 'writing'] as const)(
  'does not call the last %s bundle 100 percent complete',
  (phase) => {
    render(
      <PromptSharingDialog
        {...baseProps}
        bundles={[]}
        progress={{ phase, bundleNumber: 3, totalBundles: 3 }}
      />,
    );
    expect(screen.getByTestId('prompt-sharing-dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Bundle 3 of 3');
    expect(screen.getByRole('status')).not.toHaveTextContent('100%');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  },
);

it('shows a failed collection read without claiming the collection is empty', () => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      error={{ message: 'Save the current edits and try again.' }}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Save the current edits and try again.');
  expect(screen.queryByText('No bundle to share')).not.toBeInTheDocument();
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

function hostController(): PromptBundleUiController {
  const success = async () => ({ ok: true as const });
  return {
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
}

it('shows the selected format immediately and waits for its save before another change', async () => {
  let finish!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const props = {
    controller: hostController(),
    onError: vi.fn(),
    fileClipboardAvailable: true,
    onDefaultCopyVariantChange: save,
  };
  const view = render(<PromptBundleDialogHost {...props} defaultCopyVariant="files" />);
  const selector = screen.getByRole('combobox', { name: 'Copy format' });
  selector.focus();
  fireEvent.change(selector, { target: { value: 'rich' } });
  expect(selector).toHaveValue('rich');
  expect(selector).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Copy bundle' })).toBeDisabled();
  selector.blur();
  view.rerender(<PromptBundleDialogHost {...props} defaultCopyVariant="rich" />);
  await act(async () => finish());
  expect(selector).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Copy bundle' })).toBeEnabled();
  expect(selector).toHaveFocus();
  expect(selector).toHaveValue('rich');
  expect(save).toHaveBeenCalledExactlyOnceWith('rich');
});

it('reports a rejected default change inside the open sharing dialog and keeps the prior action', async () => {
  const controller = hostController();
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

  fireEvent.change(screen.getByRole('combobox', { name: 'Copy format' }), { target: { value: 'rich' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('previous choice is still active');
  expect(screen.getByRole('button', { name: 'Copy bundle' })).toBeEnabled();
  expect(screen.getByRole('combobox', { name: 'Copy format' })).toHaveValue('files');
  expect(onError).not.toHaveBeenCalled();
});

it('shows a failed controller copy inline without invoking a duplicate toast', async () => {
  const controller = hostController();
  const onError = vi.fn();
  controller.copyVariant = vi.fn(async () => ({
    ok: false as const,
    error: { message: 'Could not copy this bundle.' },
  }));
  const view = render(
    <PromptBundleDialogHost
      controller={controller}
      onError={onError}
      fileClipboardAvailable
      defaultCopyVariant="files"
    />,
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy bundle' })));
  expect(controller.copyVariant).toHaveBeenCalledOnce();
  expect(onError).not.toHaveBeenCalled();

  controller.error = { message: 'Could not copy this bundle.' };
  view.rerender(
    <PromptBundleDialogHost
      controller={controller}
      onError={onError}
      fileClipboardAvailable
      defaultCopyVariant="files"
    />,
  );
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not copy this bundle.');
  expect(onError).not.toHaveBeenCalled();
});

it('selects one persisted format for image bundles without putting preferences in action menus', () => {
  const onSelectCopyVariant = vi.fn();
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[
        {
          planId: 'current',
          artifactSessionId: 'saved',
          bundleNumber: 1,
          pictureNumbers: [1],
          screenshotCount: 1,
          excludedCount: 0,
          width: 1280,
          height: 800,
          delivery: 'clipboard',
          state: 'idle',
        },
      ]}
      defaultCopyVariant="files"
      onSelectCopyVariant={onSelectCopyVariant}
    />,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Copy format' }), {
    target: { value: 'files-rich' },
  });
  expect(onSelectCopyVariant).toHaveBeenCalledWith(
    { planId: 'current', artifactSessionId: 'saved', bundleNumber: 1 },
    'files-rich',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy options' }));
  expect(screen.queryByText('Default copy format')).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Copy Markdown' })).toBeInTheDocument();
});

it('reports one error with details and rebuilds the affected bundle', () => {
  const onPrepareFreshFiles = vi.fn();
  render(
    <PromptSharingDialog
      {...baseProps}
      onPrepareFreshFiles={onPrepareFreshFiles}
      bundles={[
        {
          planId: 'current',
          artifactSessionId: 'saved',
          bundleNumber: 2,
          pictureNumbers: [1],
          screenshotCount: 1,
          excludedCount: 0,
          width: 1280,
          height: 800,
          delivery: 'clipboard',
          state: 'error',
          error: 'Could not copy this bundle.',
        },
      ]}
      progress={{ phase: 'error', message: 'Could not copy this bundle.' }}
      error={{ message: 'Could not copy this bundle.', technicalDetails: 'Native clipboard unavailable' }}
    />,
  );
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getAllByText('Could not copy this bundle.')).toHaveLength(1);
  fireEvent.click(screen.getByText('Technical details'));
  expect(screen.getByText('Native clipboard unavailable')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild bundles' }));
  expect(onPrepareFreshFiles).toHaveBeenCalledWith({
    planId: 'current',
    artifactSessionId: 'saved',
    bundleNumber: 2,
  });
});
