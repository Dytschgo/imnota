import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { screenshotSchema, validateProject } from '../src/shared/schema.js';
import { nowIso } from '../src/shared/utils.js';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';

const UNDO_ROOT = '.imnota-undo';
const TOKEN_PATTERN = /^delete-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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

interface TrashManifest {
  version: 2;
  token: string;
  phase: TrashPhase;
  screenshot: ScreenshotRecord;
  deletedAt: string;
  content: ContentBackup[];
  metadataBefore: StoredBytes;
  metadataDeleted: StoredBytes;
  undoBefore?: StoredBytes;
  undoAfter?: StoredBytes;
}

export interface ScreenshotTrashOperations {
  write: typeof atomicWrite;
  removeDirectory: (target: string) => Promise<void>;
  unlink?: (target: string) => Promise<void>;
}

interface ResolvedTrashOperations extends ScreenshotTrashOperations {
  unlink: (target: string) => Promise<void>;
}

export interface ScreenshotTrashSummary {
  undoToken: string;
  screenshotId: string;
  phase: TrashPhase;
  deletedAt: string;
}

export interface DeleteScreenshotResult {
  project: ProjectData;
  undoToken: string;
  warning?: string;
}

export interface UndoScreenshotResult {
  project: ProjectData;
  cleanup: 'complete' | 'pending';
  warning?: string;
}

export interface ScreenshotTrashRecoveryResult {
  undoToken: string;
  screenshotId: string;
  status: 'baseline-restored' | 'deletion-committed' | 'undo-committed';
  undoAvailable: boolean;
  cleanup?: 'complete' | 'pending';
  warning?: string;
}

export class ScreenshotTrashError extends Error {
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
    this.name = 'ScreenshotTrashError';
  }
}

const defaultOperations: ResolvedTrashOperations = {
  write: atomicWrite,
  removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
  unlink: (target) => fs.unlink(target),
};

function operationsWithDefaults(operations: ScreenshotTrashOperations): ResolvedTrashOperations {
  return { ...operations, unlink: operations.unlink ?? defaultOperations.unlink };
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function strictToken(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new ScreenshotTrashError('invalid-token', 'Invalid Undo token.');
  return token;
}

async function projectRoot(projectPath: string): Promise<string> {
  const root = path.resolve(projectPath);
  if (root === path.parse(root).root)
    throw new ScreenshotTrashError('invalid-project', 'A filesystem root cannot be a project.');
  await assertNoLinks(root);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory())
    throw new ScreenshotTrashError('invalid-project', 'The project directory is unavailable.');
  return root;
}

function undoRoot(projectPath: string): string {
  return path.join(projectPath, UNDO_ROOT);
}

function undoDirectory(projectPath: string, token: string): string {
  const root = undoRoot(projectPath);
  const target = path.resolve(root, strictToken(token));
  if (!isWithin(root, target) || target === root)
    throw new ScreenshotTrashError('invalid-token', 'Invalid Undo token.');
  return target;
}

function expectedScreenshotPaths(screenshot: ScreenshotRecord): {
  image: string;
  annotations: string;
  description: string;
} {
  const base = `collections/${screenshot.collectionId}`;
  const expected = {
    image: `${base}/screenshots/${screenshot.storedFilename}`,
    annotations: `${base}/annotations/${screenshot.storedFilename}.json`,
    description: `${base}/descriptions/${screenshot.storedFilename}.md`,
  };
  if (
    screenshot.annotationFile !== expected.annotations ||
    screenshot.descriptionFile !== expected.description
  )
    throw new ScreenshotTrashError(
      'invalid-manifest',
      'Undo manifest contains mismatched screenshot paths. Recovery files were kept.',
    );
  return expected;
}

function resolveRelative(projectPath: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.includes(':') ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new ScreenshotTrashError('invalid-manifest', 'Undo manifest contains an unsafe path.');
  const target = path.resolve(projectPath, ...relativePath.split('/'));
  if (!isWithin(projectPath, target) || target === projectPath)
    throw new ScreenshotTrashError('invalid-manifest', 'Undo manifest path leaves the project.');
  return target;
}

function storedBytes(blob: string | null, value: Uint8Array | null): StoredBytes {
  return value === null
    ? { present: false, size: 0, sha256: null, blob: null }
    : { present: true, size: value.byteLength, sha256: sha256(value), blob };
}

