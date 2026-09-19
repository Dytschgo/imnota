import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FloatingUpdateControl } from './FloatingUpdateControl';

afterEach(() => cleanup());

it('keeps an accessible update check available when no release is pending', () => {
  const onCheck = vi.fn();
  render(
    <FloatingUpdateControl
      status={{ state: 'idle' }}
      onCheck={onCheck}
      onDownload={vi.fn()}
      onInstall={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(onCheck).toHaveBeenCalledOnce();
});

it('shows a disabled checking control with an accurate label', () => {
  render(
    <FloatingUpdateControl
      status={{ state: 'checking' }}
      onCheck={vi.fn()}
      onDownload={vi.fn()}
      onInstall={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Checking for updates' })).toBeDisabled();
});

it('keeps release notes in a reachable hover panel and closes it with Escape', () => {
  render(
    <FloatingUpdateControl
      status={{
        state: 'available',
        version: '0.3.0',
        channel: 'nightly',
        releaseNotes: 'A long-awaited fix\n\n- Keeps the panel readable',
        releaseUrl: 'https://example.com/release',
      }}
      onCheck={vi.fn()}
      onDownload={vi.fn()}
      onInstall={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

  const download = screen.getByRole('button', { name: 'Download update' });
  expect(screen.queryByRole('dialog', { name: 'Update status' })).not.toBeInTheDocument();
  fireEvent.pointerEnter(screen.getByTestId('update-indicator'));
  const initialPanel = screen.getByRole('dialog', { name: 'Update status' });
  expect(initialPanel).toHaveStyle({ visibility: 'visible' });
  fireEvent.focus(download);
  expect(initialPanel).toHaveStyle({ visibility: 'visible' });
  expect(initialPanel).toHaveTextContent('What’s changed');
  expect(initialPanel).toHaveTextContent('Keeps the panel readable');
  expect(screen.getByRole('link', { name: /View release details/ })).toHaveAttribute(
    'href',
    'https://example.com/release',
  );

  fireEvent.keyDown(download, { key: 'ArrowDown' });
  const panel = screen.getByRole('dialog', { name: 'Update status' });
  expect(panel).toHaveFocus();
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Update status' })).not.toBeInTheDocument();
  expect(download).toHaveFocus();
});

it('keeps a focused panel open when the pointer leaves the update control', () => {
  render(
    <FloatingUpdateControl
      status={{ state: 'available', releaseNotes: 'Long notes' }}
      onCheck={vi.fn()}
      onDownload={vi.fn()}
      onInstall={vi.fn()}
      onRetry={vi.fn()}
    />,
  );

  const download = screen.getByRole('button', { name: 'Download update' });
  fireEvent.pointerEnter(screen.getByTestId('update-indicator'));
  fireEvent.keyDown(download, { key: 'Tab' });
  const panel = screen.getByRole('dialog', { name: 'Update status' });
  expect(panel).toHaveFocus();
  fireEvent.pointerLeave(screen.getByTestId('update-indicator'));
  expect(panel).toBeInTheDocument();
});

it('maps actionable states to the direct update action', () => {
  const onDownload = vi.fn();
  const onInstall = vi.fn();
  const onRetry = vi.fn();
  const { rerender } = render(
    <FloatingUpdateControl
      status={{ state: 'available' }}
      onCheck={vi.fn()}
      onDownload={onDownload}
      onInstall={onInstall}
      onRetry={onRetry}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
  expect(onDownload).toHaveBeenCalledOnce();

  rerender(
    <FloatingUpdateControl
      status={{ state: 'downloaded' }}
      onCheck={vi.fn()}
      onDownload={onDownload}
      onInstall={onInstall}
      onRetry={onRetry}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
  expect(onInstall).toHaveBeenCalledOnce();
  expect(screen.getByTestId('update-indicator').querySelector('.lucide-rotate-cw')).not.toBeNull();

  rerender(
    <FloatingUpdateControl
      status={{ state: 'error' }}
      onCheck={vi.fn()}
      onDownload={onDownload}
      onInstall={onInstall}
      onRetry={onRetry}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry update check' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it.each([undefined, 'https://example.com/release'])(
  'restores logical tab order around the portal (%s)',
  (releaseUrl) => {
    render(
      <>
        <button>Before update</button>
        <FloatingUpdateControl
          status={{ state: 'available', releaseUrl }}
          onCheck={vi.fn()}
          onDownload={vi.fn()}
          onInstall={vi.fn()}
          onRetry={vi.fn()}
        />
        <button>After update</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Download update' });
    fireEvent.focus(trigger);
    fireEvent.keyDown(trigger, { key: 'Tab' });
    let panel = screen.getByRole('dialog');
    expect(panel).toHaveFocus();
    expect(fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.pointerEnter(screen.getByTestId('update-indicator'));
    fireEvent.keyDown(trigger, { key: 'Tab' });
    panel = screen.getByRole('dialog');
    if (releaseUrl) {
      const link = screen.getByRole('link');
      link.focus();
      fireEvent.keyDown(link, { key: 'Tab', shiftKey: true });
      expect(panel).toHaveFocus();
      link.focus();
      expect(fireEvent.keyDown(link, { key: 'Tab' })).toBe(true);
    } else {
      expect(fireEvent.keyDown(panel, { key: 'Tab' })).toBe(true);
    }
    // Default browser Tab is intentionally not prevented. Native verification
    // checks that it advances from this restored anchor to After update.
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);
