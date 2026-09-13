import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { z } from 'zod';
import {
  BACKUP_MANIFEST_VERSION,
  backupManifestSchema,
  backupRelativePathSchema,
  backupSnapshotIdSchema,
  type BackupInspection,
  type BackupListResult,
  type BackupManifest,
  type BackupPreferences,
  type BackupSnapshotReason,
  type BackupSnapshotSummary,
} from '../src/shared/backups.js';
import { filenameSchema, parseProjectFile, type LegacyProjectData } from '../src/shared/schema.js';
import type { ProjectData } from '../src/shared/types.js';
import { contentItemRelativePaths } from './content-paths.js';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';

const ROOT_DIRECTORY = '.imnota-backups';
const ROOT_MARKER = '.imnota-backups-v1.json';
const PUBLICATION_LEDGER = '.imnota-backup-publications-v1.json';
const SNAPSHOTS_DIRECTORY = 'snapshots';
const STAGING_DIRECTORY = 'staging';
const PROJECT_KEY_PATTERN = /^[0-9a-f]{32}$/;
const OWNER_FILE = '.imnota-stage-owner.json';
const RESTORE_OWNER_FILE = '.imnota-restore-owner.json';
const RESTORE_JOURNAL_PATTERN = /^\.imnota-restore-journal-([0-9a-f]{32})\.json$/;
const RESERVED_PROJECT_DIRECTORY_PATTERN = /^\.imnota-restore-(?:stage|rollback)-[0-9a-f]{32}$/;
const MAX_TREE_ENTRIES = 40_100;
const MAX_PUBLICATION_ENTRIES = 20_000;
export const MAX_BACKUP_ARCHIVE_BYTES = 256 * 1024 * 1024;

const publicationEntrySchema = z
  .object({
    projectKey: z.string().regex(PROJECT_KEY_PATTERN),
    snapshotId: backupSnapshotIdSchema,
    sourceProjectId: z.string().min(1).max(500),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    publishedAt: z.string().datetime(),
  })
  .strict();
const publicationLedgerSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(publicationEntrySchema).max(MAX_PUBLICATION_ENTRIES),
  })
  .strict()
  .superRefine((ledger, context) => {
    const keys = ledger.entries.map((entry) => `${entry.projectKey}/${entry.snapshotId}`);
    if (new Set(keys).size !== keys.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate backup publication record.' });
  });
type PublicationLedger = z.infer<typeof publicationLedgerSchema>;

const restoreJournalSchema = z
  .object({
    version: z.literal(1),
    token: z.string().regex(/^[0-9a-f]{32}$/),
    projectDirectory: filenameSchema,
    snapshotId: backupSnapshotIdSchema,
    sourceProjectId: z.string().min(1).max(500),
    phase: z.enum(['staged', 'original-moved', 'restored']),
  })
  .strict();
type RestoreJournal = z.infer<typeof restoreJournalSchema>;

interface BackupServiceOptions {
  getLocation(): string;
  getWorkspace(): string;
  getPreferences(): BackupPreferences;
  now?(): Date;
  randomId?(): string;
  rename?(source: string, target: string): Promise<void>;
  removeDirectory?(target: string): Promise<void>;
  maxExportBytes?: number;
}

export interface RestoreNewResult {
  projectPath: string;
  safetySnapshotId?: string;
  warnings?: string[];
}

export interface RestoreInPlaceResult {
  projectPath: string;
  safetySnapshotId: string;
  rollbackPath: string;
  warnings?: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function backupReservedProjectDirectory(name: string): boolean {
  return RESERVED_PROJECT_DIRECTORY_PATTERN.test(name);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function projectKey(projectId: string): string {
  return sha256(projectId).slice(0, 32);
}

function snapshotId(now: Date, randomId: string): string {
  const timestamp = now.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '');
  const compactId = randomId.replaceAll('-', '').toLowerCase();
  return backupSnapshotIdSchema.parse(`snapshot-${timestamp}-${compactId}`);
}

function strictRelativePath(value: string): string {
  return backupRelativePathSchema.parse(value.replaceAll('\\', '/'));
}

function targetForRelative(root: string, relativePath: string): string {
  const safe = strictRelativePath(relativePath);
  const target = path.resolve(root, ...safe.split('/'));
  if (target === path.resolve(root) || !isWithin(root, target))
    throw new Error('Backup path leaves its root.');
  return target;
}

function summary(manifest: BackupManifest): BackupSnapshotSummary {
  return {
    snapshotId: manifest.snapshotId,
    sourceProjectId: manifest.sourceProjectId,
    sourceProjectName: manifest.sourceProjectName,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    reason: manifest.reason,
    fileCount: manifest.files.length,
    totalSize: manifest.files.reduce((total, file) => total + file.size, 0),
  };
}

function uniquePortablePaths(values: readonly string[]): string[] {
  const paths = values.map(strictRelativePath);
  const keys = paths.map((value) => value.normalize('NFC').toLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error('Project content contains aliased backup paths.');
  return paths;
}

function authoritativeProjectFiles(project: ProjectData | LegacyProjectData): string[] {
  const files = ['project.json'];
  if (project.schemaVersion === 1 || project.schemaVersion === 2) {
    for (const shot of project.screenshots) {
      files.push(
        project.schemaVersion === 1
          ? `screenshots/${shot.storedFilename}`
          : `rounds/${shot.roundId}/screenshots/${shot.storedFilename}`,
        shot.annotationFile,
        shot.notesFile,
      );
    }
    return uniquePortablePaths(files);
  }
  const current = project as ProjectData;
  for (const shot of current.screenshots)
    files.push(
      `collections/${shot.collectionId}/screenshots/${shot.storedFilename}`,
      shot.annotationFile,
      shot.descriptionFile,
    );
  for (const item of current.contentItems ?? [])
    files.push(
      ...Object.values(contentItemRelativePaths(item)).filter((value): value is string => Boolean(value)),
    );
  return uniquePortablePaths(files);
}

async function regularFile(target: string): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  await assertNoLinks(target);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error(`Expected a regular file: ${path.basename(target)}`);
  return stat;
}

async function lstatOptional(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  await assertNoLinks(target);
  return fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function hashFile(target: string): Promise<{ size: number; sha256: string }> {
  await regularFile(target);
  const handle = await fs.open(target, 'r');
  const hash = createHash('sha256');
  let size = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return { size, sha256: hash.digest('hex') };
}

async function copyVerified(
  source: string,
  target: string,
  expected?: { size: number; sha256: string },
): Promise<{ size: number; sha256: string }> {
  const before = await regularFile(source);
  await assertNoLinks(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await assertNoLinks(path.dirname(target));
  await fs.copyFile(source, target);
  const [sourceHash, targetHash, after] = await Promise.all([
    hashFile(source),
    hashFile(target),
    fs.stat(source),
  ]);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    sourceHash.size !== targetHash.size ||
    sourceHash.sha256 !== targetHash.sha256
  )
    throw new Error(`Source changed while snapshotting ${path.basename(source)}.`);
  if (expected && (targetHash.size !== expected.size || targetHash.sha256 !== expected.sha256))
    throw new Error(`Backup file failed integrity validation: ${path.basename(source)}.`);
  return targetHash;
}

async function durableAtomicWrite(filePath: string, content: string): Promise<void> {
  await assertNoLinks(filePath);
  const parent = path.dirname(filePath);
  await fs.mkdir(parent, { recursive: true });
  await assertNoLinks(parent);
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filePath);
    const committed = await fs.open(filePath, 'r+');
    try {
      await committed.sync();
    } finally {
      await committed.close();
    }
    try {
      const directory = await fs.open(parent, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(code ?? ''))
        throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function exactTreeFiles(root: string): Promise<string[]> {
  await assertNoLinks(root);
  const pending: Array<{ directory: string; relative: string }> = [{ directory: root, relative: '' }];
  const files: string[] = [];
  let entriesSeen = 0;
  while (pending.length) {
    const current = pending.pop()!;
    const entries = await fs.readdir(current.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (++entriesSeen > MAX_TREE_ENTRIES) throw new Error('Backup contains too many filesystem entries.');
      const target = path.join(current.directory, entry.name);
      await assertNoLinks(target);
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Linked backup content is not supported.');
      if (entry.isDirectory()) pending.push({ directory: target, relative });
      else if (entry.isFile()) files.push(relative.replaceAll('\\', '/'));
      else throw new Error('Backup contains an unsupported filesystem entry.');
    }
  }
  return files.sort();
}

function restoredFolderBase(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${normalized || 'restored-project'}-restored`;
}

export class BackupService {
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly rename: (source: string, target: string) => Promise<void>;
  private readonly removeDirectory: (target: string) => Promise<void>;
  private readonly recoveryMessages: string[] = [];
  private readonly maxExportBytes: number;

  constructor(private readonly options: BackupServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
    this.rename = options.rename ?? ((source, target) => fs.rename(source, target));
    this.removeDirectory =
      options.removeDirectory ?? ((target) => fs.rm(target, { recursive: true, force: true }));
    this.maxExportBytes = options.maxExportBytes ?? MAX_BACKUP_ARCHIVE_BYTES;
  }

  location(): string {
    const selected = this.options.getLocation() || this.options.getWorkspace();
    if (!selected || !path.isAbsolute(selected)) throw new Error('Choose a backup location first.');
    const root = path.resolve(selected, ROOT_DIRECTORY);
    if (root === path.parse(root).root) throw new Error('A filesystem root cannot be a backup location.');
    return root;
  }

  private async root(create: boolean): Promise<string | null> {
    const root = this.location();
    await this.assertRootOutsideProject(root);
    await assertNoLinks(root);
    const stat = await fs.stat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) {
      if (!create) return null;
      await fs.mkdir(root, { recursive: true });
    } else if (!stat.isDirectory()) throw new Error('The backup location is not a folder.');
    await assertNoLinks(root);
    const markerPath = path.join(root, ROOT_MARKER);
    const markerStat = await lstatOptional(markerPath);
    if (markerStat && !markerStat.isFile())
      throw new Error('The backup ownership marker is not a regular file.');
    const marker = markerStat ? await fs.readFile(markerPath, 'utf8') : null;
    if (marker === null) {
      if (!create) return root;
      const existing = await fs.readdir(root);
      if (existing.length)
        throw new Error('The backup folder exists without an ownership marker and is not empty.');
      await atomicWrite(markerPath, JSON.stringify({ version: 1, owner: 'imnota-local-history' }, null, 2));
    } else {
      const parsed = JSON.parse(marker) as Record<string, unknown>;
      if (parsed.version !== 1 || parsed.owner !== 'imnota-local-history')
        throw new Error('The selected backup folder has an incompatible ownership marker.');
    }
    return root;
  }

  private async assertRootOutsideProject(root: string): Promise<void> {
    let current = path.dirname(root);
    while (true) {
      const projectFile = path.join(current, 'project.json');
      const stat = await fs.lstat(projectFile).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (stat)
        throw new Error(
          `The backup location cannot be inside an active project (${current}). Choose a folder outside all projects.`,
        );
      const parent = path.dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }

  private async readPublicationLedger(root: string): Promise<PublicationLedger> {
    const ledgerPath = path.join(root, PUBLICATION_LEDGER);
    const stat = await lstatOptional(ledgerPath);
    if (!stat) return { version: 1, entries: [] };
    if (!stat.isFile()) throw new Error('The backup publication ledger is not a regular file.');
    return publicationLedgerSchema.parse(JSON.parse(await fs.readFile(ledgerPath, 'utf8')));
  }

  private async writePublicationLedger(root: string, ledger: PublicationLedger): Promise<void> {
    const validated = publicationLedgerSchema.parse(ledger);
    await durableAtomicWrite(path.join(root, PUBLICATION_LEDGER), JSON.stringify(validated, null, 2));
  }

  private async registerPublication(
    root: string,
    entry: z.infer<typeof publicationEntrySchema>,
  ): Promise<void> {
    const ledger = await this.readPublicationLedger(root);
    const key = `${entry.projectKey}/${entry.snapshotId}`;
    const entries = ledger.entries.filter(
      (candidate) => `${candidate.projectKey}/${candidate.snapshotId}` !== key,
    );
    if (entries.length >= MAX_PUBLICATION_ENTRIES)
      throw new Error('The backup publication ledger is full; retention was disabled for this snapshot.');
    await this.writePublicationLedger(root, { version: 1, entries: [...entries, entry] });
  }

  private async publicationMatches(
    root: string,
    directory: string,
    projectId: string,
    snapshot: string,
  ): Promise<boolean> {
    const ledger = await this.readPublicationLedger(root);
    const record = ledger.entries.find(
      (entry) =>
        entry.projectKey === projectKey(projectId) &&
        entry.snapshotId === snapshot &&
        entry.sourceProjectId === projectId,
    );
    if (!record) return false;
    const manifest = await hashFile(path.join(directory, 'manifest.json'));
    return manifest.sha256 === record.manifestSha256;
  }

  private async unregisterPublication(root: string, projectId: string, snapshot: string): Promise<void> {
    const ledger = await this.readPublicationLedger(root);
    const entries = ledger.entries.filter(
      (entry) =>
        !(
          entry.projectKey === projectKey(projectId) &&
          entry.snapshotId === snapshot &&
          entry.sourceProjectId === projectId
        ),
    );
    if (entries.length === ledger.entries.length)
      throw new Error('Refusing to remove a snapshot without its publication record.');
    await this.writePublicationLedger(root, { version: 1, entries });
  }

  private async createStage(root: string): Promise<{ directory: string; token: string }> {
    const token = this.randomId().replaceAll('-', '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(token)) throw new Error('Could not allocate a safe backup staging ID.');
    const stagingRoot = path.join(root, STAGING_DIRECTORY);
    await assertNoLinks(stagingRoot);
    await fs.mkdir(stagingRoot, { recursive: true });
    const directory = path.join(stagingRoot, `stage-${token}`);
    await fs.mkdir(directory, { recursive: false });
    await atomicWrite(path.join(directory, OWNER_FILE), JSON.stringify({ version: 1, token }, null, 2));
    return { directory, token };
  }

  private async removeStage(root: string, directory: string, token: string): Promise<void> {
    const expected = path.join(root, STAGING_DIRECTORY, `stage-${token}`);
    if (
      path.resolve(directory) !== path.resolve(expected) ||
      !isWithin(path.join(root, STAGING_DIRECTORY), directory)
    )
      throw new Error('Refusing to clean an unowned backup staging directory.');
    await assertNoLinks(directory);
    const ownerPath = path.join(directory, OWNER_FILE);
    await regularFile(ownerPath);
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8')) as Record<string, unknown>;
    if (owner.version !== 1 || owner.token !== token)
      throw new Error('Refusing to clean a backup stage without its ownership marker.');
    await exactTreeFiles(directory);
    await this.removeDirectory(directory);
  }

  async createSnapshot(
    projectPath: string,
    reason: BackupSnapshotReason,
    retainedSnapshotIds: readonly string[] = [],
  ): Promise<BackupSnapshotSummary> {
    const sourceRoot = path.resolve(projectPath);
    await assertNoLinks(sourceRoot);
    const sourceStat = await fs.stat(sourceRoot).catch(() => null);
    if (!sourceStat?.isDirectory()) throw new Error('The project folder is unavailable.');
    const root = (await this.root(true))!;
    if (isWithin(sourceRoot, root)) throw new Error('Backups must be stored outside the active project.');

    const sourceProjectFile = path.join(sourceRoot, 'project.json');
    await regularFile(sourceProjectFile);
    const projectSource = await fs.readFile(sourceProjectFile);
    const project = parseProjectFile(JSON.parse(projectSource.toString('utf8')));
    const files = authoritativeProjectFiles(project);
    const id = snapshotId(this.now(), this.randomId());
    const key = projectKey(project.id);
    const finalDirectory = path.join(root, SNAPSHOTS_DIRECTORY, key, id);
    const stage = await this.createStage(root);
    const dataRoot = path.join(stage.directory, 'data');
    let manifest: BackupManifest;
    let manifestSource = '';
    try {
      const manifestFiles: BackupManifest['files'] = [];
      for (const relativePath of files) {
        const integrity = await copyVerified(
          targetForRelative(sourceRoot, relativePath),
          targetForRelative(dataRoot, relativePath),
        );
        manifestFiles.push({ path: relativePath, ...integrity });
      }
      const currentProject = await hashFile(path.join(sourceRoot, 'project.json'));
      const copiedProject = manifestFiles.find((file) => file.path === 'project.json')!;
      if (currentProject.size !== copiedProject.size || currentProject.sha256 !== copiedProject.sha256)
        throw new Error('Project metadata changed while the snapshot was prepared.');
      manifest = backupManifestSchema.parse({
        version: BACKUP_MANIFEST_VERSION,
        snapshotId: id,
        sourceProjectId: project.id,
        sourceProjectName: project.name,
        createdAt: this.now().toISOString(),
        schemaVersion: project.schemaVersion,
        reason,
        files: manifestFiles,
      });
      manifestSource = JSON.stringify(manifest, null, 2);
      await atomicWrite(path.join(stage.directory, 'manifest.json'), manifestSource);
      await this.inspectDirectory(stage.directory, id, [OWNER_FILE]);
      await fs.mkdir(path.dirname(finalDirectory), { recursive: true });
      await assertNoLinks(path.dirname(finalDirectory));
      if (await lstatOptional(finalDirectory)) throw new Error('The allocated snapshot already exists.');
      await fs.unlink(path.join(stage.directory, OWNER_FILE));
      await this.rename(stage.directory, finalDirectory);
    } catch (error) {
      if (await lstatOptional(stage.directory).catch(() => null)) {
        await atomicWrite(
          path.join(stage.directory, OWNER_FILE),
          JSON.stringify({ version: 1, token: stage.token }, null, 2),
        ).catch(() => undefined);
        await this.removeStage(root, stage.directory, stage.token).catch(() => undefined);
      }
      throw error;
    }
    const warnings: string[] = [];
    try {
      await this.registerPublication(root, {
        projectKey: key,
        snapshotId: id,
        sourceProjectId: project.id,
        manifestSha256: sha256(manifestSource),
        publishedAt: this.now().toISOString(),
      });
    } catch (error) {
      warnings.push(`Snapshot created, but automatic retention is disabled for it: ${message(error)}`);
    }
    try {
      await this.applyRetention(project.id, retainedSnapshotIds);
    } catch (error) {
      warnings.push(`Snapshot created, but retention cleanup is pending: ${message(error)}`);
    }
    return { ...summary(manifest), ...(warnings.length ? { warnings } : {}) };
  }

  private async inspectDirectory(
    directory: string,
    expectedId: string,
    allowedExtraFiles: readonly string[] = [],
  ): Promise<BackupInspection> {
    await assertNoLinks(directory);
    const manifestPath = path.join(directory, 'manifest.json');
    await regularFile(manifestPath);
    const manifest = backupManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
    if (manifest.snapshotId !== expectedId) throw new Error('Backup identity does not match its directory.');
    const expectedFiles = [
      'manifest.json',
      ...allowedExtraFiles,
      ...manifest.files.map((file) => `data/${file.path}`),
    ].sort();
    const actualFiles = await exactTreeFiles(directory);
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
      throw new Error('Backup contains missing or unexpected files.');
    for (const file of manifest.files) {
      const actual = await hashFile(targetForRelative(path.join(directory, 'data'), file.path));
      if (actual.size !== file.size || actual.sha256 !== file.sha256)
        throw new Error(`Backup integrity check failed for ${file.path}.`);
    }
    const projectSource = await fs.readFile(path.join(directory, 'data', 'project.json'), 'utf8');
    const project = parseProjectFile(JSON.parse(projectSource));
    if (
      project.id !== manifest.sourceProjectId ||
      project.name !== manifest.sourceProjectName ||
      project.schemaVersion !== manifest.schemaVersion
    )
      throw new Error('Backup project metadata does not match its manifest.');
    const authoritative = authoritativeProjectFiles(project)
      .map((value) => value.normalize('NFC').toLowerCase())
      .sort();
    const recorded = manifest.files.map((file) => file.path.normalize('NFC').toLowerCase()).sort();
    if (JSON.stringify(authoritative) !== JSON.stringify(recorded))
      throw new Error('Backup manifest does not contain the complete authoritative project file set.');
    return { manifest, summary: summary(manifest) };
  }

  private async snapshotDirectories(): Promise<
    Array<{ entry: string; directory: string; snapshotId: string; projectKey: string }>
  > {
    const root = await this.root(false);
    if (!root) return [];
    const snapshotsRoot = path.join(root, SNAPSHOTS_DIRECTORY);
    await assertNoLinks(snapshotsRoot);
    const projects = await fs
      .readdir(snapshotsRoot, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    const result: Array<{ entry: string; directory: string; snapshotId: string; projectKey: string }> = [];
    for (const project of projects) {
      if (!project.isDirectory() || !PROJECT_KEY_PATTERN.test(project.name)) continue;
      const projectDirectory = path.join(snapshotsRoot, project.name);
      await assertNoLinks(projectDirectory);
      const entries = await fs.readdir(projectDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !backupSnapshotIdSchema.safeParse(entry.name).success) continue;
        result.push({
          entry: `${project.name}/${entry.name}`,
          directory: path.join(projectDirectory, entry.name),
          snapshotId: entry.name,
          projectKey: project.name,
        });
      }
    }
    return result;
  }

  async listSnapshots(): Promise<BackupListResult> {
    const location = this.location();
    const snapshots: BackupSnapshotSummary[] = [];
    const invalid: BackupListResult['invalid'] = [];
    for (const entry of await this.snapshotDirectories()) {
      try {
        snapshots.push((await this.inspectDirectory(entry.directory, entry.snapshotId)).summary);
      } catch (error) {
        invalid.push({ entry: entry.entry, message: message(error) });
      }
    }
    snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    invalid.sort((left, right) => left.entry.localeCompare(right.entry));
    const recoveryMessages = this.recoveryMessages.splice(0);
    return {
      location,
      snapshots,
      invalid,
      ...(recoveryMessages.length ? { recoveryMessages } : {}),
    };
  }

  private async locate(snapshot: string): Promise<{ directory: string; inspection: BackupInspection }> {
    const id = backupSnapshotIdSchema.parse(snapshot);
    const matches = (await this.snapshotDirectories()).filter((entry) => entry.snapshotId === id);
    if (matches.length !== 1)
      throw new Error(matches.length ? 'Backup ID is ambiguous.' : 'Backup not found.');
    return {
      directory: matches[0].directory,
      inspection: await this.inspectDirectory(matches[0].directory, id),
    };
  }

  async inspectSnapshot(snapshot: string): Promise<BackupInspection> {
    return (await this.locate(snapshot)).inspection;
  }

  private async applyRetention(projectId: string, retainedSnapshotIds: readonly string[]): Promise<void> {
    const root = await this.root(false);
    if (!root) return;
    const preferences = this.options.getPreferences();
    const keep = new Set(retainedSnapshotIds.map((id) => backupSnapshotIdSchema.parse(id)));
    const candidates: Array<{ directory: string; summary: BackupSnapshotSummary }> = [];
    for (const entry of await this.snapshotDirectories()) {
      if (entry.projectKey !== projectKey(projectId)) continue;
      try {
        const inspection = await this.inspectDirectory(entry.directory, entry.snapshotId);
        if (
          inspection.manifest.sourceProjectId === projectId &&
          (await this.publicationMatches(root, entry.directory, projectId, inspection.summary.snapshotId))
        )
          candidates.push({ directory: entry.directory, summary: inspection.summary });
      } catch {
        // Invalid snapshots are reported by listing and never deleted automatically.
      }
    }
    candidates.sort((left, right) => right.summary.createdAt.localeCompare(left.summary.createdAt));
    const cutoff = this.now().getTime() - preferences.retentionAgeDays * 86_400_000;
    for (const [index, candidate] of candidates.entries()) {
      if (keep.has(candidate.summary.snapshotId)) continue;
      const expiredByCount = index >= preferences.retentionCount;
      const expiredByAge = Date.parse(candidate.summary.createdAt) < cutoff;
      if (!expiredByCount && !expiredByAge) continue;
      const expected = path.join(
        root,
        SNAPSHOTS_DIRECTORY,
        projectKey(projectId),
        candidate.summary.snapshotId,
      );
      if (
        path.resolve(candidate.directory) !== path.resolve(expected) ||
        !isWithin(path.join(root, SNAPSHOTS_DIRECTORY), candidate.directory)
      )
        throw new Error('Refusing to remove a snapshot outside the owned backup library.');
      const inspection = await this.inspectDirectory(candidate.directory, candidate.summary.snapshotId);
      if (inspection.manifest.sourceProjectId !== projectId)
        throw new Error('Refusing to remove a snapshot owned by another project.');
      if (
        !(await this.publicationMatches(root, candidate.directory, projectId, candidate.summary.snapshotId))
      )
        throw new Error('Refusing to remove a snapshot without its exact publication record.');
      await this.unregisterPublication(root, projectId, candidate.summary.snapshotId);
      await this.removeDirectory(candidate.directory);
    }
  }

  async exportSnapshot(snapshot: string, targetFile: string): Promise<void> {
    const { directory, inspection } = await this.locate(snapshot);
    if (!path.isAbsolute(targetFile)) throw new Error('Choose an absolute archive destination.');
    await assertNoLinks(targetFile);
    const totalSize = inspection.manifest.files.reduce((total, file) => total + file.size, 0);
    if (totalSize > this.maxExportBytes)
      throw new Error(
        `This snapshot is ${totalSize} bytes; archive export is limited to ${this.maxExportBytes} bytes. Open the local history folder and copy the validated snapshot directory instead.`,
      );
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(inspection.manifest, null, 2));
    for (const file of inspection.manifest.files) {
      const source = targetForRelative(path.join(directory, 'data'), file.path);
      await regularFile(source);
      zip.file(file.path, await fs.readFile(source));
    }
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await atomicWrite(targetFile, archive);
  }

  private restorePaths(workspace: string, token: string, projectDirectory: string) {
    const safeToken = z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .parse(token);
    const safeProjectDirectory = filenameSchema.parse(projectDirectory);
    const target = path.join(workspace, safeProjectDirectory);
    const stage = path.join(workspace, `.imnota-restore-stage-${safeToken}`);
    const rollback = path.join(workspace, `.imnota-restore-rollback-${safeToken}`);
    const journal = path.join(workspace, `.imnota-restore-journal-${safeToken}.json`);
    for (const candidate of [target, stage, rollback, journal])
      if (path.dirname(candidate) !== workspace || !isWithin(workspace, candidate))
        throw new Error('Restore operation leaves the selected workspace.');
    return { target, stage, rollback, journal };
  }

  private async writeRestoreJournal(workspace: string, journal: RestoreJournal): Promise<string> {
    const validated = restoreJournalSchema.parse(journal);
    const target = this.restorePaths(workspace, validated.token, validated.projectDirectory).journal;
    await durableAtomicWrite(target, JSON.stringify(validated, null, 2));
    return target;
  }

  private async createRestoreStage(workspace: string, token: string): Promise<string> {
    const stage = this.restorePaths(workspace, token, 'placeholder').stage;
    await fs.mkdir(stage, { recursive: false });
    await atomicWrite(path.join(stage, RESTORE_OWNER_FILE), JSON.stringify({ version: 1, token }, null, 2));
    return stage;
  }

  private async removeRestoreOwnedDirectory(
    workspace: string,
    directory: string,
    token: string,
  ): Promise<void> {
    const expected = this.restorePaths(workspace, token, 'placeholder').stage;
    if (path.resolve(directory) !== path.resolve(expected))
      throw new Error('Refusing to clean an unowned restore staging directory.');
    const ownerPath = path.join(directory, RESTORE_OWNER_FILE);
    await regularFile(ownerPath);
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8')) as Record<string, unknown>;
    if (owner.version !== 1 || owner.token !== token)
      throw new Error('Refusing to clean a restore stage without its ownership marker.');
    await exactTreeFiles(directory);
    await this.removeDirectory(directory);
  }

  private async removeOwnedNewRestoreTarget(
    workspace: string,
    directory: string,
    token: string,
  ): Promise<void> {
    if (path.dirname(directory) !== workspace || !isWithin(workspace, directory))
      throw new Error('Refusing to clean a restore target outside the selected workspace.');
    const ownerPath = path.join(directory, RESTORE_OWNER_FILE);
    await regularFile(ownerPath);
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8')) as Record<string, unknown>;
    if (owner.version !== 1 || owner.token !== token)
      throw new Error('Refusing to clean a restore target without its ownership marker.');
    await exactTreeFiles(directory);
    await this.removeDirectory(directory);
  }

  private async projectIdAt(directory: string): Promise<string> {
    await assertNoLinks(directory);
    const projectPath = path.join(directory, 'project.json');
    await regularFile(projectPath);
    const project = parseProjectFile(JSON.parse(await fs.readFile(projectPath, 'utf8')));
    return project.id;
  }

  private async validateRestoredProject(directory: string, inspection: BackupInspection): Promise<void> {
    const actualFiles = await exactTreeFiles(directory);
    const expectedFiles = inspection.manifest.files.map((file) => file.path).sort();
    const withoutOwner = actualFiles.filter((file) => file !== RESTORE_OWNER_FILE);
    if (JSON.stringify(withoutOwner) !== JSON.stringify(expectedFiles))
      throw new Error('Restored project contains missing or unexpected files.');
    for (const file of inspection.manifest.files) {
      const actual = await hashFile(targetForRelative(directory, file.path));
      if (actual.size !== file.size || actual.sha256 !== file.sha256)
        throw new Error(`Restored project integrity check failed for ${file.path}.`);
    }
    const projectPath = path.join(directory, 'project.json');
    const project = parseProjectFile(JSON.parse(await fs.readFile(projectPath, 'utf8')));
    if (project.id !== inspection.manifest.sourceProjectId)
      throw new Error('Restored project identity does not match the backup.');
    const authoritative = authoritativeProjectFiles(project)
      .map((value) => value.normalize('NFC').toLowerCase())
      .sort();
    const recorded = inspection.manifest.files.map((file) => file.path.normalize('NFC').toLowerCase()).sort();
    if (JSON.stringify(authoritative) !== JSON.stringify(recorded))
      throw new Error('Restored project is missing authoritative content.');
  }

  private async recoverRestoreJournal(
    workspace: string,
    journalPath: string,
  ): Promise<{ status: 'committed' | 'rolled-back'; rollbackPath?: string; message: string }> {
    await regularFile(journalPath);
    const journalName = path.basename(journalPath);
    const nameMatch = RESTORE_JOURNAL_PATTERN.exec(journalName);
    if (!nameMatch) throw new Error('Restore journal name is invalid.');
    const journal = restoreJournalSchema.parse(JSON.parse(await fs.readFile(journalPath, 'utf8')));
    if (journal.token !== nameMatch[1]) throw new Error('Restore journal identity does not match its name.');
    const locations = this.restorePaths(workspace, journal.token, journal.projectDirectory);
    const [targetStat, rollbackStat, stageStat] = await Promise.all([
      lstatOptional(locations.target),
      lstatOptional(locations.rollback),
      lstatOptional(locations.stage),
    ]);
    for (const [label, stat] of [
      ['project', targetStat],
      ['rollback', rollbackStat],
      ['stage', stageStat],
    ] as const)
      if (stat && !stat.isDirectory()) throw new Error(`Restore ${label} path is not a directory.`);

    if (targetStat && rollbackStat) {
      const located = await this.locate(journal.snapshotId);
      if ((await this.projectIdAt(locations.rollback)) !== journal.sourceProjectId)
        throw new Error('Interrupted restore has ambiguous project contents; no cleanup was attempted.');
      await this.validateRestoredProject(locations.target, located.inspection);
      const owner = path.join(locations.target, RESTORE_OWNER_FILE);
      if (await lstatOptional(owner)) await fs.unlink(owner);
      if (stageStat) await this.removeRestoreOwnedDirectory(workspace, locations.stage, journal.token);
      await fs.unlink(journalPath);
      return {
        status: 'committed',
        rollbackPath: locations.rollback,
        message: `Interrupted restore completed. The full pre-restore project remains at ${locations.rollback}.`,
      };
    }

    if (!targetStat && rollbackStat) {
      if ((await this.projectIdAt(locations.rollback)) !== journal.sourceProjectId)
        throw new Error('Restore rollback identity is invalid; no paths were changed.');
      await this.rename(locations.rollback, locations.target);
      if (stageStat) await this.removeRestoreOwnedDirectory(workspace, locations.stage, journal.token);
      await fs.unlink(journalPath);
      return {
        status: 'rolled-back',
        message: `Interrupted restore was rolled back to ${locations.target}.`,
      };
    }

    if (targetStat && !rollbackStat && stageStat) {
      if ((await this.projectIdAt(locations.target)) !== journal.sourceProjectId)
        throw new Error('Restore target identity changed; no cleanup was attempted.');
      await this.removeRestoreOwnedDirectory(workspace, locations.stage, journal.token);
      await fs.unlink(journalPath);
      return { status: 'rolled-back', message: `Uncommitted restore staging was safely removed.` };
    }

    throw new Error('Interrupted restore paths are incomplete or ambiguous; no cleanup was attempted.');
  }

  async recoverInterruptedRestores(): Promise<string[]> {
    const workspace = path.resolve(this.options.getWorkspace());
    await assertNoLinks(workspace);
    const entries = await fs.readdir(workspace, { withFileTypes: true });
    const messages: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !RESTORE_JOURNAL_PATTERN.test(entry.name)) continue;
      try {
        const recovered = await this.recoverRestoreJournal(workspace, path.join(workspace, entry.name));
        messages.push(recovered.message);
      } catch (error) {
        messages.push(`Restore recovery needs attention for ${entry.name}: ${message(error)}`);
      }
    }
    this.recoveryMessages.push(...messages);
    return messages;
  }

  private async restoreFiles(
    directory: string,
    inspection: BackupInspection,
    targetRoot: string,
  ): Promise<void> {
    const dataRoot = path.join(directory, 'data');
    for (const file of inspection.manifest.files)
      await copyVerified(
        targetForRelative(dataRoot, file.path),
        targetForRelative(targetRoot, file.path),
        file,
      );
  }

  async restoreNew(snapshot: string): Promise<RestoreNewResult> {
    const { directory, inspection } = await this.locate(snapshot);
    const workspace = path.resolve(this.options.getWorkspace());
    await assertNoLinks(workspace);
    if (!(await lstatOptional(workspace))?.isDirectory())
      throw new Error('Choose an available workspace before restoring.');
    const base = restoredFolderBase(inspection.manifest.sourceProjectName);
    const token = this.randomId().replaceAll('-', '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(token)) throw new Error('Could not allocate a safe restore ID.');
    const stage = await this.createRestoreStage(workspace, token);
    let target = '';
    let committed = false;
    try {
      await this.restoreFiles(directory, inspection, stage);
      const projectPath = path.join(stage, 'project.json');
      const raw = JSON.parse(await fs.readFile(projectPath, 'utf8')) as Record<string, unknown>;
      const project = parseProjectFile(raw);
      const now = this.now().toISOString();
      const restored = parseProjectFile({
        ...raw,
        id: `project_${this.randomId()}`,
        name: `${project.name.slice(0, 111)} restored`,
        createdAt: now,
        updatedAt: now,
      });
      await atomicWrite(projectPath, JSON.stringify(restored, null, 2));
      let suffix = 1;
      while (true) {
        target = path.join(workspace, suffix === 1 ? base : `${base}-${suffix}`);
        try {
          await fs.mkdir(target, { recursive: false });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          suffix += 1;
        }
      }
      await atomicWrite(
        path.join(target, RESTORE_OWNER_FILE),
        JSON.stringify({ version: 1, token }, null, 2),
      );
      const restoredFiles = authoritativeProjectFiles(restored);
      for (const relativePath of restoredFiles.filter((file) => file !== 'project.json')) {
        const expected = await hashFile(targetForRelative(stage, relativePath));
        await copyVerified(
          targetForRelative(stage, relativePath),
          targetForRelative(target, relativePath),
          expected,
        );
      }
      const projectIntegrity = await hashFile(projectPath);
      await copyVerified(projectPath, path.join(target, 'project.json'), projectIntegrity);
      committed = true;
      await fs.unlink(path.join(target, RESTORE_OWNER_FILE));
      const warnings: string[] = [];
      try {
        await this.removeRestoreOwnedDirectory(workspace, stage, token);
      } catch (error) {
        warnings.push(`Project restored, but staging cleanup is pending: ${message(error)}`);
      }
      return { projectPath: target, ...(warnings.length ? { warnings } : {}) };
    } catch (error) {
      if (committed)
        return {
          projectPath: target,
          warnings: [`Project restored, but final cleanup is pending: ${message(error)}`],
        };
      if (target && (await lstatOptional(path.join(target, RESTORE_OWNER_FILE)).catch(() => null)))
        await this.removeOwnedNewRestoreTarget(workspace, target, token).catch(() => undefined);
      if (await lstatOptional(stage).catch(() => null))
        await this.removeRestoreOwnedDirectory(workspace, stage, token).catch(() => undefined);
      throw error;
    }
  }

  async restoreInPlace(snapshot: string, projectPath: string): Promise<RestoreInPlaceResult> {
    const { directory, inspection } = await this.locate(snapshot);
    const target = path.resolve(projectPath);
    const workspace = path.resolve(this.options.getWorkspace());
    if (path.dirname(target) !== workspace || !isWithin(workspace, target))
      throw new Error('Restore target must be a project in the selected workspace.');
    await assertNoLinks(target);
    const currentProjectFile = path.join(target, 'project.json');
    await regularFile(currentProjectFile);
    const currentSource = await fs.readFile(currentProjectFile, 'utf8');
    const current = parseProjectFile(JSON.parse(currentSource));
    if (current.id !== inspection.manifest.sourceProjectId)
      throw new Error('This snapshot belongs to a different project.');

    const safety = await this.createSnapshot(target, 'safety-restore', [snapshot]);
    const token = this.randomId().replaceAll('-', '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(token)) throw new Error('Could not allocate a safe restore ID.');
    const locations = this.restorePaths(workspace, token, path.basename(target));
    const stage = await this.createRestoreStage(workspace, token);
    const journal: RestoreJournal = {
      version: 1,
      token,
      projectDirectory: path.basename(target),
      snapshotId: snapshot,
      sourceProjectId: current.id,
      phase: 'staged',
    };
    let journalWritten = false;
    let committed = false;
    try {
      await this.restoreFiles(directory, inspection, stage);
      const stagedProject = parseProjectFile(
        JSON.parse(await fs.readFile(path.join(stage, 'project.json'), 'utf8')),
      );
      if (stagedProject.id !== current.id) throw new Error('Staged restore changed project identity.');
      await this.writeRestoreJournal(workspace, journal);
      journalWritten = true;
      await this.rename(target, locations.rollback);
      await this.writeRestoreJournal(workspace, { ...journal, phase: 'original-moved' });
      await this.rename(stage, target);
      committed = true;
      await this.writeRestoreJournal(workspace, { ...journal, phase: 'restored' });
      await fs.unlink(path.join(target, RESTORE_OWNER_FILE));
      await fs.unlink(locations.journal);
      const warnings = [...(safety.warnings ?? [])];
      try {
        await this.applyRetention(current.id, []);
      } catch (error) {
        warnings.push(`Restore completed, but retention cleanup is pending: ${message(error)}`);
      }
      return {
        projectPath: target,
        safetySnapshotId: safety.snapshotId,
        rollbackPath: locations.rollback,
        ...(warnings.length ? { warnings } : {}),
      };
    } catch (error) {
      // The historical directory is already installed. Journal or marker cleanup
      // cannot turn that commit into a failed restore or invite a second restore.
      if (committed) {
        const warnings = [
          ...(safety.warnings ?? []),
          `Restore completed, but recovery cleanup needs attention: ${message(error)}`,
        ];
        try {
          const recovered = await this.recoverRestoreJournal(workspace, locations.journal);
          warnings.push(recovered.message);
        } catch (recoveryError) {
          warnings.push(`Recovery files were preserved: ${message(recoveryError)}`);
        }
        return {
          projectPath: target,
          safetySnapshotId: safety.snapshotId,
          rollbackPath: locations.rollback,
          warnings,
        };
      }
      if (journalWritten) {
        const recovered = await this.recoverRestoreJournal(workspace, locations.journal).catch(() => null);
        if (recovered?.status === 'committed')
          return {
            projectPath: target,
            safetySnapshotId: safety.snapshotId,
            rollbackPath: recovered.rollbackPath!,
            warnings: [...(safety.warnings ?? []), recovered.message],
          };
      } else if (await lstatOptional(stage).catch(() => null))
        await this.removeRestoreOwnedDirectory(workspace, stage, token).catch(() => undefined);
      throw error;
    }
  }
}

export function backupProjectFiles(project: ProjectData | LegacyProjectData): string[] {
  return authoritativeProjectFiles(project);
}
