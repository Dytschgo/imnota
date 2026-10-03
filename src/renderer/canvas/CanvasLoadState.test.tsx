import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasLoadState } from './CanvasLoadState';

afterEach(cleanup);

it('reports a loading screenshot without inviting an import', () => {
  render(<CanvasLoadState failed={false} onRetry={vi.fn()} />);
  const state = screen.getByRole('status');
  expect(state).toHaveAttribute('data-state', 'loading');
  expect(state).toHaveTextContent('Loading screenshot…');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

it('reports a failed load and offers Retry', () => {
  const onRetry = vi.fn();
  render(<CanvasLoadState failed onRetry={onRetry} />);
  const state = screen.getByRole('status');
  expect(state).toHaveAttribute('data-state', 'failed');
  expect(state).toHaveTextContent('This screenshot could not be loaded.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
});
