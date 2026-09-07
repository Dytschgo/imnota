import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptBundleCard, type PromptBundleCardModel } from './PromptBundleCard';

afterEach(cleanup);

it('disables preview while another prompt operation is running', () => {
  const onLoadPreview = vi.fn();
  render(
    <PromptBundleCard
      bundle={model()}
      disabled
      onCopyFresh={vi.fn()}
      onPrepareFreshFiles={vi.fn()}
      onLoadPreview={onLoadPreview}
    />,
  );
  const preview = screen.getByRole('button', { name: /full-resolution preview/i });
  expect(preview).toBeDisabled();
  fireEvent.click(preview);
  expect(onLoadPreview).not.toHaveBeenCalled();
});

function model(overrides: Partial<PromptBundleCardModel> = {}): PromptBundleCardModel {
  return {
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
    pictureNumbers: [3, 4],
    screenshotCount: 2,
    excludedCount: 1,
    width: 1952,
    height: 2300,
    estimatedBytes: 2 * 1024 * 1024,
    delivery: 'clipboard',
    state: 'idle',
    ...overrides,
  };
}

it('sends plan and artifact freshness identity with the primary action', () => {
  const onCopyFresh = vi.fn();
  render(<PromptBundleCard bundle={model()} onCopyFresh={onCopyFresh} onPrepareFreshFiles={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /copy fresh prompt/i }));
  expect(onCopyFresh).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
  });
  expect(screen.getByText('Pictures 3, 4')).toBeInTheDocument();
  expect(screen.getByText('2.0 MB estimated')).toBeInTheDocument();
});

it('uses an honest file action for oversized prompts and disables fallbacks before artifacts exist', () => {
  const onPrepareFreshFiles = vi.fn();
  render(
    <PromptBundleCard
      bundle={model({ artifactSessionId: undefined, delivery: 'file-only', warning: 'Use saved files.' })}
      onCopyFresh={vi.fn()}
      onPrepareFreshFiles={onPrepareFreshFiles}
      onCopyMarkdown={vi.fn()}
      onCopyImage={vi.fn()}
      onOpenFiles={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /prepare fresh files/i }));
  expect(onPrepareFreshFiles).toHaveBeenCalledOnce();
  expect(screen.getByText('Use saved files.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /markdown/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /image/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^files$/i })).toBeDisabled();
});
