import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';

const TRANSACTION_DIRECTORY = '.imnota-transactions';
const MAX_TRANSACTION_WRITES = 256;
const TOKEN_PATTERN = /^txn-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = ['save', 'conflict', 'recovery-restore'] as const;
const PHASES = ['staged', 'applying', 'committed'] as const;

export type ScreenshotTransactionKind = (typeof KINDS)[number];
type TransactionPhase = (typeof PHASES)[number];

export type ScreenshotTransactionBaseline = { state: 'absent' } | { state: 'present'; sha256: string };

export interface ScreenshotTransactionWrite {
  relativePath: string;
  after: Uint8Array | null;
  expectedBefore: ScreenshotTransactionBaseline;
}

export interface StageScreenshotTransactionInput {
  kind: ScreenshotTransactionKind;
  writes: ScreenshotTransactionWrite[];
}

export interface ScreenshotTransactionSummary {
  token: string;
  kind: ScreenshotTransactionKind;
  phase: TransactionPhase;
  paths: string[];
  createdAt: string;
}

export interface ScreenshotTransactionCommitResult {
  status: 'committed';
  cleanup: 'complete' | 'pending';
  warning?: string;
}

export interface ScreenshotTransactionRecoveryResult {
  token: string;
  kind: ScreenshotTransactionKind;
  status: 'candidate-staged' | 'baseline-restored' | 'committed';
  candidateAvailable: boolean;
  cleanup?: 'complete' | 'pending';
  warning?: string;
}

export interface ScreenshotTransactionOperations {
  write: typeof atomicWrite;
  unlink: (target: string) => Promise<void>;
  removeDirectory: (target: string) => Promise<void>;
}

const defaultOperations: ScreenshotTransactionOperations = {
  write: atomicWrite,
  unlink: (target) => fs.unlink(target),
  removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
};

type ErrorCode =
  | 'invalid-project'
  | 'invalid-path'
  | 'invalid-token'
  | 'invalid-journal'
  | 'baseline-changed'
  | 'commit-failed'
  | 'rollback-failed'
  | 'cleanup-failed';

export class ScreenshotTransactionError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly token?: string,
    public readonly candidateAvailable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScreenshotTransactionError';
  }
}

interface StoredImage {
  present: boolean;
  size: number;
  sha256: string | null;
  blob: string | null;
}

interface TransactionEntry {
  relativePath: string;
  before: StoredImage;
  after: StoredImage;
}

interface TransactionManifest {
  version: 1;
  token: string;
  kind: ScreenshotTransactionKind;
  phase: TransactionPhase;
  createdAt: string;
  commitPath: 'project.json';
  entries: TransactionEntry[];
}

type LiveState = 'before' | 'after' | 'same' | 'other';

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function screenshotTransactionBaseline(value: Uint8Array | null): ScreenshotTransactionBaseline {
  return value === null ? { state: 'absent' } : { state: 'present', sha256: sha256(value) };
}

function isBaseline(value: unknown): value is ScreenshotTransactionBaseline {
  if (!value || typeof value !== 'object') return false;
  const baseline = value as Record<string, unknown>;
  return (
    (baseline.state === 'absent' && Object.keys(baseline).length === 1) ||
    (baseline.state === 'present' &&
      Object.keys(baseline).length === 2 &&
      typeof baseline.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(baseline.sha256))
  );
}

function matchesBaseline(value: Buffer | null, baseline: ScreenshotTransactionBaseline): boolean {
  return baseline.state === 'absent' ? value === null : value !== null && sha256(value) === baseline.sha256;
}

function strictToken(token: string): string {
  if (!TOKEN_PATTERN.test(token))
    throw new ScreenshotTransactionError('invalid-token', 'Invalid screenshot transaction token.');
  return token;
}

function strictRelativePath(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1000 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.includes(':') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  )
    throw new ScreenshotTransactionError('invalid-path', `Unsafe transaction path: ${value}`);
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new ScreenshotTransactionError('invalid-path', `Unsafe transaction path: ${value}`);
  if (parts[0].toLowerCase() === TRANSACTION_DIRECTORY.toLowerCase())
    throw new ScreenshotTransactionError('invalid-path', 'Transactions cannot modify their own journal.');
  return value;
}

