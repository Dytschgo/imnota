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
  expect(screen.queryByRole('button', { name: /copy fresh prompt/i })).not.toBeInTheDocument();
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
  expect(screen.getByRole('status')).toHaveTextContent('Preparing Prompt 2 of 4');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog')).toHaveTextContent(/confirm that both Markdown and image are present/i);
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/receiver detected|attachment received/i);
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
