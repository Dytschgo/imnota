import {
  ChevronDown,
  ChevronRight,
  Clock,
  Heart,
  Info,
  Archive,
  Layers3,
  PanelLeft,
  Plus,
  Settings2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectListItem } from '../../shared/types';
import { Logo } from '../components/Logo';
import { ProjectIcon } from '../components/ProjectIcon';
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
  favourites: boolean;
  projects: Record<string, boolean>;
}

export interface SideNavProps {
  activeCollectionId: string;
  activeProjectPath?: string;
  navigationOpen: boolean;
  projects: ProjectListItem[];
  recentCollections: RecentCollectionHistory[];
  navigationShortcuts?: Partial<Record<'projects' | 'recent' | 'favourites' | 'archived', string>>;
  view: AppView;
  onAbout(): void;
  onNavigate(view: AppView): void | Promise<void>;
  onNewProject(): void;
  onOpenCollection(projectPath: string, collectionId: string): void | Promise<void>;
  onSetNavigationOpen(open: boolean): void;
  onSelectProject?(projectPath: string): void | Promise<void>;
}

const disclosureKey = 'imnota:sidenav-disclosures';

function getStoredDisclosures(): DisclosureState {
  try {
    const stored = localStorage.getItem(disclosureKey);
    if (!stored) return { quickAccess: true, favourites: true, projects: {} };
    const value = JSON.parse(stored) as Partial<DisclosureState>;
    const projects: Record<string, boolean> = {};
    if (value.projects && typeof value.projects === 'object' && !Array.isArray(value.projects)) {
      for (const [projectPath, expanded] of Object.entries(value.projects)) {
        if (typeof expanded === 'boolean') projects[projectPath] = expanded;
      }
    }
    return {
      quickAccess: typeof value.quickAccess === 'boolean' ? value.quickAccess : true,
      favourites: typeof value.favourites === 'boolean' ? value.favourites : true,
      projects,
    };
  } catch {
    return { quickAccess: true, favourites: true, projects: {} };
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
  onSelectProject,
}: SideNavProps) {
  const [disclosures, setDisclosures] = useState<DisclosureState>(getStoredDisclosures);
  const recentCollections = useMemo(
    () => resolveRecentCollections(projects, recentHistory).slice(0, 6),
    [projects, recentHistory],
  );
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== 'archived'),
    [projects],
  );
  const favouriteProjects = useMemo(
    () => activeProjects.filter((project) => project.favourite),
    [activeProjects],
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
    const favouriteProject = favouriteProjects.find((project) => project.projectPath === activeProjectPath);
    if ((!isRecent && !favouriteProject) || revealedActiveIdentity.current === activeIdentity) return;
    revealedActiveIdentity.current = activeIdentity;
    setDisclosures((current) => ({
      ...current,
      quickAccess: current.quickAccess || isRecent,
      favourites: current.favourites || Boolean(favouriteProject),
      projects: favouriteProject
        ? { ...current.projects, [favouriteProject.projectPath]: true }
        : current.projects,
    }));
  }, [activeCollectionId, activeProjectPath, favouriteProjects, recentCollections]);

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
          <button
            className={`nav-item ${view === 'recent' ? 'active' : ''}`}
            aria-current={view === 'recent' ? 'page' : undefined}
            title={navigationShortcuts?.recent ? `Recent (${navigationShortcuts.recent})` : 'Recent'}
            onClick={() => void onNavigate('recent')}
          >
            <Clock size={16} aria-hidden="true" />
            <span>Recent</span>
          </button>
          <button
            className={`nav-item ${view === 'archived' ? 'active' : ''}`}
            aria-current={view === 'archived' ? 'page' : undefined}
            title={navigationShortcuts?.archived ? `Archived (${navigationShortcuts.archived})` : 'Archived'}
            onClick={() => void onNavigate('archived')}
          >
            <Archive size={16} aria-hidden="true" />
            <span>Archived</span>
          </button>
          <button
            className={`nav-item ${view === 'favourites' ? 'active' : ''}`}
            aria-current={view === 'favourites' ? 'page' : undefined}
            title={
              navigationShortcuts?.favourites
                ? `Favourites (${navigationShortcuts.favourites})`
                : 'Favourites'
            }
            onClick={() => void onNavigate('favourites')}
          >
            <Heart size={16} aria-hidden="true" />
            <span>Favourites</span>
            {favouriteProjects.length > 0 && <span className="nav-count">{favouriteProjects.length}</span>}
          </button>
        </nav>

        <section className="side-nav-section" aria-labelledby="quick-access-heading">
          <div className="side-nav-section-heading">
            <h2 className="nav-label" id="quick-access-heading">
              Quick access
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
                    title={`${collection.projectName} / ${collection.name}`}
                    onClick={() => void onOpenCollection(collection.projectPath, collection.id)}
                  >
                    <span className="side-nav-collection-name">{collection.name}</span>
                    <small>
                      {collection.projectName} · {relativeOpenedTime(collection.openedAt)}
                    </small>
                  </button>
                ))}
                <button type="button" className="side-nav-view-all" onClick={() => void onNavigate('recent')}>
                  View all recent
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </>
            ) : (
              <p className="side-nav-empty">No recently opened collections.</p>
            )}
          </div>
        </section>

        <section className="side-nav-section" aria-labelledby="favourite-projects-heading">
          <div className="side-nav-section-heading">
            <h2 className="nav-label" id="favourite-projects-heading">
              Favourite projects{favouriteProjects.length ? ` (${favouriteProjects.length})` : ''}
            </h2>
            <button
              type="button"
              className="nav-disclosure"
              aria-label={`${disclosures.favourites ? 'Collapse' : 'Expand'} favourite projects`}
              aria-controls="favourite-projects"
              aria-expanded={disclosures.favourites}
              onClick={() =>
                updateDisclosures((current) => ({ ...current, favourites: !current.favourites }))
              }
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          <div
            id="favourite-projects"
            className="side-nav-list side-nav-favourites"
            hidden={!disclosures.favourites}
          >
            {favouriteProjects.length ? (
              <>
                {favouriteProjects.map((project) => {
                  const openCollections = project.collections.filter((collection) => !collection.archived);
                  const openCollection = openCollections[0];
                  const isProjectExpanded = disclosures.projects[project.projectPath] !== false;
                  const projectIsActive = activeProjectPath === project.projectPath;
                  return (
                    <div
                      className={`side-nav-project ${projectIsActive ? 'active-project' : ''}`}
                      key={project.projectPath}
                    >
                      <div className="side-nav-project-row">
                        <button
                          type="button"
                          className="side-nav-project-button"
                          title={project.name}
                          disabled={!onSelectProject && !openCollection}
                          onClick={() => {
                            if (onSelectProject) void onSelectProject(project.projectPath);
                            else if (openCollection)
                              void onOpenCollection(project.projectPath, openCollection.id);
                          }}
                        >
                          <ProjectIcon icon={project.icon} size={15} />
                          <span>{project.name}</span>
                        </button>
                        {openCollections.length > 0 && (
                          <button
                            type="button"
                            className="nav-disclosure"
                            aria-label={`${isProjectExpanded ? 'Collapse' : 'Expand'} ${project.name} collections`}
                            aria-controls={`favourite-project-${project.id}`}
                            aria-expanded={isProjectExpanded}
                            onClick={() =>
                              updateDisclosures((current) => ({
                                ...current,
                                projects: {
                                  ...current.projects,
                                  [project.projectPath]: !isProjectExpanded,
                                },
                              }))
                            }
                          >
                            <ChevronDown size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      {openCollections.length > 0 ? (
                        <div
                          id={`favourite-project-${project.id}`}
                          className="side-nav-project-collections"
                          hidden={!isProjectExpanded}
                        >
                          {openCollections.map((collection) => (
                            <button
                              type="button"
                              className={`side-nav-collection ${
                                isActiveCollection(project.projectPath, collection.id) ? 'active' : ''
                              }`}
                              key={collection.id}
                              aria-current={
                                isActiveCollection(project.projectPath, collection.id)
                                  ? 'location'
                                  : undefined
                              }
                              title={`${project.name} / ${collection.name}`}
                              onClick={() => void onOpenCollection(project.projectPath, collection.id)}
                            >
                              <span className="side-nav-collection-name">{collection.name}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="side-nav-empty side-nav-empty-collections">No active collections.</p>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="side-nav-view-all"
                  onClick={() => void onNavigate('favourites')}
                >
                  View all favourites
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </>
            ) : (
              <p className="side-nav-empty">No favourite projects yet.</p>
            )}
          </div>
        </section>
      </div>
      <nav className="side-nav-footer" aria-labelledby="workspace-navigation-heading">
        <h2 className="nav-label" id="workspace-navigation-heading">
          Workspace
        </h2>
        <button
          data-testid="settings-button"
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => void onNavigate('settings')}
        >
          <Settings2 size={16} aria-hidden="true" />
          <span>Settings</span>
        </button>
        <div className="sidebar-footer">
          <button className="nav-item" aria-label="About" title="About" onClick={onAbout}>
            <Info size={16} aria-hidden="true" />
            <span>About</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
