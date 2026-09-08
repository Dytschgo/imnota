import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { Annotation, ProjectData } from '../src/shared/types.js';
import type {
  ProjectSearchInput,
  ProjectSearchResponse,
  ProjectSearchResult,
  ProjectSearchResultKind,
  ProjectSearchTarget,
} from '../src/shared/project-search.js';
import { contentItemRelativePaths } from './content-paths.js';
import { isWithin } from './files.js';
import { validateProject } from '../src/shared/schema.js';

export const SEARCH_LIMITS = {
  projects: 200,
  entriesPerProject: 5_000,
  fileBytes: 2_000_000,
  metadataBytes: 8_000_000,
  totalBytes: 32_000_000,
  fileOperations: 10_000,
  cachedProjects: 100,
  cachedCharacters: 8_000_000,
  results: 100,
} as const;

interface SearchDocument extends ProjectSearchResult {
  searchable: string;
}

interface ProjectIndex {
  fingerprint: string;
  documents: SearchDocument[];
  truncated: boolean;
}

interface CacheEntry extends ProjectIndex {
  lastUsed: number;
  characters: number;
}

interface SearchBudget {
  remainingBytes: number;
  remainingFileOperations: number;
  truncated: boolean;
  skippedFiles: number;
  unreadableFiles: number;
}

export interface ProjectSearchDependencies {
  workspace(): string | null;
  authorizeProject(projectPath: string): Promise<string>;
  assertNoLinks(targetPath: string): Promise<void>;
  /** Test seams used to prove that path replacement between validation and open is rejected. */
  beforeFileOpen?(targetPath: string): Promise<void>;
  afterFileOpen?(targetPath: string): Promise<void>;
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function excerptFor(text: string, tokens: readonly string[]): string {
  const clean = cleanText(text);
  if (!clean) return '';
  const folded = normalized(clean);
  const positions = tokens.map((token) => folded.indexOf(token)).filter((position) => position >= 0);
  const match = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, match - 54);
  const end = Math.min(clean.length, start + 176);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

function resultId(kind: ProjectSearchResultKind, target: ProjectSearchTarget): string {
  return [kind, target.projectPath, target.collectionId, target.itemId, target.annotationId]
    .filter(Boolean)
    .join(':');
}

function document(
  kind: ProjectSearchResultKind,
  title: string,
  content: string,
  projectName: string,
  collectionName: string | undefined,
  target: ProjectSearchTarget,
): SearchDocument {
  const searchable = cleanText([title, content].filter(Boolean).join(' '));
  return {
    id: resultId(kind, target),
    kind,
    title,
    excerpt: cleanText(content || title),
    projectName,
    collectionName,
    target,
    searchable,
  };
}

function safeContentPath(projectPath: string, relative: string): string {
  const target = path.resolve(projectPath, relative);
  if (!isWithin(projectPath, target) || target === path.resolve(projectPath))
    throw new Error('Project content path escapes its project folder.');
  return target;
}

async function fileSignature(
  filePath: string,
  budget: SearchBudget,
  assertNoLinks: (target: string) => Promise<void>,
) {
  if (budget.remainingFileOperations <= 0) {
    budget.skippedFiles += 1;
    budget.truncated = true;
    return 'search-budget-exhausted';
  }
  budget.remainingFileOperations -= 1;
  await assertNoLinks(filePath);
  const stat = await fs.stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return stat?.isFile() ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : 'missing';
}

async function readBoundedText(
  filePath: string,
  budget: SearchBudget,
  dependencies: Pick<ProjectSearchDependencies, 'assertNoLinks' | 'beforeFileOpen' | 'afterFileOpen'>,
  maxBytes: number = SEARCH_LIMITS.fileBytes,
): Promise<string | null> {
  if (budget.remainingFileOperations <= 0) {
    budget.skippedFiles += 1;
    budget.truncated = true;
    return null;
  }
  budget.remainingFileOperations -= 1;
  await dependencies.assertNoLinks(filePath);
  await dependencies.beforeFileOpen?.(filePath);
  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  const handle = await fs
    .open(filePath, fsConstants.O_RDONLY | noFollow)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      budget.unreadableFiles += 1;
      budget.truncated = true;
      throw error;
    });
  if (!handle) return null;
  try {
    await dependencies.afterFileOpen?.(filePath);
    await dependencies.assertNoLinks(filePath);
    const stat = await handle.stat();
    const pathStat = await fs.lstat(filePath);
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
      budget.unreadableFiles += 1;
      budget.truncated = true;
      throw new Error('A project content path changed while it was opened.');
    }
    if (!stat.isFile() || stat.size > maxBytes || stat.size > budget.remainingBytes) {
      budget.skippedFiles += 1;
      budget.truncated = true;
      return null;
    }
    const bytes = new Uint8Array(stat.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > stat.size) {
      budget.skippedFiles += 1;
      budget.truncated = true;
      return null;
    }
    budget.remainingBytes -= bytesRead;
    const finalPathStat = await fs.lstat(filePath);
    const finalHandleStat = await handle.stat();
    if (
      stat.dev !== finalPathStat.dev ||
      stat.ino !== finalPathStat.ino ||
      stat.size !== finalHandleStat.size ||
      stat.mtimeMs !== finalHandleStat.mtimeMs ||
      stat.ctimeMs !== finalHandleStat.ctimeMs
    ) {
      budget.unreadableFiles += 1;
      budget.truncated = true;
      throw new Error('A project content path changed while it was read.');
    }
    return textDecoder.decode(bytes.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function annotationTexts(source: string): Array<Pick<Annotation, 'id' | 'text' | 'stepNumber'>> {
  try {
    const value: unknown = JSON.parse(source);
    if (!Array.isArray(value)) return [];
    return value.slice(0, SEARCH_LIMITS.entriesPerProject).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.id !== 'string' || candidate.id.length > 200) return [];
      const text = typeof candidate.text === 'string' ? candidate.text.slice(0, SEARCH_LIMITS.fileBytes) : '';
      const stepNumber =
        typeof candidate.stepNumber === 'number' && Number.isSafeInteger(candidate.stepNumber)
          ? candidate.stepNumber
          : undefined;
      return text || stepNumber ? [{ id: candidate.id, text, stepNumber }] : [];
    });
  } catch {
    return [];
  }
}

