import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ClipboardFormatsReport,
  OnboardingHandoffAction,
  OnboardingHandoffGrant,
  OnboardingHandoffOpenTarget,
} from '../src/shared/workflow-bridge.js';
import { atomicWrite } from './files.js';
import { NativeWorkflowError } from './workflow-errors.js';

const MAX_ACTIVE_HANDOFF_GRANTS = 4;
const RETIRED_HANDOFF_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export interface OnboardingHandoffDependencies {
  root: string;
  copyContext(
    markdown: string,
    imageDataUrl: string,
    filePaths: readonly string[],
  ): Promise<ClipboardFormatsReport>;
  copyText(markdown: string): Promise<void>;
  copyImage(imageDataUrl: string): Promise<void>;
  openPath(targetPath: string): Promise<void>;
}

interface HandoffGrant extends OnboardingHandoffGrant {
  directory: string;
  markdownPath: string;
  pngPath: string;
  markdown: string;
  imageDataUrl: string;
}

export class OnboardingHandoffWorkflow {
  private readonly grants = new Map<string, HandoffGrant>();
  private preparedRoot: Promise<void> | undefined;

  constructor(private readonly dependencies: OnboardingHandoffDependencies) {}

  async prepare(input: {
    markdown: string;
    imageDataUrl: string;
    markdownFilename: string;
    pngFilename: string;
  }): Promise<OnboardingHandoffGrant> {
    await this.ensureRoot();
    for (const grant of [...this.grants.values()].reverse()) {
      if (
        grant.markdown === input.markdown &&
        grant.imageDataUrl === input.imageDataUrl &&
        grant.filenames[0] === input.markdownFilename &&
        grant.filenames[1] === input.pngFilename
      ) {
        try {
          await this.validGrant(grant.sessionId);
          return { sessionId: grant.sessionId, filenames: grant.filenames };
        } catch {
          this.grants.delete(grant.sessionId);
        }
      }
    }
    const directory = await fs.mkdtemp(path.join(this.dependencies.root, 'handoff-'));
    const markdownPath = path.join(directory, input.markdownFilename);
    const pngPath = path.join(directory, input.pngFilename);
    try {
      const png = Buffer.from(input.imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
      await atomicWrite(markdownPath, input.markdown);
      await atomicWrite(pngPath, png);
      const sessionId = randomUUID();
      const grant: HandoffGrant = {
        sessionId,
        directory,
        markdownPath,
        pngPath,
        markdown: input.markdown,
        imageDataUrl: input.imageDataUrl,
        filenames: [input.markdownFilename, input.pngFilename],
      };
      // File-reference clipboard payloads can outlive the guide and the app.
      // Keep generated pairs in the OS temp directory rather than invalidating a copy.
      this.grants.set(sessionId, grant);
      while (this.grants.size > MAX_ACTIVE_HANDOFF_GRANTS) {
        const oldest = this.grants.keys().next().value as string | undefined;
        if (!oldest) break;
        this.grants.delete(oldest);
      }
      return { sessionId, filenames: grant.filenames };
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private ensureRoot(): Promise<void> {
    this.preparedRoot ??= (async () => {
      await fs.mkdir(this.dependencies.root, { recursive: true });
      const cutoff = Date.now() - RETIRED_HANDOFF_RETENTION_MS;
      const entries = await fs.readdir(this.dependencies.root, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('handoff-'))
          .map(async (entry) => {
            const directory = path.join(this.dependencies.root, entry.name);
            const stat = await fs.lstat(directory).catch(() => undefined);
            if (!stat?.isDirectory() || stat.isSymbolicLink() || stat.mtimeMs >= cutoff) return;
            await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
          }),
      );
    })();
    return this.preparedRoot;
  }

  async copy(sessionId: string, action: OnboardingHandoffAction): Promise<ClipboardFormatsReport | void> {
    const grant = await this.validGrant(sessionId);
    if (action === 'markdown') return this.dependencies.copyText(grant.markdown);
    if (action === 'image') return this.dependencies.copyImage(grant.imageDataUrl);
    if (action === 'paths') return this.dependencies.copyText([grant.markdownPath, grant.pngPath].join('\n'));
    return this.dependencies.copyContext(grant.markdown, grant.imageDataUrl, [
      grant.markdownPath,
      grant.pngPath,
    ]);
  }

  async open(sessionId: string, target: OnboardingHandoffOpenTarget): Promise<void> {
    const grant = await this.validGrant(sessionId);
    if (target === 'folder') return this.dependencies.openPath(grant.directory);
    await this.dependencies.openPath(grant.markdownPath);
    await this.dependencies.openPath(grant.pngPath);
  }

  private async validGrant(sessionId: string): Promise<HandoffGrant> {
    const grant = this.grants.get(sessionId);
    if (!grant)
      throw new NativeWorkflowError('session-not-found', 'The onboarding handoff is no longer available.');
    for (const target of [grant.markdownPath, grant.pngPath]) {
      const stat = await fs.lstat(target).catch(() => undefined);
      if (!stat?.isFile() || stat.isSymbolicLink())
        throw new NativeWorkflowError('io-failure', 'A generated onboarding handoff file is unavailable.');
    }
    const [markdown, png] = await Promise.all([
      fs.readFile(grant.markdownPath, 'utf8'),
      fs.readFile(grant.pngPath),
    ]);
    const expectedPng = Buffer.from(grant.imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
    if (markdown !== grant.markdown || !png.equals(expectedPng))
      throw new NativeWorkflowError(
        'io-failure',
        'A generated onboarding handoff file changed unexpectedly.',
      );
    return grant;
  }
}
