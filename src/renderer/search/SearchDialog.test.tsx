import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSearchResponse } from '../../shared/project-search';
import type { ImnotaBridge } from '../../shared/types';
import { SearchDialog } from './SearchDialog';

function response(query: string, title = 'Checkout annotation'): ProjectSearchResponse {
  return {
    query,
    scope: 'active',
    truncated: false,
    results: [
      {
        id: `annotation:${query}`,
        kind: 'annotation',
        title,
        excerpt: `${query} appears here`,
        projectName: 'Checkout review',
        collectionName: 'Mobile checkout',
        target: {
          projectPath: '/workspace/checkout',
          collectionId: 'collection-one',
          itemId: 'shot-one',
          annotationId: 'annotation-one',
        },
      },
    ],
  };
}

describe('SearchDialog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function setSearch(searchProjects: (input: { query: string }) => Promise<ProjectSearchResponse>) {
    Object.defineProperty(window, 'imnota', {
      configurable: true,
      value: { searchProjects } as unknown as ImnotaBridge,
    });
  }

  it('debounces search and opens the selected target with Enter', async () => {
    const searchProjects = vi.fn(async ({ query }: { query: string }) => response(query));
    setSearch(searchProjects);
    const onOpenResult = vi.fn();
    render(<SearchDialog open onClose={vi.fn()} onOpenResult={onOpenResult} />);
    fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'button copy' } });
    await act(async () => vi.advanceTimersByTime(180));
    expect(searchProjects).toHaveBeenCalledWith({ query: 'button copy', scope: 'active', limit: 50 });
    expect(screen.getByTestId('global-search-result')).toHaveAttribute(
      'data-annotation-id',
      'annotation-one',
    );
    fireEvent.keyDown(screen.getByTestId('global-search-input'), { key: 'Enter' });
    expect(onOpenResult).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'shot-one', annotationId: 'annotation-one' }),
    );
  });

  it('never renders an older response after the query changes', async () => {
    let resolveFirst!: (value: ProjectSearchResponse) => void;
    let resolveSecond!: (value: ProjectSearchResponse) => void;
    setSearch(
      vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
        .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve))),
    );
    render(<SearchDialog open onClose={vi.fn()} onOpenResult={vi.fn()} />);
    const input = screen.getByTestId('global-search-input');
    fireEvent.change(input, { target: { value: 'first' } });
    await act(async () => vi.advanceTimersByTime(180));
    fireEvent.change(input, { target: { value: 'second' } });
    expect(screen.queryByTestId('global-search-result')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(180));
    await act(async () => resolveSecond(response('second', 'Current result')));
    expect(screen.getByText('Current result')).toBeInTheDocument();
    await act(async () => resolveFirst(response('first', 'Stale result')));
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
  });

  it('does not let an earlier open action close a reopened dialog', async () => {
    setSearch(async ({ query }) => response(query));
    let finishOpen!: () => void;
    const onOpenResult = vi.fn(() => new Promise<void>((resolve) => (finishOpen = resolve)));
    const onClose = vi.fn();
    const view = render(<SearchDialog open onClose={onClose} onOpenResult={onOpenResult} />);
    fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'button' } });
    await act(async () => vi.advanceTimersByTime(180));
    fireEvent.click(screen.getByTestId('global-search-result'));
    view.rerender(<SearchDialog open={false} onClose={onClose} onOpenResult={onOpenResult} />);
    view.rerender(<SearchDialog open onClose={onClose} onOpenResult={onOpenResult} />);
    await act(async () => finishOpen());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('global-search-dialog')).toBeInTheDocument();
  });
});