function drawingText(source: string): string {
  try {
    const root: unknown = JSON.parse(source);
    const values: string[] = [];
    const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
    let visited = 0;
    let characters = 0;
    while (stack.length && visited++ < 10_000 && characters < 100_000) {
      const current = stack.pop()!;
      if (current.depth > 12 || !current.value || typeof current.value !== 'object') continue;
      for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
        if ((key === 'text' || key === 'originalText') && typeof value === 'string') {
          const slice = value.slice(0, 10_000);
          values.push(slice);
          characters += slice.length;
        } else if (typeof value === 'object' && value) {
          stack.push({ value, depth: current.depth + 1 });
        }
      }
    }
    return cleanText(values.join(' '));
  } catch {
    return '';
  }
}

function score(document: SearchDocument, tokens: readonly string[], query: string): number {
  const title = normalized(document.title);
  const searchable = normalized(document.searchable);
  let value = document.kind === 'project' ? 20 : document.kind === 'collection' ? 10 : 0;
  if (title === query) value += 100;
  else if (title.startsWith(query)) value += 70;
  else if (title.includes(query)) value += 45;
  if (searchable.includes(query)) value += 30;
  for (const token of tokens) {
    if (title.includes(token)) value += 8;
    if (searchable.includes(token)) value += 2;
  }
  return value;
}

export class ProjectSearchService {
  private readonly cache = new Map<string, CacheEntry>();
  private cachedCharacters = 0;
  private searchGeneration = 0;

  constructor(private readonly dependencies: ProjectSearchDependencies) {}

  invalidateForPath(targetPath: string): void {
    for (const projectPath of this.cache.keys())
      if (isWithin(projectPath, targetPath)) this.deleteCached(projectPath);
  }

  clear(): void {
    this.cache.clear();
    this.cachedCharacters = 0;
  }