async function projectRoot(projectPath: string): Promise<string> {
  const root = path.resolve(projectPath);
  if (root === path.parse(root).root)
    throw new ScreenshotTransactionError('invalid-project', 'A filesystem root cannot be a project.');
  await assertNoLinks(root);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory())
    throw new ScreenshotTransactionError('invalid-project', 'The project directory is unavailable.');
  return root;
}

function livePath(root: string, relativePath: string): string {
  const target = path.resolve(root, ...strictRelativePath(relativePath).split('/'));
  if (target === root || !isWithin(root, target))
    throw new ScreenshotTransactionError('invalid-path', `Path leaves the project: ${relativePath}`);
  return target;
}

function journalRoot(root: string): string {
  return path.join(root, TRANSACTION_DIRECTORY);
}

function transactionDirectory(root: string, token: string): string {
  return path.join(journalRoot(root), strictToken(token));
}

async function readOptional(target: string): Promise<Buffer | null> {
  await assertNoLinks(target);
  return fs.readFile(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

function storedImage(blob: string | null, value: Uint8Array | null): StoredImage {
  return value === null
    ? { present: false, size: 0, sha256: null, blob: null }
    : { present: true, size: value.byteLength, sha256: sha256(value), blob };
}

function sameStoredBytes(left: StoredImage, right: StoredImage): boolean {
  return left.present === right.present && left.size === right.size && left.sha256 === right.sha256;
}

function isStoredImage(value: unknown): value is StoredImage {
  if (!value || typeof value !== 'object') return false;
  const image = value as Record<string, unknown>;
  if (image.present === false) return image.size === 0 && image.sha256 === null && image.blob === null;
  return (
    image.present === true &&
    Number.isSafeInteger(image.size) &&
    (image.size as number) >= 0 &&
    typeof image.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(image.sha256) &&
    typeof image.blob === 'string' &&
    /^(before|after)-[0-9]{4}\.bin$/.test(image.blob)
  );
}

function parseManifest(value: unknown, expectedToken: string): TransactionManifest {
  if (!value || typeof value !== 'object')
    throw new ScreenshotTransactionError('invalid-journal', 'Transaction manifest is not an object.');
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    input.token !== expectedToken ||
    !KINDS.includes(input.kind as ScreenshotTransactionKind) ||
    !PHASES.includes(input.phase as TransactionPhase) ||
    typeof input.createdAt !== 'string' ||
    input.commitPath !== 'project.json' ||
    !Array.isArray(input.entries) ||
    input.entries.length < 2 ||
    input.entries.length > MAX_TRANSACTION_WRITES
  )
    throw new ScreenshotTransactionError(
      'invalid-journal',
      'Transaction manifest failed validation.',
      expectedToken,
      true,
    );

  const entries: TransactionEntry[] = [];
  const paths = new Set<string>();
  const blobs = new Set<string>();
  for (const raw of input.entries) {
    if (!raw || typeof raw !== 'object')
      throw new ScreenshotTransactionError('invalid-journal', 'Transaction entry is invalid.');
    const entry = raw as Record<string, unknown>;
    if (typeof entry.relativePath !== 'string' || !isStoredImage(entry.before) || !isStoredImage(entry.after))
      throw new ScreenshotTransactionError('invalid-journal', 'Transaction entry failed validation.');
    const relativePath = strictRelativePath(entry.relativePath);
    const key = relativePath.toLowerCase();
    if (paths.has(key))
      throw new ScreenshotTransactionError('invalid-journal', 'Transaction contains aliased paths.');
    paths.add(key);
    for (const image of [entry.before, entry.after]) {
      if (image.blob) {
        if (blobs.has(image.blob))
          throw new ScreenshotTransactionError('invalid-journal', 'Transaction reuses a journal blob.');
        blobs.add(image.blob);
      }
    }
    entries.push({ relativePath, before: entry.before, after: entry.after });
  }
  const commits = entries.filter((entry) => entry.relativePath.toLowerCase() === 'project.json');
  if (commits.length !== 1)
    throw new ScreenshotTransactionError(
      'invalid-journal',
      'Transaction requires one project.json commit point.',
    );
  if (sameStoredBytes(commits[0].before, commits[0].after))
    throw new ScreenshotTransactionError(
      'invalid-journal',
      'project.json must change so the transaction has an unambiguous commit point.',
      expectedToken,
      true,
    );

  return {
    version: 1,
    token: expectedToken,
    kind: input.kind as ScreenshotTransactionKind,
    phase: input.phase as TransactionPhase,
    createdAt: input.createdAt,
    commitPath: 'project.json',
    entries,
  };
}

async function writeJournalFile(
  target: string,
  content: string | Uint8Array,
  operations: ScreenshotTransactionOperations,
): Promise<void> {
  await assertNoLinks(target);
  await operations.write(target, content);
  await assertNoLinks(target);
}

async function writeManifest(
  directory: string,
  manifest: TransactionManifest,
  operations: ScreenshotTransactionOperations,
): Promise<void> {
  await writeJournalFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    operations,
  );
}

