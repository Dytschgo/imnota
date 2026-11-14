import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentHandoffDialog } from './AgentHandoffDialog';
import type { AgentHandoffReview } from './prompt-export-controller-core';

const handoff: AgentHandoffReview = {
  bundleId: 'b_' + '1'.repeat(32),
  setName: 'Review - 261106-010203',
  collectionName: 'Checkout review',
  bundleNumber: 2,
  instruction: 'Read exact saved b_' + '1'.repeat(32),
  agentAccessEnabled: true,
  freshness: 'changed',
  pictureNumbers: [3, 4],
  textCount: 1,
};
beforeEach(() => {
  window.imnota = { copyPromptExportMarkdown: vi.fn(async () => ({ ok: true, value: undefined })) } as never;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows the saved scope and changed state, then copies the exact instruction without claiming target acceptance', async () => {
  render(<AgentHandoffDialog handoff={handoff} onClose={vi.fn()} onOpenSavedFiles={vi.fn()} />);
  expect(screen.getByText(/collection has changed/)).toBeVisible();
  expect(screen.getByText('Pictures 3, 4 · 1 text block')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Copy agent instruction' }));
  await screen.findByText('Agent instruction copied. Paste it into your configured agent.');
  expect(window.imnota.copyPromptExportMarkdown).toHaveBeenCalledExactlyOnceWith(handoff.instruction);
});

it('keeps access off and offers setup guidance without copying or modifying settings', () => {
  render(
    <AgentHandoffDialog
      handoff={{ ...handoff, agentAccessEnabled: false }}
      onClose={vi.fn()}
      onOpenSavedFiles={vi.fn()}
    />,
  );
  expect(screen.getByText(/Local agent access is off/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Copy agent instruction' })).toBeDisabled();
  expect(window.imnota.copyPromptExportMarkdown).not.toHaveBeenCalled();
});

it('preserves the instruction after a failed copy and permits an explicit retry', async () => {
  vi.mocked(window.imnota.copyPromptExportMarkdown).mockResolvedValueOnce({
    ok: false,
    error: { code: 'io-failure', message: 'Clipboard unavailable', retryable: true },
  });
  render(<AgentHandoffDialog handoff={handoff} onClose={vi.fn()} onOpenSavedFiles={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy agent instruction' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard unavailable');
  expect(screen.getByLabelText('Agent instruction')).toHaveValue(handoff.instruction);
  fireEvent.click(screen.getByRole('button', { name: 'Copy agent instruction' }));
  await screen.findByText('Agent instruction copied. Paste it into your configured agent.');
  expect(window.imnota.copyPromptExportMarkdown).toHaveBeenCalledTimes(2);
});

it('opens exactly the saved-file action and reports unavailable files inside the active dialog', async () => {
  const open = vi.fn(async () => ({
    ok: false as const,
    error: {
      code: 'native-failure' as const,
      message: 'Saved files unavailable',
      retryable: false,
      fallbackAvailable: false,
      recovery: 'none' as const,
    },
  }));
  render(<AgentHandoffDialog handoff={handoff} onClose={vi.fn()} onOpenSavedFiles={open} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open saved files' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Saved files unavailable');
  expect(open).toHaveBeenCalledTimes(1);
});
