import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ContentItem } from '../src/shared/content-items.js';
import type { ProjectData } from '../src/shared/types.js';
import { contentItemSchema, validateProject } from '../src/shared/schema.js';
import { nowIso } from '../src/shared/utils.js';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';
import { contentItemRelativePaths } from './content-paths.js';

const UNDO_ROOT = '.imnota-content-undo';
const MAX_PROJECT_BYTES = 20_000_000;
const MAX_CONTENT_BYTES = 100_000_000;
const MAX_MANIFEST_BYTES = 1_000_000;
const TOKEN_PATTERN = /^content-delete-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHASES = ['prepared', 'trashing', 'deleted', 'undoing', 'restored'] as const;
type TrashPhase = (typeof PHASES)[number];

interface StoredBytes {
  present: boolean;
  size: number;
  sha256: string | null;
  blob: string | null;
}

interface ContentBackup {
  relativePath: string;
  bytes: StoredBytes;
}

interface ContentTrashManifest {
  version: 1;
  token: string;
  phase: TrashPhase;
  item: ContentItem;
  deletedAt: string;
  content: ContentBackup[];
  metadataBefore: StoredBytes;
  metadataDeleted: StoredBytes;
  undoBefore?: StoredBytes;
  undoAfter?: StoredBytes;
}

export interface ContentTrashOperations {
  write: typeof atomicWrite;
  removeDirectory: (target: string) => Promise<void>;
  unlink?: (target: string) => Promise<void>;
}

interface ResolvedOperations extends ContentTrashOperations {
  unlink: (target: string) => Promise<void>;
}

export interface ContentTrashRecoveryResult {
  undoToken: string;
  itemId: string;
  status: 'baseline-restored' | 'deletion-committed' | 'undo-committed';
  undoAvailable: boolean;
  warning?: string;
}

export class ContentTrashError extends Error {
  constructor(
    public readonly code:
      | 'invalid-project'
      | 'invalid-token'
      | 'invalid-manifest'
      | 'baseline-changed'
      | 'delete-failed'
      | 'undo-failed'
      | 'rollback-failed',
    message: string,
    public readonly undoToken?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ContentTrashError';
  }
}

const defaultOperations: ResolvedOperations = {
  write: atomicWrite,
  removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
  unlink: (target) => fs.unlink(target),
};

function operationsWithDefaults(operations?: ContentTrashOperations): ResolvedOperations {
  return operations
    ? { ...operations, unlink: operations.unlink ?? defaultOperations.unlink }
    : defaultOperations;
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function strictToken(value: string): string {
  if (!TOKEN_PATTERN.test(value)) throw new ContentTrashError('invalid-token', 'Invalid content Undo token.');
  return value;
}

async function projectRoot(projectPath: string): Promise<string> {
  const root = path.resolve(projectPath);
  if (root === path.parse(root).root)
    throw new ContentTrashError('invalid-project', 'A filesystem root cannot be a project.');
  await assertNoLinks(root);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory())
    throw new ContentTrashError('invalid-project', 'The project directory is unavailable.');
  return root;
}

function undoRoot(projectPath: string): string {
  return path.join(projectPath, UNDO_ROOT);
}

function undoDirectory(projectPath: string, token: string): string {
  const parent = undoRoot(projectPath);
  const target = path.resolve(parent, strictToken(token));
  if (target === parent || !isWithin(parent, target))
    throw new ContentTrashError('invalid-token', 'Invalid content Undo token.');
  return target;
}

function relativePaths(item: ContentItem): string[] {
  const paths = contentItemRelativePaths(item);
  return item.kind === 'drawing' ? [paths.source!, paths.image!] : [paths.markdown!];
}

function resolveRelative(projectPath: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.includes(':') ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new ContentTrashError('invalid-manifest', 'Content Undo contains an unsafe path.');
  const target = path.resolve(projectPath, ...relativePath.split('/'));
  if (target === path.resolve(projectPath) || !isWithin(projectPath, target))
    throw new ContentTrashError('invalid-manifest', 'Content Undo path leaves the project.');
  return target;
}

