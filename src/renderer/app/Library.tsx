import { Archive, ArchiveRestore, FolderOpen, Heart, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { ContentSearchResult } from '../../shared/content-search';
import { collectionDisplayName } from '../collection/collection-display-name';
import { ProjectIcon } from '../components/ProjectIcon';
import { Button, EmptyState, IconButton } from '../components/ui';
import { relativeOpenedTime, resolveRecentCollections } from '../navigation-history';
import { ContentSearchResults } from '../search/ContentSearchResults';
import { useAppStore } from '../store';

export function Library({
  onOpenCollection,
  onNew,
  onOpen,
  onSelect,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  onSearch,
  onBrowseProjects,
  onFilter,
  onSelectContentResult,
}: {
  onOpenCollection(projectPath: string, collectionId: string): void | Promise<void>;
  onNew(): void;
  onOpen(): void;
  onSelect(projectPath: string): void;
  onEdit(projectPath: string): void;
  onArchive(projectPath: string): void;
  onRestore(projectPath: string): void;
  onDelete(projectPath: string): void;
  onSearch(): void | Promise<void>;
  onBrowseProjects(): void | Promise<void>;
  /** Switch between the project filters, which are separate navigation views. */
  onFilter(view: 'projects' | 'favourites' | 'archived'): void | Promise<void>;
  onSelectContentResult(result: ContentSearchResult): void;
}) {
  const { projects, search, set, view, settings, recentCollections } = useAppStore();
  const recent = resolveRecentCollections(projects, recentCollections).filter((entry) =>
    `${entry.name} ${entry.projectName}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const normalizedQuery = search.trim();
  const filtered = projects.filter((project) => {
    if (view === 'archived') return project.status === 'archived';
    return project.status !== 'archived' && (view !== 'favourites' || project.favourite);
  });
  // Archived collections inside active projects; an archived project already lists as a whole.
  const archivedCollections =
    view === 'archived'
      ? projects.flatMap((project) =>
          project.status === 'archived'
            ? []
            : project.collections
                .filter((collection) => collection.archived)
                .map((collection) => ({ project, collection })),
        )
      : [];
  return (
    <section className="library">
      <div className="library-heading">
        <div>
          <h1>
            {view === 'favourites'
              ? 'Favourite projects'
              : view === 'recent'
                ? 'Recent collections'
                : view === 'archived'
                  ? 'Archived'
                  : 'Projects'}
          </h1>
          <p>
            {projects.length} local project{projects.length === 1 ? '' : 's'} · {settings.workspacePath}
          </p>
        </div>
        <div className="library-actions">
          <Button variant="ghost" onClick={onOpen}>
            <FolderOpen size={16} aria-hidden="true" />
            Open project
          </Button>
          <Button variant="primary" onClick={onNew}>
            <Plus size={16} aria-hidden="true" />
            New project
          </Button>
        </div>
      </div>
      {view !== 'recent' && (
        <div className="library-filter" role="group" aria-label="Show projects">
          {(
            [
              ['projects', 'All'],
              ['favourites', 'Favourites'],
              ['archived', 'Archived'],
            ] as const
          ).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              aria-pressed={view === filter}
              onClick={() => void onFilter(filter)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {view === 'recent' ? (
        <div className="search-line">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Filter recent collections"
            placeholder="Filter recent collections and projects"
            value={search}
            onChange={(event) => set({ search: event.target.value })}
          />
          {search && (
            <button className="search-clear" type="button" onClick={() => set({ search: '' })}>
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            className="search-line library-search-trigger"
            type="button"
            data-testid="library-full-search"
            onClick={() => void onSearch()}
          >
            <Search size={16} aria-hidden="true" />
            <span>Search workspace</span>
          </button>
          <div className="search-line">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search projects"
              placeholder="Filter projects and local content"
              maxLength={500}
              value={search}
              onChange={(event) => set({ search: event.target.value })}
            />
            {search && (
              <button className="search-clear" type="button" onClick={() => set({ search: '' })}>
                Clear search
              </button>
            )}
          </div>
        </>
      )}
      {view === 'recent' ? (
        recent.length ? (
          <div className="project-list">
            {recent.map((entry) => (
              <button
                className="project-row"
                key={`${entry.projectPath}:${entry.id}`}
                onClick={() => void onOpenCollection(entry.projectPath, entry.id)}
                title={collectionDisplayName(entry.name, entry.projectPath, entry.otherCollectionNames)}
              >
                <div className="project-symbol">
                  <ProjectIcon icon={entry.icon} />
                </div>
                <div className="project-row-copy">
                  <strong>
                    {collectionDisplayName(entry.name, entry.projectPath, entry.otherCollectionNames)}
                  </strong>
                  <span>{entry.projectName}</span>
                  <small>{relativeOpenedTime(entry.openedAt)}</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FolderOpen size={22} aria-hidden="true" />}
            title={search ? 'No matching collections' : 'No recent collections yet'}
            description={
              search
                ? 'Try another collection or project name.'
                : 'Open a project or collection to find it here next time.'
            }
            action={
              !search ? <Button onClick={() => void onBrowseProjects()}>Browse projects</Button> : undefined
            }
          />
        )
      ) : normalizedQuery && settings.workspacePath ? (
        <ContentSearchResults
          query={normalizedQuery}
          workspacePath={settings.workspacePath}
          projects={projects}
          favouritesOnly={view === 'favourites'}
          scope={view === 'archived' ? 'archived' : 'active'}
          onSelect={onSelectContentResult}
        />
      ) : filtered.length || archivedCollections.length ? (
        <>
          {view === 'archived' && filtered.length > 0 && (
            <h2 id="archived-projects-heading">Archived projects</h2>
          )}
          {filtered.length > 0 && (
            <div
              className="project-list"
              aria-labelledby={view === 'archived' ? 'archived-projects-heading' : undefined}
            >
              {filtered.map((project) => (
                <div className="project-row" key={project.id}>
                  <button className="project-row-main" onClick={() => onSelect(project.projectPath)}>
                    <div className="project-symbol">
                      <ProjectIcon icon={project.icon} />
                    </div>
                    <div className="project-row-copy">
                      <strong>{project.name}</strong>
                      <span>{project.description || 'No description yet'}</span>
                      <small>
                        {project.screenshots.length} screenshot{project.screenshots.length === 1 ? '' : 's'} ·
                        edited {new Date(project.updatedAt).toLocaleDateString()}
                      </small>
                    </div>
                    <div className="project-row-meta">
                      {project.favourite && <Heart size={15} fill="currentColor" aria-hidden="true" />}
                    </div>
                  </button>
                  <div className="project-row-actions">
                    <IconButton
                      data-testid={`project-edit-${project.id}`}
                      label={`Edit ${project.name}`}
                      onClick={() => onEdit(project.projectPath)}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </IconButton>
                    {project.status === 'archived' ? (
                      <IconButton
                        data-testid={`project-restore-${project.id}`}
                        label={`Restore ${project.name}`}
                        onClick={() => onRestore(project.projectPath)}
                      >
                        <ArchiveRestore size={15} aria-hidden="true" />
                      </IconButton>
                    ) : (
                      <IconButton
                        data-testid={`project-archive-${project.id}`}
                        label={`Archive ${project.name}`}
                        onClick={() => onArchive(project.projectPath)}
                      >
                        <Archive size={15} aria-hidden="true" />
                      </IconButton>
                    )}
                    <IconButton
                      data-testid={`project-delete-${project.id}`}
                      className="project-row-delete"
                      label={`Delete ${project.name}`}
                      onClick={() => onDelete(project.projectPath)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
          {archivedCollections.length > 0 && (
            <>
              <h2 id="archived-collections-heading">Archived collections</h2>
              <div className="project-list" aria-labelledby="archived-collections-heading">
                {archivedCollections.map(({ project, collection }) => (
                  <button
                    className="project-row"
                    key={`${project.projectPath}:${collection.id}`}
                    data-testid={`archived-collection-${project.id}-${collection.id}`}
                    onClick={() => void onOpenCollection(project.projectPath, collection.id)}
                  >
                    <div className="project-symbol">
                      <ProjectIcon icon={project.icon} />
                    </div>
                    <div className="project-row-copy">
                      <strong>{collection.name}</strong>
                      <span>{project.name}</span>
                      <small>
                        archived collection · edited {new Date(collection.updatedAt).toLocaleDateString()}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <EmptyState
          icon={<FolderOpen size={22} aria-hidden="true" />}
          title={
            view === 'favourites'
              ? 'No favourite projects yet'
              : view === 'archived'
                ? 'No archived projects or collections'
                : 'Your project library is empty'
          }
          description={
            view === 'favourites'
              ? 'Open a project and use the heart button to keep it here.'
              : view === 'archived'
                ? 'Archived projects and collections stay here until you restore them.'
                : 'Create a local project, then add the screenshots that explain the work.'
          }
          action={
            view !== 'favourites' && view !== 'archived' ? (
              <Button variant="primary" onClick={onNew}>
                <Plus size={16} aria-hidden="true" />
                Create first project
              </Button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
