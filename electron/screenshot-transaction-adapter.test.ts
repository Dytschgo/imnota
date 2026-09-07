// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWrite } from './files.js';
import {
  commitScreenshotFileTransaction,
  nextProjectMutationTimestamp,
} from './screenshot-transaction-adapter.js';
import {
  commitScreenshotTransaction,
  discardScreenshotTransaction,
  listScreenshotTransactions,
  stageScreenshotTransaction,
} from './screenshot-transactions.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((item) => fs.rm(item, { recursive: true, force: true })));
});

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('screenshot transaction baseline adapter', () => {
  it('advances project metadata when consecutive saves share the same clock value', () => {
    const clock = new Date('2026-09-07T02:15:00.000Z');
    expect(nextProjectMutationTimestamp(clock.toISOString(), clock)).toBe('2026-09-07T02:15:00.001Z');
    expect(nextProjectMutationTimestamp('2026-09-07T02:15:02.000Z', clock)).toBe('2026-09-07T02:15:02.001Z');
  });

  it('does not overwrite an external project change inserted between read and stage', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-transaction-adapter-'));
    temporary.push(projectPath);
    const projectFile = path.join(projectPath, 'project.json');
    const sidecarFile = path.join(projectPath, 'sidecar.md');
    const baseline = '{"revision":"baseline"}';
    const external = '{"revision":"external"}';
    await fs.writeFile(projectFile, baseline);
    await fs.writeFile(sidecarFile, 'baseline sidecar');
    const expectedRevision = digest(baseline);
    const operations = {
      write: atomicWrite,
      unlink: (target: string) => fs.unlink(target),
      removeDirectory: (target: string) => fs.rm(target, { recursive: true, force: true }),
    };

    await expect(
      commitScreenshotFileTransaction(
        projectPath,
        {
          kind: 'save',
          writes: [
            { relativePath: 'sidecar.md', after: Buffer.from('candidate sidecar') },
            { relativePath: 'project.json', after: Buffer.from('{"revision":"candidate"}') },
          ],
          operations,
          assertBaseline: async () => {
            if (digest(await fs.readFile(projectFile)) !== expectedRevision)
              throw new Error('project changed');
          },
        },
        {
          stage: async (...arguments_) => {
            await fs.writeFile(projectFile, external);
            return stageScreenshotTransaction(...arguments_);
          },
          commit: commitScreenshotTransaction,
          discard: discardScreenshotTransaction,
        },
      ),
    ).rejects.toThrow('project changed');

    expect(await fs.readFile(projectFile, 'utf8')).toBe(external);
    expect(await fs.readFile(sidecarFile, 'utf8')).toBe('baseline sidecar');
    expect(await listScreenshotTransactions(projectPath)).toEqual([]);
  });
});