function storedBytes(blob: string | null, value: Uint8Array | null): StoredBytes {
  return value === null
    ? { present: false, size: 0, sha256: null, blob: null }
    : { present: true, size: value.byteLength, sha256: digest(value), blob };
}

function isStoredBytes(value: unknown): value is StoredBytes {
  if (!value || typeof value !== 'object') return false;
  const stored = value as Record<string, unknown>;
  if (stored.present === false) return stored.size === 0 && stored.sha256 === null && stored.blob === null;
  return (
    stored.present === true &&
    Number.isSafeInteger(stored.size) &&
    (stored.size as number) >= 0 &&
    typeof stored.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(stored.sha256) &&
    typeof stored.blob === 'string' &&
    /^(content-[0-9]{4}|metadata-before|metadata-deleted|undo-before|undo-after)\.bin$/.test(stored.blob)
  );
}

function parseManifest(value: unknown, token: string): ContentTrashManifest {
  if (!value || typeof value !== 'object')
    throw new ContentTrashError('invalid-manifest', 'Content Undo manifest is invalid.', token);
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    input.token !== token ||
    !PHASES.includes(input.phase as TrashPhase) ||
    typeof input.deletedAt !== 'string' ||
    !Array.isArray(input.content) ||
    !isStoredBytes(input.metadataBefore) ||
    !isStoredBytes(input.metadataDeleted) ||
    (input.undoBefore !== undefined && !isStoredBytes(input.undoBefore)) ||
    (input.undoAfter !== undefined && !isStoredBytes(input.undoAfter))
  )
    throw new ContentTrashError('invalid-manifest', 'Content Undo manifest failed validation.', token);
  const item = contentItemSchema.parse(input.item);
  const expected = relativePaths(item);
  const rawContent = input.content as Array<Record<string, unknown>>;
  if (
    rawContent.length !== expected.length ||
    rawContent.some((entry, index) => entry.relativePath !== expected[index] || !isStoredBytes(entry.bytes))
  )
    throw new ContentTrashError('invalid-manifest', 'Content Undo paths failed validation.', token);
  const blobs = [
    ...rawContent.map((entry) => (entry.bytes as StoredBytes).blob),
    input.metadataBefore.blob,
    input.metadataDeleted.blob,
    (input.undoBefore as StoredBytes | undefined)?.blob,
    (input.undoAfter as StoredBytes | undefined)?.blob,
  ].filter((blob): blob is string => Boolean(blob));
  if (new Set(blobs).size !== blobs.length)
    throw new ContentTrashError('invalid-manifest', 'Content Undo reuses a backup blob.', token);
  return {
    version: 1,
    token,
    phase: input.phase as TrashPhase,
    item,
    deletedAt: input.deletedAt,
    content: rawContent as unknown as ContentBackup[],
    metadataBefore: input.metadataBefore,
    metadataDeleted: input.metadataDeleted,
    undoBefore: input.undoBefore as StoredBytes | undefined,
    undoAfter: input.undoAfter as StoredBytes | undefined,
  };
}

async function readOptional(target: string, maximum = MAX_CONTENT_BYTES): Promise<Buffer | null> {
  await assertNoLinks(target);
  const stat = await fs.stat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile()) throw new ContentTrashError('invalid-manifest', 'Expected a regular Undo file.');
  if (stat.size > maximum) throw new ContentTrashError('invalid-manifest', 'Undo file exceeds size limits.');
  const value = await fs.readFile(target);
  if (value.byteLength > maximum)
    throw new ContentTrashError('invalid-manifest', 'Undo file exceeds size limits.');
  return value;
}

