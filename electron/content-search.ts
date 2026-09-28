import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectData } from '../src/shared/types.js';
import { parseProjectFile, type LegacyProjectData } from '../src/shared/schema.js';
import {
  searchContent,
  type ContentSearchDocument,
  type ContentSearchRequest,
  type ContentSearchResponse,
} from '../src/shared/content-search.js';
import { orderedCollectionItems } from '../src/shared/content-items.js';
import { contentItemRelativePaths } from './content-paths.js';
import { assertNoLinks, FileReadLimitError, isWithin, readStableRegularFile } from './files.js';

// Restore copies and template stages contain project.json but are not library projects.
// Match only reserved names; other hidden user project folders remain searchable.
const RESERVED_SEARCH_DIRECTORY = /^\.imnota-(?:restore-(?:rollback|stage)-[a-f0-9]{32}$|template-)/i;

export function isReservedProjectDirectory(name: string): boolean {
  return name.toLowerCase() === '.imnota-backups' || RESERVED_SEARCH_DIRECTORY.test(name);
}

/** Backup data and recovery copies are not editable workspace projects. */
export function isReservedProjectPath(projectPath: string): boolean {
  return path.resolve(projectPath).split(path.sep).some(isReservedProjectDirectory);
}

export const SEARCH_LIMITS = {
  textBytes: 2_000_000,
  projectBytes: 20_000_000,
  projects: 500,
  documents: 10_000,
  // UTF-16 code units, including labels/identity. At most ~32 MB retained text.
  characters: 16_000_000,
  results: 200,
};

/** Read only a regular, contained file. A growing file cannot expand the allocation. */
export async function readSearchText(projectPath: string, relativePath: string, maximum: number) {
  const target = path.resolve(projectPath, relativePath);
  if (target === path.resolve(projectPath) || !isWithin(projectPath, target))
    throw new Error('Search content path leaves the project.');
  try {
    const result = await readStableRegularFile(target, maximum);
    if (!result) throw Object.assign(new Error('Search file is missing.'), { code: 'ENOENT' as const });
    return result.text;
  } catch (error) {
    if (error instanceof FileReadLimitError) throw new Error('Search file exceeds the read limit.');
    if (error instanceof Error && /changed while it was/.test(error.message))
      throw new Error('Search file changed while it was read.');
    throw error;
  }
}

interface SearchIndex {
  documents: ContentSearchDocument[];
  warnings: string[];
}

interface SearchDependencies {
  readText: typeof readSearchText;
  limits: typeof SEARCH_LIMITS;
}

async function* projectSearchDocuments(
  projectPath: string,
  project: ProjectData | LegacyProjectData,
  readText: SearchDependencies['readText'],
  textLimit: number,
  unavailable: () => void,
  checkCurrent: () => void,
): AsyncGenerator<ContentSearchDocument> {
  const identity = {
    projectPath,
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    favourite: project.favourite,
  };
  yield {
    ...identity,
    kind: 'project',
    label: project.name,
    fields: { name: project.name, description: project.description },
  };
  if (project.schemaVersion === 1 || project.schemaVersion === 2) return;
  const current = project as ProjectData;
  const text = async (relativePath: string, fallback: string) => {
    checkCurrent();
    try {
      return await readText(projectPath, relativePath, textLimit);
    } catch {
      unavailable();
      return fallback;
    }
  };
  for (const collection of current.collections) {
    checkCurrent();
    const location = { ...identity, collectionId: collection.id, collectionName: collection.name };
    yield {
      ...location,
      kind: 'collection',
      label: collection.name,
      fields: { name: collection.name, context: collection.overallContext },
    };
    for (const item of orderedCollectionItems(current, collection.id)) {
      checkCurrent();
      if (item.kind === 'screenshot') {
        yield {
          ...location,
          itemId: item.id,
          kind: item.kind,
          label: item.title || item.originalFilename,
          fields: { title: item.title, description: await text(item.descriptionFile, item.description) },
        };
      } else if (item.kind === 'drawing') {
        yield {
          ...location,
          itemId: item.id,
          kind: item.kind,
          label: item.title,
          fields: { title: item.title },
        };
      } else {
        yield {
          ...location,
          itemId: item.id,
          kind: item.kind,
          label: item.preview || 'Text block',
          fields: { markdown: await text(contentItemRelativePaths(item).markdown!, item.preview ?? '') },
        };
      }
    }
  }
}

/** One bounded index and one scan at a time, shared across queries. Never migrates or writes files. */
export class WorkspaceContentSearch {
  private workspace = '';
  private generation = 0;
  private request = 0;
  private index?: SearchIndex;
  private scan?: Promise<void>;
  private readonly dependencies: SearchDependencies;

  constructor(dependencies: Partial<SearchDependencies> = {}) {
    this.dependencies = { readText: readSearchText, limits: SEARCH_LIMITS, ...dependencies };
  }

