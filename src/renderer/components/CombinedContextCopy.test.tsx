import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CombinedContextCopy } from './CombinedContextCopy';
import { prepareClipboardImage } from '../clipboard-image';

vi.mock('../clipboard-image', () => ({ prepareClipboardImage: vi.fn() }));
const copyContext = vi.fn();
beforeEach(() => {
  vi.mocked(prepareClipboardImage).mockReset();
  copyContext.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, 'imnota', { configurable: true, value: { copyContext } });
});
afterEach(cleanup);
const images = [{ filename: '001-annotated.png', dataUrl: 'rendered-png' }];
it('prepares annotated output before one typed clipboard write and explains compatibility', async () => {
  vi.mocked(prepareClipboardImage).mockResolvedValue('combined-png');
  const busy = vi.fn();
  render(<CombinedContextCopy markdown="# Brief" images={images} onBusyChange={busy} />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() =>
    expect(copyContext).toHaveBeenCalledWith({ markdown: '# Brief', imageDataUrl: 'combined-png' }),
  );
  expect(prepareClipboardImage).toHaveBeenCalledWith(images);
  expect(await screen.findByRole('status')).toHaveTextContent('some apps accept only one');
  expect(busy.mock.calls).toEqual([[true], [false]]);
});
it('does not touch the clipboard on preparation failure and can retry', async () => {
  vi.mocked(prepareClipboardImage)
    .mockRejectedValueOnce(new Error('Too large; use exported PNGs.'))
    .mockResolvedValue('png');
  render(<CombinedContextCopy markdown="text" images={images} onBusyChange={() => undefined} />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Too large');
  expect(copyContext).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(copyContext).toHaveBeenCalledTimes(1));
});
it('disables image copying with no references and labels multiple references as one image', () => {
  const { rerender } = render(
    <CombinedContextCopy markdown="text" images={[]} onBusyChange={() => undefined} />,
  );
  expect(screen.getByRole('button')).toBeDisabled();
  rerender(
    <CombinedContextCopy markdown="text" images={[...images, ...images]} onBusyChange={() => undefined} />,
  );
  expect(screen.getByText(/2 screenshots will become one labelled image/)).toBeInTheDocument();
});
