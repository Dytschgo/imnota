import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentSearchResponse, ContentSearchResult } from '../../shared/content-search';
import type { ImnotaBridge, ProjectListItem } from '../../shared/types';
import type { ProjectWatchEvent } from '../../shared/workflow-bridge';
import { ContentSearchResults } from './ContentSearchResults';

const result: ContentSearchResult = {
  projectPath: '/workspace/project',
  projectId: 'project',
  projectName: 'Atlas',
  itemId: 'text',
  collectionId: 'review',
  collectionName: 'Review',
  kind: 'text',
  label: 'Found text',
  matchSource: 'markdown',
  excerpt: 'Full body match',
};
const response = (label: string): ContentSearchResponse => ({
  results: [{ ...result, label }],
  warnings: [],
  totalMatches: 1,
});
const props = {
  query: 'match',
  workspacePath: '/workspace',
  projects: [] as ProjectListItem[],
  favouritesOnly: false,
  scope: 'active' as const,
  onSelect: vi.fn(),
};
const searchContent = vi.fn<ImnotaBridge['searchContent']>();
let watch: (event: ProjectWatchEvent) => void;
function deferred() {
  let resolve!: (value: ContentSearchResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ContentSearchResponse>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function debounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  searchContent.mockReset();
  window.imnota = {
    searchContent,
    onProjectWatchEvent: (handler: (event: ProjectWatchEvent) => void) => {
      watch = handler;
      return () => {};
    },
  } as unknown as ImnotaBridge;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('content search responses', () => {
  it('immediately hides clickable old rows on query changes and ignores late responses', async () => {
    const old = deferred();
    const latest = deferred();
    searchContent
      .mockResolvedValueOnce(response('Initial'))
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const view = render(<ContentSearchResults {...props} />);
    await debounce();
    expect(screen.getByRole('button', { name: /Initial/ })).toBeVisible();
    view.rerender(<ContentSearchResults {...props} query="old" />);
    expect(screen.queryByRole('button', { name: /Initial/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/No matching/)).not.toBeInTheDocument();
    await debounce();
    view.rerender(<ContentSearchResults {...props} query="latest" />);
    await debounce();
    await act(async () => latest.resolve(response('Latest')));
    await act(async () => old.resolve(response('Stale')));
    expect(screen.getByRole('button', { name: /Latest/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Stale/ })).not.toBeInTheDocument();
    expect(searchContent.mock.calls.map(([input]) => input.refresh)).toEqual([true, false, false]);
  });

  it('refreshes an unchanged query for workspace and project-list generations', async () => {
    const pending = deferred();
    searchContent
      .mockResolvedValueOnce(response('Workspace A'))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response('Fresh projects'));
    const view = render(<ContentSearchResults {...props} />);
    await debounce();
    view.rerender(<ContentSearchResults {...props} workspacePath="/other" />);
    expect(screen.queryByRole('button', { name: /Workspace A/ })).not.toBeInTheDocument();
    await debounce();
    expect(searchContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspacePath: '/other', query: 'match', refresh: true }),
    );
    view.rerender(<ContentSearchResults {...props} workspacePath="/other" projects={[...props.projects]} />);
    await debounce();
    await act(async () => pending.resolve(response('Obsolete list')));
    expect(screen.getByRole('button', { name: /Fresh projects/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Obsolete list/ })).not.toBeInTheDocument();
  });

  it('treats a scope change as a distinct request and hides active results immediately', async () => {
    searchContent
      .mockResolvedValueOnce(response('Active result'))
      .mockResolvedValueOnce(response('Archived result'));
    const view = render(<ContentSearchResults {...props} />);
    await debounce();
    expect(screen.getByRole('button', { name: /Active result/ })).toBeVisible();

    view.rerender(<ContentSearchResults {...props} scope="archived" />);
    expect(screen.queryByRole('button', { name: /Active result/ })).not.toBeInTheDocument();
    await debounce();

    expect(searchContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'match', scope: 'archived', refresh: false }),
    );
    expect(screen.getByRole('button', { name: /Archived result/ })).toBeVisible();
  });

  it('reports failure with Retry and never presents indexing or failure as no matches', async () => {
    searchContent
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce({ results: [], warnings: [], totalMatches: 0 });
    render(<ContentSearchResults {...props} />);
    expect(screen.getByRole('region', { name: 'Content search results' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText(/No matching/)).not.toBeInTheDocument();
    await debounce();
    expect(screen.getByRole('alert')).toHaveTextContent('Search could not read this workspace');
    expect(screen.queryByText(/No matching/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await debounce();
    expect(searchContent).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    expect(screen.getByText(/No matching projects or content/)).toBeVisible();
  });

  it('ignores late failures and refreshes after watcher events', async () => {
    const old = deferred();
    searchContent
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response('Current'))
      .mockResolvedValueOnce(response('Watcher update'));
    const view = render(<ContentSearchResults {...props} />);
    await debounce();
    view.rerender(<ContentSearchResults {...props} query="new" />);
    await debounce();
    await act(async () => old.reject(new Error('late failure')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() =>
      watch({
        watchId: 'watch',
        projectPath: result.projectPath,
        kind: 'external-change',
        changedPaths: ['text.md'],
      }),
    );
    expect(screen.queryByRole('button', { name: /Current/ })).not.toBeInTheDocument();
    await debounce();
    expect(screen.getByRole('button', { name: /Watcher update/ })).toBeVisible();
    expect(searchContent).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'new', refresh: true }));
  });

  it('exposes partial results and delegates the favourites filter before native result limits', async () => {
    searchContent.mockResolvedValue({
      ...response('Partial'),
      warnings: ['One file could not be searched.'],
    });
    render(<ContentSearchResults {...props} favouritesOnly />);
    await debounce();
    expect(searchContent).toHaveBeenCalledWith(expect.objectContaining({ favouritesOnly: true }));
    expect(screen.getByText('One file could not be searched.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh search' })).toBeVisible();
    const button = screen.getByRole('button', { name: /Partial/ });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'text' }));
  });
});
