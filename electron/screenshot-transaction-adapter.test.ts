// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { emptyProject } from '../src/shared/utils.js';
import { atomicWrite } from './files.js';
import {
  commitScreenshotFileTransaction,
  nextProjectMutationTimestamp,
  prepareConflictTransactionWrites,
  prepareRecoveryRestoreTransaction,
} from './screenshot-transaction-adapter.js';
import {
  commitScreenshotTransaction,
  discardScreenshotTransaction,
  listScreenshotTransactions,
  screenshotTransactionBaseline,
  stageScreenshotTransaction,
} from './screenshot-transactions.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((item) => fs.rm(item, { recursive: true, force: true })));
});

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

const operations = {
  write: atomicWrite,
  unlink: (target: string) => fs.unlink(target),
  removeDirectory: (target: string) => fs.rm(target, { recursive: true, force: true }),
};

async function recoveryFixture(count: number, changeDescriptions: boolean) {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-recovery-adapter-'));
  temporary.push(projectPath);
  const currentProject = emptyProject('Recovery', '');
  currentProject.id = 'project_recovery_fixture';
  currentProject.updatedAt = '2026-09-07T02:15:00.000Z';
  const screenshots: ScreenshotRecord[] = Array.from({ length: count }, (_, index) => {
    const filename = `shot-${String(index + 1).padStart(3, '0')}.png`;
    return {
      collectionId: '001-collection',
      id: `shot_${index + 1}`,
      originalFilename: filename,
      storedFilename: filename,
      title: filename,
      description: `saved description ${index + 1}`,
      position: index,
      createdAt: currentProject.createdAt,
      updatedAt: currentProject.updatedAt,
      priority: 'medium',
      annotationFile: `collections/001-collection/annotations/${filename}.json`,
      descriptionFile: `collections/001-collection/descriptions/${filename}.md`,
      originalWidth: 1,
      originalHeight: 1,
      includeInExport: true,
    };
  });
  currentProject.screenshots = screenshots;
  const recoveredProject: ProjectData = {
    ...currentProject,
    updatedAt: '2026-09-07T02:15:00.001Z',
    screenshots: screenshots.map((shot, index) => ({
      ...shot,
      description: changeDescriptions ? `recovered description ${index + 1}` : shot.description,
    })),
  };
  const projectSource = Buffer.from(JSON.stringify(currentProject, null, 2));
  const recoverySource = Buffer.from('{"recovery":true}');
  await fs.writeFile(path.join(projectPath, 'project.json'), projectSource);
  await fs.writeFile(path.join(projectPath, '.imnota-recovery.json'), recoverySource);
  const annotations: Record<string, []> = {};
  for (const shot of screenshots) {
    const annotationPath = path.join(projectPath, shot.annotationFile);
    const descriptionPath = path.join(projectPath, shot.descriptionFile);
    await fs.mkdir(path.dirname(annotationPath), { recursive: true });
    await fs.mkdir(path.dirname(descriptionPath), { recursive: true });
    await fs.writeFile(annotationPath, '[]');
    await fs.writeFile(descriptionPath, shot.description);
    annotations[shot.id] = [];
  }
  return { projectPath, currentProject, recoveredProject, projectSource, recoverySource, annotations };
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
    await expect(
      commitScreenshotFileTransaction(
        projectPath,
        {
          kind: 'save',
          writes: [
            {
              relativePath: 'sidecar.md',
              after: Buffer.from('candidate sidecar'),
              expectedBefore: screenshotTransactionBaseline(Buffer.from('baseline sidecar')),
            },
            {
              relativePath: 'project.json',
              after: Buffer.from('{"revision":"candidate"}'),
              expectedBefore: screenshotTransactionBaseline(Buffer.from(baseline)),
            },
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
    ).rejects.toThrow(/caller-observed baseline|project changed/);

    expect(await fs.readFile(projectFile, 'utf8')).toBe(external);
    expect(await fs.readFile(sidecarFile, 'utf8')).toBe('baseline sidecar');
    expect(await listScreenshotTransactions(projectPath)).toEqual([]);
  });

  it.each(['annotation', 'description'] as const)(
    'rejects %s drift that occurs while the recovery dialog is open',
    async (target) => {
      const fixture = await recoveryFixture(1, false);
      const prepared = await prepareRecoveryRestoreTransaction(fixture.projectPath, fixture);
      const shot = fixture.currentProject.screenshots[0];
      const targetPath = path.join(
        fixture.projectPath,
        target === 'annotation' ? shot.annotationFile : shot.descriptionFile,
      );
      await fs.writeFile(targetPath, `external ${target}`);

      await expect(
        commitScreenshotFileTransaction(fixture.projectPath, {
          kind: 'recovery-restore',
          writes: prepared.writes,
          assertBaseline: prepared.assertBaseline,
          operations,
        }),
      ).rejects.toThrow(new RegExp(`${target}s?/|${target}.*changed`, 'i'));
      expect(await fs.readFile(targetPath, 'utf8')).toBe(`external ${target}`);
      expect(await fs.readFile(path.join(fixture.projectPath, '.imnota-recovery.json'), 'utf8')).toBe(
        fixture.recoverySource.toString('utf8'),
      );
    },
  );

  it('consumes the exact observed recovery journal when a conflict copy commits', async () => {
    const fixture = await recoveryFixture(1, false);
    const writes = prepareConflictTransactionWrites({
      imagePath: 'collections/001-collection/screenshots/conflict.png',
      imageAfter: Buffer.from('image'),
      annotationPath: 'collections/001-collection/annotations/conflict.png.json',
      annotationAfter: Buffer.from('[]'),
      descriptionPath: 'collections/001-collection/descriptions/conflict.png.md',
      descriptionAfter: Buffer.from('conflict'),
      projectAfter: Buffer.from('{"candidate":true}'),
      projectSource: fixture.projectSource,
      recoverySource: fixture.recoverySource,
    });
    await commitScreenshotFileTransaction(fixture.projectPath, {
      kind: 'conflict',
      writes,
      assertBaseline: async () => undefined,
      operations,
    });
    await expect(fs.stat(path.join(fixture.projectPath, '.imnota-recovery.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(path.join(fixture.projectPath, 'project.json'), 'utf8')).toBe(
      '{"candidate":true}',
    );
  });

  it('commits a bounded 100-screenshot recovery containing 203 writes', async () => {
    const fixture = await recoveryFixture(100, true);
    const prepared = await prepareRecoveryRestoreTransaction(fixture.projectPath, fixture);
    expect(prepared.writes).toHaveLength(203);
    await commitScreenshotFileTransaction(fixture.projectPath, {
      kind: 'recovery-restore',
      writes: prepared.writes,
      assertBaseline: prepared.assertBaseline,
      operations,
    });
    expect(
      await fs.readFile(
        path.join(fixture.projectPath, fixture.recoveredProject.screenshots[99].descriptionFile),
        'utf8',
      ),
    ).toBe('recovered description 100');
    expect(await listScreenshotTransactions(fixture.projectPath)).toEqual([]);
  }, 30_000);
});