async function loadManifest(
  root: string,
  token: string,
): Promise<{ directory: string; manifest: TransactionManifest }> {
  const directory = transactionDirectory(root, token);
  await assertNoLinks(directory);
  const source = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8');
  return { directory, manifest: parseManifest(JSON.parse(source), token) };
}

async function imageBytes(directory: string, image: StoredImage): Promise<Buffer | null> {
  if (!image.present) return null;
  const target = path.join(directory, image.blob!);
  await assertNoLinks(target);
  const value = await fs.readFile(target);
  if (value.byteLength !== image.size || sha256(value) !== image.sha256)
    throw new ScreenshotTransactionError('invalid-journal', 'Transaction blob failed integrity validation.');
  return value;
}

function equalBytes(left: Buffer | null, right: Buffer | null): boolean {
  return left === null ? right === null : right !== null && left.equals(right);
}

async function classifyLive(root: string, directory: string, entry: TransactionEntry): Promise<LiveState> {
  const current = await readOptional(livePath(root, entry.relativePath));
  const before = await imageBytes(directory, entry.before);
  const after = await imageBytes(directory, entry.after);
  const matchesBefore = equalBytes(current, before);
  const matchesAfter = equalBytes(current, after);
  if (matchesBefore && matchesAfter) return 'same';
  if (matchesBefore) return 'before';
  return matchesAfter ? 'after' : 'other';
}

function stateIsAccepted(state: LiveState, accepted: Array<'before' | 'after'>): boolean {
  return state === 'same' ? accepted.length > 0 : accepted.includes(state as 'before' | 'after');
}

async function applyImage(
  target: string,
  value: Buffer | null,
  operations: ScreenshotTransactionOperations,
): Promise<void> {
  await assertNoLinks(target);
  if (value === null) {
    await operations.unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  } else {
    await operations.write(target, value);
  }
  await assertNoLinks(target);
}

async function setPhase(
  directory: string,
  manifest: TransactionManifest,
  phase: TransactionPhase,
  operations: ScreenshotTransactionOperations,
): Promise<TransactionManifest> {
  const next = { ...manifest, phase };
  await writeManifest(directory, next, operations);
  return next;
}

async function assertExpectedState(
  root: string,
  directory: string,
  entries: TransactionEntry[],
  accepted: Array<'before' | 'after'>,
): Promise<void> {
  const collisions: string[] = [];
  for (const entry of entries) {
    const state = await classifyLive(root, directory, entry);
    if (!stateIsAccepted(state, accepted)) collisions.push(entry.relativePath);
  }
  if (collisions.length)
    throw new ScreenshotTransactionError(
      'baseline-changed',
      `Transaction stopped because these paths changed externally: ${collisions.join(', ')}`,
      path.basename(directory),
      true,
    );
}

