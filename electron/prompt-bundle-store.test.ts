// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite } from './files.js';
import {
  budgetPromptCollectionName,
  PromptBundleStore,
  formatPromptTimestamp,
  sanitizePromptCollectionName,
} from './prompt-bundle-store.js';

const temporaryDirectories: string[] = [];

async function fixture(collectionId = '001-collection') {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-prompt-store-'));
  temporaryDirectories.push(projectPath);
  await fs.mkdir(path.join(projectPath, 'collections', collectionId), { recursive: true });
  return { projectPath, collectionId };
}

function png(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('prompt bundle store', () => {
  it('reserves collision-free same-second sets and publishes approved matched filenames', async () => {
    const input = await fixture();
    const ids = ['session-one', 'session-two'];
    const now = new Date(2026, 8, 7, 18, 42, 5);
    const store = new PromptBundleStore({ now: () => now, randomId: () => ids.shift()! });
    const first = await store.startSession({ ...input, collectionName: 'Collection 02' });
    const second = await store.startSession({ ...input, collectionName: 'Collection 02' });
    expect(first.timestamp).toBe('260907-184205');
    expect(second.timestamp).toBe('260907-184206');

    await store.commitBundle({
      sessionId: first.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# One\n',
    });
    await store.commitBundle({
      sessionId: second.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# Two\n',
    });
    const firstResult = await store.finishSession(first.sessionId);
    const secondResult = await store.finishSession(second.sessionId);
    expect(firstResult.bundles[0].pngFilename).toBe('Collection 02 - 260907-184205 - 01.png');
    expect(firstResult.bundles[0].markdownFilename).toBe('Collection 02 - 260907-184205 - 01.md');
    expect(secondResult.bundles[0].pngFilename).toBe('Collection 02 - 260907-184206 - 01.png');
    expect(await fs.readdir(firstResult.folderPath!)).toEqual([
      'Collection 02 - 260907-184205 - 01.md',
      'Collection 02 - 260907-184205 - 01.png',
    ]);
  });

  it('removes a partial pair when its second atomic write fails', async () => {
    const input = await fixture();
    let writes = 0;
    const store = new PromptBundleStore({
      randomId: () => 'failure-session',
      writeAtomically: async (target: string, content: string | Uint8Array) => {
        writes++;
        if (writes === 2) throw new Error('disk full');
        await atomicWrite(target, content);
      },
    });
    const session = await store.startSession({ ...input, collectionName: 'Failure' });
    await expect(
      store.commitBundle({
        sessionId: session.sessionId,
        bundleNumber: 1,
        png: png(),
        markdown: '# Failure\n',
      }),
    ).rejects.toThrow('disk full');
    const result = await store.cancelSession(session.sessionId);
    expect(result).toEqual({ status: 'cancelled', published: false, bundles: [], warnings: [] });
    const exportsDirectory = path.join(input.projectPath, 'collections', input.collectionId, 'exports');
    expect((await fs.readdir(exportsDirectory)).filter((name) => !name.endsWith('.reservation'))).toEqual([]);
  });

  it('publishes completed pairs on cancellation and rejects later commits', async () => {
    const input = await fixture();
    const store = new PromptBundleStore({ randomId: () => 'cancel-session' });
    const session = await store.startSession({ ...input, collectionName: 'Cancel test' });
    await store.commitBundle({
      sessionId: session.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# Complete\n',
    });
    const result = await store.cancelSession(session.sessionId);
    expect(result).toMatchObject({ status: 'cancelled', published: true });
    expect(result.bundles).toHaveLength(1);
    await expect(
      store.commitBundle({ sessionId: session.sessionId, bundleNumber: 2, png: png(), markdown: '# Late\n' }),
    ).rejects.toThrow(/not found|closed/);
  });

  it('publishes complete pairs when the optional master overview fails', async () => {
    const input = await fixture();
    const store = new PromptBundleStore({
      randomId: () => 'overview-session',
      writeAtomically: async (target: string, content: string | Uint8Array) => {
        if (target.endsWith('overview.md')) throw new Error('overview disk failure');
        await atomicWrite(target, content);
      },
    });
    const session = await store.startSession({ ...input, collectionName: 'Overview test' });
    await store.commitBundle({
      sessionId: session.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# Complete pair\n',
    });
    const result = await store.finishSession(session.sessionId, { masterMarkdown: '# Master\n' });
    expect(result).toMatchObject({ status: 'completed', published: true });
    expect(result.masterMarkdownPath).toBeUndefined();
    expect(result.warnings).toEqual([expect.stringContaining('overview disk failure')]);
    expect(await fs.readdir(result.folderPath!)).toEqual([
      expect.stringMatching(/ - 01\.md$/),
      expect.stringMatching(/ - 01\.png$/),
    ]);
  });

  it('rejects unsafe collection paths and invalid PNG data before creating a pair', async () => {
    const input = await fixture();
    const store = new PromptBundleStore({ randomId: () => 'safe-session' });
    await expect(
      store.startSession({ ...input, collectionId: '../escape', collectionName: 'Unsafe' }),
    ).rejects.toThrow(/safe path segment/);
    const session = await store.startSession({ ...input, collectionName: 'Safe' });
    await expect(
      store.commitBundle({
        sessionId: session.sessionId,
        bundleNumber: 1,
        png: new Uint8Array([1, 2, 3]),
        markdown: '# Invalid\n',
      }),
    ).rejects.toThrow(/damaged/);
    await store.cancelSession(session.sessionId);
  });
});

describe('prompt export names', () => {
  it('formats local timestamps and sanitizes Windows names without losing Unicode', () => {
    expect(formatPromptTimestamp(new Date(2026, 8, 7, 18, 42, 5))).toBe('260907-184205');
    expect(sanitizePromptCollectionName('UX / Zürich: checkout. ')).toBe('UX - Zürich- checkout');
    expect(sanitizePromptCollectionName('CON')).toBe('_CON');
  });

  it('budgets duplicated set and file names against the actual exports path', () => {
    const exportsDirectory = path.resolve('C:/workspace/project/collections/001/exports');
    const bounded = budgetPromptCollectionName(exportsDirectory, 'A'.repeat(120), '260907-184205', 150);
    const setName = `${bounded} - 260907-184205`;
    expect(path.join(exportsDirectory, setName, `${setName} - overview.md`).length).toBeLessThanOrEqual(150);
    expect(() =>
      budgetPromptCollectionName(
        path.resolve(`C:/${'nested/'.repeat(40)}exports`),
        'Collection',
        '260907-184205',
        120,
      ),
    ).toThrow(/workspace path is too long/);
  });
});
