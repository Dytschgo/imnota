import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PromptExportBundleContent,
  PromptExportBundleGrant,
  PromptExportBundleManifest,
  PromptExportCopyTarget,
  PromptExportFinalized,
  PromptExportOpenTarget,
  PromptExportSessionInfo,
} from '../src/shared/workflow-bridge.js';
import { assertNoLinks, isWithin } from './files.js';
import {
  MAX_PROMPT_BUNDLE_MARKDOWN_BYTES,
  MAX_PROMPT_BUNDLE_MARKDOWN_CHARACTERS,
  MAX_PROMPT_BUNDLE_PNG_BYTES,
  PromptBundleStore,
  type PromptBundleSourceAsset,
  type FinalizedPromptBundleSession,
  type StoredPromptBundle,
} from './prompt-bundle-store.js';
import { NativeWorkflowError } from './workflow-errors.js';

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const MAX_PNG_DATA_URL_CHARACTERS =
  PNG_DATA_URL_PREFIX.length + Math.ceil(MAX_PROMPT_BUNDLE_PNG_BYTES / 3) * 4;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_FINALIZED_GRANTS = 128;

export interface AuthorizedPromptCollection {
  projectPath: string;
  collectionId: string;
  collectionName: string;
}

export interface PromptBundleWorkflowDependencies {
  authorize(projectPath: string, collectionId: string): Promise<AuthorizedPromptCollection>;
  copyContext(markdown: string, imageDataUrl: string): Promise<void> | void;
  copyText(markdown: string): Promise<void> | void;
  copyImage(imageDataUrl: string): Promise<void> | void;
  openPath(targetPath: string): Promise<void>;
}

interface ActiveGrant {
  phase: 'active';
  projectPath: string;
  collectionId: string;
  finalization?: Promise<PromptExportFinalized>;
}

interface FinalGrant {
  phase: 'final';
  projectPath: string;
  collectionId: string;
  folderPath?: string;
  masterMarkdownPath?: string;
  bundles: Map<number, StoredPromptBundle>;
  result: PromptExportFinalized;
}

type SessionGrant = ActiveGrant | FinalGrant;

function publicBundle(bundle: StoredPromptBundle): PromptExportBundleGrant {
  return {
    bundleNumber: bundle.bundleNumber,
    pngFilename: bundle.pngFilename,
    markdownFilename: bundle.markdownFilename,
  };
}

function publicFinalized(result: FinalizedPromptBundleSession): PromptExportFinalized {
  return {
    status: result.status,
    published: result.published,
    bundles: result.bundles.map(publicBundle),
    hasMasterMarkdown: Boolean(result.masterMarkdownPath),
    warnings: [...result.warnings],
  };
}

function decodePngDataUrl(dataUrl: string): Uint8Array {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_PNG_DATA_URL_CHARACTERS)
    throw new NativeWorkflowError('invalid-input', 'Prompt PNG is empty or too large.');
  const match = PNG_DATA_URL.exec(dataUrl);
  if (!match) throw new NativeWorkflowError('invalid-input', 'Prompt image must be a PNG data URL.');
  return Buffer.from(match[1], 'base64');
}

async function readBoundedRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new NativeWorkflowError('io-failure', `${label} is no longer a regular file.`);
    if (stat.size < 0 || stat.size > maximumBytes)
      throw new NativeWorkflowError(
        'io-failure',
        `${label} is larger than the safe ${maximumBytes.toLocaleString('en-US')}-byte read limit.`,
      );
    const content = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
      if (!bytesRead)
        throw new NativeWorkflowError('io-failure', `${label} changed while it was being read.`);
      offset += bytesRead;
    }
    const trailing = Buffer.alloc(1);
    if ((await handle.read(trailing, 0, 1, offset)).bytesRead)
      throw new NativeWorkflowError('io-failure', `${label} changed or exceeded its limit while being read.`);
    return content;
  } finally {
    await handle.close();
  }
}

export class PromptBundleWorkflow {
  private readonly grants = new Map<string, SessionGrant>();

  constructor(
    private readonly dependencies: PromptBundleWorkflowDependencies,
    private readonly store: PromptBundleStore,
  ) {}

