import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from '../components/ui';
import { PromptBundlePreview } from './PromptBundlePreview';

afterEach(cleanup);

const preview = { bundleNumber: 1, dataUrl: 'data:image/png;base64,AA', width: 897, height: 2661 };

it('opens with the complete original image and offers independent inspection scales', () => {
  const onClose = vi.fn();
  render(<PromptBundlePreview preview={preview} onClose={onClose} />);
  const image = screen.getByRole('img');
  expect(image).toHaveAttribute('src', preview.dataUrl);
  expect(image).toHaveAttribute('width', '897');
  expect(image).toHaveAttribute('height', '2661');
  expect(screen.getByRole('button', { name: 'Fit image' })).toHaveAttribute('aria-pressed', 'true');
  for (const mode of ['Fit width', 'Actual size', 'Fit image']) {
    fireEvent.click(screen.getByRole('button', { name: mode }));
    expect(screen.getByRole('button', { name: mode })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img')).toHaveAttribute('src', preview.dataUrl);
    expect(screen.getByRole('region')).toHaveAttribute('tabindex', '0');
  }
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
});

it('returns to the same bundle opener and then to the app opener', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Share</button>
        {open && (
          <Modal title="Share bundles" hidden={showPreview} onClose={() => setOpen(false)}>
            <button onClick={() => setShowPreview(true)}>Preview bundle</button>
          </Modal>
        )}
        {showPreview && <PromptBundlePreview preview={preview} onClose={() => setShowPreview(false)} />}
      </>
    );
  }
  render(<Harness />);
  const share = screen.getByRole('button', { name: 'Share' });
  share.focus();
  fireEvent.click(share);
  const opener = screen.getByRole('button', { name: 'Preview bundle' });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Share bundles');
  expect(opener).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(share).toHaveFocus();
});