  invalidate(): void {
    this.generation += 1;
    this.index = undefined;
  }

  invalidatePath(target: string): void {
    if (this.workspace && isWithin(this.workspace, target)) this.invalidate();
  }

  async search(input: ContentSearchRequest): Promise<ContentSearchResponse> {
    const workspace = path.resolve(input.workspacePath);
    if (workspace !== this.workspace || input.refresh) {
      this.workspace = workspace;
      this.invalidate();
    }
    const request = ++this.request;
    const generation = this.generation;
    const checkCurrent = () => {
      if (generation !== this.generation || workspace !== this.workspace || request !== this.request)
        throw new Error('Search changed while loading. Retry to search the current workspace.');
    };
    if (!input.query.trim()) return { results: [], warnings: [], totalMatches: 0 };
    // A superseded scan finishes its current bounded read before the next scan starts.
    if (this.scan) await this.scan.catch(() => undefined);
    checkCurrent();
    if (!this.index) {
      const scan = this.build(workspace, generation).then((index) => {
        if (generation === this.generation && workspace === this.workspace) this.index = index;
      });
      this.scan = scan;
      try {
        await scan;
      } finally {
        if (this.scan === scan) this.scan = undefined;
      }
    }
    checkCurrent();
    if (!this.index) throw new Error('The search index changed. Retry to refresh it.');
    const scope = input.scope ?? 'active';
    const matches = searchContent(
      this.index.documents.filter(
        (document) => document.status === scope && (!input.favouritesOnly || document.favourite),
      ),
      input.query,
    );
    const warnings = [...this.index.warnings];
    if (matches.length > this.dependencies.limits.results)
      warnings.push(
        `Showing the first ${this.dependencies.limits.results} of ${matches.length} matches. Refine your search to see more.`,
      );
    return {
      results: matches.slice(0, this.dependencies.limits.results),
      warnings,
      totalMatches: matches.length,
    };
  }

  private async build(workspace: string, generation: number): Promise<SearchIndex> {
    await assertNoLinks(workspace);
    const checkCurrent = () => {
      if (this.generation !== generation || this.workspace !== workspace)
        throw new Error('Search workspace changed while indexing.');
    };
    const { readText, limits } = this.dependencies;
    const documents: ContentSearchDocument[] = [];
    const projectDates = new Map<string, string>();
    const warnings = new Set<string>();
    let unavailable = 0;
    let projects = 0;
    let characters = 0;
    const directory = await fs.opendir(workspace);
    scan: for await (const entry of directory) {
      checkCurrent();
      if (!entry.isDirectory() || isReservedProjectDirectory(entry.name)) continue;
      const projectPath = path.join(workspace, entry.name);
      const stat = await fs
        .lstat(path.join(projectPath, 'project.json'))
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') unavailable += 1;
          return null;
        });
      if (!stat) continue;
      let project: ProjectData | LegacyProjectData;
      try {
        project = parseProjectFile(
          JSON.parse(await readText(projectPath, 'project.json', limits.projectBytes)),
        );
      } catch {
        unavailable += 1;
        continue;
      }
      checkCurrent();
      // Non-project and malformed folders do not consume the project allowance.
      if (projects === limits.projects) {
        warnings.add(`Search is limited to ${limits.projects} projects in this workspace.`);
        break;
      }
      projects += 1;
      projectDates.set(projectPath, project.updatedAt);
      if (project.schemaVersion === 1 || project.schemaVersion === 2)
        warnings.add(
          'Older projects are searchable by name and description. Open them to enable content search.',
        );
      for await (const document of projectSearchDocuments(
        projectPath,
        project,
        readText,
        limits.textBytes,
        () => (unavailable += 1),
        checkCurrent,
      )) {
        checkCurrent();
        const size =
          Object.values(document).reduce(
            (sum: number, value) => sum + (typeof value === 'string' ? value.length : 0),
            0,
          ) + Object.values(document.fields).reduce((sum, value) => sum + value.length, 0);
        if (documents.length === limits.documents || characters + size > limits.characters) {
          warnings.add('Some content exceeds the search index limit and could not be included.');
          break scan;
        }
        characters += size;
        documents.push(document);
      }
    }
    checkCurrent();
    if (unavailable)
      warnings.add(
        `${unavailable} unavailable or oversized file${unavailable === 1 ? '' : 's'} could not be fully searched. Other results are available.`,
      );
    // Stable sort preserves collection/item order within each project.
    documents.sort(
      (a, b) =>
        (projectDates.get(b.projectPath) ?? '').localeCompare(projectDates.get(a.projectPath) ?? '') ||
        a.projectPath.localeCompare(b.projectPath),
    );
    return { documents, warnings: [...warnings] };
  }
}
