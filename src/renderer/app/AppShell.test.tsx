import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectListItem } from '../../shared/types';
import { useAppStore } from '../store';
import { AppShell } from './AppShell';

const projects: ProjectListItem[] = [
  {
    projectPath: '/workspace/atlas',
    name: 'Atlas',
    favourite: true,
    collections: [
      {
        id: 'atlas-recent',
        name: 'Latest review',
        archived: false,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
        overallContext: '',
      },
    ],
  },
] as ProjectListItem[];

beforeEach(() => {
  useAppStore.setState({
    projects,
    view: 'projects',
    navigationOpen: true,
    snapshot: null,
    activeCollectionId: 'atlas-recent',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppShell navigation', () => {
  it('keeps Recent and Favourites navigation separate from their expanded collection disclosures', () => {
    const onNavigate = vi.fn();
    const onOpenCollection = vi.fn();
    render(
      <AppShell
        searchShortcut="Ctrl+P"
        onNavigate={onNavigate}
        onNewProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenCollection={onOpenCollection}
        onSearch={vi.fn()}
        onOpenPromptBundles={vi.fn()}
        onToggleFavourite={vi.fn()}
        onAbout={vi.fn()}
      >
        <div>Workbench</div>
      </AppShell>,
    );

    expect(screen.getByRole('heading', { name: 'Library' })).toBeVisible();
    const disclosure = screen.getByRole('button', { name: 'Collapse recently updated collections' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(disclosure);
    expect(document.getElementById('recent-collections')).toHaveAttribute('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(onNavigate).toHaveBeenCalledWith('recent');
    expect(onOpenCollection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Expand recently updated collections' }));
    fireEvent.click(
      within(document.getElementById('recent-collections')!).getByRole('button', {
        name: /Latest review/,
      }),
    );
    expect(onOpenCollection).toHaveBeenCalledWith('/workspace/atlas', 'atlas-recent');
  });
});