async function rollbackToBefore(
  root: string,
  directory: string,
  manifest: TransactionManifest,
  operations: ScreenshotTransactionOperations,
): Promise<void> {
  const commit = manifest.entries.find((entry) => entry.relativePath.toLowerCase() === 'project.json')!;
  const commitState = await classifyLive(root, directory, commit);
  if (commitState === 'after') return;
  if (commitState === 'same')
    throw new ScreenshotTransactionError(
      'invalid-journal',
      'project.json does not provide a distinct transaction commit point.',
      manifest.token,
      true,
    );
  if (commitState === 'other')
    throw new ScreenshotTransactionError(
      'baseline-changed',
      'project.json changed externally; transaction data was preserved without overwriting it.',
      manifest.token,
      true,
    );

  const failures: string[] = [];
  const entries = manifest.entries
    .filter((entry) => entry !== commit)
    .slice()
    .reverse();
  for (const entry of entries) {
    try {
      const state = await classifyLive(root, directory, entry);
      if (state === 'other') {
        failures.push(`${entry.relativePath} changed externally`);
        continue;
      }
      if (state === 'after') {
        await applyImage(
          livePath(root, entry.relativePath),
          await imageBytes(directory, entry.before),
          operations,
        );
        if (!stateIsAccepted(await classifyLive(root, directory, entry), ['before']))
          failures.push(`${entry.relativePath} did not restore byte-exactly`);
      }
    } catch (error) {
      failures.push(`${entry.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length)
    throw new ScreenshotTransactionError(
      'rollback-failed',
      `Transaction rollback needs recovery: ${failures.join('; ')}`,
      manifest.token,
      true,
    );
}

function expectedJournalFiles(manifest: TransactionManifest): Set<string> {
  const expected = new Set(['manifest.json']);
  for (const entry of manifest.entries)
    for (const image of [entry.before, entry.after]) if (image.blob) expected.add(image.blob);
  return expected;
}

async function cleanupTransaction(
  directory: string,
  manifest: TransactionManifest,
  operations: ScreenshotTransactionOperations,
): Promise<void> {
  await assertNoLinks(directory);
  const expected = expectedJournalFiles(manifest);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !expected.has(entry.name))
      throw new ScreenshotTransactionError(
        'cleanup-failed',
        'Transaction cleanup stopped because the journal contains an unknown path.',
        manifest.token,
      );
    await assertNoLinks(path.join(directory, entry.name));
  }
  await operations.removeDirectory(directory);
}

async function cleanupIncompleteTransaction(
  directory: string,
  operations: ScreenshotTransactionOperations,
): Promise<boolean> {
  await assertNoLinks(directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.name === 'manifest.json')) return false;
  for (const entry of entries) {
    if (!entry.isFile() || !/^(before|after)-[0-9]{4}\.bin$/.test(entry.name))
      throw new ScreenshotTransactionError(
        'invalid-journal',
        'Incomplete transaction cleanup stopped at an unknown path.',
        path.basename(directory),
        true,
      );
    await assertNoLinks(path.join(directory, entry.name));
  }
  await operations.removeDirectory(directory);
  return true;
}

async function cleanupCommittedBeforeStage(
  root: string,
  operations: ScreenshotTransactionOperations,
): Promise<void> {
  for (const token of await transactionTokens(root, operations)) {
    const { directory, manifest } = await loadManifest(root, token);
    try {
      if (manifest.phase === 'committed') {
        await cleanupTransaction(directory, manifest, operations);
        continue;
      }
      const commit = manifest.entries.find((entry) => entry.relativePath.toLowerCase() === 'project.json')!;
      if ((await classifyLive(root, directory, commit)) !== 'after') continue;
      const result = await finishCommitted(directory, manifest, operations);
      if (result.cleanup === 'pending') throw new Error(result.warning);
    } catch (error) {
      throw new ScreenshotTransactionError(
        'cleanup-failed',
        `A committed transaction journal could not be cleaned before the next save: ${error instanceof Error ? error.message : String(error)}`,
        token,
        false,
        { cause: error },
      );
    }
  }
}

async function finishCommitted(
  directory: string,
  manifest: TransactionManifest,
  operations: ScreenshotTransactionOperations,
): Promise<ScreenshotTransactionCommitResult> {
  let committedManifest = manifest;
  try {
    if (manifest.phase !== 'committed')
      committedManifest = await setPhase(directory, manifest, 'committed', operations);
  } catch {
    // project.json is the authoritative commit point. Recovery can infer commit from it.
  }
  try {
    await cleanupTransaction(directory, committedManifest, operations);
    return { status: 'committed', cleanup: 'complete' };
  } catch (error) {
    return {
      status: 'committed',
      cleanup: 'pending',
      warning: `The save committed, but journal cleanup is pending: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function stageScreenshotTransaction(
  projectPath: string,
  input: StageScreenshotTransactionInput,
  operations: ScreenshotTransactionOperations = defaultOperations,
): Promise<ScreenshotTransactionSummary> {
  const root = await projectRoot(projectPath);
  await cleanupCommittedBeforeStage(root, operations);
  if (!KINDS.includes(input.kind) || input.writes.length < 2 || input.writes.length > MAX_TRANSACTION_WRITES)
    throw new ScreenshotTransactionError('invalid-journal', 'Transaction input is invalid.');

  const normalized = input.writes.map((write) => ({
    relativePath: strictRelativePath(write.relativePath),
    after: write.after === null ? null : Buffer.from(write.after),
    expectedBefore: write.expectedBefore,
  }));
  if (normalized.some((write) => !isBaseline(write.expectedBefore)))
    throw new ScreenshotTransactionError('invalid-journal', 'Transaction precondition is invalid.');
  const keys = normalized.map((write) => write.relativePath.toLowerCase());
  if (new Set(keys).size !== keys.length)
    throw new ScreenshotTransactionError('invalid-path', 'Transaction contains duplicate or aliased paths.');
  if (normalized.filter((write) => write.relativePath.toLowerCase() === 'project.json').length !== 1)
    throw new ScreenshotTransactionError(
      'invalid-journal',
      'Transaction requires one project.json commit point.',
    );

  const commit = normalized.find((write) => write.relativePath.toLowerCase() === 'project.json')!;
  if (commit.after === null)
    throw new ScreenshotTransactionError('invalid-journal', 'project.json cannot be deleted.');
  const ordered = [...normalized.filter((write) => write !== commit), commit];

  // Capture and validate the complete baseline before creating a journal. In
  // particular, an allocated conflict path must still be absent at this point.
  const snapshots: Array<{ write: (typeof ordered)[number]; before: Buffer | null }> = [];
  for (const write of ordered) {
    const before = await readOptional(livePath(root, write.relativePath));
    if (!matchesBaseline(before, write.expectedBefore))
      throw new ScreenshotTransactionError(
        'baseline-changed',
        `${write.relativePath} no longer matches the caller-observed baseline.`,
      );
    snapshots.push({ write, before });
  }
  const commitSnapshot = snapshots.find(({ write }) => write === commit)!;
  if (equalBytes(commitSnapshot.before, commit.after))
    throw new ScreenshotTransactionError(
      'invalid-journal',
      'project.json must change so the transaction has an unambiguous commit point.',
    );

  const token = `txn-${randomUUID()}`;
  const rootDirectory = journalRoot(root);
  await assertNoLinks(rootDirectory);
  await fs.mkdir(rootDirectory, { recursive: true });
  await assertNoLinks(rootDirectory);
  const directory = transactionDirectory(root, token);
  const entries: TransactionEntry[] = [];
  let manifest: TransactionManifest;
  let directoryCreated = false;
  try {
    await assertNoLinks(directory);
    await fs.mkdir(directory, { recursive: false });
    directoryCreated = true;
    await assertNoLinks(directory);

    for (const [index, { write, before }] of snapshots.entries()) {
      const beforeBlob = before === null ? null : `before-${String(index).padStart(4, '0')}.bin`;
      const afterBlob = write.after === null ? null : `after-${String(index).padStart(4, '0')}.bin`;
      if (beforeBlob) await writeJournalFile(path.join(directory, beforeBlob), before!, operations);
      if (afterBlob) await writeJournalFile(path.join(directory, afterBlob), write.after!, operations);
      entries.push({
        relativePath: write.relativePath,
        before: storedImage(beforeBlob, before),
        after: storedImage(afterBlob, write.after),
      });
    }

    manifest = {
      version: 1,
      token,
      kind: input.kind,
      phase: 'staged',
      createdAt: new Date().toISOString(),
      commitPath: 'project.json',
      entries,
    };
    await writeManifest(directory, manifest, operations);
  } catch (error) {
    if (!directoryCreated) throw error;
    try {
      await cleanupIncompleteTransaction(directory, operations);
    } catch (cleanupError) {
      throw new ScreenshotTransactionError(
        'cleanup-failed',
        `Transaction staging failed and its incomplete journal could not be cleaned: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        token,
        false,
        { cause: error },
      );
    }
    throw error;
  }
  await assertExpectedState(root, directory, entries, ['before']);
  return {
    token,
    kind: manifest.kind,
    phase: manifest.phase,
    paths: entries.map((entry) => entry.relativePath),
    createdAt: manifest.createdAt,
  };
}

export async function commitScreenshotTransaction(
  projectPath: string,
  token: string,
  operations: ScreenshotTransactionOperations = defaultOperations,
): Promise<ScreenshotTransactionCommitResult> {
  const root = await projectRoot(projectPath);
  const loaded = await loadManifest(root, token);
  let { manifest } = loaded;
  const { directory } = loaded;
  const commit = manifest.entries.find((entry) => entry.relativePath.toLowerCase() === 'project.json')!;

  if (manifest.phase === 'committed') return finishCommitted(directory, manifest, operations);
  const initialCommitState = await classifyLive(root, directory, commit);
  if (initialCommitState === 'after') return finishCommitted(directory, manifest, operations);
  if (initialCommitState === 'same')
    throw new ScreenshotTransactionError(
      'invalid-journal',
      'project.json does not provide a distinct transaction commit point.',
      token,
      true,
    );
  await assertExpectedState(root, directory, manifest.entries, ['before', 'after']);

  try {
    manifest = await setPhase(directory, manifest, 'applying', operations);
    for (const entry of manifest.entries.filter((candidate) => candidate !== commit)) {
      const state = await classifyLive(root, directory, entry);
      if (state === 'other')
        throw new ScreenshotTransactionError(
          'baseline-changed',
          `${entry.relativePath} changed externally; candidate was preserved.`,
          token,
          true,
        );
      if (state === 'before')
        await applyImage(
          livePath(root, entry.relativePath),
          await imageBytes(directory, entry.after),
          operations,
        );
      if (!stateIsAccepted(await classifyLive(root, directory, entry), ['after']))
        throw new Error(`${entry.relativePath} did not reach its candidate bytes.`);
    }

    await assertExpectedState(
      root,
      directory,
      manifest.entries.filter((entry) => entry !== commit),
      ['after'],
    );
    if ((await classifyLive(root, directory, commit)) !== 'before')
      throw new ScreenshotTransactionError(
        'baseline-changed',
        'project.json changed before the commit point; candidate was preserved.',
        token,
        true,
      );
    await applyImage(
      livePath(root, commit.relativePath),
      (await imageBytes(directory, commit.after))!,
      operations,
    );
    if ((await classifyLive(root, directory, commit)) !== 'after')
      throw new Error('project.json did not reach its committed bytes.');
    return finishCommitted(directory, manifest, operations);
  } catch (error) {
    if ((await classifyLive(root, directory, commit)) === 'after')
      return finishCommitted(directory, manifest, operations);
    try {
      await rollbackToBefore(root, directory, manifest, operations);
      await setPhase(directory, manifest, 'staged', operations);
    } catch (rollbackError) {
      throw new ScreenshotTransactionError(
        'rollback-failed',
        `Save failed and baseline repair is incomplete: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        token,
        true,
        { cause: error },
      );
    }
    if (error instanceof ScreenshotTransactionError) throw error;
    throw new ScreenshotTransactionError(
      'commit-failed',
      `Save failed; committed content was restored and the candidate remains recoverable: ${error instanceof Error ? error.message : String(error)}`,
      token,
      true,
      { cause: error },
    );
  }
}

async function transactionTokens(
  root: string,
  operations: ScreenshotTransactionOperations = defaultOperations,
): Promise<string[]> {
  const directory = journalRoot(root);
  await assertNoLinks(directory);
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const tokens: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !TOKEN_PATTERN.test(entry.name)) continue;
    const manifestPath = path.join(directory, entry.name, 'manifest.json');
    await assertNoLinks(manifestPath);
    const stat = await fs.stat(manifestPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isFile()) tokens.push(entry.name);
    else if (stat)
      throw new ScreenshotTransactionError(
        'invalid-journal',
        'Transaction manifest path is not a regular file.',
        entry.name,
        true,
      );
    else await cleanupIncompleteTransaction(path.join(directory, entry.name), operations);
  }
  return tokens.sort();
}

export async function listScreenshotTransactions(
  projectPath: string,
): Promise<ScreenshotTransactionSummary[]> {
  const root = await projectRoot(projectPath);
  const summaries: ScreenshotTransactionSummary[] = [];
  for (const token of await transactionTokens(root)) {
    const { manifest } = await loadManifest(root, token);
    summaries.push({
      token,
      kind: manifest.kind,
      phase: manifest.phase,
      paths: manifest.entries.map((entry) => entry.relativePath),
      createdAt: manifest.createdAt,
    });
  }
  return summaries;
}

export async function recoverScreenshotTransactions(
  projectPath: string,
  operations: ScreenshotTransactionOperations = defaultOperations,
): Promise<ScreenshotTransactionRecoveryResult[]> {
  const root = await projectRoot(projectPath);
  const results: ScreenshotTransactionRecoveryResult[] = [];
  for (const token of await transactionTokens(root, operations)) {
    const { directory, manifest } = await loadManifest(root, token);
    const commit = manifest.entries.find((entry) => entry.relativePath.toLowerCase() === 'project.json')!;
    if (manifest.phase === 'committed') {
      const result = await finishCommitted(directory, manifest, operations);
      results.push({
        token,
        kind: manifest.kind,
        status: 'committed',
        candidateAvailable: false,
        cleanup: result.cleanup,
        warning: result.warning,
      });
      continue;
    }
    const commitState = await classifyLive(root, directory, commit);
    if (commitState === 'after') {
      const result = await finishCommitted(directory, manifest, operations);
      results.push({
        token,
        kind: manifest.kind,
        status: 'committed',
        candidateAvailable: false,
        cleanup: result.cleanup,
        warning: result.warning,
      });
      continue;
    }
    if (commitState === 'same')
      throw new ScreenshotTransactionError(
        'invalid-journal',
        'project.json does not provide a distinct transaction commit point.',
        token,
        true,
      );
    const hadAppliedBytes = (
      await Promise.all(
        manifest.entries
          .filter((entry) => entry !== commit)
          .map((entry) => classifyLive(root, directory, entry)),
      )
    ).includes('after');
    await rollbackToBefore(root, directory, manifest, operations);
    await setPhase(directory, manifest, 'staged', operations);
    results.push({
      token,
      kind: manifest.kind,
      status: hadAppliedBytes ? 'baseline-restored' : 'candidate-staged',
      candidateAvailable: true,
    });
  }
  return results;
}

export function replayScreenshotTransaction(
  projectPath: string,
  token: string,
  operations: ScreenshotTransactionOperations = defaultOperations,
): Promise<ScreenshotTransactionCommitResult> {
  return commitScreenshotTransaction(projectPath, token, operations);
}

export async function discardScreenshotTransaction(
  projectPath: string,
  token: string,
  operations: ScreenshotTransactionOperations = defaultOperations,
): Promise<void> {
  const root = await projectRoot(projectPath);
  const { directory, manifest } = await loadManifest(root, token);
  if (manifest.phase === 'committed')
    throw new ScreenshotTransactionError(
      'cleanup-failed',
      'A committed transaction cannot be discarded.',
      token,
    );
  await assertExpectedState(root, directory, manifest.entries, ['before']);
  await cleanupTransaction(directory, manifest, operations);
}
