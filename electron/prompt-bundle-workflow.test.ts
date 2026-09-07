// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PROMPT_BUNDLE_MARKDOWN_BYTES,
  MAX_PROMPT_BUNDLE_PNG_BYTES,
  PromptBundleStore,
} from './prompt-bundle-store.js';
import { PromptBundleWorkflow } from './prompt-bundle-workflow.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((item) => fs.rm(item, { recursive: true, force: true })));
});

function pngDataUrl(): string {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
}

const manifest = [{ bundleNumber: 1, width: 1, height: 1 }];

async function fixture() {
  const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-workflow-')));
  temporary.push(projectPath);
  const collectionId = '001-collection';
  await fs.mkdir(path.join(projectPath, 'collections', collectionId), { recursive: true });
  const copyContext = vi.fn();
  const copyText = vi.fn();
  const copyImage = vi.fn();
  const openPath = vi.fn();
  const workflow = new PromptBundleWorkflow(
    {
      authorize: async (candidate, candidateCollection) => {
        if (candidate !== projectPath || candidateCollection !== collectionId)
          throw new Error('Collection does not belong to the project.');
        return { projectPath, collectionId, collectionName: 'Collection' };
      },
      copyContext,
      copyText,
      copyImage,
      openPath,
    },
    new PromptBundleStore({
      randomId: () => 'server-session',
      now: () => new Date(2026, 8, 7, 12, 0, 0),
      validateDecodedPng: () => undefined,
    }),
  );
  return { workflow, projectPath, collectionId, copyContext, copyText, copyImage, openPath };
}

describe('main-owned prompt bundle grants', () => {
  it('derives collection identity, publishes a pair, and grants only session/bundle access', async () => {
    const { workflow, projectPath, collectionId, copyContext, openPath } = await fixture();
    await expect(workflow.start(projectPath, 'other', manifest)).rejects.toThrow(/does not belong/);
    const session = await workflow.start(projectPath, collectionId, manifest);
    expect(session).toMatchObject({
      sessionId: 'server-session',
      collectionId,
      setName: 'Collection - 260907-120000',
    });
    await workflow.write(session.sessionId, 1, pngDataUrl(), '# Prompt\n');
    const final = await workflow.finish(session.sessionId, '# Overview\n');
    expect(final).toMatchObject({ published: true, hasMasterMarkdown: true });
    await expect(workflow.finish(session.sessionId)).resolves.toEqual(final);
    const content = await workflow.read(session.sessionId, 1);
    expect(content.markdown).toBe('# Prompt\n');
    expect(content.imageDataUrl).toBe(pngDataUrl());
    await workflow.copy(session.sessionId, 1, 'context');
    expect(copyContext).toHaveBeenCalledWith('# Prompt\n', pngDataUrl());
    await workflow.open(session.sessionId, 1, 'png');
    expect(openPath).toHaveBeenCalledWith(expect.stringMatching(/ - 01\.png$/));
    await workflow.open(session.sessionId, 1, 'master');
    expect(openPath).toHaveBeenCalledWith(expect.stringMatching(/ - overview\.md$/));
    await expect(workflow.read('renderer-invented', 1)).rejects.toThrow(/grant was not found/);
    await expect(workflow.read(session.sessionId, 2)).rejects.toThrow(/bundle was not found/);
  });

  it('keeps completed grants when cancellation interrupts queued work', async () => {
    const { workflow, projectPath, collectionId } = await fixture();
    const session = await workflow.start(projectPath, collectionId, manifest);
    await workflow.write(session.sessionId, 1, pngDataUrl(), '# Complete\n');
    const cancelled = await workflow.cancel(session.sessionId);
    expect(cancelled).toMatchObject({ status: 'cancelled', published: true });
    await expect(workflow.read(session.sessionId, 1)).resolves.toMatchObject({ markdown: '# Complete\n' });
    await expect(workflow.write(session.sessionId, 2, pngDataUrl(), '# Late\n')).rejects.toThrow(/closed/);
  });

  it('bounds changed granted files before allocation and copies Markdown without reading PNG', async () => {
    const { workflow, projectPath, collectionId, copyText, copyImage } = await fixture();
    const session = await workflow.start(projectPath, collectionId, manifest);
    await workflow.write(session.sessionId, 1, pngDataUrl(), '# Safe Markdown\n');
    const finalized = await workflow.finish(session.sessionId);
    const folder = path.join(projectPath, 'collections', collectionId, 'exports', session.setName);
    const pngPath = path.join(folder, finalized.bundles[0].pngFilename);
    const markdownPath = path.join(folder, finalized.bundles[0].markdownFilename);

    await fs.truncate(pngPath, MAX_PROMPT_BUNDLE_PNG_BYTES + 1);
    await expect(workflow.copy(session.sessionId, 1, 'markdown')).resolves.toBeUndefined();
    expect(copyText).toHaveBeenCalledWith('# Safe Markdown\n');
    expect(copyImage).not.toHaveBeenCalled();
    await expect(workflow.copy(session.sessionId, 1, 'image')).rejects.toThrow(/safe .*byte read limit/);

    await fs.truncate(markdownPath, MAX_PROMPT_BUNDLE_MARKDOWN_BYTES + 1);
    await expect(workflow.copy(session.sessionId, 1, 'markdown')).rejects.toThrow(/safe .*byte read limit/);
  });
});
