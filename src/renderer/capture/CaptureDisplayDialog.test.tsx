import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptureDisplayDialog } from './CaptureDisplayDialog';

const displays = [
  {
    id: 10,
    bounds: { x: 0, y: 0, width: 2752, height: 1152 },
    scaleFactor: 1.25,
    position: 'Primary display',
  },
  {
    id: 20,
    bounds: { x: -3440, y: 0, width: 3440, height: 1440 },
    scaleFactor: 1.5,
    position: 'Left of primary',
  },
] as const;

afterEach(cleanup);

it('shows display geometry and selects the exact display id', () => {
  const select = vi.fn();
  render(<CaptureDisplayDialog displays={displays} onSelect={select} onCancel={vi.fn()} />);

  expect(screen.getByText('2752 × 1152 points · 125% scale')).toBeInTheDocument();
  expect(screen.getByText('Desktop position -3440, 0')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Capture Left of primary/ }));
  expect(select).toHaveBeenCalledExactlyOnceWith(20);
});

it('cancels without choosing a display', () => {
  const cancel = vi.fn();
  const select = vi.fn();
  render(<CaptureDisplayDialog displays={displays} onSelect={select} onCancel={cancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});