  async start(
    projectPath: string,
    collectionId: string,
    bundles: readonly PromptExportBundleManifest[],
  ): Promise<PromptExportSessionInfo> {
    const authorized = await this.dependencies.authorize(projectPath, collectionId);
    const session = await this.store.startSession({
      projectPath: authorized.projectPath,
      collectionId: authorized.collectionId,
      collectionName: authorized.collectionName,
      bundles,
    });
    this.grants.set(session.sessionId, {
      phase: 'active',
      projectPath: authorized.projectPath,
      collectionId: authorized.collectionId,
    });
    return session;
  }

  async write(
    sessionId: string,
    bundleNumber: number,
    pngDataUrl: string | undefined,
    markdown: string,
    sourceAssets?: readonly PromptBundleSourceAsset[],
  ): Promise<PromptExportBundleGrant> {
    await this.validateActiveGrant(sessionId);
    return publicBundle(
      await this.store.commitBundle({
        sessionId,
        bundleNumber,
        png: pngDataUrl === undefined ? undefined : decodePngDataUrl(pngDataUrl),
        markdown,
        sourceAssets,
      }),
    );
  }

  async finish(sessionId: string, masterMarkdown?: string): Promise<PromptExportFinalized> {
    const existing = this.grants.get(sessionId);
    if (existing?.phase === 'final') return existing.result;
    if (existing?.phase === 'active' && existing.finalization) return existing.finalization;
    await this.validateActiveGrant(sessionId);
    return this.finalize(sessionId, () => this.store.finishSession(sessionId, { masterMarkdown }));
  }

  async cancel(sessionId: string): Promise<PromptExportFinalized> {
    return this.finalize(sessionId, () => this.store.cancelSession(sessionId));
  }

  async read(sessionId: string, bundleNumber: number): Promise<PromptExportBundleContent> {
    const bundle = this.bundleGrant(sessionId, bundleNumber);
    const grant = this.finalGrant(sessionId);
    const markdown = await this.readMarkdown(grant, bundle);
    const imageDataUrl = bundle.pngFilename ? await this.readPng(grant, bundle) : undefined;
    return {
      ...publicBundle(bundle),
      markdown,
      imageDataUrl,
    };
  }

  async copy(sessionId: string, bundleNumber: number, target: PromptExportCopyTarget): Promise<void> {
    const bundle = this.bundleGrant(sessionId, bundleNumber);
    const grant = this.finalGrant(sessionId);
    if (target === 'markdown') {
      await this.dependencies.copyText(await this.readMarkdown(grant, bundle));
      return;
    }
    if (!bundle.pngFilename) {
      if (target === 'image')
        throw new NativeWorkflowError('bundle-not-found', 'This text-only prompt has no image to copy.');
      await this.dependencies.copyText(await this.readMarkdown(grant, bundle));
      return;
    }
    const imageDataUrl = await this.readPng(grant, bundle);
    if (target === 'image') {
      await this.dependencies.copyImage(imageDataUrl);
      return;
    }
    await this.dependencies.copyContext(await this.readMarkdown(grant, bundle), imageDataUrl);
  }

  async open(sessionId: string, bundleNumber: number, target: PromptExportOpenTarget): Promise<void> {
    const bundle = this.bundleGrant(sessionId, bundleNumber);
    const grant = this.finalGrant(sessionId);
    const targetPath =
      target === 'folder'
        ? grant.folderPath
        : target === 'png'
          ? bundle.pngFilename
            ? bundle.pngPath
            : undefined
          : target === 'markdown'
            ? bundle.markdownPath
            : grant.masterMarkdownPath;
    if (!targetPath)
      throw new NativeWorkflowError('bundle-not-found', 'Prompt export folder is unavailable.');
    await this.assertGrantedPath(grant, targetPath);
    await this.dependencies.openPath(targetPath);
  }

  private activeGrant(sessionId: string): ActiveGrant {
    const grant = this.grants.get(sessionId);
    if (!grant || grant.phase !== 'active')
      throw new NativeWorkflowError('session-not-found', 'Prompt export session was not found or is closed.');
    if (grant.finalization)
      throw new NativeWorkflowError('session-not-found', 'Prompt export session is already finalizing.');
    return grant;
  }

  private async validateActiveGrant(sessionId: string): Promise<ActiveGrant> {
    const grant = this.activeGrant(sessionId);
    const authorized = await this.dependencies.authorize(grant.projectPath, grant.collectionId);
    if (
      path.resolve(authorized.projectPath) !== path.resolve(grant.projectPath) ||
      authorized.collectionId !== grant.collectionId
    )
      throw new NativeWorkflowError(
        'permission-denied',
        'Prompt export session no longer matches its project collection.',
      );
    return grant;
  }

