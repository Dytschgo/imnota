// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicWrite } from './files.js';
import {
  budgetPromptCollectionName,
  PromptBundleStore,
  formatPromptTimestamp,
  sanitizePromptCollectionName,
  validatePromptBundlePng,
  type PromptBundleStoreDependencies,
} from './prompt-bundle-store.js';

const temporaryDirectories: string[] = [];

async function fixture(collectionId = '001-collection') {
  const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-prompt-store-')));
  temporaryDirectories.push(projectPath);
  await fs.mkdir(path.join(projectPath, 'collections', collectionId), { recursive: true });
  return { projectPath, collectionId };
}

function png(): Uint8Array {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateDecodedPngForTest(value: Uint8Array): void {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const chunks: Uint8Array[] = [];
  let offset = 8;
  while (offset < value.length) {
    const length = view.getUint32(offset);
    const type = Buffer.from(value.subarray(offset + 4, offset + 8)).toString('ascii');
    if (type === 'IDAT') chunks.push(value.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const scanlines = inflateSync(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  if (scanlines.length !== 3 || scanlines[0] > 4) throw new Error('Prompt PNG scanlines are invalid.');
}

function promptStore(dependencies: Partial<PromptBundleStoreDependencies> = {}): PromptBundleStore {
  return new PromptBundleStore({
    ...dependencies,
    validateDecodedPng: dependencies.validateDecodedPng ?? validateDecodedPngForTest,
  });
}

function pngWithInvalidIdatAndValidCrc(): Uint8Array {
  const corrupt = png().slice();
  const view = new DataView(corrupt.buffer, corrupt.byteOffset, corrupt.byteLength);
  let offset = 8;
  while (offset < corrupt.length) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const type = Buffer.from(corrupt.subarray(typeOffset, dataOffset)).toString('ascii');
    if (type === 'IDAT') {
      corrupt[dataOffset] ^= 0xff;
      const crcOffset = dataOffset + length;
      view.setUint32(crcOffset, crc32(corrupt.subarray(typeOffset, crcOffset)));
      return corrupt;
    }
    offset += 12 + length;
  }
  throw new Error('PNG fixture has no IDAT chunk.');
}

function startInput(input: Awaited<ReturnType<typeof fixture>>, collectionName: string, count = 1) {
  return {
    ...input,
    collectionName,
    bundles: Array.from({ length: count }, (_, index) => ({
      bundleNumber: index + 1,
      width: 1,
      height: 1,
    })),
  };
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
    const store = promptStore({ now: () => now, randomId: () => ids.shift()! });
    const first = await store.startSession(startInput(input, 'Collection 02'));
    const second = await store.startSession(startInput(input, 'Collection 02'));
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

  it('recovers a journalled abandoned session when its owning process is gone', async () => {
    const input = await fixture();
    const oldStore = promptStore({
      randomId: () => 'abandoned-session',
      ownerProcessId: () => 101,
      isProcessAlive: () => true,
    });
    const abandoned = await oldStore.startSession(startInput(input, 'Abandoned'));
    await oldStore.commitBundle({
      sessionId: abandoned.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# Abandoned\n',
    });
    const exportsDirectory = path.join(input.projectPath, 'collections', input.collectionId, 'exports');
    const abandonedStaging = path.join(exportsDirectory, `.prompt-staging-${abandoned.sessionId}`);
    const abandonedReservation = path.join(exportsDirectory, `.${abandoned.setName}.reservation`);

    const nextStore = promptStore({
      randomId: () => 'next-session',
      ownerProcessId: () => 202,
      isProcessAlive: (processId) => processId === 202,
    });
    const next = await nextStore.startSession(startInput(input, 'Next'));

    expect(await fs.lstat(abandonedStaging).catch(() => null)).toBeNull();
    expect(await fs.lstat(abandonedReservation).catch(() => null)).toBeNull();
    await nextStore.cancelSession(next.sessionId);
  });

  it('recovers a journalled reservation abandoned before staging was created', async () => {
    const input = await fixture();
    const oldStore = promptStore({
      randomId: () => 'reservation-only-session',
      ownerProcessId: () => 101,
    });
    const abandoned = await oldStore.startSession(startInput(input, 'Reservation only'));
    const exportsDirectory = path.join(input.projectPath, 'collections', input.collectionId, 'exports');
    const abandonedStaging = path.join(exportsDirectory, `.prompt-staging-${abandoned.sessionId}`);
    const abandonedReservation = path.join(exportsDirectory, `.${abandoned.setName}.reservation`);
    await fs.rm(abandonedStaging, { recursive: true });

    const nextStore = promptStore({
      randomId: () => 'after-reservation-session',
      ownerProcessId: () => 202,
      isProcessAlive: () => false,
    });
    const next = await nextStore.startSession(startInput(input, 'After reservation'));

    expect(await fs.lstat(abandonedReservation).catch(() => null)).toBeNull();
    await nextStore.cancelSession(next.sessionId);
  });

  it('preserves an orphan reservation when staging absence cannot be proven', async () => {
    const input = await fixture();
    const oldStore = promptStore({
      randomId: () => 'inaccessible-session',
      ownerProcessId: () => 101,
    });
    const abandoned = await oldStore.startSession(startInput(input, 'Inaccessible'));
    const exportsDirectory = path.join(input.projectPath, 'collections', input.collectionId, 'exports');
    const abandonedStaging = path.join(exportsDirectory, `.prompt-staging-${abandoned.sessionId}`);
    const abandonedReservation = path.join(exportsDirectory, `.${abandoned.setName}.reservation`);
    await fs.rm(abandonedStaging, { recursive: true });
    const realLstat = fs.lstat.bind(fs);
    const lstat = vi.spyOn(fs, 'lstat').mockImplementation(async (candidate) => {
      if (path.resolve(String(candidate)) === path.resolve(abandonedStaging))
        throw Object.assign(new Error('access denied'), { code: 'EACCES' });
      return await realLstat(candidate);
    });

    const nextStore = promptStore({
      randomId: () => 'after-inaccessible-session',
      ownerProcessId: () => 202,
      isProcessAlive: () => false,
    });
    const next = await nextStore.startSession(startInput(input, 'After inaccessible'));
    lstat.mockRestore();

    expect(await fs.lstat(abandonedReservation)).toBeTruthy();
    await nextStore.cancelSession(next.sessionId);
  });

  it('keeps published exports when a later session performs orphan recovery', async () => {
    const input = await fixture();
    const oldStore = promptStore({
      randomId: () => 'published-session',
      ownerProcessId: () => 101,
    });
    const session = await oldStore.startSession(startInput(input, 'Published'));
    await oldStore.commitBundle({
      sessionId: session.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# Published\n',
    });
    const published = await oldStore.finishSession(session.sessionId);

    const nextStore = promptStore({
      randomId: () => 'later-session',
      ownerProcessId: () => 202,
      isProcessAlive: () => false,
    });
    const next = await nextStore.startSession(startInput(input, 'Later'));

    expect(await fs.readFile(published.bundles[0].markdownPath, 'utf8')).toBe('# Published\n');
    expect(await fs.readdir(published.folderPath!)).toEqual([
      expect.stringMatching(/ - 01\.md$/),
      expect.stringMatching(/ - 01\.png$/),
    ]);
    await nextStore.cancelSession(next.sessionId);
  });

  it('leaves foreign, live-owner, and linked staging entries untouched', async () => {
    const input = await fixture();
    const exportsDirectory = path.join(input.projectPath, 'collections', input.collectionId, 'exports');
    await fs.mkdir(exportsDirectory, { recursive: true });
    const foreignStaging = path.join(exportsDirectory, '.prompt-staging-legacy');
    const foreignReservation = path.join(exportsDirectory, '.Legacy - 260907-120000.reservation');
    await fs.mkdir(foreignStaging);
    await fs.writeFile(path.join(foreignStaging, 'user-file.txt'), 'keep');
    await fs.writeFile(foreignReservation, '');

    const liveStore = promptStore({
      randomId: () => 'live-session',
      ownerProcessId: () => 101,
      isProcessAlive: (processId) => processId === 101,
    });
    const live = await liveStore.startSession(startInput(input, 'Live'));
    const linkedStore = promptStore({
      randomId: () => 'linked-session',
      ownerProcessId: () => 202,
      isProcessAlive: (processId) => processId === 101 || processId === 202,
    });
    const linked = await linkedStore.startSession(startInput(input, 'Linked'));
    const linkedStaging = path.join(exportsDirectory, `.prompt-staging-${linked.sessionId}`);
    const outside = path.join(input.projectPath, 'outside-staging-target');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'outside.txt'), 'keep');
    await fs.symlink(
      outside,
      path.join(linkedStaging, 'linked-child'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const nextStore = promptStore({
      randomId: () => 'new-session',
      ownerProcessId: () => 303,
      isProcessAlive: (processId) => processId === 101 || processId === 303,
    });
    const next = await nextStore.startSession(startInput(input, 'New'));

    expect(await fs.readFile(path.join(foreignStaging, 'user-file.txt'), 'utf8')).toBe('keep');
    expect(await fs.lstat(foreignReservation)).toBeTruthy();
    expect(await fs.lstat(path.join(exportsDirectory, `.prompt-staging-${live.sessionId}`))).toBeTruthy();
    expect(await fs.lstat(linkedStaging)).toBeTruthy();
    expect(await fs.readFile(path.join(outside, 'outside.txt'), 'utf8')).toBe('keep');
    await Promise.all([
      liveStore.cancelSession(live.sessionId),
      linkedStore.cancelSession(linked.sessionId),
      nextStore.cancelSession(next.sessionId),
    ]);
  });

  it('does not remove a pre-existing directory, live session, or link when a new ID collides', async () => {
    const input = await fixture();
    const exportsDirectory = path.join(input.projectPath, 'collections', input.collectionId, 'exports');
    await fs.mkdir(exportsDirectory, { recursive: true });

    const foreignStaging = path.join(exportsDirectory, '.prompt-staging-foreign-collision');
    await fs.mkdir(foreignStaging);
    await fs.writeFile(path.join(foreignStaging, 'user-file.txt'), 'keep');
    const foreignCollision = promptStore({
      randomId: () => 'foreign-collision',
      ownerProcessId: () => 301,
      isProcessAlive: () => false,
    });
    await expect(foreignCollision.startSession(startInput(input, 'Foreign collision'))).rejects.toThrow();
    expect(await fs.readFile(path.join(foreignStaging, 'user-file.txt'), 'utf8')).toBe('keep');

    const outside = path.join(input.projectPath, 'linked-collision-target');
    const linkedStaging = path.join(exportsDirectory, '.prompt-staging-linked-collision');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'outside.txt'), 'keep');
    await fs.symlink(outside, linkedStaging, process.platform === 'win32' ? 'junction' : 'dir');
    const linkedCollision = promptStore({
      randomId: () => 'linked-collision',
      ownerProcessId: () => 302,
      isProcessAlive: () => false,
    });
    await expect(linkedCollision.startSession(startInput(input, 'Linked collision'))).rejects.toThrow();
    expect((await fs.lstat(linkedStaging)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(outside, 'outside.txt'), 'utf8')).toBe('keep');

    const liveStore = promptStore({
      randomId: () => 'live-collision',
      ownerProcessId: () => 101,
      isProcessAlive: (processId) => processId === 101,
    });
    const live = await liveStore.startSession(startInput(input, 'Live collision'));
    const liveStaging = path.join(exportsDirectory, `.prompt-staging-${live.sessionId}`);
    const liveCollision = promptStore({
      randomId: () => live.sessionId,
      ownerProcessId: () => 303,
      isProcessAlive: (processId) => processId === 101,
    });
    await expect(liveCollision.startSession(startInput(input, 'Live collision'))).rejects.toThrow();
    expect(await fs.lstat(liveStaging)).toBeTruthy();
    await liveStore.cancelSession(live.sessionId);
  });

  it('removes a partial pair when its second atomic write fails', async () => {
    const input = await fixture();
    let writes = 0;
    const store = promptStore({
      randomId: () => 'failure-session',
      writeAtomically: async (target: string, content: string | Uint8Array) => {
        writes++;
        if (writes === 2) throw new Error('disk full');
        await atomicWrite(target, content);
      },
    });
    const session = await store.startSession(startInput(input, 'Failure'));
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
    const store = promptStore({ randomId: () => 'cancel-session' });
    const session = await store.startSession(startInput(input, 'Cancel test', 2));
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

  it('publishes a text-only Markdown bundle and preserves drawing source JSON without a fake PNG', async () => {
    const input = await fixture();
    const store = promptStore({ randomId: () => 'text-source-session' });
    const session = await store.startSession({
      ...startInput(input, 'Mixed'),
      bundles: [{ bundleNumber: 1, hasImage: false, width: 0, height: 0 }],
    });
    await store.commitBundle({
      sessionId: session.sessionId,
      bundleNumber: 1,
      markdown: '# Text only\n',
      sourceAssets: [{ filename: 'drawing-flow.json', source: '{"type":"excalidraw"}' }],
    });
    const result = await store.finishSession(session.sessionId);
    expect(result.bundles[0]).toMatchObject({
      pngFilename: '',
      markdownFilename: expect.stringMatching(/\.md$/),
    });
    expect(await fs.readdir(result.folderPath!)).toEqual([expect.stringMatching(/\.md$/), 'sources']);
    expect(await fs.readFile(path.join(result.folderPath!, 'sources', 'drawing-flow.json'), 'utf8')).toBe(
      '{"type":"excalidraw"}',
    );
  });

  it('publishes complete pairs when the optional master overview fails', async () => {
    const input = await fixture();
    const store = promptStore({
      randomId: () => 'overview-session',
      writeAtomically: async (target: string, content: string | Uint8Array) => {
        if (target.endsWith('overview.md')) throw new Error('overview disk failure');
        await atomicWrite(target, content);
      },
    });
    const session = await store.startSession(startInput(input, 'Overview test'));
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
    const store = promptStore({ randomId: () => 'safe-session' });
    await expect(
      store.startSession({ ...startInput(input, 'Unsafe'), collectionId: '../escape' }),
    ).rejects.toThrow(/safe path segment/);
    const session = await store.startSession(startInput(input, 'Safe'));
    await expect(
      store.commitBundle({
        sessionId: session.sessionId,
        bundleNumber: 1,
        png: new Uint8Array([1, 2, 3]),
        markdown: '# Invalid\n',
      }),
    ).rejects.toThrow(/damaged/);
    const pseudoPng = new Uint8Array(24);
    pseudoPng.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(pseudoPng.buffer).setUint32(16, 0xffffffff);
    new DataView(pseudoPng.buffer).setUint32(20, 0xffffffff);
    await expect(
      store.commitBundle({
        sessionId: session.sessionId,
        bundleNumber: 1,
        png: pseudoPng,
        markdown: '# Invalid pseudo PNG\n',
      }),
    ).rejects.toThrow(/damaged/);
    await store.cancelSession(session.sessionId);
  });

  it('rejects corrupt or manifest-mismatched PNGs and incomplete successful sessions', async () => {
    const input = await fixture();
    const store = promptStore({ randomId: () => 'manifest-session' });
    const session = await store.startSession(startInput(input, 'Manifest', 2));
    const corrupt = png().slice();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(
      store.commitBundle({
        sessionId: session.sessionId,
        bundleNumber: 1,
        png: corrupt,
        markdown: '# Corrupt\n',
      }),
    ).rejects.toThrow(/integrity check/);
    const invalidIdat = pngWithInvalidIdatAndValidCrc();
    expect(() => validatePromptBundlePng(invalidIdat, { width: 1, height: 1 })).not.toThrow();
    await expect(
      store.commitBundle({
        sessionId: session.sessionId,
        bundleNumber: 1,
        png: invalidIdat,
        markdown: '# Invalid image data\n',
      }),
    ).rejects.toThrow(/scanlines|header check/);
    await store.commitBundle({
      sessionId: session.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# One\n',
    });
    await expect(store.finishSession(session.sessionId)).rejects.toThrow(/1 of 2/);
    const cancelled = await store.cancelSession(session.sessionId);
    expect(cancelled).toMatchObject({ status: 'cancelled', bundles: [{ bundleNumber: 1 }] });

    const mismatchStore = promptStore({ randomId: () => 'dimension-session' });
    const mismatch = await mismatchStore.startSession({
      ...startInput(input, 'Dimension'),
      bundles: [{ bundleNumber: 1, width: 2, height: 1 }],
    });
    await expect(
      mismatchStore.commitBundle({
        sessionId: mismatch.sessionId,
        bundleNumber: 1,
        png: png(),
        markdown: '# Wrong dimensions\n',
      }),
    ).rejects.toThrow(/reserved bundle manifest/);
    await mismatchStore.cancelSession(mismatch.sessionId);
  });

  it('returns an idempotent recovery grant if the reserved destination appears', async () => {
    const input = await fixture();
    const store = promptStore({ randomId: () => 'collision-session' });
    const session = await store.startSession(startInput(input, 'Collision'));
    await store.commitBundle({
      sessionId: session.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# Complete\n',
    });
    const destination = path.join(
      input.projectPath,
      'collections',
      input.collectionId,
      'exports',
      session.setName,
    );
    await fs.mkdir(destination);
    const first = await store.finishSession(session.sessionId);
    const second = await store.cancelSession(session.sessionId);
    expect(first).toMatchObject({ published: false, bundles: [{ bundleNumber: 1 }] });
    expect(first.warnings[0]).toMatch(/recovery folder/);
    expect(second).toEqual(first);
    expect(await fs.stat(first.bundles[0].pngPath)).toBeTruthy();
  });
});

describe('prompt export names', () => {
  it('rolls back sources from a failed bundle without touching sources in completed bundles', async () => {
    const input = await fixture();
    const store = promptStore({
      writeAtomically: async (target, content) => {
        if (target.endsWith('broken.json')) throw new Error('source write failed');
        await atomicWrite(target, content);
      },
    });
    const session = await store.startSession(startInput(input, 'Source rollback', 2));
    await store.commitBundle({
      sessionId: session.sessionId,
      bundleNumber: 1,
      png: png(),
      markdown: '# First',
      sourceAssets: [{ filename: 'kept.json', source: '{"kept":true}' }],
    });
    await expect(
      store.commitBundle({
        sessionId: session.sessionId,
        bundleNumber: 2,
        png: png(),
        markdown: '# Second',
        sourceAssets: [
          { filename: 'kept.json', source: '{"kept":true}' },
          { filename: 'partial.json', source: '{}' },
          { filename: 'broken.json', source: '{}' },
        ],
      }),
    ).rejects.toThrow(/source write failed/);
    const result = await store.cancelSession(session.sessionId);
    expect(result.published).toBe(true);
    expect(result.bundles).toHaveLength(1);
    expect(await fs.readdir(path.join(result.folderPath!, 'sources'))).toEqual(['kept.json']);
  });
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