async function backupBytes(directory: string, stored: StoredBytes): Promise<Buffer | null> {
  if (!stored.present) return null;
  if (stored.size > MAX_CONTENT_BYTES)
    throw new ContentTrashError('invalid-manifest', 'Content Undo backup exceeds size limits.');
  const target = path.join(directory, stored.blob!);
  await assertNoLinks(target);
  const value = await fs.readFile(target);
  if (value.byteLength !== stored.size || digest(value) !== stored.sha256)
    throw new ContentTrashError('invalid-manifest', 'Content Undo backup failed integrity validation.');
  return value;
}

function equalBytes(left: Buffer | null, right: Buffer | null): boolean {
  return left === null ? right === null : right !== null && left.equals(right);
}

async function classify(target: string, directory: string, expected: StoredBytes): Promise<boolean> {
  return equalBytes(await readOptional(target), await backupBytes(directory, expected));
}

async function writeProtected(
  target: string,
  value: string | Uint8Array,
  operations: ResolvedOperations,
): Promise<void> {
  await assertNoLinks(target);
  await operations.write(target, value);
  await assertNoLinks(target);
}

async function applyStored(
  target: string,
  directory: string,
  stored: StoredBytes,
  operations: ResolvedOperations,
): Promise<void> {
  const value = await backupBytes(directory, stored);
  await assertNoLinks(target);
  if (value === null) {
    await operations.unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  } else await operations.write(target, value);
  await assertNoLinks(target);
}

async function writeManifest(
  directory: string,
  manifest: ContentTrashManifest,
  operations: ResolvedOperations,
): Promise<void> {
  await writeProtected(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), operations);
}

async function setPhase(
  directory: string,
  manifest: ContentTrashManifest,
  phase: TrashPhase,
  operations: ResolvedOperations,
): Promise<ContentTrashManifest> {
  const next = { ...manifest, phase };
  await writeManifest(directory, next, operations);
  return next;
}

async function loadManifest(
  projectPath: string,
  token: string,
): Promise<{ directory: string; manifest: ContentTrashManifest }> {
  const directory = undoDirectory(projectPath, token);
  await assertNoLinks(directory);
  const source = await readOptional(path.join(directory, 'manifest.json'), MAX_MANIFEST_BYTES);
  if (!source) throw new ContentTrashError('invalid-manifest', 'Content Undo manifest is missing.', token);
  return { directory, manifest: parseManifest(JSON.parse(source.toString('utf8')), token) };
}

