import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FloatingUpdateControl } from './FloatingUpdateControl';

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
