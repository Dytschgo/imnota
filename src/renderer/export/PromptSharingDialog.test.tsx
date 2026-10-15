import { controllerExportFailure, nativeExportFailure } from './export-failure-catalog';
import { COMMITTED_WRITE_WARNING } from '../../shared/write-outcome';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptBundleDialogHost, type PromptBundleUiController } from './PromptBundleDialogHost';
import { PromptSharingDialog } from './PromptSharingDialog';

vi.mock('./HostedShareDialog', () => ({
  HostedShareDialog: ({ artifacts }: { artifacts: { title: string } }) => (
    <div role="dialog" aria-label="Hosted share">
      {artifacts.title}
    </div>
  ),
}));

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
  // Rendering is not a completed fraction: the bar is indeterminate, with no percentage.
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
  expect(screen.getByRole('status')).not.toHaveTextContent('%');
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
      error={controllerExportFailure('cleanup-pending')}
      cleanupPending
      onRetryCleanup={onRetryCleanup}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('cleanup could not finish');
  fireEvent.click(screen.getByRole('button', { name: 'Retry cleanup' }));
  expect(onRetryCleanup).toHaveBeenCalledOnce();
});

it('keeps Retry cleanup available when a different error appears while cleanup is pending', () => {
  const onRetryCleanup = vi.fn();
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      error={controllerExportFailure('busy')}
      cleanupPending
      onRetryCleanup={onRetryCleanup}
      onRebuild={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Rebuild bundles' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry cleanup' }));
  expect(onRetryCleanup).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'preserves copy preference failure and current action (committed: %s)',
  async (committed) => {
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
      canRetry: false,
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
      retry: vi.fn(success),
      retryCleanup: vi.fn(success),
      prepareHostedShare: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'unexpected' as const,
          recovery: 'rebuild' as const,
          message: 'Not used',
          retryable: false,
          fallbackAvailable: false,
        },
      })),
    };
    const onError = vi.fn();
    const failure = committed ? COMMITTED_WRITE_WARNING : 'disk full';
    const onChange = vi.fn(async () => {
      throw new Error(failure);
    });
    const { rerender } = render(
      <PromptBundleDialogHost
        controller={controller}
        onError={onError}
        fileClipboardAvailable
        defaultCopyVariant="files"
        onDefaultCopyVariantChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rich copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(failure);
    if (committed)
      rerender(
        <PromptBundleDialogHost
          controller={controller}
          onError={onError}
          fileClipboardAvailable
          defaultCopyVariant="rich"
          onDefaultCopyVariantChange={onChange}
        />,
      );
    expect(screen.getByRole('button', { name: committed ? 'Rich copy' : 'Copy files' })).toBeEnabled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('previous choice');
    expect(onChange).toHaveBeenCalledOnce();
    expect(controller.copyVariant).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  },
);

it('shows a failure once, with technical details and a Rebuild bundles action', () => {
  const onPrepareFreshFiles = vi.fn();
  const bundle = {
    planId: 'plan-1',
    artifactSessionId: 'session-1',
    bundleNumber: 1,
    pictureNumbers: [1],
    screenshotCount: 1,
    excludedCount: 0,
    width: 800,
    height: 600,
    delivery: 'clipboard' as const,
    state: 'error' as const,
    error: 'An export file is missing. Choose Rebuild bundles to create a new copy.',
  };
  render(
    <PromptSharingDialog
      {...baseProps}
      onPrepareFreshFiles={onPrepareFreshFiles}
      bundles={[bundle]}
      progress={{ phase: 'error', message: 'Export failed' }}
      error={nativeExportFailure({
        code: 'io-failure',
        message: 'ENOENT bundle-1.png',
        retryable: true,
        details: { errno: 'ENOENT' },
      })}
    />,
  );
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByText('Technical details')).toBeInTheDocument();
  expect(screen.getByText('ENOENT bundle-1.png')).not.toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild bundles' }));
  expect(onPrepareFreshFiles).toHaveBeenCalledWith({
    planId: 'plan-1',
    artifactSessionId: 'session-1',
    bundleNumber: 1,
  });
});

const recoveryBundle = {
  planId: 'plan-recovery',
  bundleNumber: 1,
  pictureNumbers: [1],
  screenshotCount: 1,
  excludedCount: 0,
  width: 800,
  height: 600,
  delivery: 'clipboard' as const,
  state: 'idle' as const,
};

