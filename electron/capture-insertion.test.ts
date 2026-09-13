import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite } from './files.js';
import { assertCaptureCommitAdmission, readWithCaptureAdmission } from './capture-commit-guard.js';
import {
  commitScreenshotTransaction,
  screenshotTransactionBaseline,
  stageScreenshotTransaction,
} from './screenshot-transactions.js';

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('capture insertion transaction', () => {
  it('writes image, sidecars, and metadata together through the capture journal', async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-capture-')));
    fixtures.push(directory);
    const projectBefore = Buffer.from('{"screenshots":[]}');
    const projectAfter = Buffer.from('{"screenshots":["capture"]}');
    await atomicWrite(path.join(directory, 'project.json'), projectBefore);
    const staged = await stageScreenshotTransaction(directory, {
      kind: 'capture',
      writes: [
        {
          relativePath: 'collections/001/screenshots/capture.png',
          after: Buffer.from('png'),
          expectedBefore: screenshotTransactionBaseline(null),
        },
        {
          relativePath: 'collections/001/annotations/capture.png.json',
          after: Buffer.from('[]'),
          expectedBefore: screenshotTransactionBaseline(null),
        },
        {
          relativePath: 'collections/001/descriptions/capture.png.md',
          after: Buffer.from(''),
          expectedBefore: screenshotTransactionBaseline(null),
        },
        {
          relativePath: 'project.json',
          after: projectAfter,
          expectedBefore: screenshotTransactionBaseline(projectBefore),
        },
      ],
    });
    await commitScreenshotTransaction(directory, staged.token);
    await expect(
      fs.readFile(path.join(directory, 'collections/001/screenshots/capture.png')),
    ).resolves.toEqual(Buffer.from('png'));
    await expect(fs.readFile(path.join(directory, 'project.json'))).resolves.toEqual(projectAfter);
  });

  it('does not stage files or rewrite project metadata when admission is revoked during baseline read', async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-capture-')));
    fixtures.push(directory);
    const projectBefore = Buffer.from('{"screenshots":[]}');
    await atomicWrite(path.join(directory, 'project.json'), projectBefore);
    let resolveBaseline!: (value: Buffer) => void;
    const baseline = new Promise<Buffer>((resolve) => {
      resolveBaseline = resolve;
    });
    let admitted = true;
    const assertAdmission = () => {
      if (!admitted) throw new Error('Screen capture cancelled.');
    };
    const candidate = readWithCaptureAdmission(() => baseline, assertAdmission).then(async () => {
      await stageScreenshotTransaction(directory, {
        kind: 'capture',
        writes: [
          {
            relativePath: 'collections/001/screenshots/capture.png',
            after: Buffer.from('png'),
            expectedBefore: screenshotTransactionBaseline(null),
          },
        ],
      });
    });
    admitted = false;
    resolveBaseline(projectBefore);
    await expect(candidate).rejects.toThrow('Screen capture cancelled.');
    await expect(fs.readFile(path.join(directory, 'project.json'))).resolves.toEqual(projectBefore);
    await expect(fs.readdir(directory)).resolves.toEqual(['project.json']);
  });

  it('checks capture admission before staging and immediately before commit baseline validation', async () => {
    const calls: string[] = [];
    await assertCaptureCommitAdmission(
      () => {
        calls.push('admission');
      },
      async () => {
        calls.push('baseline');
      },
    );
    expect(calls).toEqual(['admission', 'baseline', 'admission']);
  });
});
