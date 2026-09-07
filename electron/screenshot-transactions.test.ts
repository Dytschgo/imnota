// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite } from './files.js';
import {
  commitScreenshotTransaction,
  discardScreenshotTransaction,
  listScreenshotTransactions,
  recoverScreenshotTransactions,
  replayScreenshotTransaction,
  ScreenshotTransactionError,
  screenshotTransactionBaseline,
  stageScreenshotTransaction,
  type ScreenshotTransactionOperations,
} from './screenshot-transactions.js';

const temporaryDirectories: string[] = [];

async function temporaryProject(): Promise<string> {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-screenshot-transaction-test-')),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function safeCleanup(directory: string): Promise<void> {
  const parent = await fs.realpath(os.tmpdir());
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== parent ||
    !path.basename(resolved).startsWith('imnota-screenshot-transaction-test-')
  )
    throw new Error(`Refusing unsafe fixture cleanup: ${resolved}`);
  await fs.rm(resolved, { recursive: true, force: true });
  await expect(fs.stat(resolved)).rejects.toMatchObject({ code: 'ENOENT' });
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await safeCleanup(directory);
});

const defaultUnlink = (target: string) => fs.unlink(target);
const defaultRemoveDirectory = (target: string) => fs.rm(target, { recursive: true, force: true });

function transactionWrite(relativePath: string, after: Uint8Array | null, before: Uint8Array | null) {
  return { relativePath, after, expectedBefore: screenshotTransactionBaseline(before) };
}

function faultingWrites(failTarget: string): ScreenshotTransactionOperations {
  let failed = false;
  return {
    write: async (target, content) => {
      if (!failed && target === failTarget) {
        failed = true;
        throw new Error(`injected write failure: ${path.basename(target)}`);
      }
      await atomicWrite(target, content);
    },
    unlink: defaultUnlink,
    removeDirectory: defaultRemoveDirectory,
  };
}

async function normalFixture() {
  const directory = await temporaryProject();
  const annotationPath = path.join(directory, 'collections/001/annotations/screen.json');
  const descriptionPath = path.join(directory, 'collections/001/descriptions/screen.md');
  const metadataPath = path.join(directory, 'project.json');
  const before = {
    annotation: Buffer.from('annotation-A\n'),
    description: Buffer.from('description-A\n'),
    metadata: Buffer.from('{"version":"A"}\n'),
  };
  const after = {
    annotation: Buffer.from('annotation-B\n'),
    description: Buffer.from('description-B\n'),
    metadata: Buffer.from('{"version":"B"}\n'),
  };
  await atomicWrite(annotationPath, before.annotation);
  await atomicWrite(descriptionPath, before.description);
  await atomicWrite(metadataPath, before.metadata);
  const staged = await stageScreenshotTransaction(directory, {
    kind: 'save',
    writes: [
      transactionWrite('collections/001/annotations/screen.json', after.annotation, before.annotation),
      transactionWrite('collections/001/descriptions/screen.md', after.description, before.description),
      transactionWrite('project.json', after.metadata, before.metadata),
    ],
  });
  return {
    directory,
    annotationPath,
    descriptionPath,
    metadataPath,
    before,
    after,
    staged,
  };
}

async function expectBytes(target: string, expected: Uint8Array): Promise<void> {
  expect(await fs.readFile(target)).toEqual(Buffer.from(expected));
}

