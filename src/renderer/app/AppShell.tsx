import {
  BookOpen,
  ChevronDown,
  FolderOpen,
  Heart,
  Info,
  Layers3,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../components/ui';
import { Logo } from '../components/Logo';
import { useAppStore, type AppView } from '../store';

export interface AppShellProps {
  children: ReactNode;
  searchShortcut: string;
  onNavigate(view: AppView): void | Promise<void>;
  onNewProject(): void;
  onOpenProject(): void | Promise<void>;
  onOpenCollection(projectPath: string, collectionId: string): void | Promise<void>;
  onSearch(): void | Promise<void>;
  onOpenPromptBundles(): void | Promise<void>;
  onToggleFavourite(): void | Promise<void>;
  onAbout(): void;
  onDropFiles?(files: FileList): void | Promise<void>;
}

type LibraryView = 'projects' | 'recent' | 'favourites';

export function AppShell({
  children,
  searchShortcut,
  onNavigate,
  onNewProject,
  onOpenProject,
  onOpenCollection,
  onSearch,
  onOpenPromptBundles,
  onToggleFavourite,
  onAbout,
  onDropFiles,
}: AppShellProps) {
  const store = useAppStore();
  const shellRef = useRef<HTMLDivElement>(null);
  const previousNavigationOpen = useRef(store.navigationOpen);
  useLayoutEffect(() => {
    if (previousNavigationOpen.current !== store.navigationOpen) {
      shellRef.current
        ?.querySelector<HTMLButtonElement>(store.navigationOpen ? '.sidebar-toggle' : '.navigation-restore')
        ?.focus();
      previousNavigationOpen.current = store.navigationOpen;
    }
  }, [store.navigationOpen]);
  const [expandedGroups, setExpandedGroups] = useState({ recent: true, favourites: true });
  const nav: Array<{ id: LibraryView; label: string; icon: typeof Layers3 }> = [
    { id: 'projects', label: 'Projects', icon: Layers3 },
    { id: 'recent', label: 'Recent', icon: BookOpen },
    { id: 'favourites', label: 'Favourites', icon: Heart },
  ];
  const collectionEntries = store.projects.flatMap((project) =>
    project.collections
      .filter((collection) => !collection.archived)
      .map((collection) => ({
        ...collection,
        projectName: project.name,
        projectFavourite: project.favourite,
        projectPath: project.projectPath,
      })),
  );
  const recentCollections = [...collectionEntries]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4);
  const favouriteCollections = collectionEntries
    .filter((collection) => collection.projectFavourite)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4);
  return (
    <div
      ref={shellRef}
      className={`app-shell ${navigator.platform.toLowerCase().includes('mac') ? 'platform-mac' : ''} ${store.navigationOpen ? '' : 'navigation-hidden'}`}
      data-testid="app-shell"
      onDragOver={(event) => {
        if (store.snapshot && onDropFiles) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!store.snapshot || !onDropFiles) return;
        event.preventDefault();
        void onDropFiles(event.dataTransfer.files);
      }}
    >
      <aside
        className={`sidebar ${store.navigationOpen ? '' : 'sidebar-collapsed'}`}
        aria-label="Side navigation"
        hidden={!store.navigationOpen}
      >
        <div className="sidebar-top">
          <IconButton
            className="sidebar-toggle"
            label={store.navigationOpen ? 'Hide navigation' : 'Show navigation'}
            onClick={() => store.set({ navigationOpen: !store.navigationOpen })}
          >
            <PanelLeft size={16} aria-hidden="true" />
          </IconButton>
          <Logo />
        </div>
        <div className="sidebar-links" hidden={!store.navigationOpen}>
          <nav aria-label="Primary">
            <h2 className="nav-label" id="library-navigation-heading">
              Library
            </h2>
            {nav.map(({ id, label, icon: Icon }) => {
              const entries =
                id === 'recent' ? recentCollections : id === 'favourites' ? favouriteCollections : [];
              const collectionHeading =
                id === 'recent' ? 'Recently updated collections' : `${label} collections`;
              return (
                <div className={`nav-group ${entries.length ? 'has-submenu' : ''}`} key={id}>
                  <div className="nav-group-row">
                    <button
                      className={`nav-item ${store.view === id ? 'active' : ''}`}
                      onClick={() => void onNavigate(id)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>{label}</span>
                      {id === 'favourites' && store.projects.some((item) => item.favourite) && (
                        <span className="nav-count">
                          {store.projects.filter((item) => item.favourite).length}
                        </span>
                      )}
                    </button>
                    {entries.length > 0 && id !== 'projects' && (
                      <button
                        type="button"
                        className="nav-disclosure"
                        aria-label={`${expandedGroups[id] ? 'Collapse' : 'Expand'} ${collectionHeading.toLowerCase()}`}
                        aria-controls={`${id}-collections`}
                        aria-expanded={expandedGroups[id]}
                        onClick={() => setExpandedGroups((groups) => ({ ...groups, [id]: !groups[id] }))}
                      >
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {entries.length > 0 && id !== 'projects' && (
                    <section
                      id={`${id}-collections`}
                      className="nav-submenu"
                      aria-labelledby={`${id}-collections-heading`}
                      hidden={!expandedGroups[id]}
                    >
                      <h3 className="sr-only" id={`${id}-collections-heading`}>
                        {collectionHeading}
                      </h3>
                      {entries.map((entry) => (
                        <button
                          type="button"
                          className={`nav-submenu-item ${
                            store.snapshot?.projectPath === entry.projectPath &&
                            store.activeCollectionId === entry.id
                              ? 'active'
                              : ''
                          }`}
                          key={`${entry.projectPath}:${entry.id}`}
                          title={`${entry.projectName} / ${entry.name}`}
                          onClick={() => void onOpenCollection(entry.projectPath, entry.id)}
                        >
                          <span>{entry.name}</span>
                          <small>{entry.projectName}</small>
                        </button>
                      ))}
                    </section>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="sidebar-spacer" />
          <nav aria-labelledby="workspace-navigation-heading">
            <h2 className="nav-label" id="workspace-navigation-heading">
              Workspace
            </h2>
            <button
              data-testid="settings-button"
              className={`nav-item ${store.view === 'settings' ? 'active' : ''}`}
              onClick={() => void onNavigate('settings')}
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </nav>
        </div>
        <div className="sidebar-footer">
          <button className="nav-item" aria-label="About" title="About" onClick={onAbout}>
            <Info size={16} aria-hidden="true" />
            <span>About</span>
          </button>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="crumbs">
            {!store.navigationOpen && (
              <IconButton
                className="navigation-restore"
                label="Show navigation"
                onClick={() => store.set({ navigationOpen: true })}
              >
                <PanelLeft size={16} aria-hidden="true" />
              </IconButton>
            )}
            <span className="crumb-muted">
              {store.view === 'settings'
                ? 'Settings'
                : store.snapshot
                  ? store.snapshot.project.name
                  : 'Projects'}
            </span>
            {store.snapshot && store.view !== 'settings' && (
              <>
                <span className="crumb-separator">/</span>
                <span>Screenshots</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="search-trigger"
              onClick={() => void onSearch()}
              disabled={!store.settings.workspacePath}
              aria-label={`Search projects (${searchShortcut})`}
            >
              <Search size={15} aria-hidden="true" />
              <span>Search projects</span>
              <kbd>{searchShortcut}</kbd>
            </button>
            {store.snapshot ? (
              <>
                <Button
                  variant="primary"
                  onClick={() => void onOpenPromptBundles()}
                  data-testid="share-prompt-bundles"
                >
                  <Sparkles size={15} aria-hidden="true" />
                  Prompt bundles
                </Button>
                <IconButton
                  label={store.snapshot.project.favourite ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={() => void onToggleFavourite()}
                >
                  <Heart
                    size={16}
                    fill={store.snapshot.project.favourite ? 'currentColor' : 'none'}
                    aria-hidden="true"
                  />
                </IconButton>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => void onOpenProject()}>
                  <FolderOpen size={15} aria-hidden="true" />
                  Open
                </Button>
                <Button variant="primary" onClick={onNewProject} data-testid="new-project-button">
                  <Plus size={15} aria-hidden="true" />
                  New project
                </Button>
              </>
            )}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