function normalizeWithout(project: ProjectData, item: ContentItem): ProjectData {
  if (project.schemaVersion !== 4)
    throw new ContentTrashError('invalid-project', 'Content requires schema 4.');
  const ordered = [
    ...project.screenshots.filter((entry) => entry.collectionId === item.collectionId),
    ...(project.contentItems ?? []).filter(
      (entry) => entry.collectionId === item.collectionId && entry.id !== item.id,
    ),
  ]
    .sort(
      (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    .map((entry, position) => ({ ...entry, position }));
  const positions = new Map(ordered.map((entry) => [entry.id, entry.position]));
  return validateProject({
    ...project,
    updatedAt: nowIso(),
    screenshots: project.screenshots.map((entry) =>
      entry.collectionId === item.collectionId ? { ...entry, position: positions.get(entry.id)! } : entry,
    ),
    contentItems: (project.contentItems ?? [])
      .filter((entry) => entry.id !== item.id)
      .map((entry) =>
        entry.collectionId === item.collectionId ? { ...entry, position: positions.get(entry.id)! } : entry,
      ),
  });
}

function normalizeWith(project: ProjectData, item: ContentItem, token: string): ProjectData {
  if (project.schemaVersion !== 4)
    throw new ContentTrashError('invalid-project', 'Content requires schema 4.');
  if (
    project.screenshots.some((entry) => entry.id === item.id) ||
    (project.contentItems ?? []).some((entry) => entry.id === item.id)
  )
    throw new ContentTrashError('undo-failed', 'This content item has already been restored.', token);
  if (!project.collections.some((entry) => entry.id === item.collectionId))
    throw new ContentTrashError('undo-failed', 'The content collection no longer exists.', token);
  const occupied = new Set(
    (project.contentItems ?? []).flatMap((entry) => relativePaths(entry).map((value) => value.toLowerCase())),
  );
  if (relativePaths(item).some((value) => occupied.has(value.toLowerCase())))
    throw new ContentTrashError('baseline-changed', 'A later item owns a path required by Undo.', token);
  const ordered = [
    ...project.screenshots.filter((entry) => entry.collectionId === item.collectionId),
    ...(project.contentItems ?? []).filter((entry) => entry.collectionId === item.collectionId),
  ].sort(
    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  ordered.splice(Math.min(item.position, ordered.length), 0, item);
  const positions = new Map(ordered.map((entry, position) => [entry.id, position]));
  return validateProject({
    ...project,
    updatedAt: nowIso(),
    screenshots: project.screenshots.map((entry) =>
      entry.collectionId === item.collectionId ? { ...entry, position: positions.get(entry.id)! } : entry,
    ),
    contentItems: [...(project.contentItems ?? []), item].map((entry) =>
      entry.collectionId === item.collectionId ? { ...entry, position: positions.get(entry.id)! } : entry,
    ),
  });
}

async function clean(directory: string, operations: ResolvedOperations): Promise<void> {
  await assertNoLinks(directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (
    entries.some(
      (entry) =>
        !entry.isFile() ||
        !/^(manifest\.json|content-[0-9]{4}\.bin|metadata-before\.bin|metadata-deleted\.bin|undo-before\.bin|undo-after\.bin)$/.test(
          entry.name,
        ),
    )
  )
    throw new ContentTrashError('invalid-manifest', 'Content Undo journal contains an unknown path.');
  await operations.removeDirectory(directory);
}

async function restoreContent(
  projectPath: string,
  directory: string,
  manifest: ContentTrashManifest,
  operations: ResolvedOperations,
): Promise<void> {
  for (const entry of manifest.content) {
    const target = resolveRelative(projectPath, entry.relativePath);
    const current = await readOptional(target);
    const backup = await backupBytes(directory, entry.bytes);
    if (equalBytes(current, backup)) continue;
    if (current !== null)
      throw new ContentTrashError(
        'baseline-changed',
        `${entry.relativePath} is occupied by different bytes.`,
      );
    await applyStored(target, directory, entry.bytes, operations);
    if (!(await classify(target, directory, entry.bytes)))
      throw new ContentTrashError('rollback-failed', `${entry.relativePath} did not restore byte-exactly.`);
  }
}

async function removeOwnContent(
  projectPath: string,
  directory: string,
  manifest: ContentTrashManifest,
  operations: ResolvedOperations,
): Promise<void> {
  for (const entry of manifest.content) {
    const target = resolveRelative(projectPath, entry.relativePath);
    const current = await readOptional(target);
    if (current === null) continue;
    const backup = await backupBytes(directory, entry.bytes);
    if (!equalBytes(current, backup))
      throw new ContentTrashError('baseline-changed', `${entry.relativePath} changed; it was preserved.`);
    await operations.unlink(target);
  }
}

async function stageDelete(
  projectPath: string,
  project: ProjectData,
  itemId: string,
  operations: ResolvedOperations,
): Promise<{ directory: string; manifest: ContentTrashManifest; deletedProject: ProjectData }> {
  validateProject(project);
  const metadataPath = path.join(projectPath, 'project.json');
  const metadataBefore = await readOptional(metadataPath, MAX_PROJECT_BYTES);
  if (!metadataBefore) throw new ContentTrashError('invalid-project', 'project.json is missing.');
  const diskProject = validateProject(JSON.parse(metadataBefore.toString('utf8')));
  if (diskProject.id !== project.id)
    throw new ContentTrashError('baseline-changed', 'The project changed before content deletion.');
  const item = (diskProject.contentItems ?? []).find((entry) => entry.id === itemId);
  if (!item) throw new ContentTrashError('delete-failed', 'Content item not found.');
  const paths = relativePaths(item);
  const values = await Promise.all(
    paths.map((entry) => readOptional(resolveRelative(projectPath, entry), MAX_CONTENT_BYTES)),
  );
  if (values.some((value) => value === null))
    throw new ContentTrashError('delete-failed', 'Content item files are incomplete.');
  const deletedProject = normalizeWithout(diskProject, item);
  const metadataDeleted = Buffer.from(JSON.stringify(deletedProject, null, 2));
  const token = `content-delete-${randomUUID()}`;
  const root = undoRoot(projectPath);
  await assertNoLinks(root);
  await fs.mkdir(root, { recursive: true });
  await assertNoLinks(root);
  const directory = undoDirectory(projectPath, token);
  await fs.mkdir(directory, { recursive: false });
  await assertNoLinks(directory);
  const content: ContentBackup[] = [];
  try {
    for (const [index, value] of values.entries()) {
      const blob = `content-${String(index).padStart(4, '0')}.bin`;
      await writeProtected(path.join(directory, blob), value!, operations);
      content.push({ relativePath: paths[index], bytes: storedBytes(blob, value) });
    }
    await writeProtected(path.join(directory, 'metadata-before.bin'), metadataBefore, operations);
    await writeProtected(path.join(directory, 'metadata-deleted.bin'), metadataDeleted, operations);
    const manifest: ContentTrashManifest = {
      version: 1,
      token,
      phase: 'prepared',
      item,
      deletedAt: nowIso(),
      content,
      metadataBefore: storedBytes('metadata-before.bin', metadataBefore),
      metadataDeleted: storedBytes('metadata-deleted.bin', metadataDeleted),
    };
    await writeManifest(directory, manifest, operations);
    return { directory, manifest, deletedProject };
  } catch (error) {
    await clean(directory, operations).catch(() => undefined);
    throw error;
  }
}

export async function deleteContentItemToTrash(
  projectPath: string,
  project: ProjectData,
  itemId: string,
  trashItem: (target: string) => Promise<void>,
  suppliedOperations?: ContentTrashOperations,
): Promise<{ project: ProjectData; undoToken: string; warning?: string }> {
  const root = await projectRoot(projectPath);
  const operations = operationsWithDefaults(suppliedOperations);
  const staged = await stageDelete(root, project, itemId, operations);
  let { manifest } = staged;
  const metadataPath = path.join(root, 'project.json');
  try {
    manifest = await setPhase(staged.directory, manifest, 'trashing', operations);
    for (const entry of manifest.content) {
      const target = resolveRelative(root, entry.relativePath);
      if (!(await classify(target, staged.directory, entry.bytes)))
        throw new ContentTrashError('baseline-changed', `${entry.relativePath} changed before trashing.`);
      await trashItem(target);
      if ((await readOptional(target)) !== null)
        throw new Error(`${entry.relativePath} remained after the trash operation.`);
    }
    if (!(await classify(metadataPath, staged.directory, manifest.metadataBefore)))
      throw new ContentTrashError('baseline-changed', 'project.json changed before content deletion.');
    await applyStored(metadataPath, staged.directory, manifest.metadataDeleted, operations);
    if (!(await classify(metadataPath, staged.directory, manifest.metadataDeleted)))
      throw new Error('project.json did not reach its deleted state.');
    try {
      manifest = await setPhase(staged.directory, manifest, 'deleted', operations);
      return { project: staged.deletedProject, undoToken: manifest.token };
    } catch (error) {
      return {
        project: staged.deletedProject,
        undoToken: manifest.token,
        warning: `Deletion committed, but content Undo recovery is pending: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    if (await classify(metadataPath, staged.directory, manifest.metadataDeleted))
      return {
        project: staged.deletedProject,
        undoToken: manifest.token,
        warning: `Deletion committed after a recoverable journal error: ${error instanceof Error ? error.message : String(error)}`,
      };
    try {
      if (!(await classify(metadataPath, staged.directory, manifest.metadataBefore)))
        throw new ContentTrashError(
          'baseline-changed',
          'project.json changed; content backups were preserved.',
        );
      await restoreContent(root, staged.directory, manifest, operations);
      await clean(staged.directory, operations);
    } catch (rollbackError) {
      throw new ContentTrashError(
        'rollback-failed',
        `Content deletion failed and recovery is incomplete: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        manifest.token,
        { cause: error },
      );
    }
    throw new ContentTrashError(
      error instanceof ContentTrashError ? error.code : 'delete-failed',
      `Content deletion failed; baseline files were restored: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      { cause: error },
    );
  }
}

export async function undoContentItemDelete(
  projectPath: string,
  project: ProjectData,
  token: string,
  suppliedOperations?: ContentTrashOperations,
): Promise<{ project: ProjectData; warning?: string }> {
  const root = await projectRoot(projectPath);
  const operations = operationsWithDefaults(suppliedOperations);
  const loaded = await loadManifest(root, token);
  let { manifest } = loaded;
  const metadataPath = path.join(root, 'project.json');
  const currentMetadata = await readOptional(metadataPath, MAX_PROJECT_BYTES);
  if (!currentMetadata) throw new ContentTrashError('invalid-project', 'project.json is missing.', token);
  const currentProject = validateProject(JSON.parse(currentMetadata.toString('utf8')));
  validateProject(project);
  if (currentProject.id !== project.id)
    throw new ContentTrashError('baseline-changed', 'Undo belongs to a different project.', token);
  if (manifest.undoAfter && (await classify(metadataPath, loaded.directory, manifest.undoAfter))) {
    await clean(loaded.directory, operations);
    return { project: validateProject(JSON.parse(currentMetadata.toString('utf8'))) };
  }
  if (manifest.phase === 'undoing') {
    if (!manifest.undoBefore || !manifest.undoAfter)
      throw new ContentTrashError('invalid-manifest', 'Content Undo is missing CAS images.', token);
    if (!(await classify(metadataPath, loaded.directory, manifest.undoBefore)))
      throw new ContentTrashError('baseline-changed', 'project.json changed during content Undo.', token);
    await removeOwnContent(root, loaded.directory, manifest, operations);
    manifest = await setPhase(loaded.directory, manifest, 'deleted', operations);
  }
  if (manifest.phase !== 'deleted')
    throw new ContentTrashError('undo-failed', 'Content deletion must be recovered before Undo.', token);
  const restoredProject = normalizeWith(currentProject, manifest.item, token);
  const undoAfter = Buffer.from(JSON.stringify(restoredProject, null, 2));
  const undoBeforeStored = storedBytes('undo-before.bin', currentMetadata);
  const undoAfterStored = storedBytes('undo-after.bin', undoAfter);
  await writeProtected(path.join(loaded.directory, 'undo-before.bin'), currentMetadata, operations);
  await writeProtected(path.join(loaded.directory, 'undo-after.bin'), undoAfter, operations);
  manifest = {
    ...manifest,
    phase: 'undoing',
    undoBefore: undoBeforeStored,
    undoAfter: undoAfterStored,
  };
  await writeManifest(loaded.directory, manifest, operations);
  try {
    await restoreContent(root, loaded.directory, manifest, operations);
    if (!(await classify(metadataPath, loaded.directory, undoBeforeStored)))
      throw new ContentTrashError(
        'baseline-changed',
        'project.json changed before content Undo commit.',
        token,
      );
    await applyStored(metadataPath, loaded.directory, undoAfterStored, operations);
    if (!(await classify(metadataPath, loaded.directory, undoAfterStored)))
      throw new Error('project.json did not reach its restored state.');
    try {
      await setPhase(loaded.directory, manifest, 'restored', operations);
      await clean(loaded.directory, operations);
      return { project: restoredProject };
    } catch (error) {
      return {
        project: restoredProject,
        warning: `Content restored, but Undo cleanup is pending: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    if (await classify(metadataPath, loaded.directory, undoAfterStored))
      return { project: restoredProject, warning: 'Content restored; Undo cleanup is pending.' };
    await removeOwnContent(root, loaded.directory, manifest, operations);
    await setPhase(loaded.directory, manifest, 'deleted', operations);
    throw new ContentTrashError(
      error instanceof ContentTrashError ? error.code : 'undo-failed',
      `Content Undo failed and remains retryable: ${error instanceof Error ? error.message : String(error)}`,
      token,
      { cause: error },
    );
  }
}

async function tokens(root: string): Promise<string[]> {
  await assertNoLinks(root);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !TOKEN_PATTERN.test(entry.name))
      throw new ContentTrashError('invalid-manifest', 'Content Undo directory contains an unknown path.');
    await assertNoLinks(path.join(root, entry.name));
    result.push(entry.name);
  }
  return result.sort();
}

export async function recoverContentTrashTransactions(
  projectPath: string,
  suppliedOperations?: ContentTrashOperations,
): Promise<ContentTrashRecoveryResult[]> {
  const project = await projectRoot(projectPath);
  const operations = operationsWithDefaults(suppliedOperations);
  const results: ContentTrashRecoveryResult[] = [];
  for (const token of await tokens(undoRoot(project))) {
    const loaded = await loadManifest(project, token);
    let { manifest } = loaded;
    const metadataPath = path.join(project, 'project.json');
    const metadata = await readOptional(metadataPath, MAX_PROJECT_BYTES);
    if (!metadata) throw new ContentTrashError('invalid-project', 'project.json is missing.', token);
    if (manifest.undoAfter && (await classify(metadataPath, loaded.directory, manifest.undoAfter))) {
      await restoreContent(project, loaded.directory, manifest, operations);
      await clean(loaded.directory, operations);
      results.push({
        undoToken: token,
        itemId: manifest.item.id,
        status: 'undo-committed',
        undoAvailable: false,
      });
      continue;
    }
    if (await classify(metadataPath, loaded.directory, manifest.metadataBefore)) {
      await restoreContent(project, loaded.directory, manifest, operations);
      await clean(loaded.directory, operations);
      results.push({
        undoToken: token,
        itemId: manifest.item.id,
        status: 'baseline-restored',
        undoAvailable: false,
      });
      continue;
    }
    const current = validateProject(JSON.parse(metadata.toString('utf8')));
    if (current.schemaVersion !== 4)
      throw new ContentTrashError('baseline-changed', 'Content Undo requires schema version 4.', token);
    if (
      current.id !==
      validateProject(
        JSON.parse((await backupBytes(loaded.directory, manifest.metadataBefore))!.toString('utf8')),
      ).id
    )
      throw new ContentTrashError('baseline-changed', 'Content Undo belongs to another project.', token);
    if ((current.contentItems ?? []).some((entry) => entry.id === manifest.item.id))
      throw new ContentTrashError(
        'baseline-changed',
        'Deleted content ID is occupied; backups were preserved.',
        token,
      );
    if (manifest.phase === 'undoing') {
      if (!manifest.undoBefore || !(await classify(metadataPath, loaded.directory, manifest.undoBefore)))
        throw new ContentTrashError('baseline-changed', 'Interrupted content Undo metadata changed.', token);
      await removeOwnContent(project, loaded.directory, manifest, operations);
      manifest = await setPhase(loaded.directory, manifest, 'deleted', operations);
    } else {
      await removeOwnContent(project, loaded.directory, manifest, operations);
      if (manifest.phase !== 'deleted')
        manifest = await setPhase(loaded.directory, manifest, 'deleted', operations);
    }
    results.push({
      undoToken: token,
      itemId: manifest.item.id,
      status: 'deletion-committed',
      undoAvailable: true,
    });
  }
  return results;
}
