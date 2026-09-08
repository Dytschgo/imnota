import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptSharingDialog } from './PromptSharingDialog';

afterEach(cleanup);

const baseProps = {
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
  expect(screen.getByRole('dialog')).toHaveTextContent(/Copy Bundle includes image and Markdown/i);
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
