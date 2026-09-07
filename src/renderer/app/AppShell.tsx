import {
  BookOpen,
  FolderOpen,
  Heart,
  Info,
  Keyboard,
  Layers3,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, IconButton } from '../components/ui';
import { Logo } from '../components/Logo';
import { useAppStore, type AppView } from '../store';

export interface AppShellProps {
  children: ReactNode;
  searchShortcut: string;
  onNavigate(view: AppView): void | Promise<void>;
  onNewProject(): void;
  onOpenProject(): void | Promise<void>;
  onSearch(): void | Promise<void>;
  onOpenPromptBundles(): void | Promise<void>;
  onToggleFavourite(): void | Promise<void>;
  onAbout(): void;
  onShortcuts(): void;
  onDropFiles?(files: FileList): void | Promise<void>;
}

export function AppShell({
  children,
  searchShortcut,
  onNavigate,
  onNewProject,
  onOpenProject,
  onSearch,
  onOpenPromptBundles,
  onToggleFavourite,
  onAbout,
  onShortcuts,
  onDropFiles,
}: AppShellProps) {
  const store = useAppStore();
  const nav: Array<{ id: AppView; label: string; icon: typeof Layers3 }> = [
    { id: 'projects', label: 'Projects', icon: Layers3 },
    { id: 'recent', label: 'Recent', icon: BookOpen },
    { id: 'favourites', label: 'Favourites', icon: Heart },
  ];
  return (
    <div
      className={`app-shell ${navigator.platform.toLowerCase().includes('mac') ? 'platform-mac' : ''}`}
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
      >
        <div className="sidebar-top">
          <Logo compact={!store.navigationOpen} />
          <IconButton
            className="sidebar-toggle"
            label={store.navigationOpen ? 'Hide navigation' : 'Show navigation'}
            onClick={() => store.set({ navigationOpen: !store.navigationOpen })}
          >
            <PanelLeft size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="sidebar-links" hidden={!store.navigationOpen}>
          <nav aria-label="Primary">
            <span className="nav-label">Library</span>
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${store.view === id ? 'active' : ''}`}
                onClick={() => void onNavigate(id)}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
                {id === 'favourites' && store.projects.some((item) => item.favourite) && (
                  <span className="nav-count">{store.projects.filter((item) => item.favourite).length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-spacer" />
          <nav aria-label="Application">
            <span className="nav-label">Workspace</span>
            <button
              data-testid="settings-button"
              className={`nav-item ${store.view === 'settings' ? 'active' : ''}`}
              onClick={() => void onNavigate('settings')}
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
            <button className="nav-item" onClick={onShortcuts}>
              <Keyboard size={16} aria-hidden="true" />
              Shortcuts
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
