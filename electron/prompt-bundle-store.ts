import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';

export const MAX_PROMPT_BUNDLE_PNG_BYTES = 100_000_000;
export const MAX_PROMPT_BUNDLE_PNG_EDGE = 16_384;
export const MAX_PROMPT_BUNDLE_PNG_PIXELS = 64_000_000;
export const MAX_PROMPT_BUNDLE_MARKDOWN_CHARACTERS = 2_000_000;
export const MAX_PROMPT_BUNDLE_MARKDOWN_BYTES = 8_000_000;
export const MAX_PROMPT_BUNDLE_SOURCE_BYTES = 8_000_000;
const MAX_TIMESTAMP_ATTEMPTS = 86_400;
const MAX_OWNERSHIP_RECORD_BYTES = 4_096;
const MAX_RECOVERY_ENTRIES = 10_000;
const OWNERSHIP_RECORD_FILENAME = '.imnota-prompt-export.json';
const OWNERSHIP_RECORD_KIND = 'imnota-prompt-export-session';
const WINDOWS_FRIENDLY_PATH_UNITS = 240;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface StartPromptBundleSessionInput {
  /** Main integration must first authorize project membership and collection ownership. */
  projectPath: string;
  collectionId: string;
  collectionName: string;
  bundles: readonly PromptBundleManifestItem[];
}

export interface PromptBundleManifestItem {
  bundleNumber: number;
  /** False reserves a Markdown-only bundle and intentionally no PNG file. */
  hasImage?: boolean;
  width: number;
  height: number;
}

export interface PromptBundleSourceAsset {
  filename: string;
  source: string;
}

export interface PromptBundleSessionInfo {
  sessionId: string;
  collectionId: string;
  timestamp: string;
  setName: string;
}

export interface CommitPromptBundleInput {
  sessionId: string;
  bundleNumber: number;
  png?: Uint8Array;
  markdown: string;
  sourceAssets?: readonly PromptBundleSourceAsset[];
}

export interface StoredPromptBundle {
  bundleNumber: number;
  width: number;
  height: number;
  pngFilename: string;
  markdownFilename: string;
  pngPath: string;
  markdownPath: string;
}

export interface FinalizedPromptBundleSession {
  status: 'completed' | 'cancelled';
  published: boolean;
  folderPath?: string;
  masterMarkdownPath?: string;
  bundles: StoredPromptBundle[];
  warnings: string[];
}

export interface FinishPromptBundleSessionOptions {
  /** Optional inspection artifact. It is never used by the primary clipboard action. */
  masterMarkdown?: string;
}

export interface PromptBundleStoreDependencies {
  now(): Date;
  randomId(): string;
  ownerProcessId(): number;
  isProcessAlive(processId: number): boolean;
  writeAtomically(filePath: string, content: string | Uint8Array): Promise<void>;
  /** Must fully decode the structurally bounded PNG, not merely inspect its header. */
  validateDecodedPng(
    png: Uint8Array,
    expected: Pick<PromptBundleManifestItem, 'width' | 'height'>,
  ): Promise<void> | void;
}

type PromptBundleStoreOptions = Pick<PromptBundleStoreDependencies, 'validateDecodedPng'> &
  Partial<Omit<PromptBundleStoreDependencies, 'validateDecodedPng'>>;

interface StoredSession {
  sessionId: string;
  collectionId: string;
  timestamp: string;
  setName: string;
  exportsDirectory: string;
  stagingDirectory: string;
  finalDirectory: string;
  reservationPath: string;
  ownershipJournalPath: string;
  completed: Map<number, StoredPromptBundle>;
  sourceAssets: Map<string, string>;
  incompleteFiles: Set<string>;
  manifest: Map<number, PromptBundleManifestItem>;
  queue: Promise<void>;
  cancelRequested: boolean;
  finalizing: boolean;
}

interface PromptBundleOwnershipRecord {
  kind: typeof OWNERSHIP_RECORD_KIND;
  version: 1;
  sessionId: string;
  collectionId: string;
  setName: string;
  ownerProcessId: number;
}

function validatePathSegment(value: string, label: string): string {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    /[\\/:]/.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(value)
  )
    throw new Error(`${label} is not a safe path segment.`);
  return value;
}

