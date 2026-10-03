import { ChevronDown, ChevronRight, Info, Layers3, PanelLeft, Plus, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ProjectListItem } from '../../shared/types';
import { Logo } from '../components/Logo';
import { collectionDisplayName } from '../collection/collection-display-name';
import { IconButton } from '../components/ui';
import type { AppView } from '../store';
import { relativeOpenedTime, resolveRecentCollections } from '../navigation-history';
import './sidenav.css';

type RecentCollectionHistory = {
  projectPath: string;
  collectionId: string;
  openedAt: string;
};

interface DisclosureState {
  quickAccess: boolean;
}

export interface SideNavProps {
  activeCollectionId: string;
  activeProjectPath?: string;
  navigationOpen: boolean;
  projects: ProjectListItem[];
  recentCollections: RecentCollectionHistory[];
  navigationShortcuts?: Partial<Record<'projects' | 'recent' | 'settings', string>>;
  view: AppView;
  onAbout(): void;
  onNavigate(view: AppView): void | Promise<void>;
  onNewProject(): void;
  onOpenCollection(projectPath: string, collectionId: string): void | Promise<void>;
  onSetNavigationOpen(open: boolean): void;
  /** Update indicator rendered beside About; null while no update needs attention. */
  updateControl?: ReactNode;
}

const disclosureKey = 'imnota:sidenav-disclosures';

function getStoredDisclosures(): DisclosureState {
  try {
    const stored = localStorage.getItem(disclosureKey);
    if (!stored) return { quickAccess: true };
    // Older builds also stored favourite-section state; only Recent remains.
    const value = JSON.parse(stored) as Partial<DisclosureState>;
    return { quickAccess: typeof value.quickAccess === 'boolean' ? value.quickAccess : true };
  } catch {
    return { quickAccess: true };
  }
}

function rememberDisclosures(value: DisclosureState) {
  try {
    localStorage.setItem(disclosureKey, JSON.stringify(value));
  } catch {
    // Navigation preferences are cosmetic and must never affect project access.
  }
}