  private finalGrant(sessionId: string): FinalGrant {
    const grant = this.grants.get(sessionId);
    if (!grant || grant.phase !== 'final')
      throw new NativeWorkflowError('session-not-found', 'Stored prompt export grant was not found.');
    return grant;
  }

  private bundleGrant(sessionId: string, bundleNumber: number): StoredPromptBundle {
    const bundle = this.finalGrant(sessionId).bundles.get(bundleNumber);
    if (!bundle) throw new NativeWorkflowError('bundle-not-found', 'Stored prompt bundle was not found.');
    return bundle;
  }

  private finalizeGrant(
    sessionId: string,
    active: ActiveGrant,
    stored: FinalizedPromptBundleSession,
  ): PromptExportFinalized {
    const result = publicFinalized(stored);
    // Map replacement preserves the active session's old insertion position. Reinsert so retention
    // follows finalization order and a long-running export does not evict itself as soon as it finishes.
    this.grants.delete(sessionId);
    this.grants.set(sessionId, {
      ...active,
      phase: 'final',
      folderPath: stored.folderPath,
      masterMarkdownPath: stored.masterMarkdownPath,
      bundles: new Map(stored.bundles.map((bundle) => [bundle.bundleNumber, bundle])),
      result,
    });
    let finalizedCount = 0;
    for (const grant of this.grants.values()) if (grant.phase === 'final') finalizedCount++;
    if (finalizedCount > MAX_FINALIZED_GRANTS) {
      for (const [storedSessionId, grant] of this.grants) {
        if (grant.phase !== 'final') continue;
        this.grants.delete(storedSessionId);
        break;
      }
    }
    return result;
  }

  private finalize(
    sessionId: string,
    operation: () => Promise<FinalizedPromptBundleSession>,
  ): Promise<PromptExportFinalized> {
    const existing = this.grants.get(sessionId);
    if (existing?.phase === 'final') return Promise.resolve(existing.result);
    if (!existing)
      return Promise.reject(
        new NativeWorkflowError('session-not-found', 'Prompt export session was not found or is closed.'),
      );
    if (existing.finalization) return existing.finalization;
    const finalization = operation().then(
      (result) => this.finalizeGrant(sessionId, existing, result),
      (error) => {
        existing.finalization = undefined;
        throw error;
      },
    );
    existing.finalization = finalization;
    return finalization;
  }

  private async assertGrantedPath(grant: FinalGrant, targetPath: string): Promise<void> {
    if (!grant.folderPath || !isWithin(grant.folderPath, targetPath))
      throw new NativeWorkflowError('permission-denied', 'Stored prompt path is outside its granted folder.');
    await assertNoLinks(targetPath);
    const [realFolder, realTarget] = await Promise.all([
      fs.realpath(grant.folderPath),
      fs.realpath(targetPath),
    ]);
    if (!isWithin(realFolder, realTarget))
      throw new NativeWorkflowError('permission-denied', 'Stored prompt path escaped its granted folder.');
  }

  private async readMarkdown(grant: FinalGrant, bundle: StoredPromptBundle): Promise<string> {
    await this.assertGrantedPath(grant, bundle.markdownPath);
    const bytes = await readBoundedRegularFile(
      bundle.markdownPath,
      MAX_PROMPT_BUNDLE_MARKDOWN_BYTES,
      'Stored prompt Markdown',
    );
    let markdown: string;
    try {
      markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new NativeWorkflowError('io-failure', 'Stored prompt Markdown is not valid UTF-8.');
    }
    if (!markdown.trim() || markdown.length > MAX_PROMPT_BUNDLE_MARKDOWN_CHARACTERS)
      throw new NativeWorkflowError('io-failure', 'Stored prompt Markdown is empty or too large.');
    return markdown;
  }

  private async readPng(grant: FinalGrant, bundle: StoredPromptBundle): Promise<string> {
    await this.assertGrantedPath(grant, bundle.pngPath);
    const png = await readBoundedRegularFile(
      bundle.pngPath,
      MAX_PROMPT_BUNDLE_PNG_BYTES,
      'Stored prompt PNG',
    );
    try {
      await this.store.validatePng(png, bundle);
    } catch (error) {
      throw new NativeWorkflowError(
        'io-failure',
        `Stored prompt PNG is damaged or no longer matches its grant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return `${PNG_DATA_URL_PREFIX}${png.toString('base64')}`;
  }
}
