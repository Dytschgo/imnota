import { FolderOpen, Heart, PanelLeft, Plus, Search, Sparkles } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button, IconButton } from '../components/ui';
import { useAppStore, type AppView } from '../store';
import { SideNav } from './SideNav';

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
  onSelectProject?(projectPath: string): void | Promise<void>;
  navigationShortcuts?: Partial<Record<'projects' | 'recent' | 'favourites', string>>;
}

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
  onSelectProject,
  navigationShortcuts,
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
  const recentCollections = store.recentCollections;
  const activeProjectPath = store.snapshot?.projectPath;
  const activeCollection = store.snapshot?.project.collections.find(
    (collection) => collection.id === store.activeCollectionId,
  );
  const activeItemCount = activeCollection
    ? [
        ...store.snapshot!.project.screenshots.filter(
          (screenshot) => screenshot.collectionId === activeCollection.id,
        ),
        ...(store.snapshot!.project.contentItems ?? []).filter(
          (item) => item.collectionId === activeCollection.id,
        ),
      ].length
    : 0;
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
      <SideNav
        activeCollectionId={store.activeCollectionId}
        activeProjectPath={activeProjectPath}
        navigationOpen={store.navigationOpen}
        projects={store.projects}
        recentCollections={recentCollections}
        navigationShortcuts={navigationShortcuts}
        view={store.view}
        onAbout={onAbout}
        onNavigate={onNavigate}
        onNewProject={onNewProject}
        onOpenCollection={onOpenCollection}
        onSetNavigationOpen={(navigationOpen) => store.set({ navigationOpen })}
        onSelectProject={onSelectProject}
      />
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
                <span className="crumb-current" title={activeCollection?.name}>
                  {activeCollection?.name ?? 'Collection'}
                  <small>{activeItemCount} items</small>
                </span>
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
                  Copy prompt bundle
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