function isStoredBytes(value: unknown): value is StoredBytes {
  if (!value || typeof value !== 'object') return false;
  const bytes = value as Record<string, unknown>;
  if (bytes.present === false) return bytes.size === 0 && bytes.sha256 === null && bytes.blob === null;
  return (
    bytes.present === true &&
    Number.isSafeInteger(bytes.size) &&
    (bytes.size as number) >= 0 &&
    typeof bytes.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(bytes.sha256) &&
    typeof bytes.blob === 'string' &&
    /^(image|annotations|description|metadata-before|metadata-deleted|undo-before|undo-after)\.bin$/.test(
      bytes.blob,
    )
  );
}

function parseManifest(value: unknown, expectedToken: string): TrashManifest {
  if (!value || typeof value !== 'object')
    throw new ScreenshotTrashError('invalid-manifest', 'Undo manifest is invalid.', expectedToken);
  const input = value as Record<string, unknown>;
  if (
    input.version !== 2 ||
    input.token !== expectedToken ||
    !PHASES.includes(input.phase as TrashPhase) ||
    typeof input.deletedAt !== 'string' ||
    !Array.isArray(input.content) ||
    input.content.length !== 3 ||
    !isStoredBytes(input.metadataBefore) ||
    !isStoredBytes(input.metadataDeleted) ||
    (input.undoBefore !== undefined && !isStoredBytes(input.undoBefore)) ||
    (input.undoAfter !== undefined && !isStoredBytes(input.undoAfter))
  )
    throw new ScreenshotTrashError('invalid-manifest', 'Undo manifest failed validation.', expectedToken);
  const screenshot = screenshotSchema.parse(input.screenshot);
  const expectedPaths = Object.values(expectedScreenshotPaths(screenshot));
  const content = input.content as Array<Record<string, unknown>>;
  if (
    content.some((entry, index) => entry.relativePath !== expectedPaths[index] || !isStoredBytes(entry.bytes))
  )
    throw new ScreenshotTrashError(
      'invalid-manifest',
      'Undo manifest content paths failed validation.',
      expectedToken,
    );
  const blobNames = [
    ...content.map((entry) => (entry.bytes as StoredBytes).blob),
    input.metadataBefore.blob,
    input.metadataDeleted.blob,
    (input.undoBefore as StoredBytes | undefined)?.blob,
    (input.undoAfter as StoredBytes | undefined)?.blob,
  ].filter((blob): blob is string => Boolean(blob));
  if (new Set(blobNames).size !== blobNames.length)
    throw new ScreenshotTrashError('invalid-manifest', 'Undo manifest reuses a backup blob.', expectedToken);
  return {
    version: 2,
    token: expectedToken,
    phase: input.phase as TrashPhase,
    screenshot,
    deletedAt: input.deletedAt,
    content: content as unknown as ContentBackup[],
    metadataBefore: input.metadataBefore,
    metadataDeleted: input.metadataDeleted,
    undoBefore: input.undoBefore as StoredBytes | undefined,
    undoAfter: input.undoAfter as StoredBytes | undefined,
  };
}