export function sanitizePromptCollectionName(value: string): string {
  let clean = Array.from(value.normalize('NFC'), (character) =>
    character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character,
  )
    .join('')
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  if (!clean) clean = 'Untitled collection';
  if (WINDOWS_RESERVED_NAME.test(clean)) clean = `_${clean}`;
  clean = Array.from(clean)
    .slice(0, 120)
    .join('')
    .replace(/[. ]+$/g, '');
  return clean || 'Untitled collection';
}

function maximumPublishedPath(exportsDirectory: string, setName: string): string {
  const bundlePath = path.join(exportsDirectory, setName, `${setName} - 999.png`);
  const overviewPath = path.join(exportsDirectory, setName, `${setName} - overview.md`);
  return bundlePath.length >= overviewPath.length ? bundlePath : overviewPath;
}

export function budgetPromptCollectionName(
  exportsDirectory: string,
  value: string,
  timestamp: string,
  maximumPathUnits = WINDOWS_FRIENDLY_PATH_UNITS,
): string {
  if (!path.isAbsolute(exportsDirectory)) throw new Error('Collection exports path must be absolute.');
  if (!Number.isSafeInteger(maximumPathUnits) || maximumPathUnits < 1)
    throw new Error('Maximum export path length must be a positive integer.');
  const characters = Array.from(sanitizePromptCollectionName(value));
  while (characters.length) {
    const candidate = characters.join('').replace(/[. ]+$/g, '');
    if (candidate) {
      const setName = `${candidate} - ${timestamp}`;
      if (maximumPublishedPath(exportsDirectory, setName).length <= maximumPathUnits) return candidate;
    }
    characters.pop();
  }
  throw new Error(
    'The workspace path is too long for safe Windows-compatible prompt filenames. Move the workspace closer to the drive root and try again.',
  );
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatPromptTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('Export timestamp is invalid.');
  return `${two(date.getFullYear() % 100)}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

function bundleSuffix(bundleNumber: number): string {
  if (!Number.isSafeInteger(bundleNumber) || bundleNumber < 1 || bundleNumber > 999)
    throw new Error('Bundle number must be between 1 and 999.');
  return String(bundleNumber).padStart(2, '0');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkType(png: Uint8Array, offset: number): string {
  return String.fromCharCode(png[offset], png[offset + 1], png[offset + 2], png[offset + 3]);
}

export function validatePromptBundlePng(
  png: Uint8Array,
  expected: Pick<PromptBundleManifestItem, 'width' | 'height'>,
): void {
  if (!(png instanceof Uint8Array) || png.length < 57 || png.length > MAX_PROMPT_BUNDLE_PNG_BYTES)
    throw new Error('Prompt PNG is empty, damaged, or too large to store.');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => png[index] !== byte))
    throw new Error('Prompt PNG has an invalid header.');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let chunkIndex = 0;
  let width = 0;
  let height = 0;
  let sawData = false;
  let sawEnd = false;
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error('Prompt PNG is truncated.');
    const length = view.getUint32(offset);
    if (length > png.length - offset - 12) throw new Error('Prompt PNG contains a truncated chunk.');
    const typeOffset = offset + 4;
    const type = chunkType(png, typeOffset);
    const dataOffset = typeOffset + 4;
    const crcOffset = dataOffset + length;
    if (view.getUint32(crcOffset) !== crc32(png.subarray(typeOffset, crcOffset)))
      throw new Error('Prompt PNG failed its integrity check.');
    if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13))
      throw new Error('Prompt PNG is missing its required header.');
    if (type === 'IHDR') {
      if (chunkIndex !== 0 || width || height) throw new Error('Prompt PNG contains duplicate headers.');
      width = view.getUint32(dataOffset);
      height = view.getUint32(dataOffset + 4);
      if (
        width < 1 ||
        height < 1 ||
        width > MAX_PROMPT_BUNDLE_PNG_EDGE ||
        height > MAX_PROMPT_BUNDLE_PNG_EDGE ||
        width * height > MAX_PROMPT_BUNDLE_PNG_PIXELS
      )
        throw new Error('Prompt PNG dimensions exceed safe full-resolution storage limits.');
      if (width !== expected.width || height !== expected.height)
        throw new Error('Prompt PNG dimensions do not match the reserved bundle manifest.');
    } else if (type === 'IDAT') sawData = true;
    else if (type === 'IEND') {
      if (length !== 0 || !sawData) throw new Error('Prompt PNG has an invalid ending.');
      sawEnd = true;
      offset = crcOffset + 4;
      break;
    }
    offset = crcOffset + 4;
    chunkIndex++;
  }
  if (!sawEnd || offset !== png.length) throw new Error('Prompt PNG is incomplete or has trailing data.');
}

function validateManifest(items: readonly PromptBundleManifestItem[]): Map<number, PromptBundleManifestItem> {
  if (!Array.isArray(items) || !items.length || items.length > 999)
    throw new Error('Prompt export manifest must contain between 1 and 999 bundles.');
  const manifest = new Map<number, PromptBundleManifestItem>();
  for (const [index, item] of items.entries()) {
    if (item.bundleNumber !== index + 1)
      throw new Error('Prompt export manifest bundle numbers must be contiguous from 1.');
    const hasImage = item.hasImage !== false;
    if (
      !Number.isSafeInteger(item.width) ||
      !Number.isSafeInteger(item.height) ||
      item.width < (hasImage ? 1 : 0) ||
      item.height < (hasImage ? 1 : 0) ||
      item.width > MAX_PROMPT_BUNDLE_PNG_EDGE ||
      item.height > MAX_PROMPT_BUNDLE_PNG_EDGE ||
      item.width * item.height > MAX_PROMPT_BUNDLE_PNG_PIXELS
    )
      throw new Error(`Prompt ${item.bundleNumber} dimensions exceed safe storage limits.`);
    if (!hasImage && (item.width !== 0 || item.height !== 0))
      throw new Error(`Text-only Prompt ${item.bundleNumber} must not reserve image dimensions.`);
    manifest.set(item.bundleNumber, { ...item, hasImage });
  }
  return manifest;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function parseOwnershipRecord(value: string): PromptBundleOwnershipRecord | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'collectionId,kind,ownerProcessId,sessionId,setName,version' ||
    record.kind !== OWNERSHIP_RECORD_KIND ||
    record.version !== 1 ||
    typeof record.sessionId !== 'string' ||
    typeof record.collectionId !== 'string' ||
    typeof record.setName !== 'string' ||
    !Number.isSafeInteger(record.ownerProcessId) ||
    (record.ownerProcessId as number) < 1
  )
    return undefined;
  try {
    validatePathSegment(record.sessionId, 'Session ID');
    validatePathSegment(record.collectionId, 'Collection ID');
    validatePathSegment(record.setName, 'Export set name');
  } catch {
    return undefined;
  }
  return record as unknown as PromptBundleOwnershipRecord;
}

async function readOwnershipRecord(filePath: string): Promise<PromptBundleOwnershipRecord | undefined> {
  await assertNoLinks(filePath);
  const handle = await fs.open(filePath, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!handle) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_OWNERSHIP_RECORD_BYTES) return undefined;
    const content = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(content, 0, content.length, 0);
    if (bytesRead !== content.length) return undefined;
    const trailing = Buffer.alloc(1);
    if ((await handle.read(trailing, 0, 1, content.length)).bytesRead) return undefined;
    try {
      return parseOwnershipRecord(new TextDecoder('utf-8', { fatal: true }).decode(content));
    } catch {
      return undefined;
    }
  } finally {
    await handle.close();
  }
}

function sameOwnershipRecord(left: PromptBundleOwnershipRecord, right: PromptBundleOwnershipRecord): boolean {
  return (
    left.kind === right.kind &&
    left.version === right.version &&
    left.sessionId === right.sessionId &&
    left.collectionId === right.collectionId &&
    left.setName === right.setName &&
    left.ownerProcessId === right.ownerProcessId
  );
}

async function lstatIfExists(filePath: string) {
  return await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function containsLinkOrTooManyEntries(directory: string): Promise<boolean> {
  let visited = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      visited++;
      if (visited > MAX_RECOVERY_ENTRIES || entry.isSymbolicLink()) return true;
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      else if (!entry.isFile()) return true;
    }
  }
  return false;
}

async function removeFiles(filePaths: readonly string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        errors.push(`${path.basename(filePath)}: ${errorMessage(error)}`);
    }
  }
  return errors;
}

export class PromptBundleStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly terminalResults = new Map<string, FinalizedPromptBundleSession>();
  private readonly finalizations = new Map<string, Promise<FinalizedPromptBundleSession>>();
  private readonly dependencies: PromptBundleStoreDependencies;

  constructor(dependencies: PromptBundleStoreOptions) {
    this.dependencies = {
      now: dependencies.now ?? (() => new Date()),
      randomId: dependencies.randomId ?? (() => randomUUID()),
      ownerProcessId: dependencies.ownerProcessId ?? (() => process.pid),
      isProcessAlive: dependencies.isProcessAlive ?? defaultProcessAlive,
      writeAtomically: dependencies.writeAtomically ?? atomicWrite,
      validateDecodedPng: dependencies.validateDecodedPng,
    };
  }

  async validatePng(
    png: Uint8Array,
    expected: Pick<PromptBundleManifestItem, 'width' | 'height'>,
  ): Promise<void> {
    validatePromptBundlePng(png, expected);
    await this.dependencies.validateDecodedPng(png, expected);
  }

  async startSession(input: StartPromptBundleSessionInput): Promise<PromptBundleSessionInfo> {
    const manifest = validateManifest(input.bundles);
    if (!path.isAbsolute(input.projectPath)) throw new Error('Project path must be absolute.');
    const projectPath = path.resolve(input.projectPath);
    const collectionId = validatePathSegment(input.collectionId, 'Collection ID');
    const collectionDirectory = path.join(projectPath, 'collections', collectionId);
    const exportsDirectory = path.join(collectionDirectory, 'exports');
    if (!isWithin(projectPath, exportsDirectory))
      throw new Error('Collection exports path is outside the project.');
    await assertNoLinks(projectPath);
    await assertNoLinks(collectionDirectory);
    const collectionStat = await fs.stat(collectionDirectory).catch(() => null);
    if (!collectionStat?.isDirectory()) throw new Error('Collection folder is unavailable.');
    await assertNoLinks(exportsDirectory);
    await fs.mkdir(exportsDirectory, { recursive: true });
    await this.recoverOwnedSessions(exportsDirectory, collectionId);
    const sessionId = this.dependencies.randomId();
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || this.sessions.has(sessionId))
      throw new Error('Could not create a unique export session.');
    const baseTime = this.dependencies.now();
    let timestamp = '';
    let setName = '';
    let finalDirectory = '';
    let reservationPath = '';
    let reserved = false;
    for (let offset = 0; offset < MAX_TIMESTAMP_ATTEMPTS; offset++) {
      timestamp = formatPromptTimestamp(new Date(baseTime.getTime() + offset * 1000));
      const safeCollectionName = budgetPromptCollectionName(
        exportsDirectory,
        input.collectionName,
        timestamp,
      );
      setName = `${safeCollectionName} - ${timestamp}`;
      finalDirectory = path.join(exportsDirectory, setName);
      reservationPath = path.join(exportsDirectory, `.${setName}.reservation`);
      await assertNoLinks(finalDirectory);
      await assertNoLinks(exportsDirectory);
      if (await fs.stat(finalDirectory).catch(() => null)) continue;
      try {
        const reservation = await fs.open(reservationPath, 'wx');
        try {
          const ownership: PromptBundleOwnershipRecord = {
            kind: OWNERSHIP_RECORD_KIND,
            version: 1,
            sessionId,
            collectionId,
            setName,
            ownerProcessId: this.dependencies.ownerProcessId(),
          };
          await reservation.writeFile(JSON.stringify(ownership), 'utf8');
        } finally {
          await reservation.close();
        }
        reserved = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    if (!reserved) throw new Error('Could not reserve a unique prompt export timestamp.');

    const stagingDirectory = path.join(exportsDirectory, `.prompt-staging-${sessionId}`);
    const ownershipJournalPath = path.join(stagingDirectory, OWNERSHIP_RECORD_FILENAME);
    let createdStaging = false;
    try {
      await assertNoLinks(stagingDirectory);
      await fs.mkdir(stagingDirectory, { recursive: false });
      createdStaging = true;
      const [realExports, realStaging] = await Promise.all([
        fs.realpath(exportsDirectory),
        fs.realpath(stagingDirectory),
      ]);
      if (!isWithin(realExports, realStaging) || realExports === realStaging)
        throw new Error('Prompt staging directory escaped its collection exports folder.');
      const reservationRecord = await readOwnershipRecord(reservationPath);
      if (!reservationRecord) throw new Error('Prompt export ownership reservation is invalid.');
      await fs.writeFile(ownershipJournalPath, JSON.stringify(reservationRecord), {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      if (createdStaging)
        await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      await fs.unlink(reservationPath).catch(() => undefined);
      throw error;
    }

    this.sessions.set(sessionId, {
      sessionId,
      collectionId,
      timestamp,
      setName,
      exportsDirectory,
      stagingDirectory,
      finalDirectory,
      reservationPath,
      ownershipJournalPath,
      completed: new Map(),
      sourceAssets: new Map(),
      incompleteFiles: new Set(),
      manifest,
      queue: Promise.resolve(),
      cancelRequested: false,
      finalizing: false,
    });
    return { sessionId, collectionId, timestamp, setName };
  }

  private async recoverOwnedSessions(exportsDirectory: string, collectionId: string): Promise<void> {
    const entries = await fs.readdir(exportsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith('.prompt-staging-') || !entry.isDirectory() || entry.isSymbolicLink())
        continue;
      const sessionId = entry.name.slice('.prompt-staging-'.length);
      if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || this.sessions.has(sessionId)) continue;
      const stagingDirectory = path.join(exportsDirectory, entry.name);
      try {
        const stagingRecord = await readOwnershipRecord(
          path.join(stagingDirectory, OWNERSHIP_RECORD_FILENAME),
        );
        if (
          !stagingRecord ||
          stagingRecord.sessionId !== sessionId ||
          stagingRecord.collectionId !== collectionId ||
          stagingRecord.ownerProcessId === this.dependencies.ownerProcessId() ||
          this.dependencies.isProcessAlive(stagingRecord.ownerProcessId)
        )
          continue;
        const reservationPath = path.join(exportsDirectory, `.${stagingRecord.setName}.reservation`);
        const reservationRecord = await readOwnershipRecord(reservationPath);
        if (!reservationRecord || !sameOwnershipRecord(stagingRecord, reservationRecord)) continue;
        const finalDirectory = path.join(exportsDirectory, stagingRecord.setName);
        if ((await lstatIfExists(finalDirectory)) || (await containsLinkOrTooManyEntries(stagingDirectory)))
          continue;
        await assertNoLinks(stagingDirectory);
        await assertNoLinks(reservationPath);
        await fs.rm(stagingDirectory, { recursive: true });
        await fs.unlink(reservationPath).catch(() => undefined);
      } catch {
        // Foreign, malformed, linked, changing, or inaccessible entries are left untouched.
      }
    }
    await this.recoverOwnedReservations(exportsDirectory, collectionId);
  }

  private async recoverOwnedReservations(exportsDirectory: string, collectionId: string): Promise<void> {
    const entries = await fs.readdir(exportsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith('.') || !entry.name.endsWith('.reservation') || !entry.isFile()) continue;
      const reservationPath = path.join(exportsDirectory, entry.name);
      try {
        const record = await readOwnershipRecord(reservationPath);
        if (
          !record ||
          entry.name !== `.${record.setName}.reservation` ||
          record.collectionId !== collectionId ||
          this.sessions.has(record.sessionId) ||
          record.ownerProcessId === this.dependencies.ownerProcessId() ||
          this.dependencies.isProcessAlive(record.ownerProcessId)
        )
          continue;
        const stagingDirectory = path.join(exportsDirectory, `.prompt-staging-${record.sessionId}`);
        if (await lstatIfExists(stagingDirectory)) continue;
        await assertNoLinks(reservationPath);
        await fs.unlink(reservationPath);
      } catch {
        // Reservations that cannot be proven abandoned and app-owned remain untouched.
      }
    }
  }

  async commitBundle(input: CommitPromptBundleInput): Promise<StoredPromptBundle> {
    const session = this.session(input.sessionId);
    const expected = session.manifest.get(input.bundleNumber);
    if (!expected) throw new Error(`Prompt ${input.bundleNumber} is not in the reserved bundle manifest.`);
    const hasImage = expected.hasImage !== false;
    if (hasImage && !input.png) throw new Error(`Prompt ${input.bundleNumber} requires a PNG.`);
    if (!hasImage && input.png)
      throw new Error(`Text-only Prompt ${input.bundleNumber} must not include a PNG.`);
    if (input.png) validatePromptBundlePng(input.png, expected);
    if (
      typeof input.markdown !== 'string' ||
      !input.markdown.trim() ||
      input.markdown.length > MAX_PROMPT_BUNDLE_MARKDOWN_CHARACTERS ||
      Buffer.byteLength(input.markdown, 'utf8') > MAX_PROMPT_BUNDLE_MARKDOWN_BYTES
    )
      throw new Error('Prompt Markdown is empty or too large to store.');
    const suffix = bundleSuffix(input.bundleNumber);
    return await this.enqueue(session, async () => {
      if (session.cancelRequested) throw new Error('Prompt export was cancelled.');
      if (session.finalizing) throw new Error('Prompt export is already finishing.');
      if (input.png) await this.dependencies.validateDecodedPng(input.png, expected);
      if (session.cancelRequested) throw new Error('Prompt export was cancelled.');
      if (session.completed.has(input.bundleNumber))
        throw new Error(`Prompt ${input.bundleNumber} is already stored.`);
      const base = `${session.setName} - ${suffix}`;
      const pngFilename = hasImage ? `${base}.png` : '';
      const markdownFilename = `${base}.md`;
      const pngPath = hasImage ? path.join(session.stagingDirectory, pngFilename) : undefined;
      const markdownPath = path.join(session.stagingDirectory, markdownFilename);
      const [realExports, realStaging] = await Promise.all([
        fs.realpath(session.exportsDirectory),
        fs.realpath(session.stagingDirectory),
      ]);
      if (!isWithin(realExports, realStaging) || realExports === realStaging)
        throw new Error('Prompt staging directory escaped its collection exports folder.');
      await assertNoLinks(session.stagingDirectory);
      if (pngPath) await assertNoLinks(pngPath);
      await assertNoLinks(markdownPath);
      if (
        (pngPath && (await fs.stat(pngPath).catch(() => null))) ||
        (await fs.stat(markdownPath).catch(() => null))
      )
        throw new Error(`Prompt ${input.bundleNumber} would overwrite an existing staged file.`);
      const ownedPaths = [...(pngPath ? [pngPath] : []), markdownPath];
      const addedSources = new Map<string, string>();
      ownedPaths.forEach((target) => session.incompleteFiles.add(target));
      try {
        if (pngPath && input.png) await this.dependencies.writeAtomically(pngPath, input.png);
        if (session.cancelRequested) throw new Error('Prompt export was cancelled.');
        await this.dependencies.writeAtomically(markdownPath, input.markdown);
        if (session.cancelRequested) throw new Error('Prompt export was cancelled.');
        await this.writeSourceAssets(session, input.sourceAssets ?? [], ownedPaths, addedSources);
        const stored = {
          bundleNumber: input.bundleNumber,
          width: expected.width,
          height: expected.height,
          pngFilename,
          markdownFilename,
          pngPath: pngPath ?? '',
          markdownPath,
        };
        session.completed.set(input.bundleNumber, stored);
        addedSources.forEach((source, filename) => session.sourceAssets.set(filename, source));
        ownedPaths.forEach((target) => session.incompleteFiles.delete(target));
        return stored;
      } catch (error) {
        const cleanupErrors = await removeFiles(ownedPaths);
        if (cleanupErrors.length)
          throw new AggregateError(
            [error, ...cleanupErrors.map((message) => new Error(message))],
            `Prompt ${input.bundleNumber} failed and incomplete files could not all be removed.`,
          );
        ownedPaths.forEach((target) => session.incompleteFiles.delete(target));
        throw error;
      }
    });
  }

  finishSession(
    sessionId: string,
    options: FinishPromptBundleSessionOptions = {},
  ): Promise<FinalizedPromptBundleSession> {
    return this.beginFinalization(sessionId, 'completed', options);
  }

  cancelSession(sessionId: string): Promise<FinalizedPromptBundleSession> {
    return this.beginFinalization(sessionId, 'cancelled');
  }

  private beginFinalization(
    sessionId: string,
    status: FinalizedPromptBundleSession['status'],
    options: FinishPromptBundleSessionOptions = {},
  ): Promise<FinalizedPromptBundleSession> {
    const terminal = this.terminalResults.get(sessionId);
    if (terminal) return Promise.resolve(terminal);
    const current = this.finalizations.get(sessionId);
    if (current) return current;
    const session = this.session(sessionId);
    if (status === 'cancelled') session.cancelRequested = true;
    const result = this.enqueue(session, () => this.finalize(session, status, options));
    this.finalizations.set(sessionId, result);
    void result.then(
      (value) => {
        this.finalizations.delete(sessionId);
        this.terminalResults.set(sessionId, value);
        if (this.terminalResults.size > 128)
          this.terminalResults.delete(this.terminalResults.keys().next().value!);
      },
      () => this.finalizations.delete(sessionId),
    );
    return result;
  }

  private session(sessionId: string): StoredSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Prompt export session was not found or has already closed.');
    return session;
  }

  private enqueue<T>(session: StoredSession, operation: () => Promise<T>): Promise<T> {
    const result = session.queue.then(operation);
    session.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Sources are written under a fixed child directory, never from a renderer path. */
  private async writeSourceAssets(
    session: StoredSession,
    assets: readonly PromptBundleSourceAsset[],
    ownedPaths: string[],
    addedSources: Map<string, string>,
  ): Promise<void> {
    for (const asset of assets) {
      const filename = validatePathSegment(asset.filename, 'Source filename');
      if (!filename.endsWith('.json')) throw new Error('Drawing source filename must end in .json.');
      if (
        typeof asset.source !== 'string' ||
        !asset.source.trim() ||
        Buffer.byteLength(asset.source, 'utf8') > MAX_PROMPT_BUNDLE_SOURCE_BYTES
      )
        throw new Error('Drawing source is empty or too large to store.');
      const prior = session.sourceAssets.get(filename) ?? addedSources.get(filename);
      if (prior !== undefined) {
        if (prior !== asset.source) throw new Error(`Drawing source ${filename} changed during export.`);
        continue;
      }
      const sourceDirectory = path.join(session.stagingDirectory, 'sources');
      const sourcePath = path.join(sourceDirectory, filename);
      await assertNoLinks(sourceDirectory);
      await fs.mkdir(sourceDirectory, { recursive: true });
      await assertNoLinks(sourcePath);
      if (await fs.stat(sourcePath).catch(() => null))
        throw new Error(`Drawing source ${filename} already exists.`);
      ownedPaths.push(sourcePath);
      session.incompleteFiles.add(sourcePath);
      await this.dependencies.writeAtomically(sourcePath, asset.source);
      addedSources.set(filename, asset.source);
    }
  }

  private async finalize(
    session: StoredSession,
    status: FinalizedPromptBundleSession['status'],
    options: FinishPromptBundleSessionOptions = {},
  ): Promise<FinalizedPromptBundleSession> {
    if (session.finalizing) throw new Error('Prompt export is already finishing.');
    session.finalizing = true;
    const completed = [...session.completed.values()].sort(
      (left, right) => left.bundleNumber - right.bundleNumber,
    );
    const warnings: string[] = [];
    let masterMarkdownFilename: string | undefined;
    try {
      const cleanupErrors = await removeFiles([...session.incompleteFiles]);
      if (cleanupErrors.length)
        throw new Error(
          `Incomplete export files need cleanup before publication: ${cleanupErrors.join('; ')}`,
        );
      session.incompleteFiles.clear();
      if (
        status === 'completed' &&
        (completed.length !== session.manifest.size ||
          completed.some((bundle, index) => bundle.bundleNumber !== index + 1))
      )
        throw new Error(
          `Prompt export is incomplete: ${completed.length} of ${session.manifest.size} bundle pairs are stored. Write every reserved bundle before finishing, or cancel to retain the completed subset.`,
        );
      if (!completed.length) {
        await fs.rm(session.stagingDirectory, { recursive: true, force: true });
        await fs.unlink(session.reservationPath).catch(() => undefined);
        this.sessions.delete(session.sessionId);
        return { status, published: false, bundles: [], warnings };
      }
      if (options.masterMarkdown !== undefined) {
        if (
          typeof options.masterMarkdown !== 'string' ||
          !options.masterMarkdown.trim() ||
          options.masterMarkdown.length > MAX_PROMPT_BUNDLE_MARKDOWN_CHARACTERS ||
          Buffer.byteLength(options.masterMarkdown, 'utf8') > MAX_PROMPT_BUNDLE_MARKDOWN_BYTES
        )
          warnings.push('Master overview was not stored because it was empty or too large.');
        else {
          masterMarkdownFilename = `${session.setName} - overview.md`;
          const masterPath = path.join(session.stagingDirectory, masterMarkdownFilename);
          try {
            await assertNoLinks(masterPath);
            await this.dependencies.writeAtomically(masterPath, options.masterMarkdown);
          } catch (error) {
            masterMarkdownFilename = undefined;
            const cleanupErrors = await removeFiles([masterPath]);
            warnings.push(
              `Master overview could not be stored: ${errorMessage(error)}${cleanupErrors.length ? ` Cleanup also failed: ${cleanupErrors.join('; ')}` : ''}`,
            );
          }
        }
      }
      await assertNoLinks(session.stagingDirectory);
      await assertNoLinks(session.finalDirectory);
      const [realExports, realStaging] = await Promise.all([
        fs.realpath(session.exportsDirectory),
        fs.realpath(session.stagingDirectory),
      ]);
      if (!isWithin(realExports, realStaging) || realExports === realStaging)
        throw new Error('Prompt staging directory escaped its collection exports folder.');
      if (await fs.stat(session.finalDirectory).catch(() => null)) {
        warnings.push(
          'The reserved destination appeared before publication. Complete bundle pairs remain in the reported recovery folder; nothing was overwritten.',
        );
        await assertNoLinks(session.ownershipJournalPath);
        await fs.writeFile(session.ownershipJournalPath, '{"kind":"imnota-prompt-export-retained"}');
        await fs.unlink(session.ownershipJournalPath).catch((error) => {
          warnings.push(`Export ownership marker cleanup failed: ${errorMessage(error)}`);
        });
        await fs.unlink(session.reservationPath).catch((error) => {
          warnings.push(`Timestamp reservation cleanup failed: ${errorMessage(error)}`);
        });
        this.sessions.delete(session.sessionId);
        return {
          status,
          published: false,
          folderPath: session.stagingDirectory,
          masterMarkdownPath: masterMarkdownFilename
            ? path.join(session.stagingDirectory, masterMarkdownFilename)
            : undefined,
          bundles: completed,
          warnings,
        };
      }
      await fs.rename(session.stagingDirectory, session.finalDirectory);
      await fs
        .unlink(path.join(session.finalDirectory, OWNERSHIP_RECORD_FILENAME))
        .catch((error) => warnings.push(`Export ownership marker cleanup failed: ${errorMessage(error)}`));
      await fs.unlink(session.reservationPath).catch((error) => {
        warnings.push(`Timestamp reservation cleanup failed: ${errorMessage(error)}`);
      });
      this.sessions.delete(session.sessionId);
      return {
        status,
        published: true,
        folderPath: session.finalDirectory,
        masterMarkdownPath: masterMarkdownFilename
          ? path.join(session.finalDirectory, masterMarkdownFilename)
          : undefined,
        bundles: completed.map((bundle) => ({
          ...bundle,
          pngPath: bundle.pngFilename ? path.join(session.finalDirectory, bundle.pngFilename) : '',
          markdownPath: path.join(session.finalDirectory, bundle.markdownFilename),
        })),
        warnings,
      };
    } catch (error) {
      session.finalizing = false;
      throw error;
    }
  }
}
