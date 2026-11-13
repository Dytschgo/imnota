import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentAccessSettings } from './AgentAccessSettings';
import { localAgentAccessHttpSnippet, localAgentAccessStdioSnippet } from './preferences';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('announces clipboard failure and allows retry with the same setup prompt', async () => {
  const copyText = vi
    .fn()
    .mockRejectedValueOnce(new Error('clipboard unavailable'))
    .mockResolvedValueOnce(undefined);
  vi.stubGlobal('imnota', { copyText });
  render(<AgentAccessSettings value={{ enabled: false }} disabled={false} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy. Try again, or select and copy');
  expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Setup prompt could not be copied. Select the text and copy it instead.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy failed' }));
  await screen.findByRole('button', { name: 'Copied' });
  expect(screen.getByRole('status')).toHaveTextContent('Setup prompt copied to clipboard.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(copyText.mock.calls[1]).toEqual(copyText.mock.calls[0]);
});

it('clears earlier success and prevents overlapping clipboard requests', async () => {
  let rejectCopy!: (error: Error) => void;
  const copyText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCopy = reject;
        }),
    );
  vi.stubGlobal('imnota', { copyText });
  render(<AgentAccessSettings value={{ enabled: true }} disabled={false} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
  await screen.findByRole('button', { name: 'Copied' });
  fireEvent.click(screen.getByText('Configuration reference'));
  const buttons = screen.getAllByRole('button', { name: 'Copy' });
  fireEvent.click(buttons[0]);
  expect(screen.getByRole('status')).toHaveTextContent('Copying');
  expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  expect(buttons[1]).toBeDisabled();
  fireEvent.click(buttons[1]);
  expect(copyText).toHaveBeenCalledTimes(2);
  expect(copyText).toHaveBeenLastCalledWith(localAgentAccessHttpSnippet());
  rejectCopy(new Error('clipboard unavailable'));
  await screen.findByRole('alert');
  expect(buttons[1]).toBeEnabled();
  fireEvent.click(buttons[1]);
  await screen.findByRole('button', { name: 'Copied' });
  expect(copyText).toHaveBeenLastCalledWith(localAgentAccessStdioSnippet());
  expect(screen.getByRole('status')).toHaveTextContent('Stdio configuration copied');
});