  async search(rawInput: ProjectSearchInput): Promise<ProjectSearchResponse> {
    const generation = ++this.searchGeneration;
    const query = cleanText(rawInput.query).slice(0, 200);
    const scope = rawInput.scope ?? 'active';
    const limit = Math.min(Math.max(rawInput.limit ?? 50, 1), SEARCH_LIMITS.results);
    if (!query) return { query, scope, results: [], truncated: false };
    const workspace = this.dependencies.workspace();
    if (!workspace) return { query, scope, results: [], truncated: false };

    const entries = await fs.readdir(workspace, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const budget: SearchBudget = {
      remainingBytes: SEARCH_LIMITS.totalBytes,
      remainingFileOperations: SEARCH_LIMITS.fileOperations,
      truncated: directories.length > SEARCH_LIMITS.projects,
      skippedFiles: 0,
      unreadableFiles: 0,
    };
    const indexes: ProjectIndex[] = [];
    for (const entry of directories.slice(0, SEARCH_LIMITS.projects)) {
      if (generation !== this.searchGeneration) {
        budget.truncated = true;
        break;
      }
      try {
        const projectPath = await this.dependencies.authorizeProject(path.join(workspace, entry.name));
        const projectSource = await readBoundedText(
          safeContentPath(projectPath, 'project.json'),
          budget,
          this.dependencies,
          SEARCH_LIMITS.metadataBytes,
        );
        if (!projectSource) continue;
        const project = validateProject(JSON.parse(projectSource));
        if ((scope === 'archived') !== (project.status === 'archived')) continue;
        indexes.push(await this.indexProject(projectPath, project, budget));
      } catch {
        // Corrupt and linked project folders remain available through the explicit Open flow.
        budget.unreadableFiles += 1;
        budget.truncated = true;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const foldedQuery = normalized(query);
    const tokens = foldedQuery.split(/\s+/).filter(Boolean).slice(0, 8);
    const matches = indexes
      .flatMap((index) => index.documents)
      .map((candidate) => ({ candidate, folded: normalized(candidate.searchable) }))
      .filter(({ folded }) => tokens.every((token) => folded.includes(token)))
      .map(({ candidate }) => ({ candidate, score: score(candidate, tokens, foldedQuery) }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.projectName.localeCompare(right.candidate.projectName) ||
          left.candidate.title.localeCompare(right.candidate.title),
      );
    return {
      query,
      scope,
      results: matches.slice(0, limit).map(({ candidate }) => {
        const { searchable: _searchable, ...result } = candidate;
        void _searchable;
        return { ...result, excerpt: excerptFor(candidate.excerpt, tokens) };
      }),
      truncated: budget.truncated || indexes.some((index) => index.truncated) || matches.length > limit,
      ...((budget.skippedFiles || budget.unreadableFiles) && {
        warnings: [
          `${budget.skippedFiles + budget.unreadableFiles} local ${budget.skippedFiles + budget.unreadableFiles === 1 ? 'file was' : 'files were'} skipped because they were unavailable or exceeded the search limits.`,
        ],
      }),
    };
  }

  private async indexProject(
    projectPath: string,
    project: ProjectData,
    budget: SearchBudget,
  ): Promise<ProjectIndex> {
    const contentPaths = ['project.json'];
    for (const shot of project.screenshots.slice(0, SEARCH_LIMITS.entriesPerProject))
      contentPaths.push(shot.descriptionFile, shot.annotationFile);
    for (const item of (project.contentItems ?? []).slice(0, SEARCH_LIMITS.entriesPerProject)) {
      const paths = contentItemRelativePaths(item);
      if (paths.markdown) contentPaths.push(paths.markdown);
      if (paths.source) contentPaths.push(paths.source);
    }
    const limitedPaths = contentPaths.slice(0, SEARCH_LIMITS.entriesPerProject + 1);
    const signatures: string[] = [];
    for (let offset = 0; offset < limitedPaths.length; offset += 32) {
      signatures.push(
        ...(await Promise.all(
          limitedPaths.slice(offset, offset + 32).map(async (relative) => {
            const target = safeContentPath(projectPath, relative);
            return `${relative}:${await fileSignature(target, budget, this.dependencies.assertNoLinks)}`;
          }),
        )),
      );
    }
    const fingerprint = signatures.join('|');
    const cached = this.cache.get(projectPath);
    if (cached?.fingerprint === fingerprint) {
      cached.lastUsed = Date.now();
      return cached;
    }

    const skippedBefore = budget.skippedFiles + budget.unreadableFiles;
    const collections = new Map(project.collections.map((collection) => [collection.id, collection]));
    const documents: SearchDocument[] = [
      document('project', project.name, project.description, project.name, undefined, { projectPath }),
    ];
    for (const collection of project.collections.slice(0, SEARCH_LIMITS.entriesPerProject))
      documents.push(
        document('collection', collection.name, collection.overallContext, project.name, collection.name, {
          projectPath,
          collectionId: collection.id,
        }),
      );

    let entriesRead = project.collections.length;
    for (const shot of project.screenshots) {
      if (entriesRead++ >= SEARCH_LIMITS.entriesPerProject) {
        budget.truncated = true;
        break;
      }
      const collectionName = collections.get(shot.collectionId)?.name;
      const description =
        (await readBoundedText(
          safeContentPath(projectPath, shot.descriptionFile),
          budget,
          this.dependencies,
        )) ?? shot.description;
      documents.push(
        document(
          'screenshot',
          shot.title || shot.originalFilename,
          description,
          project.name,
          collectionName,
          {
            projectPath,
            collectionId: shot.collectionId,
            itemId: shot.id,
          },
        ),
      );
      const annotationSource = await readBoundedText(
        safeContentPath(projectPath, shot.annotationFile),
        budget,
        this.dependencies,
      );
      if (annotationSource)
        for (const annotation of annotationTexts(annotationSource)) {
          if (entriesRead++ >= SEARCH_LIMITS.entriesPerProject) {
            budget.truncated = true;
            break;
          }
          const annotationText = cleanText(
            [annotation.text, annotation.stepNumber ? `Step ${annotation.stepNumber}` : '']
              .filter(Boolean)
              .join(' '),
          );
          documents.push(
            document('annotation', shot.title || 'Annotation', annotationText, project.name, collectionName, {
              projectPath,
              collectionId: shot.collectionId,
              itemId: shot.id,
              annotationId: annotation.id,
            }),
          );
        }
    }

    for (const item of project.contentItems ?? []) {
      if (entriesRead++ >= SEARCH_LIMITS.entriesPerProject) {
        budget.truncated = true;
        break;
      }
      const collectionName = collections.get(item.collectionId)?.name;
      const relative = contentItemRelativePaths(item);
      const source = relative.markdown ?? relative.source;
      const raw = source
        ? await readBoundedText(safeContentPath(projectPath, source), budget, this.dependencies)
        : null;
      const content = item.kind === 'drawing' ? drawingText(raw ?? '') : (raw ?? item.preview ?? '');
      const title = item.kind === 'drawing' ? item.title || 'Drawing' : item.preview || 'Text block';
      documents.push(
        document(item.kind, title, content, project.name, collectionName, {
          projectPath,
          collectionId: item.collectionId,
          itemId: item.id,
        }),
      );
    }
    const index: CacheEntry = {
      fingerprint,
      documents,
      truncated:
        project.screenshots.length + (project.contentItems?.length ?? 0) > SEARCH_LIMITS.entriesPerProject ||
        contentPaths.length > limitedPaths.length ||
        entriesRead > SEARCH_LIMITS.entriesPerProject,
      lastUsed: Date.now(),
      characters: documents.reduce((total, item) => total + item.searchable.length + item.excerpt.length, 0),
    };
    // A file skipped because the current search exhausted its byte budget gets another chance later.
    if (
      budget.skippedFiles + budget.unreadableFiles === skippedBefore &&
      index.characters <= SEARCH_LIMITS.cachedCharacters
    ) {
      this.deleteCached(projectPath);
      this.cache.set(projectPath, index);
      this.cachedCharacters += index.characters;
    }
    while (
      this.cache.size > SEARCH_LIMITS.cachedProjects ||
      this.cachedCharacters > SEARCH_LIMITS.cachedCharacters
    ) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]?.[0];
      if (!oldest) break;
      this.deleteCached(oldest);
    }
    return index;
  }

  private deleteCached(projectPath: string): void {
    const cached = this.cache.get(projectPath);
    if (!cached) return;
    this.cachedCharacters -= cached.characters;
    this.cache.delete(projectPath);
  }
}