it.each(['cancelled', 'render-limit', 'disposed', 'busy'] as const)(
  'does not offer Rebuild bundles for %s',
  (code) => {
    render(
      <PromptSharingDialog {...baseProps} bundles={[recoveryBundle]} error={controllerExportFailure(code)} />,
    );
    expect(screen.queryByRole('button', { name: 'Rebuild bundles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  },
);

it('shows card fallbacks without Rebuild for clipboard limits, even when the card has no error', () => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[recoveryBundle]}
      error={nativeExportFailure({
        code: 'clipboard-limit',
        message: 'raw',
        retryable: false,
        details: { reason: 'too-large' },
      })}
      onCopyMarkdown={vi.fn()}
      onOpenFiles={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Rebuild bundles' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy Markdown only' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Open files' })).toBeEnabled();
});

it('Rebuild requests the displayed failure bundle even when another card is already errored', () => {
  const onPrepareFreshFiles = vi.fn();
  const selected = { ...recoveryBundle, bundleNumber: 2 };
  const error = { ...controllerExportFailure('unexpected'), bundle: selected };
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[{ ...recoveryBundle, state: 'error' }, selected]}
      error={error}
      onPrepareFreshFiles={onPrepareFreshFiles}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild bundles' }));
  expect(onPrepareFreshFiles).toHaveBeenCalledWith({
    planId: selected.planId,
    artifactSessionId: undefined,
    bundleNumber: 2,
  });
});

it('a plan-level failure still rebuilds the first card', () => {
  const onPrepareFreshFiles = vi.fn();
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[recoveryBundle, { ...recoveryBundle, bundleNumber: 2 }]}
      error={controllerExportFailure('unexpected')}
      onPrepareFreshFiles={onPrepareFreshFiles}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild bundles' }));
  expect(onPrepareFreshFiles).toHaveBeenCalledWith({
    planId: recoveryBundle.planId,
    artifactSessionId: undefined,
    bundleNumber: 1,
  });
});

it.each(['replaced-plan', 'replaced-session', 'missing-bundle'] as const)(
  'falls back to the first current card for a stale failure association (%s)',
  (replacement) => {
    const selected = { ...recoveryBundle, artifactSessionId: 'old-session', bundleNumber: 2 };
    const error = { ...controllerExportFailure('unexpected'), fallbackAvailable: true, bundle: selected };
    const onPrepareFreshFiles = vi.fn();
    const onOpenFiles = vi.fn();
    const props = { ...baseProps, error, onPrepareFreshFiles, onOpenFiles };
    const { rerender } = render(<PromptSharingDialog {...props} bundles={[recoveryBundle, selected]} />);
    const current = { ...recoveryBundle, planId: 'new-plan', artifactSessionId: 'new-session' };
    const second = {
      ...selected,
      ...(replacement === 'replaced-plan' ? { planId: current.planId } : {}),
      ...(replacement === 'replaced-session' ? { artifactSessionId: current.artifactSessionId } : {}),
      ...(replacement === 'missing-bundle' ? { bundleNumber: 3 } : {}),
    };
    rerender(<PromptSharingDialog {...props} bundles={[current, second]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild bundles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }));
    const request = { planId: current.planId, artifactSessionId: current.artifactSessionId, bundleNumber: 1 };
    expect(onPrepareFreshFiles).toHaveBeenCalledWith(request);
    expect(onOpenFiles).toHaveBeenCalledWith(request);
  },
);

it.each(['rebuild', 'retry'] as const)('offers %s recovery before any cards are available', (recovery) => {
  const onRecover = vi.fn();
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[]}
      error={controllerExportFailure(recovery === 'rebuild' ? 'unexpected' : 'composition-unavailable')}
      onRebuild={onRecover}
      onRetry={onRecover}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: recovery === 'rebuild' ? 'Rebuild bundles' : 'Try again' }),
  );
  expect(onRecover).toHaveBeenCalledOnce();
});

it('does not offer retry when the error marks it unavailable', () => {
  render(
    <PromptSharingDialog
      {...baseProps}
      bundles={[recoveryBundle]}
      error={{ ...controllerExportFailure('encode-failed'), retryable: false }}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});

it.each([false, true])(
  'offers hosted preparation retry only with a matching error target (%s)',
  async (canRetry) => {
    const success = vi.fn(async () => ({ ok: true as const }));
    const error = controllerExportFailure('composition-unavailable');
    const controller: PromptBundleUiController = {
      cards: [],
      isOpen: true,
      cleanupPending: false,
      canRetry,
      error,
      close: vi.fn(),
      clearPreview: vi.fn(),
      copyFresh: success,
      copyVariant: success,
      prepareFreshFiles: success,
      copyMarkdown: success,
      copyImage: success,
      openFiles: success,
      copyPaths: success,
      openFolder: success,
      cancel: success,
      loadPreview: success,
      retryCleanup: success,
      prepareHostedShare: vi.fn(async () => ({ ok: false as const, error })),
      retry: vi.fn(async () => ({
        ok: true as const,
        value: {
          title: 'Synthetic shared collection',
          sessionId: 'session',
          bundleNumbers: [1],
          imageBundleNumbers: [],
        },
      })),
    };
    const onError = vi.fn();
    render(<PromptBundleDialogHost controller={controller} onError={onError} />);
    if (!canRetry) {
      expect(screen.getByRole('alert')).toHaveTextContent(error.message);
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(controller.retry).not.toHaveBeenCalled();
      return;
    }
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Hosted share' })).toHaveTextContent(
      'Synthetic shared collection',
    );
    expect(screen.queryByRole('dialog', { name: 'Share bundles' })).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  },
);
