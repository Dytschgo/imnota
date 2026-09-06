import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';

const MAX_PNG_BYTES = 100_000_000;
const MAX_MARKDOWN_CHARACTERS = 2_000_000;
const MAX_TIMESTAMP_ATTEMPTS = 86_400;
const WINDOWS_FRIENDLY_PATH_UNITS = 240;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface StartPromptBundleSessionInput {
  /** Main integration must first authorize project membership and collection ownership. */
  projectPath: string;
  collectionId: string;
  collectionName: string;
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
  png: Uint8Array;
  markdown: string;
}

export interface StoredPromptBundle {
  bundleNumber: number;
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
  writeAtomically(filePath: string, content: string | Uint8Array): Promise<void>;
}

interface StoredSession {
  sessionId: string;
  collectionId: string;
  timestamp: string;
  setName: string;
  exportsDirectory: string;
  stagingDirectory: string;
  finalDirectory: string;
  reservationPath: string;
  completed: Map<number, StoredPromptBundle>;
  queue: Promise<void>;
  cancelRequested: boolean;
  finalizing: boolean;
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

function validatePng(png: Uint8Array): void {
  if (!(png instanceof Uint8Array) || png.length < 24 || png.length > MAX_PNG_BYTES)
    throw new Error('Prompt PNG is empty, damaged, or too large to store.');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (signature.some((byte, index) => png[index] !== byte))
    throw new Error('Prompt PNG has an invalid header.');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (view.getUint32(16) < 1 || view.getUint32(20) < 1) throw new Error('Prompt PNG has invalid dimensions.');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  private readonly dependencies: PromptBundleStoreDependencies;

  constructor(dependencies: Partial<PromptBundleStoreDependencies> = {}) {
    this.dependencies = {
      now: dependencies.now ?? (() => new Date()),
      randomId: dependencies.randomId ?? (() => randomUUID()),
      writeAtomically: dependencies.writeAtomically ?? atomicWrite,
    };
  }

  async startSession(input: StartPromptBundleSessionInput): Promise<PromptBundleSessionInfo> {
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
      await fs.mkdir(exportsDirectory, { recursive: true });
      if (await fs.stat(finalDirectory).catch(() => null)) continue;
      try {
        const reservation = await fs.open(reservationPath, 'wx');
        await reservation.close();
        reserved = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    if (!reserved) throw new Error('Could not reserve a unique prompt export timestamp.');

    const sessionId = this.dependencies.randomId();
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || this.sessions.has(sessionId)) {
      await fs.unlink(reservationPath).catch(() => undefined);
      throw new Error('Could not create a unique export session.');
    }
    const stagingDirectory = path.join(exportsDirectory, `.prompt-staging-${sessionId}`);
    try {
      await assertNoLinks(stagingDirectory);
      await fs.mkdir(stagingDirectory, { recursive: false });
    } catch (error) {
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
      completed: new Map(),
      queue: Promise.resolve(),
      cancelRequested: false,
      finalizing: false,
    });
    return { sessionId, collectionId, timestamp, setName };
  }

  async commitBundle(input: CommitPromptBundleInput): Promise<StoredPromptBundle> {
    const session = this.session(input.sessionId);
    validatePng(input.png);
    if (
      typeof input.markdown !== 'string' ||
      !input.markdown.trim() ||
      input.markdown.length > MAX_MARKDOWN_CHARACTERS
    )
      throw new Error('Prompt Markdown is empty or too large to store.');
    const suffix = bundleSuffix(input.bundleNumber);
    return await this.enqueue(session, async () => {
      if (session.cancelRequested) throw new Error('Prompt export was cancelled.');
      if (session.finalizing) throw new Error('Prompt export is already finishing.');
      if (session.completed.has(input.bundleNumber))
        throw new Error(`Prompt ${input.bundleNumber} is already stored.`);
      const base = `${session.setName} - ${suffix}`;
      const pngFilename = `${base}.png`;
      const markdownFilename = `${base}.md`;
      const pngPath = path.join(session.stagingDirectory, pngFilename);
      const markdownPath = path.join(session.stagingDirectory, markdownFilename);
      await assertNoLinks(pngPath);
      await assertNoLinks(markdownPath);
      if ((await fs.stat(pngPath).catch(() => null)) || (await fs.stat(markdownPath).catch(() => null)))
        throw new Error(`Prompt ${input.bundleNumber} would overwrite an existing staged file.`);
      try {
        await this.dependencies.writeAtomically(pngPath, input.png);
        if (session.cancelRequested) throw new Error('Prompt export was cancelled.');
        await this.dependencies.writeAtomically(markdownPath, input.markdown);
        if (session.cancelRequested) throw new Error('Prompt export was cancelled.');
        const stored = {
          bundleNumber: input.bundleNumber,
          pngFilename,
          markdownFilename,
          pngPath,
          markdownPath,
        };
        session.completed.set(input.bundleNumber, stored);
        return stored;
      } catch (error) {
        const cleanupErrors = await removeFiles([pngPath, markdownPath]);
        if (cleanupErrors.length)
          throw new AggregateError(
            [error, ...cleanupErrors.map((message) => new Error(message))],
            `Prompt ${input.bundleNumber} failed and incomplete files could not all be removed.`,
          );
        throw error;
      }
    });
  }

  finishSession(
    sessionId: string,
    options: FinishPromptBundleSessionOptions = {},
  ): Promise<FinalizedPromptBundleSession> {
    const session = this.session(sessionId);
    return this.enqueue(session, () => this.finalize(session, 'completed', options));
  }

  cancelSession(sessionId: string): Promise<FinalizedPromptBundleSession> {
    const session = this.session(sessionId);
    session.cancelRequested = true;
    return this.enqueue(session, () => this.finalize(session, 'cancelled'));
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
          options.masterMarkdown.length > MAX_MARKDOWN_CHARACTERS
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
      if (await fs.stat(session.finalDirectory).catch(() => null))
        throw new Error('The reserved prompt export folder already exists. Nothing was overwritten.');
      await fs.rename(session.stagingDirectory, session.finalDirectory);
      await fs.unlink(session.reservationPath).catch(() => undefined);
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
          pngPath: path.join(session.finalDirectory, bundle.pngFilename),
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