async function readOptional(target: string): Promise<Buffer | null> {
  await assertNoLinks(target);
  return fs.readFile(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function backupBytes(directory: string, stored: StoredBytes): Promise<Buffer | null> {
  if (!stored.present) return null;
  const target = path.join(directory, stored.blob!);
  await assertNoLinks(target);
  const value = await fs.readFile(target);
  if (value.byteLength !== stored.size || sha256(value) !== stored.sha256)
    throw new ScreenshotTrashError('invalid-manifest', 'Undo backup failed integrity validation.');
  return value;
}

function equalBytes(left: Buffer | null, right: Buffer | null): boolean {
  return left === null ? right === null : right !== null && left.equals(right);
}

async function classify(
  target: string,
  directory: string,
  expected: StoredBytes,
): Promise<'expected' | 'other'> {
  return equalBytes(await readOptional(target), await backupBytes(directory, expected))
    ? 'expected'
    : 'other';
}

async function writeProtected(
  target: string,
  content: string | Uint8Array,
  operations: ResolvedTrashOperations,
): Promise<void> {
  await assertNoLinks(target);
  await operations.write(target, content);
  await assertNoLinks(target);
}

async function loadManifest(
  projectPath: string,
  token: string,
): Promise<{ directory: string; manifest: TrashManifest }> {
  const directory = undoDirectory(projectPath, token);
  await assertNoLinks(directory);
  const source = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8');
  return { directory, manifest: parseManifest(JSON.parse(source), token) };
}

async function writeManifest(
  directory: string,
  manifest: TrashManifest,
  operations: ResolvedTrashOperations,
): Promise<void> {
  await writeProtected(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), operations);
}

async function setPhase(
  directory: string,
  manifest: TrashManifest,
  phase: TrashPhase,
  operations: ResolvedTrashOperations,
): Promise<TrashManifest> {
  const next = { ...manifest, phase };
  await writeManifest(directory, next, operations);
  return next;
}

function parseCurrentProject(value: Buffer, token: string): ProjectData {
  try {
    return validateProject(JSON.parse(value.toString('utf8')));
  } catch (error) {
    throw new ScreenshotTrashError(
      'baseline-changed',
      'Current project.json is invalid; Undo preserved all backups.',
      token,
      { cause: error },
    );
  }
}

function withoutScreenshot(project: ProjectData, screenshot: ScreenshotRecord): ProjectData {
  const collectionShots = project.screenshots
    .filter((item) => item.collectionId === screenshot.collectionId && item.id !== screenshot.id)
    .sort((a, b) => a.position - b.position)
    .map((item, position) => ({ ...item, position }));
  let cursor = 0;
  return validateProject({
    ...project,
    updatedAt: nowIso(),
    screenshots: project.screenshots
      .filter((item) => item.id !== screenshot.id)
      .map((item) => (item.collectionId === screenshot.collectionId ? collectionShots[cursor++] : item)),
  });
}

function withScreenshot(project: ProjectData, screenshot: ScreenshotRecord, token: string): ProjectData {
  if (project.screenshots.some((item) => item.id === screenshot.id))
    throw new ScreenshotTrashError('undo-failed', 'This screenshot has already been restored.', token);
  if (!project.collections.some((collection) => collection.id === screenshot.collectionId))
    throw new ScreenshotTrashError('undo-failed', 'The screenshot collection no longer exists.', token);
  const restoredPaths = expectedScreenshotPaths(screenshot);
  if (
    project.screenshots.some(
      (item) =>
        item.collectionId === screenshot.collectionId &&
        (item.storedFilename === screenshot.storedFilename ||
          item.annotationFile === restoredPaths.annotations ||
          item.descriptionFile === restoredPaths.description),
    )
  )
    throw new ScreenshotTrashError(
      'baseline-changed',
      'A later screenshot already owns one of the paths required by Undo.',
      token,
    );
  const collectionShots = project.screenshots
    .filter((item) => item.collectionId === screenshot.collectionId)
    .sort((a, b) => a.position - b.position);
  collectionShots.splice(Math.min(screenshot.position, collectionShots.length), 0, screenshot);
  const normalized = collectionShots.map((item, position) => ({ ...item, position }));
  const normalizedById = new Map(normalized.map((item) => [item.id, item]));
  return validateProject({
    ...project,
    updatedAt: nowIso(),
    screenshots: [...project.screenshots, screenshot].map((item) => normalizedById.get(item.id) ?? item),
  });
}

async function applyStored(
  target: string,
  directory: string,
  stored: StoredBytes,
  operations: ResolvedTrashOperations,
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

async function restoreDeleteBaseline(
  projectPath: string,
  directory: string,
  manifest: TrashManifest,
  operations: ResolvedTrashOperations,
): Promise<void> {
  const failures: string[] = [];
  for (const item of manifest.content) {
    const target = resolveRelative(projectPath, item.relativePath);
    try {
      const current = await readOptional(target);
      const expected = await backupBytes(directory, item.bytes);
      if (equalBytes(current, expected)) continue;
      if (current !== null) {
        failures.push(`${item.relativePath} is occupied by different bytes`);
        continue;
      }
      await applyStored(target, directory, item.bytes, operations);
      if ((await classify(target, directory, item.bytes)) !== 'expected')
        failures.push(`${item.relativePath} did not restore byte-exactly`);
    } catch (error) {
      failures.push(`${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length)
    throw new ScreenshotTrashError(
      failures.some((failure) => failure.includes('occupied')) ? 'baseline-changed' : 'rollback-failed',
      `Screenshot delete recovery needs attention: ${failures.join('; ')}`,
      manifest.token,
    );
}

async function ensureReferencedContent(
  projectPath: string,
  directory: string,
  manifest: TrashManifest,
  operations: ResolvedTrashOperations,
): Promise<void> {
  const failures: string[] = [];
  for (const item of manifest.content) {
    const target = resolveRelative(projectPath, item.relativePath);
    try {
      if ((await readOptional(target)) !== null) continue;
      await applyStored(target, directory, item.bytes, operations);
      if ((await classify(target, directory, item.bytes)) !== 'expected')
        failures.push(`${item.relativePath} did not restore byte-exactly`);
    } catch (error) {
      failures.push(`${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length)
    throw new ScreenshotTrashError(
      'rollback-failed',
      `Screenshot delete recovery needs attention: ${failures.join('; ')}`,
      manifest.token,
    );
}

async function restoreDeletedState(
  projectPath: string,
  directory: string,
  manifest: TrashManifest,
  operations: ResolvedTrashOperations,
): Promise<void> {
  const failures: string[] = [];
  for (const item of manifest.content) {
    const target = resolveRelative(projectPath, item.relativePath);
    try {
      const current = await readOptional(target);
      if (current === null) continue;
      const expected = await backupBytes(directory, item.bytes);
      if (!equalBytes(current, expected)) {
        // Different bytes are not ours. Preserve them; the original operation
        // still surfaces the collision to the caller.
        continue;
      }
      await assertNoLinks(target);
      await operations.unlink(target);
    } catch (error) {
      failures.push(`${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length)
    throw new ScreenshotTrashError(
      'rollback-failed',
      `Screenshot Undo rollback needs attention: ${failures.join('; ')}`,
      manifest.token,
    );
}

function expectedJournalFiles(manifest: TrashManifest): Set<string> {
  const expected = new Set(['manifest.json']);
  for (const stored of [
    ...manifest.content.map((item) => item.bytes),
    manifest.metadataBefore,
    manifest.metadataDeleted,
    manifest.undoBefore,
    manifest.undoAfter,
  ])
    if (stored?.blob) expected.add(stored.blob);
  return expected;
}

async function cleanupUndo(
  directory: string,
  manifest: TrashManifest,
  operations: ResolvedTrashOperations,
): Promise<void> {
  await assertNoLinks(directory);
  const expected = expectedJournalFiles(manifest);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !expected.has(entry.name))
      throw new ScreenshotTrashError(
        'invalid-manifest',
        'Undo cleanup stopped because the journal contains an unknown path.',
        manifest.token,
      );
    await assertNoLinks(path.join(directory, entry.name));
  }
  await operations.removeDirectory(directory);
}

async function cleanupIncompleteUndo(
  directory: string,
  operations: ResolvedTrashOperations,
): Promise<boolean> {
  await assertNoLinks(directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.name === 'manifest.json')) return false;
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !/^(image|annotations|description|metadata-before|metadata-deleted)\.bin$/.test(entry.name)
    )
      throw new ScreenshotTrashError(
        'invalid-manifest',
        'Incomplete Undo cleanup stopped at an unknown path.',
        path.basename(directory),
      );
    await assertNoLinks(path.join(directory, entry.name));
  }
  await operations.removeDirectory(directory);
  return true;
}

async function finishUndo(
  directory: string,
  manifest: TrashManifest,
  project: ProjectData,
  operations: ResolvedTrashOperations,
): Promise<UndoScreenshotResult> {
  let finalManifest = manifest;
  try {
    if (manifest.phase !== 'restored')
      finalManifest = await setPhase(directory, manifest, 'restored', operations);
  } catch {
    // The undoAfter metadata image is the commit point and is checked during recovery.
  }
  try {
    await cleanupUndo(directory, finalManifest, operations);
    return { project, cleanup: 'complete' };
  } catch (error) {
    return {
      project,
      cleanup: 'pending',
      warning: `Screenshot restored, but Undo journal cleanup is pending: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function stageDelete(
  projectPath: string,
  project: ProjectData,
  screenshotId: string,
  operations: ResolvedTrashOperations,
): Promise<{ directory: string; manifest: TrashManifest; deletedProject: ProjectData }> {
  validateProject(project);
  const metadataPath = path.join(projectPath, 'project.json');
  const metadataBefore = await readOptional(metadataPath);
  if (metadataBefore === null) throw new ScreenshotTrashError('invalid-project', 'project.json is missing.');
  const diskProject = validateProject(JSON.parse(metadataBefore.toString('utf8')));
  if (diskProject.id !== project.id)
    throw new ScreenshotTrashError('baseline-changed', 'The project changed before screenshot deletion.');
  const screenshot = diskProject.screenshots.find((item) => item.id === screenshotId);
  if (!screenshot) throw new ScreenshotTrashError('delete-failed', 'Screenshot not found.');
  const relative = expectedScreenshotPaths(screenshot);
  const contentValues = await Promise.all(
    Object.values(relative).map((item) => readOptional(resolveRelative(projectPath, item))),
  );
  if (contentValues[0] === null)
    throw new ScreenshotTrashError('delete-failed', 'The screenshot image is missing.');
  const deletedProject = withoutScreenshot(diskProject, screenshot);
  const metadataDeleted = Buffer.from(JSON.stringify(deletedProject, null, 2));
  const token = `delete-${randomUUID()}`;
  const root = undoRoot(projectPath);
  await assertNoLinks(root);
  await fs.mkdir(root, { recursive: true });
  await assertNoLinks(root);
  const directory = undoDirectory(projectPath, token);
  const names = ['image.bin', 'annotations.bin', 'description.bin'];
  const content: ContentBackup[] = [];
  let manifest: TrashManifest;
  let directoryCreated = false;
  try {
    await assertNoLinks(directory);
    await fs.mkdir(directory, { recursive: false });
    directoryCreated = true;
    await assertNoLinks(directory);

    for (const [index, value] of contentValues.entries()) {
      if (value) await writeProtected(path.join(directory, names[index]), value, operations);
      content.push({
        relativePath: Object.values(relative)[index],
        bytes: storedBytes(value ? names[index] : null, value),
      });
    }
    await writeProtected(path.join(directory, 'metadata-before.bin'), metadataBefore, operations);
    await writeProtected(path.join(directory, 'metadata-deleted.bin'), metadataDeleted, operations);
    manifest = {
      version: 2,
      token,
      phase: 'prepared',
      screenshot,
      deletedAt: nowIso(),
      content,
      metadataBefore: storedBytes('metadata-before.bin', metadataBefore),
      metadataDeleted: storedBytes('metadata-deleted.bin', metadataDeleted),
    };
    await writeManifest(directory, manifest, operations);
  } catch (error) {
    if (!directoryCreated) throw error;
    try {
      await cleanupIncompleteUndo(directory, operations);
    } catch (cleanupError) {
      throw new ScreenshotTrashError(
        'rollback-failed',
        `Undo staging failed and its incomplete journal could not be cleaned: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        token,
        { cause: error },
      );
    }
    throw error;
  }
  return { directory, manifest, deletedProject };
}

export async function deleteScreenshotToTrash(
  projectPath: string,
  project: ProjectData,
  screenshotId: string,
  trashItem: (target: string) => Promise<void>,
  suppliedOperations: ScreenshotTrashOperations = defaultOperations,
): Promise<DeleteScreenshotResult> {
  const root = await projectRoot(projectPath);
  const operations = operationsWithDefaults(suppliedOperations);
  const staged = await stageDelete(root, project, screenshotId, operations);
  let { manifest } = staged;
  const { directory, deletedProject } = staged;
  const metadataPath = path.join(root, 'project.json');
  try {
    manifest = await setPhase(directory, manifest, 'trashing', operations);
    for (const item of manifest.content) {
      const target = resolveRelative(root, item.relativePath);
      const current = await readOptional(target);
      if (current === null) continue;
      const backup = await backupBytes(directory, item.bytes);
      if (!equalBytes(current, backup))
        throw new ScreenshotTrashError(
          'baseline-changed',
          `${item.relativePath} changed before trashing; original backup was preserved.`,
          manifest.token,
        );
      await assertNoLinks(target);
      await trashItem(target);
      if ((await readOptional(target)) !== null)
        throw new Error(`${item.relativePath} remained after the trash operation.`);
    }
    if ((await classify(metadataPath, directory, manifest.metadataBefore)) !== 'expected')
      throw new ScreenshotTrashError(
        'baseline-changed',
        'project.json changed before the delete commit point; backup was preserved.',
        manifest.token,
      );
    await applyStored(metadataPath, directory, manifest.metadataDeleted, operations);
    if ((await classify(metadataPath, directory, manifest.metadataDeleted)) !== 'expected')
      throw new Error('project.json did not reach its deleted state.');
    try {
      manifest = await setPhase(directory, manifest, 'deleted', operations);
      return { project: deletedProject, undoToken: manifest.token };
    } catch (error) {
      return {
        project: deletedProject,
        undoToken: manifest.token,
        warning: `Deletion committed, but the Undo journal needs recovery: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    if ((await classify(metadataPath, directory, manifest.metadataDeleted)) === 'expected') {
      try {
        manifest = await setPhase(directory, manifest, 'deleted', operations);
      } catch {
        // The exact deleted metadata is still a recoverable commit point.
      }
      return {
        project: deletedProject,
        undoToken: manifest.token,
        warning: `Deletion committed after a recoverable journal error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    try {
      if ((await classify(metadataPath, directory, manifest.metadataBefore)) !== 'expected')
        throw new ScreenshotTrashError(
          'baseline-changed',
          'project.json changed externally; delete recovery did not overwrite it.',
          manifest.token,
        );
      await restoreDeleteBaseline(root, directory, manifest, operations);
      manifest = await setPhase(directory, manifest, 'prepared', operations);
      await cleanupUndo(directory, manifest, operations);
    } catch (rollbackError) {
      throw new ScreenshotTrashError(
        'rollback-failed',
        `Screenshot deletion failed and recovery is incomplete: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        manifest.token,
        { cause: error },
      );
    }
    if (error instanceof ScreenshotTrashError)
      throw new ScreenshotTrashError(error.code, error.message, undefined, { cause: error });
    throw new ScreenshotTrashError(
      'delete-failed',
      `Screenshot deletion failed; baseline files were restored: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      { cause: error },
    );
  }
}

export async function undoScreenshotDelete(
  projectPath: string,
  project: ProjectData,
  token: string,
  suppliedOperations: ScreenshotTrashOperations = defaultOperations,
): Promise<UndoScreenshotResult> {
  const root = await projectRoot(projectPath);
  const operations = operationsWithDefaults(suppliedOperations);
  const loaded = await loadManifest(root, token);
  let { manifest } = loaded;
  const { directory } = loaded;
  const metadataPath = path.join(root, 'project.json');

  const currentMetadata = await readOptional(metadataPath);
  if (currentMetadata === null)
    throw new ScreenshotTrashError('invalid-project', 'project.json is missing.', token);
  const currentProject = parseCurrentProject(currentMetadata, token);
  const originalProject = validateProject(
    JSON.parse((await backupBytes(directory, manifest.metadataBefore))!.toString('utf8')),
  );
  validateProject(project);
  if (currentProject.id !== project.id || currentProject.id !== originalProject.id)
    throw new ScreenshotTrashError('baseline-changed', 'Undo belongs to a different project.', token);

  if (manifest.phase === 'restored') return finishUndo(directory, manifest, currentProject, operations);
  if (manifest.undoAfter && (await classify(metadataPath, directory, manifest.undoAfter)) === 'expected') {
    const restored = validateProject(
      JSON.parse((await backupBytes(directory, manifest.undoAfter))!.toString('utf8')),
    );
    return finishUndo(directory, manifest, restored, operations);
  }
  if (manifest.phase === 'undoing') {
    if (!manifest.undoBefore || !manifest.undoAfter)
      throw new ScreenshotTrashError('invalid-manifest', 'Undo journal is missing its CAS images.', token);
    if ((await classify(metadataPath, directory, manifest.undoBefore)) !== 'expected')
      throw new ScreenshotTrashError(
        'baseline-changed',
        'project.json changed during the interrupted Undo; all backups were preserved.',
        token,
      );
    await restoreDeletedState(root, directory, manifest, operations);
    manifest = await setPhase(directory, manifest, 'deleted', operations);
  }
  if (manifest.phase !== 'deleted')
    throw new ScreenshotTrashError(
      'undo-failed',
      'The deletion must be recovered before Undo can run.',
      token,
    );
  if (currentProject.screenshots.some((item) => item.id === manifest.screenshot.id))
    throw new ScreenshotTrashError('undo-failed', 'This screenshot has already been restored.', token);

  const restoredProject = withScreenshot(currentProject, manifest.screenshot, token);
  const undoBefore = currentMetadata;
  const undoAfter = Buffer.from(JSON.stringify(restoredProject, null, 2));
  const undoBeforeStored = storedBytes('undo-before.bin', undoBefore);
  const undoAfterStored = storedBytes('undo-after.bin', undoAfter);
  await writeProtected(path.join(directory, 'undo-before.bin'), undoBefore!, operations);
  await writeProtected(path.join(directory, 'undo-after.bin'), undoAfter, operations);
  manifest = {
    ...manifest,
    phase: 'undoing',
    undoBefore: undoBeforeStored,
    undoAfter: undoAfterStored,
  };
  await writeManifest(directory, manifest, operations);

  try {
    for (const item of manifest.content) {
      const target = resolveRelative(root, item.relativePath);
      const current = await readOptional(target);
      const expected = await backupBytes(directory, item.bytes);
      if (equalBytes(current, expected)) continue;
      if (current !== null)
        throw new ScreenshotTrashError(
          'baseline-changed',
          `${item.relativePath} is occupied; Undo preserved both versions.`,
          token,
        );
      await applyStored(target, directory, item.bytes, operations);
      if ((await classify(target, directory, item.bytes)) !== 'expected')
        throw new Error(`${item.relativePath} did not restore byte-exactly.`);
    }
    if ((await classify(metadataPath, directory, undoBeforeStored)) !== 'expected')
      throw new ScreenshotTrashError(
        'baseline-changed',
        'project.json changed before the Undo commit point; candidate was preserved.',
        token,
      );
    await applyStored(metadataPath, directory, undoAfterStored, operations);
    if ((await classify(metadataPath, directory, undoAfterStored)) !== 'expected')
      throw new Error('project.json did not reach its restored state.');
    return finishUndo(directory, manifest, restoredProject, operations);
  } catch (error) {
    if ((await classify(metadataPath, directory, undoAfterStored)) === 'expected')
      return finishUndo(directory, manifest, restoredProject, operations);
    try {
      await restoreDeletedState(root, directory, manifest, operations);
      await setPhase(directory, manifest, 'deleted', operations);
    } catch (rollbackError) {
      throw new ScreenshotTrashError(
        'rollback-failed',
        `Screenshot Undo failed and recovery is incomplete: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        token,
        { cause: error },
      );
    }
    if (error instanceof ScreenshotTrashError) throw error;
    throw new ScreenshotTrashError(
      'undo-failed',
      `Screenshot Undo failed; deleted state was restored and can be retried: ${error instanceof Error ? error.message : String(error)}`,
      token,
      { cause: error },
    );
  }
}

async function trashTokens(
  projectPath: string,
  operations: ResolvedTrashOperations = defaultOperations,
): Promise<string[]> {
  const root = undoRoot(projectPath);
  await assertNoLinks(root);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const tokens: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !TOKEN_PATTERN.test(entry.name)) continue;
    const manifestPath = path.join(root, entry.name, 'manifest.json');
    await assertNoLinks(manifestPath);
    const stat = await fs.stat(manifestPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isFile()) tokens.push(entry.name);
    else if (stat)
      throw new ScreenshotTrashError(
        'invalid-manifest',
        'Undo manifest path is not a regular file.',
        entry.name,
      );
    else await cleanupIncompleteUndo(path.join(root, entry.name), operations);
  }
  return tokens.sort();
}

export async function listScreenshotTrashTransactions(
  projectPath: string,
): Promise<ScreenshotTrashSummary[]> {
  const root = await projectRoot(projectPath);
  const summaries: ScreenshotTrashSummary[] = [];
  for (const token of await trashTokens(root)) {
    const { manifest } = await loadManifest(root, token);
    summaries.push({
      undoToken: token,
      screenshotId: manifest.screenshot.id,
      phase: manifest.phase,
      deletedAt: manifest.deletedAt,
    });
  }
  return summaries;
}

export async function recoverScreenshotTrashTransactions(
  projectPath: string,
  suppliedOperations: ScreenshotTrashOperations = defaultOperations,
): Promise<ScreenshotTrashRecoveryResult[]> {
  const root = await projectRoot(projectPath);
  const operations = operationsWithDefaults(suppliedOperations);
  const metadataPath = path.join(root, 'project.json');
  const results: ScreenshotTrashRecoveryResult[] = [];
  for (const token of await trashTokens(root, operations)) {
    const loaded = await loadManifest(root, token);
    let { manifest } = loaded;
    const { directory } = loaded;
    if (manifest.phase === 'deleted') {
      results.push({
        undoToken: token,
        screenshotId: manifest.screenshot.id,
        status: 'deletion-committed',
        undoAvailable: true,
      });
      continue;
    }

    if (manifest.phase === 'prepared') {
      await cleanupUndo(directory, manifest, operations);
      results.push({
        undoToken: token,
        screenshotId: manifest.screenshot.id,
        status: 'baseline-restored',
        undoAvailable: false,
        cleanup: 'complete',
      });
      continue;
    }

    const metadata = await readOptional(metadataPath);
    if (metadata === null)
      throw new ScreenshotTrashError('invalid-project', 'project.json is missing.', token);
    const currentProject = parseCurrentProject(metadata, token);
    const originalProject = validateProject(
      JSON.parse((await backupBytes(directory, manifest.metadataBefore))!.toString('utf8')),
    );
    if (currentProject.id !== originalProject.id)
      throw new ScreenshotTrashError('baseline-changed', 'Undo belongs to a different project.', token);

    if (manifest.phase === 'restored') {
      const finished = await finishUndo(directory, manifest, currentProject, operations);
      results.push({
        undoToken: token,
        screenshotId: manifest.screenshot.id,
        status: 'undo-committed',
        undoAvailable: false,
        cleanup: finished.cleanup,
        warning: finished.warning,
      });
      continue;
    }

    if (manifest.phase === 'undoing') {
      if (!manifest.undoBefore || !manifest.undoAfter)
        throw new ScreenshotTrashError('invalid-manifest', 'Undo journal is missing its CAS images.', token);
      if ((await classify(metadataPath, directory, manifest.undoAfter)) === 'expected') {
        const restored = validateProject(
          JSON.parse((await backupBytes(directory, manifest.undoAfter))!.toString('utf8')),
        );
        const finished = await finishUndo(directory, manifest, restored, operations);
        results.push({
          undoToken: token,
          screenshotId: manifest.screenshot.id,
          status: 'undo-committed',
          undoAvailable: false,
          cleanup: finished.cleanup,
          warning: finished.warning,
        });
        continue;
      }
      if (currentProject.screenshots.some((item) => item.id === manifest.screenshot.id)) {
        throw new ScreenshotTrashError(
          'baseline-changed',
          'An interrupted Undo collided with a later screenshot record; all backups were preserved.',
          token,
        );
      }
      await restoreDeletedState(root, directory, manifest, operations);
      manifest = await setPhase(directory, manifest, 'deleted', operations);
      results.push({
        undoToken: token,
        screenshotId: manifest.screenshot.id,
        status: 'deletion-committed',
        undoAvailable: true,
      });
      continue;
    }

    if ((await classify(metadataPath, directory, manifest.metadataDeleted)) === 'expected') {
      manifest = await setPhase(directory, manifest, 'deleted', operations);
      results.push({
        undoToken: token,
        screenshotId: manifest.screenshot.id,
        status: 'deletion-committed',
        undoAvailable: true,
      });
      continue;
    }

    if (currentProject.screenshots.some((item) => item.id === manifest.screenshot.id)) {
      await ensureReferencedContent(root, directory, manifest, operations);
      manifest = await setPhase(directory, manifest, 'prepared', operations);
      await cleanupUndo(directory, manifest, operations);
      results.push({
        undoToken: token,
        screenshotId: manifest.screenshot.id,
        status: 'baseline-restored',
        undoAvailable: false,
        cleanup: 'complete',
      });
      continue;
    }

    manifest = await setPhase(directory, manifest, 'deleted', operations);
    results.push({
      undoToken: token,
      screenshotId: manifest.screenshot.id,
      status: 'deletion-committed',
      undoAvailable: true,
    });
  }
  return results;
}
