import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectListItem } from '../../shared/types';
import { useAppStore } from '../store';
import { FloatingUpdateControl } from '../components/FloatingUpdateControl';
import { AppShell } from './AppShell';
import { SideNav } from './SideNav';

const projects: ProjectListItem[] = [
  {
    projectPath: '/workspace/atlas',
    id: 'atlas',
    name: 'Atlas',
    description: '',
    status: 'active',
    favourite: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    screenshots: [],
    collections: [
      {
        id: 'atlas-recent',
        name: 'Latest review',
        archived: false,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
    ],
  },
];

beforeEach(() => {
  useAppStore.setState({
    projects,
    view: 'projects',
    navigationOpen: true,
    snapshot: null,
    activeCollectionId: 'atlas-recent',
    recentCollections: [
      {
        projectPath: '/workspace/atlas',
        collectionId: 'atlas-recent',
        openedAt: '2026-09-03T00:00:00.000Z',
      },
    ],
  });
  localStorage.removeItem('imnota:sidenav-disclosures');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppShell navigation', () => {
  it('places Back before the location toolbar and hides Forward until history exists', () => {
    const onBack = vi.fn();
    render(
      <AppShell
        searchShortcut="Ctrl+F"
        onNavigate={vi.fn()}
        onNewProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenCollection={vi.fn()}
        onSearch={vi.fn()}
        onBack={onBack}
        canGoBack
        onOpenPromptBundles={vi.fn()}
        onToggleFavourite={vi.fn()}
        onAbout={vi.fn()}
      >
        <div>Workbench</div>
      </AppShell>,
    );

    const back = screen.getByRole('button', { name: 'Back' });
    const locationToolbar = document.querySelector('.crumbs')!;
    expect(back.compareDocumentPosition(locationToolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forward' })).not.toBeInTheDocument();
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.getByTestId('search-trigger')).toHaveTextContent('Search');
  });

  it('keeps a refresh control beside About when no update is pending', () => {
    const onCheck = vi.fn();
    render(
      <AppShell
        searchShortcut="Ctrl+F"
        onNavigate={vi.fn()}
        onNewProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenCollection={vi.fn()}
        onSearch={vi.fn()}
        onOpenPromptBundles={vi.fn()}
        onToggleFavourite={vi.fn()}
        onAbout={vi.fn()}
        renderUpdateControl={(placement) => (
          <FloatingUpdateControl
            status={{ state: 'idle' }}
            placement={placement}
            onCheck={onCheck}
            onDownload={vi.fn()}
            onInstall={vi.fn()}
            onRetry={vi.fn()}
          />
        )}
      >
        <div>Workbench</div>
      </AppShell>,
    );
    const about = screen.getByRole('button', { name: 'About' });
    const check = screen.getByRole('button', { name: 'Check for updates' });
    expect(about.parentElement).toBe(screen.getByTestId('update-indicator').parentElement);
    fireEvent.click(check);
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it('shows the update indicator beside About and lower-left while navigation is hidden', () => {
    const onDownload = vi.fn();
    const shell = (
      <AppShell
        searchShortcut="Ctrl+F"
        onNavigate={vi.fn()}
        onNewProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenCollection={vi.fn()}
        onSearch={vi.fn()}
        onOpenPromptBundles={vi.fn()}
        onToggleFavourite={vi.fn()}
        onAbout={vi.fn()}
        renderUpdateControl={(placement) => (
          <FloatingUpdateControl
            status={{ state: 'available', version: '0.3.0', channel: 'nightly' }}
            placement={placement}
            onCheck={vi.fn()}
            onDownload={onDownload}
            onInstall={vi.fn()}
            onRetry={vi.fn()}
          />
        )}
      >
        <div>Workbench</div>
      </AppShell>
    );
    const { rerender } = render(shell);
    const about = screen.getByRole('button', { name: 'About' });
    const download = screen.getByRole('button', { name: 'Download update' });
    expect(about.parentElement).toBe(screen.getByTestId('update-indicator').parentElement);
    expect(about.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.focus(download);
    expect(screen.getByRole('dialog', { name: 'Update status' })).toHaveTextContent('Update 0.3.0 · nightly');
    expect(screen.getByRole('dialog', { name: 'Update status' })).toHaveTextContent(
      'Nothing downloads until you choose to.',
    );
    fireEvent.click(download);
    expect(onDownload).toHaveBeenCalledOnce();

    useAppStore.setState({ navigationOpen: false });
    rerender(shell);
    const updateIndicator = screen.getByTestId('update-indicator');
    expect(updateIndicator).toHaveClass('floating-update-topbar');
    expect(updateIndicator.closest('.topbar')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Download update' })).toBeVisible();
  });

  it('keeps library destinations separate from quick access disclosures', () => {
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
    const disclosure = screen.getByRole('button', { name: 'Collapse quick access' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(disclosure);
    expect(document.getElementById('quick-access-collections')).toHaveAttribute('hidden');

    expect(screen.queryByRole('button', { name: 'Recent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Favourites/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand quick access' }));
    fireEvent.click(screen.getByRole('button', { name: 'View all recent' }));
    expect(onNavigate).toHaveBeenCalledWith('recent');
    expect(onOpenCollection).not.toHaveBeenCalled();

    fireEvent.click(
      within(document.getElementById('quick-access-collections')!).getByRole('button', {
        name: /Latest review/,
      }),
    );
    expect(onOpenCollection).toHaveBeenCalledWith('/workspace/atlas', 'atlas-recent');
    fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
    expect(
      screen
        .getByRole('button', { name: 'Show navigation' })
        .compareDocumentPosition(screen.getByRole('button', { name: 'Back' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByLabelText('Side navigation')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Show navigation' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
    expect(screen.getByLabelText('Side navigation')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide navigation' })).toHaveFocus();
  });

  it('skips controls inside collapsed regions when moving shortcut focus', () => {
    render(
      <AppShell
        searchShortcut="Ctrl+P"
        onNavigate={vi.fn()}
        onNewProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenCollection={vi.fn()}
        onSearch={vi.fn()}
        onOpenPromptBundles={vi.fn()}
        onToggleFavourite={vi.fn()}
        onAbout={vi.fn()}
      >
        <div>Workbench</div>
      </AppShell>,
    );

    const disclosure = screen.getByRole('button', { name: 'Collapse quick access' });
    fireEvent.click(disclosure);
    disclosure.focus();
    fireEvent.keyDown(disclosure, { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: 'Collapse favourite projects' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('button', { name: 'About' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('button', { name: 'Hide navigation' })).toHaveFocus();
  });

  it('does not reopen an active favourite group when project metadata refreshes', () => {
    const props = {
      activeCollectionId: 'atlas-recent',
      activeProjectPath: '/workspace/atlas',
      navigationOpen: true,
      projects,
      recentCollections: [
        {
          projectPath: '/workspace/atlas',
          collectionId: 'atlas-recent',
          openedAt: '2026-09-03T00:00:00.000Z',
        },
      ],
      view: 'workspace' as const,
      onAbout: vi.fn(),
      onNavigate: vi.fn(),
      onNewProject: vi.fn(),
      onOpenCollection: vi.fn(),
      onSetNavigationOpen: vi.fn(),
    };
    const { rerender } = render(<SideNav {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse favourite projects' }));
    expect(document.getElementById('favourite-projects')).toHaveAttribute('hidden');

    rerender(
      <SideNav
        {...props}
        projects={projects.map((project) => ({ ...project, updatedAt: '2026-09-04T00:00:00.000Z' }))}
      />,
    );

    expect(document.getElementById('favourite-projects')).toHaveAttribute('hidden');
  });

  it('renders the workspace footer as icon-only Settings, About, and update controls', () => {
    const onNavigate = vi.fn();
    const onAbout = vi.fn();
    render(
      <SideNav
        activeCollectionId=""
        navigationOpen
        projects={projects}
        recentCollections={[]}
        view="settings"
        onAbout={onAbout}
        onNavigate={onNavigate}
        onNewProject={vi.fn()}
        onOpenCollection={vi.fn()}
        onSetNavigationOpen={vi.fn()}
        updateControl={<button type="button">Check for updates</button>}
      />,
    );
    const footer = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(footer).queryByRole('heading')).toBeNull();
    const settings = within(footer).getByRole('button', { name: 'Settings' });
    const about = within(footer).getByRole('button', { name: 'About' });
    expect(settings).toHaveTextContent('');
    expect(about).toHaveTextContent('');
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(
      within(footer)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Settings', 'About', 'Check for updates']);
    fireEvent.click(settings);
    expect(onNavigate).toHaveBeenCalledWith('settings');
    fireEvent.click(about);
    expect(onAbout).toHaveBeenCalledOnce();
  });
});
