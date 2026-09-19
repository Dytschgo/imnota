// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onboardingHandoffRoot, OnboardingHandoffWorkflow, promptHandoffRoot } from './onboarding-handoff.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const imageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-onboarding-test-'));
  roots.push(root);
  const copyContext = vi.fn(async (markdown: string, imageDataUrl: string, filePaths: readonly string[]) => {
    void markdown;
    void imageDataUrl;
    void filePaths;
    return { text: true, html: true, image: false, fileHandoff: 'opened' as const };
  });
  const copyText = vi.fn(async () => {});
  const copyImage = vi.fn(async () => {});
  const openPath = vi.fn(async () => {});
  const workflow = new OnboardingHandoffWorkflow({ root, copyContext, copyText, copyImage, openPath });
  const grant = await workflow.prepare({
    markdown: '# Handoff\n\n![Sample](./component-search.png)\n',
    imageDataUrl,
    markdownFilename: 'component-search.md',
    pngFilename: 'component-search.png',
  });
  return { root, workflow, grant, copyContext, copyText, copyImage, openPath };
}

describe('onboarding handoff grants', () => {
  it('keeps production handoffs in temp and smoke handoffs inside the isolated profile', () => {
    const paths = { temporaryDirectory: path.resolve('temp'), userDataDirectory: path.resolve('profile') };
    expect(onboardingHandoffRoot(paths, false)).toBe(
      path.join(paths.temporaryDirectory, 'imnota-onboarding-handoffs'),
    );
    expect(onboardingHandoffRoot(paths, true)).toBe(
      path.join(paths.userDataDirectory, 'onboarding-handoffs'),
    );
    expect(promptHandoffRoot(paths, false)).toBe(
      path.join(paths.temporaryDirectory, 'imnota-prompt-handoffs'),
    );
    expect(promptHandoffRoot(paths, true)).toBe(path.join(paths.userDataDirectory, 'prompt-handoffs'));
  });

  it('canonicalizes an operating-system temp alias before writing the handoff', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-onboarding-alias-test-'));
    roots.push(base);
    const realParent = path.join(base, 'real');
    const aliasedParent = path.join(base, 'alias');
    await fs.mkdir(realParent);
    await fs.symlink(realParent, aliasedParent, process.platform === 'win32' ? 'junction' : 'dir');
    const copyContext = vi.fn(async (markdown: string, image: string, filePaths: readonly string[]) => {
      void markdown;
      void image;
      void filePaths;
      return { text: true, html: true, image: true };
    });
    const workflow = new OnboardingHandoffWorkflow({
      root: path.join(aliasedParent, 'handoffs'),
      copyContext,
      copyText: vi.fn(),
      copyImage: vi.fn(),
      openPath: vi.fn(),
    });
    const grant = await workflow.prepare({
      markdown: '# Alias\n',
      imageDataUrl,
      markdownFilename: 'component-search.md',
      pngFilename: 'component-search.png',
    });
    await workflow.copy(grant.sessionId, 'context');
    const canonicalParent = await fs.realpath(realParent);
    expect(copyContext.mock.calls[0][2]).toEqual([
      expect.stringMatching(
        new RegExp(`^${canonicalParent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*component-search\\.md$`),
      ),
      expect.stringMatching(
        new RegExp(`^${canonicalParent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*component-search\\.png$`),
      ),
    ]);
  });

  it('rejects a symlink at the app-owned handoff root leaf', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-onboarding-leaf-test-'));
    roots.push(base);
    const parent = path.join(base, 'parent');
    const target = path.join(base, 'target');
    await Promise.all([fs.mkdir(parent), fs.mkdir(target)]);
    const root = path.join(parent, 'handoffs');
    await fs.symlink(target, root, process.platform === 'win32' ? 'junction' : 'dir');
    const workflow = new OnboardingHandoffWorkflow({
      root,
      copyContext: vi.fn(),
      copyText: vi.fn(),
      copyImage: vi.fn(),
      openPath: vi.fn(),
    });
    await expect(
      workflow.prepare({
        markdown: '# Linked root\n',
        imageDataUrl,
        markdownFilename: 'component-search.md',
        pngFilename: 'component-search.png',
      }),
    ).rejects.toThrow(/regular directory/);
  });

  it('materializes a matching Markdown/PNG pair and uses it for the production combined copy', async () => {
    const { workflow, grant, copyContext } = await fixture();
    await expect(workflow.copy(grant.sessionId, 'context')).resolves.toEqual({
      text: true,
      html: true,
      image: false,
      fileHandoff: 'opened',
    });
    expect(copyContext).toHaveBeenCalledWith(
      '# Handoff\n\n![Sample](./component-search.png)\n',
      imageDataUrl,
      [expect.stringMatching(/component-search\.md$/), expect.stringMatching(/component-search\.png$/)],
    );
    const [markdownPath, pngPath] = copyContext.mock.calls[0][2];
    await expect(fs.readFile(markdownPath, 'utf8')).resolves.toContain('./component-search.png');
    await expect(fs.readFile(pngPath)).resolves.toEqual(
      Buffer.from(imageDataUrl.slice('data:image/png;base64,'.length), 'base64'),
    );
  });

  it('supports every explicit fallback through the same validated grant', async () => {
    const { workflow, grant, copyText, copyImage, openPath } = await fixture();
    await workflow.copy(grant.sessionId, 'markdown');
    expect(copyText).toHaveBeenLastCalledWith(expect.stringContaining('# Handoff'));
    await workflow.copy(grant.sessionId, 'image');
    expect(copyImage).toHaveBeenLastCalledWith(imageDataUrl);
    await workflow.copy(grant.sessionId, 'paths');
    expect(copyText).toHaveBeenLastCalledWith(
      expect.stringMatching(/component-search\.md\n.*component-search\.png$/),
    );
    await workflow.open(grant.sessionId, 'files');
    expect(openPath).toHaveBeenCalledTimes(2);
    await workflow.open(grant.sessionId, 'folder');
    expect(openPath).toHaveBeenCalledTimes(3);
  });

  it('does not touch the clipboard when a prepared file is missing', async () => {
    const { root, workflow, grant, copyContext, copyText, copyImage } = await fixture();
    const directory = path.join(root, (await fs.readdir(root))[0]);
    await fs.unlink(path.join(directory, 'component-search.png'));
    await expect(workflow.copy(grant.sessionId, 'context')).rejects.toThrow(/unavailable/);
    expect(copyContext).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(copyImage).not.toHaveBeenCalled();
  });

  it('does not touch the clipboard when prepared content changes', async () => {
    const { root, workflow, grant, copyContext, copyText, copyImage } = await fixture();
    const directory = path.join(root, (await fs.readdir(root))[0]);
    await fs.writeFile(path.join(directory, 'component-search.md'), '# Replaced\n');
    await expect(workflow.copy(grant.sessionId, 'context')).rejects.toThrow(/changed unexpectedly/);
    expect(copyContext).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(copyImage).not.toHaveBeenCalled();
  });

  it('bounds active authorization without deleting generated pairs a user may be attaching', async () => {
    const { root, workflow, grant: oldest, copyText } = await fixture();
    let newest = oldest;
    for (let index = 0; index < 4; index += 1) {
      newest = await workflow.prepare({
        markdown: `# Handoff ${index}\n`,
        imageDataUrl,
        markdownFilename: 'component-search.md',
        pngFilename: 'component-search.png',
      });
    }
    await expect(workflow.copy(oldest.sessionId, 'markdown')).rejects.toThrow(/no longer available/);
    await expect(workflow.copy(newest.sessionId, 'markdown')).resolves.toBeUndefined();
    expect(copyText).toHaveBeenCalledWith('# Handoff 3\n');
    expect(await fs.readdir(root)).toHaveLength(5);
  });

  it('reuses an unchanged prepared pair instead of accumulating directories on replay', async () => {
    const { root, workflow, grant } = await fixture();
    const replay = await workflow.prepare({
      markdown: '# Handoff\n\n![Sample](./component-search.png)\n',
      imageDataUrl,
      markdownFilename: 'component-search.md',
      pngFilename: 'component-search.png',
    });
    expect(replay).toEqual(grant);
    expect(await fs.readdir(root)).toHaveLength(1);
  });

  it('removes only retired handoff directories during the next workflow session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-onboarding-test-'));
    roots.push(root);
    const oldDirectory = path.join(root, 'handoff-retired');
    const recentDirectory = path.join(root, 'handoff-recent');
    const unrelatedDirectory = path.join(root, 'other-retired');
    await Promise.all([fs.mkdir(oldDirectory), fs.mkdir(recentDirectory), fs.mkdir(unrelatedDirectory)]);
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
    await Promise.all([fs.utimes(oldDirectory, old, old), fs.utimes(unrelatedDirectory, old, old)]);
    const workflow = new OnboardingHandoffWorkflow({
      root,
      copyContext: vi.fn(),
      copyText: vi.fn(),
      copyImage: vi.fn(),
      openPath: vi.fn(),
    });
    await workflow.prepare({
      markdown: '# Current\n',
      imageDataUrl,
      markdownFilename: 'component-search.md',
      pngFilename: 'component-search.png',
    });
    await expect(fs.stat(oldDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(recentDirectory)).resolves.toBeDefined();
    await expect(fs.stat(unrelatedDirectory)).resolves.toBeDefined();
  });
});