export function SideNav({
  activeCollectionId,
  activeProjectPath,
  navigationOpen,
  projects,
  recentCollections: recentHistory,
  navigationShortcuts,
  view,
  onAbout,
  onNavigate,
  onNewProject,
  onOpenCollection,
  onSetNavigationOpen,
  updateControl,
}: SideNavProps) {
  const [disclosures, setDisclosures] = useState<DisclosureState>(getStoredDisclosures);
  const recentCollections = useMemo(
    () => resolveRecentCollections(projects, recentHistory).slice(0, 6),
    [projects, recentHistory],
  );
  const lastActiveIdentity = useRef<string | null>(null);
  const revealedActiveIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProjectPath || !activeCollectionId) return;
    const activeIdentity = `${activeProjectPath}:${activeCollectionId}`;
    if (lastActiveIdentity.current !== activeIdentity) {
      lastActiveIdentity.current = activeIdentity;
      revealedActiveIdentity.current = null;
    }
    const isRecent = recentCollections.some(
      (collection) => collection.projectPath === activeProjectPath && collection.id === activeCollectionId,
    );
    if (!isRecent || revealedActiveIdentity.current === activeIdentity) return;
    revealedActiveIdentity.current = activeIdentity;
    setDisclosures((current) => ({ ...current, quickAccess: true }));
  }, [activeCollectionId, activeProjectPath, recentCollections]);

  const updateDisclosures = (updater: (current: DisclosureState) => DisclosureState) => {
    setDisclosures((current) => {
      const next = updater(current);
      rememberDisclosures(next);
      return next;
    });
  };

  const moveShortcutFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).filter((button) => !button.closest('[hidden]'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || !buttons.length) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  const isActiveCollection = (projectPath: string, collectionId: string) =>
    activeProjectPath === projectPath && activeCollectionId === collectionId;

  return (
    <aside
      className={`sidebar side-nav ${navigationOpen ? '' : 'sidebar-collapsed'}`}
      aria-label="Side navigation"
      hidden={!navigationOpen}
      onKeyDown={moveShortcutFocus}
    >
      <div className="sidebar-top">
        <IconButton
          className="sidebar-toggle"
          label="Hide navigation"
          onClick={() => onSetNavigationOpen(false)}
        >
          <PanelLeft size={16} aria-hidden="true" />
        </IconButton>
        <Logo />
      </div>
      <div className="side-nav-scroll">
        <nav className="side-nav-primary" aria-labelledby="library-navigation-heading">
          <h2 className="nav-label" id="library-navigation-heading">
            Library
          </h2>
          <div className="side-nav-projects-row">
            <button
              className={`nav-item ${view === 'projects' ? 'active' : ''}`}
              aria-current={view === 'projects' ? 'page' : undefined}
              title={
                navigationShortcuts?.projects ? `Projects (${navigationShortcuts.projects})` : 'Projects'
              }
              onClick={() => void onNavigate('projects')}
            >
              <Layers3 size={16} aria-hidden="true" />
              <span>Projects</span>
            </button>
            <IconButton label="New project" className="side-nav-new-project" onClick={onNewProject}>
              <Plus size={16} aria-hidden="true" />
            </IconButton>
          </div>
        </nav>

        <section className="side-nav-section" aria-labelledby="quick-access-heading">
          <div className="side-nav-section-heading">
            <h2 className="nav-label" id="quick-access-heading">
              Recent
            </h2>
            <button
              type="button"
              className="nav-disclosure"
              aria-label={`${disclosures.quickAccess ? 'Collapse' : 'Expand'} quick access`}
              aria-controls="quick-access-collections"
              aria-expanded={disclosures.quickAccess}
              onClick={() =>
                updateDisclosures((current) => ({ ...current, quickAccess: !current.quickAccess }))
              }
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          <div id="quick-access-collections" className="side-nav-list" hidden={!disclosures.quickAccess}>
            {recentCollections.length ? (
              <>
                {recentCollections.map((collection) => (
                  <button
                    type="button"
                    className={`side-nav-collection ${
                      isActiveCollection(collection.projectPath, collection.id) ? 'active' : ''
                    }`}
                    key={`${collection.projectPath}:${collection.id}`}
                    aria-current={
                      isActiveCollection(collection.projectPath, collection.id) ? 'location' : undefined
                    }
                    title={collectionDisplayName(
                      collection.name,
                      collection.projectPath,
                      collection.otherCollectionNames,
                    )}
                    onClick={() => void onOpenCollection(collection.projectPath, collection.id)}
                  >
                    <span className="side-nav-collection-name">
                      {collectionDisplayName(
                        collection.name,
                        collection.projectPath,
                        collection.otherCollectionNames,
                      )}
                    </span>
                    <small>
                      {collection.projectName} · {relativeOpenedTime(collection.openedAt)}
                    </small>
                  </button>
                ))}
              </>
            ) : (
              <p className="side-nav-empty">No recently opened collections.</p>
            )}
            <button
              type="button"
              className="side-nav-view-all"
              aria-current={view === 'recent' ? 'page' : undefined}
              title={navigationShortcuts?.recent ? `Recent (${navigationShortcuts.recent})` : 'Recent'}
              onClick={() => void onNavigate('recent')}
            >
              View all recent
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
      <nav className="side-nav-footer" aria-label="Workspace">
        <IconButton
          data-testid="settings-button"
          className={`side-nav-footer-button ${view === 'settings' ? 'active' : ''}`}
          label="Settings"
          title={navigationShortcuts?.settings ? `Settings (${navigationShortcuts.settings})` : 'Settings'}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => void onNavigate('settings')}
        >
          <Settings2 size={16} aria-hidden="true" />
        </IconButton>
        <IconButton className="side-nav-footer-button" label="About" onClick={onAbout}>
          <Info size={16} aria-hidden="true" />
        </IconButton>
        {updateControl}
      </nav>
    </aside>
  );
}