describe('screenshot multi-file transactions', () => {
  it('does not expose an incomplete pre-manifest candidate or touch live bytes', async () => {
    const directory = await temporaryProject();
    const metadataPath = path.join(directory, 'project.json');
    const sidecarPath = path.join(directory, 'collections/001/annotations/screen.json');
    await atomicWrite(metadataPath, Buffer.from('metadata-A'));
    await atomicWrite(sidecarPath, Buffer.from('sidecar-A'));
    const operations: ScreenshotTransactionOperations = {
      write: async (target, content) => {
        await atomicWrite(target, content);
        if (path.basename(target) === 'after-0000.bin') throw new Error('injected staging failure');
      },
      unlink: defaultUnlink,
      removeDirectory: defaultRemoveDirectory,
    };
    await expect(
      stageScreenshotTransaction(
        directory,
        {
          kind: 'save',
          writes: [
            transactionWrite(
              'collections/001/annotations/screen.json',
              Buffer.from('sidecar-B'),
              Buffer.from('sidecar-A'),
            ),
            transactionWrite('project.json', Buffer.from('metadata-B'), Buffer.from('metadata-A')),
          ],
        },
        operations,
      ),
    ).rejects.toThrow('injected staging failure');
    await expectBytes(sidecarPath, Buffer.from('sidecar-A'));
    await expectBytes(metadataPath, Buffer.from('metadata-A'));
    expect(await fs.readdir(path.join(directory, '.imnota-transactions'))).toEqual([]);
    expect(await listScreenshotTransactions(directory)).toEqual([]);
  });

  it('sweeps only a strictly owned incomplete transaction directory on startup discovery', async () => {
    const directory = await temporaryProject();
    const token = 'txn-00000000-0000-4000-8000-000000000001';
    const incomplete = path.join(directory, '.imnota-transactions', token);
    await fs.mkdir(incomplete, { recursive: true });
    await atomicWrite(path.join(incomplete, 'before-0000.bin'), Buffer.from('sensitive-baseline'));

    expect(await listScreenshotTransactions(directory)).toEqual([]);
    await expect(fs.stat(incomplete)).rejects.toMatchObject({ code: 'ENOENT' });

    const unknownToken = 'txn-00000000-0000-4000-8000-000000000002';
    const unknown = path.join(directory, '.imnota-transactions', unknownToken);
    await fs.mkdir(unknown, { recursive: true });
    await atomicWrite(path.join(unknown, 'unowned.bin'), Buffer.from('preserve-me'));
    await expect(listScreenshotTransactions(directory)).rejects.toMatchObject({
      code: 'invalid-journal',
      token: unknownToken,
    });
    await expectBytes(path.join(unknown, 'unowned.bin'), Buffer.from('preserve-me'));
  });

  it('rejects caller-observed digest drift before creating a journal', async () => {
    const directory = await temporaryProject();
    const sidecarPath = path.join(directory, 'collections/001/annotations/screen.json');
    const metadataPath = path.join(directory, 'project.json');
    await atomicWrite(sidecarPath, Buffer.from('sidecar-current'));
    await atomicWrite(metadataPath, Buffer.from('metadata-A'));

    await expect(
      stageScreenshotTransaction(directory, {
        kind: 'save',
        writes: [
          transactionWrite(
            'collections/001/annotations/screen.json',
            Buffer.from('sidecar-candidate'),
            Buffer.from('sidecar-caller-observed'),
          ),
          transactionWrite('project.json', Buffer.from('metadata-B'), Buffer.from('metadata-A')),
        ],
      }),
    ).rejects.toMatchObject({ code: 'baseline-changed', token: undefined });
    await expect(fs.stat(path.join(directory, '.imnota-transactions'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expectBytes(sidecarPath, Buffer.from('sidecar-current'));
  });

  it('stages a complete candidate without changing live bytes and commits metadata last', async () => {
    const fixture = await normalFixture();
    await expectBytes(fixture.annotationPath, fixture.before.annotation);
    await expectBytes(fixture.descriptionPath, fixture.before.description);
    await expectBytes(fixture.metadataPath, fixture.before.metadata);
    expect(await listScreenshotTransactions(fixture.directory)).toMatchObject([
      { token: fixture.staged.token, kind: 'save', phase: 'staged' },
    ]);

    await expect(commitScreenshotTransaction(fixture.directory, fixture.staged.token)).resolves.toEqual({
      status: 'committed',
      cleanup: 'complete',
    });
    await expectBytes(fixture.annotationPath, fixture.after.annotation);
    await expectBytes(fixture.descriptionPath, fixture.after.description);
    await expectBytes(fixture.metadataPath, fixture.after.metadata);
    expect(await listScreenshotTransactions(fixture.directory)).toEqual([]);
  });

  it('commits a description-only save when the annotation sidecar is unchanged', async () => {
    const directory = await temporaryProject();
    const annotationPath = path.join(directory, 'collections/001/annotations/screen.json');
    const descriptionPath = path.join(directory, 'collections/001/descriptions/screen.md');
    const metadataPath = path.join(directory, 'project.json');
    await atomicWrite(annotationPath, Buffer.from('annotation-A'));
    await atomicWrite(descriptionPath, Buffer.from('description-A'));
    await atomicWrite(metadataPath, Buffer.from('{"revision":1}'));

    const staged = await stageScreenshotTransaction(directory, {
      kind: 'save',
      writes: [
        transactionWrite(
          'collections/001/annotations/screen.json',
          Buffer.from('annotation-A'),
          Buffer.from('annotation-A'),
        ),
        transactionWrite(
          'collections/001/descriptions/screen.md',
          Buffer.from('description-B'),
          Buffer.from('description-A'),
        ),
        transactionWrite('project.json', Buffer.from('{"revision":2}'), Buffer.from('{"revision":1}')),
      ],
    });

    await expect(commitScreenshotTransaction(directory, staged.token)).resolves.toMatchObject({
      status: 'committed',
    });
    await expectBytes(annotationPath, Buffer.from('annotation-A'));
    await expectBytes(descriptionPath, Buffer.from('description-B'));
    await expectBytes(metadataPath, Buffer.from('{"revision":2}'));
  });

  it('commits a title-only save when both sidecars are unchanged', async () => {
    const directory = await temporaryProject();
    const annotationPath = path.join(directory, 'collections/001/annotations/screen.json');
    const descriptionPath = path.join(directory, 'collections/001/descriptions/screen.md');
    const metadataPath = path.join(directory, 'project.json');
    await atomicWrite(annotationPath, Buffer.from('annotation-A'));
    await atomicWrite(descriptionPath, Buffer.from('description-A'));
    await atomicWrite(metadataPath, Buffer.from('{"title":"A","revision":1}'));

    const staged = await stageScreenshotTransaction(directory, {
      kind: 'save',
      writes: [
        transactionWrite(
          'collections/001/annotations/screen.json',
          Buffer.from('annotation-A'),
          Buffer.from('annotation-A'),
        ),
        transactionWrite(
          'collections/001/descriptions/screen.md',
          Buffer.from('description-A'),
          Buffer.from('description-A'),
        ),
        transactionWrite(
          'project.json',
          Buffer.from('{"title":"B","revision":2}'),
          Buffer.from('{"title":"A","revision":1}'),
        ),
      ],
    });

    await expect(commitScreenshotTransaction(directory, staged.token)).resolves.toMatchObject({
      status: 'committed',
    });
    await expectBytes(annotationPath, Buffer.from('annotation-A'));
    await expectBytes(descriptionPath, Buffer.from('description-A'));
    await expectBytes(metadataPath, Buffer.from('{"title":"B","revision":2}'));
  });

  it('commits an annotation-only recovery restore with unchanged description and changed metadata', async () => {
    const directory = await temporaryProject();
    const annotationPath = path.join(directory, 'collections/001/annotations/screen.json');
    const descriptionPath = path.join(directory, 'collections/001/descriptions/screen.md');
    const metadataPath = path.join(directory, 'project.json');
    await atomicWrite(annotationPath, Buffer.from('annotation-saved'));
    await atomicWrite(descriptionPath, Buffer.from('description-same'));
    await atomicWrite(metadataPath, Buffer.from('{"revision":7}'));

    const staged = await stageScreenshotTransaction(directory, {
      kind: 'recovery-restore',
      writes: [
        transactionWrite(
          'collections/001/annotations/screen.json',
          Buffer.from('annotation-recovered'),
          Buffer.from('annotation-saved'),
        ),
        transactionWrite(
          'collections/001/descriptions/screen.md',
          Buffer.from('description-same'),
          Buffer.from('description-same'),
        ),
        transactionWrite('project.json', Buffer.from('{"revision":8}'), Buffer.from('{"revision":7}')),
      ],
    });

    await expect(commitScreenshotTransaction(directory, staged.token)).resolves.toMatchObject({
      status: 'committed',
    });
    await expectBytes(annotationPath, Buffer.from('annotation-recovered'));
    await expectBytes(descriptionPath, Buffer.from('description-same'));
    await expectBytes(metadataPath, Buffer.from('{"revision":8}'));
  });

  it('rejects an annotation-only restore with identical project.json before journal writes', async () => {
    const directory = await temporaryProject();
    const annotationPath = path.join(directory, 'collections/001/annotations/screen.json');
    const metadataPath = path.join(directory, 'project.json');
    await atomicWrite(annotationPath, Buffer.from('annotation-saved'));
    await atomicWrite(metadataPath, Buffer.from('{"revision":7}'));
    let journalWrites = 0;
    const operations: ScreenshotTransactionOperations = {
      write: async (target, content) => {
        journalWrites += 1;
        await atomicWrite(target, content);
      },
      unlink: defaultUnlink,
      removeDirectory: defaultRemoveDirectory,
    };

    await expect(
      stageScreenshotTransaction(
        directory,
        {
          kind: 'recovery-restore',
          writes: [
            transactionWrite(
              'collections/001/annotations/screen.json',
              Buffer.from('annotation-recovered'),
              Buffer.from('annotation-saved'),
            ),
            transactionWrite('project.json', Buffer.from('{"revision":7}'), Buffer.from('{"revision":7}')),
          ],
        },
        operations,
      ),
    ).rejects.toMatchObject({ code: 'invalid-journal' });
    expect(journalWrites).toBe(0);
    await expectBytes(annotationPath, Buffer.from('annotation-saved'));
    await expectBytes(metadataPath, Buffer.from('{"revision":7}'));
    await expect(fs.stat(path.join(directory, '.imnota-transactions'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['annotation', 'description', 'metadata'] as const)(
    'restores byte-exact baseline when the %s write fails and preserves the candidate',
    async (failed) => {
      const fixture = await normalFixture();
      const target = {
        annotation: fixture.annotationPath,
        description: fixture.descriptionPath,
        metadata: fixture.metadataPath,
      }[failed];

      await expect(
        commitScreenshotTransaction(fixture.directory, fixture.staged.token, faultingWrites(target)),
      ).rejects.toMatchObject({
        code: 'commit-failed',
        token: fixture.staged.token,
        candidateAvailable: true,
      });
      await expectBytes(fixture.annotationPath, fixture.before.annotation);
      await expectBytes(fixture.descriptionPath, fixture.before.description);
      await expectBytes(fixture.metadataPath, fixture.before.metadata);
      expect(await listScreenshotTransactions(fixture.directory)).toMatchObject([
        { token: fixture.staged.token, phase: 'staged' },
      ]);

      await replayScreenshotTransaction(fixture.directory, fixture.staged.token);
      await expectBytes(fixture.annotationPath, fixture.after.annotation);
      await expectBytes(fixture.descriptionPath, fixture.after.description);
      await expectBytes(fixture.metadataPath, fixture.after.metadata);
    },
  );

  it.each(['image', 'annotation', 'description', 'metadata'] as const)(
    'rolls back allocated conflict paths when the %s write fails without touching the external source',
    async (failed) => {
      const directory = await temporaryProject();
      const source = path.join(directory, 'collections/001/screenshots/source.png');
      const allocated = {
        image: path.join(directory, 'collections/001/screenshots/conflict.png'),
        annotation: path.join(directory, 'collections/001/annotations/conflict.json'),
        description: path.join(directory, 'collections/001/descriptions/conflict.md'),
        metadata: path.join(directory, 'project.json'),
      };
      await atomicWrite(source, Buffer.from('external-version'));
      await atomicWrite(allocated.metadata, Buffer.from('{"screenshots":[]}'));
      const staged = await stageScreenshotTransaction(directory, {
        kind: 'conflict',
        writes: [
          transactionWrite('collections/001/screenshots/conflict.png', Buffer.from('candidate-image'), null),
          transactionWrite('collections/001/annotations/conflict.json', Buffer.from('candidate-notes'), null),
          transactionWrite('collections/001/descriptions/conflict.md', Buffer.from('candidate-text'), null),
          transactionWrite(
            'project.json',
            Buffer.from('{"screenshots":["conflict"]}'),
            Buffer.from('{"screenshots":[]}'),
          ),
        ],
      });

      await expect(
        commitScreenshotTransaction(directory, staged.token, faultingWrites(allocated[failed])),
      ).rejects.toBeInstanceOf(ScreenshotTransactionError);
      await expectBytes(source, Buffer.from('external-version'));
      for (const target of [allocated.image, allocated.annotation, allocated.description])
        await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
      await expectBytes(allocated.metadata, Buffer.from('{"screenshots":[]}'));
      expect(await listScreenshotTransactions(directory)).toHaveLength(1);

      await replayScreenshotTransaction(directory, staged.token);
      await expectBytes(source, Buffer.from('external-version'));
      await expectBytes(allocated.image, Buffer.from('candidate-image'));
      await expectBytes(allocated.annotation, Buffer.from('candidate-notes'));
      await expectBytes(allocated.description, Buffer.from('candidate-text'));
    },
  );

  it('retains an applying journal when rollback fails, then repairs it on startup recovery', async () => {
    const fixture = await normalFixture();
    let candidateDescriptionFailed = false;
    let annotationRollbackFailed = false;
    const operations: ScreenshotTransactionOperations = {
      write: async (target, content) => {
        const bytes = Buffer.from(content);
        if (target === fixture.descriptionPath && bytes.equals(fixture.after.description)) {
          candidateDescriptionFailed = true;
          throw new Error('injected candidate failure');
        }
        if (
          candidateDescriptionFailed &&
          !annotationRollbackFailed &&
          target === fixture.annotationPath &&
          bytes.equals(fixture.before.annotation)
        ) {
          annotationRollbackFailed = true;
          throw new Error('injected rollback failure');
        }
        await atomicWrite(target, content);
      },
      unlink: defaultUnlink,
      removeDirectory: defaultRemoveDirectory,
    };

    await expect(
      commitScreenshotTransaction(fixture.directory, fixture.staged.token, operations),
    ).rejects.toMatchObject({ code: 'rollback-failed', candidateAvailable: true });
    await expectBytes(fixture.annotationPath, fixture.after.annotation);
    await expectBytes(fixture.descriptionPath, fixture.before.description);
    await expectBytes(fixture.metadataPath, fixture.before.metadata);

    await expect(recoverScreenshotTransactions(fixture.directory)).resolves.toMatchObject([
      { token: fixture.staged.token, status: 'baseline-restored', candidateAvailable: true },
    ]);
    await expectBytes(fixture.annotationPath, fixture.before.annotation);
    await replayScreenshotTransaction(fixture.directory, fixture.staged.token);
    await expectBytes(fixture.metadataPath, fixture.after.metadata);
  });

  it('recognizes the metadata commit point when cleanup fails and cleans it on recovery', async () => {
    const fixture = await normalFixture();
    const operations: ScreenshotTransactionOperations = {
      write: atomicWrite,
      unlink: defaultUnlink,
      removeDirectory: async () => {
        throw new Error('injected cleanup failure');
      },
    };
    await expect(
      commitScreenshotTransaction(fixture.directory, fixture.staged.token, operations),
    ).resolves.toMatchObject({ status: 'committed', cleanup: 'pending' });
    await expectBytes(fixture.metadataPath, fixture.after.metadata);
    expect(await listScreenshotTransactions(fixture.directory)).toMatchObject([
      { token: fixture.staged.token, phase: 'committed' },
    ]);
    const laterMetadata = Buffer.from('{"version":"later-save"}\n');
    await atomicWrite(fixture.metadataPath, laterMetadata);
    await expect(recoverScreenshotTransactions(fixture.directory)).resolves.toMatchObject([
      { token: fixture.staged.token, status: 'committed', cleanup: 'complete' },
    ]);
    await expectBytes(fixture.metadataPath, laterMetadata);
    expect(await listScreenshotTransactions(fixture.directory)).toEqual([]);
  });

  it('cleans a committed journal before a later save without comparing stale metadata', async () => {
    const fixture = await normalFixture();
    const cleanupFailure: ScreenshotTransactionOperations = {
      write: async (target, content) => {
        if (
          path.basename(target) === 'manifest.json' &&
          Buffer.from(content).toString('utf8').includes('"phase": "committed"')
        )
          throw new Error('injected commit receipt failure');
        await atomicWrite(target, content);
      },
      unlink: defaultUnlink,
      removeDirectory: async () => {
        throw new Error('injected cleanup failure');
      },
    };
    await expect(
      commitScreenshotTransaction(fixture.directory, fixture.staged.token, cleanupFailure),
    ).resolves.toMatchObject({ status: 'committed', cleanup: 'pending' });
    expect(await listScreenshotTransactions(fixture.directory)).toMatchObject([{ phase: 'applying' }]);

    const secondMetadata = Buffer.from('{"version":"C"}\n');
    const second = await stageScreenshotTransaction(fixture.directory, {
      kind: 'save',
      writes: [
        transactionWrite(
          'collections/001/annotations/screen.json',
          fixture.after.annotation,
          fixture.after.annotation,
        ),
        transactionWrite('project.json', secondMetadata, fixture.after.metadata),
      ],
    });
    expect((await listScreenshotTransactions(fixture.directory)).map((item) => item.token)).toEqual([
      second.token,
    ]);
    await commitScreenshotTransaction(fixture.directory, second.token);
    await expectBytes(fixture.metadataPath, secondMetadata);
    expect(await listScreenshotTransactions(fixture.directory)).toEqual([]);
  });

  it('reports success when the metadata write committed before its writer surfaced an error', async () => {
    const fixture = await normalFixture();
    let failed = false;
    const operations: ScreenshotTransactionOperations = {
      write: async (target, content) => {
        await atomicWrite(target, content);
        if (!failed && target === fixture.metadataPath) {
          failed = true;
          throw new Error('injected post-commit error');
        }
      },
      unlink: defaultUnlink,
      removeDirectory: defaultRemoveDirectory,
    };
    await expect(
      commitScreenshotTransaction(fixture.directory, fixture.staged.token, operations),
    ).resolves.toMatchObject({ status: 'committed' });
    await expectBytes(fixture.metadataPath, fixture.after.metadata);
    expect(await listScreenshotTransactions(fixture.directory)).toEqual([]);
  });

  it('repairs a persisted mid-application manifest before replaying the candidate', async () => {
    const fixture = await normalFixture();
    const transactionDirectory = path.join(fixture.directory, '.imnota-transactions', fixture.staged.token);
    const manifestPath = path.join(transactionDirectory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.phase = 'applying';
    await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
    await atomicWrite(fixture.annotationPath, fixture.after.annotation);

    await expect(recoverScreenshotTransactions(fixture.directory)).resolves.toMatchObject([
      { token: fixture.staged.token, status: 'baseline-restored', candidateAvailable: true },
    ]);
    await expectBytes(fixture.annotationPath, fixture.before.annotation);
    await expectBytes(fixture.metadataPath, fixture.before.metadata);
    await replayScreenshotTransaction(fixture.directory, fixture.staged.token);
    await expectBytes(fixture.metadataPath, fixture.after.metadata);
  });

  it('rejects an already occupied allocated path before creating a recoverable journal', async () => {
    const directory = await temporaryProject();
    const metadataPath = path.join(directory, 'project.json');
    const allocatedPath = path.join(directory, 'collections/001/screenshots/conflict.png');
    await atomicWrite(metadataPath, Buffer.from('metadata-A'));
    await atomicWrite(allocatedPath, Buffer.from('external'));

    await expect(
      stageScreenshotTransaction(directory, {
        kind: 'conflict',
        writes: [
          transactionWrite('collections/001/screenshots/conflict.png', Buffer.from('candidate'), null),
          transactionWrite('project.json', Buffer.from('metadata-B'), Buffer.from('metadata-A')),
        ],
      }),
    ).rejects.toMatchObject({ code: 'baseline-changed', candidateAvailable: false });
    await expectBytes(allocatedPath, Buffer.from('external'));
    await expectBytes(metadataPath, Buffer.from('metadata-A'));
    expect(await listScreenshotTransactions(directory)).toEqual([]);
  });

  it('aborts on a newly occupied path and preserves both the external bytes and candidate', async () => {
    const directory = await temporaryProject();
    const metadataPath = path.join(directory, 'project.json');
    const allocatedPath = path.join(directory, 'collections/001/screenshots/conflict.png');
    await atomicWrite(metadataPath, Buffer.from('metadata-A'));
    const staged = await stageScreenshotTransaction(directory, {
      kind: 'conflict',
      writes: [
        transactionWrite('collections/001/screenshots/conflict.png', Buffer.from('candidate'), null),
        transactionWrite('project.json', Buffer.from('metadata-B'), Buffer.from('metadata-A')),
      ],
    });
    await atomicWrite(allocatedPath, Buffer.from('external'));

    await expect(commitScreenshotTransaction(directory, staged.token)).rejects.toMatchObject({
      code: 'baseline-changed',
      candidateAvailable: true,
    });
    await expectBytes(allocatedPath, Buffer.from('external'));
    await expectBytes(metadataPath, Buffer.from('metadata-A'));
    expect(await listScreenshotTransactions(directory)).toHaveLength(1);
    await expect(discardScreenshotTransaction(directory, staged.token)).rejects.toMatchObject({
      code: 'baseline-changed',
    });
  });

  it('aborts when an existing baseline changes instead of clobbering it', async () => {
    const fixture = await normalFixture();
    await atomicWrite(fixture.descriptionPath, Buffer.from('external-description'));
    await expect(commitScreenshotTransaction(fixture.directory, fixture.staged.token)).rejects.toMatchObject({
      code: 'baseline-changed',
    });
    await expectBytes(fixture.descriptionPath, Buffer.from('external-description'));
    await expectBytes(fixture.metadataPath, fixture.before.metadata);
  });

  it('rejects aliases, traversal and linked project paths before writing outside the fixture', async () => {
    const directory = await temporaryProject();
    await atomicWrite(path.join(directory, 'project.json'), Buffer.from('A'));
    for (const relativePath of [
      '../outside',
      'collections/../outside',
      'collections\\001\\outside',
      'C:/outside',
    ]) {
      await expect(
        stageScreenshotTransaction(directory, {
          kind: 'save',
          writes: [
            transactionWrite(relativePath, Buffer.from('candidate'), null),
            transactionWrite('project.json', Buffer.from('B'), Buffer.from('A')),
          ],
        }),
      ).rejects.toMatchObject({ code: 'invalid-path' });
    }
    await expect(
      stageScreenshotTransaction(directory, {
        kind: 'save',
        writes: [
          transactionWrite('collections/Case/file', Buffer.from('one'), null),
          transactionWrite('collections/case/file', Buffer.from('two'), null),
          transactionWrite('project.json', Buffer.from('B'), Buffer.from('A')),
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid-path' });

    const alias = `${directory}-alias`;
    await fs.symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await expect(
        stageScreenshotTransaction(alias, {
          kind: 'save',
          writes: [
            transactionWrite('sidecar', Buffer.from('candidate'), null),
            transactionWrite('project.json', Buffer.from('B'), Buffer.from('A')),
          ],
        }),
      ).rejects.toThrow('Linked');
    } finally {
      await fs.unlink(alias);
    }

    const outside = await temporaryProject();
    const linked = path.join(directory, 'collections', 'linked');
    await fs.mkdir(path.dirname(linked), { recursive: true });
    await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      stageScreenshotTransaction(directory, {
        kind: 'save',
        writes: [
          transactionWrite('collections/linked/candidate', Buffer.from('candidate'), null),
          transactionWrite('project.json', Buffer.from('B'), Buffer.from('A')),
        ],
      }),
    ).rejects.toThrow('Linked');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('keeps the expanded recovery capacity bounded at 256 writes', async () => {
    const directory = await temporaryProject();
    const metadata = Buffer.from('metadata-A');
    await atomicWrite(path.join(directory, 'project.json'), metadata);
    await expect(
      stageScreenshotTransaction(directory, {
        kind: 'recovery-restore',
        writes: [
          ...Array.from({ length: 256 }, (_, index) =>
            transactionWrite(`sidecars/${index}.txt`, Buffer.from('candidate'), null),
          ),
          transactionWrite('project.json', Buffer.from('metadata-B'), metadata),
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid-journal' });
    expect(await listScreenshotTransactions(directory)).toEqual([]);
  });
});
