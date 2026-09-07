import fs from 'node:fs/promises';
import path from 'node:path';
import type { Annotation, ProjectData } from '../src/shared/types.js';
import { assertNoLinks, isWithin } from './files.js';
import {
  commitScreenshotTransaction,
  discardScreenshotTransaction,
  screenshotTransactionBaseline,
  stageScreenshotTransaction,
  type ScreenshotTransactionCommitResult,
  type ScreenshotTransactionKind,
  type ScreenshotTransactionOperations,
  type ScreenshotTransactionSummary,
  type ScreenshotTransactionWrite,
} from './screenshot-transactions.js';

export interface PreparedRecoveryRestoreTransaction {
  writes: ScreenshotTransactionWrite[];
  assertBaseline(): Promise<void>;
}

export interface PrepareRecoveryRestoreTransactionInput {
  currentProject: ProjectData;
  recoveredProject: ProjectData;
  projectSource: Uint8Array;
  recoverySource: Uint8Array;
  annotations: Readonly<Record<string, readonly Annotation[]>>;
}

export interface PrepareConflictTransactionInput {
  imagePath: string;
  imageAfter: Uint8Array;
  annotationPath: string;
  annotationAfter: Uint8Array;
  descriptionPath: string;
  descriptionAfter: Uint8Array;
  projectAfter: Uint8Array;
  projectSource: Uint8Array;
  recoverySource: Uint8Array | null;
}

export interface CommitScreenshotFileTransactionInput {
  kind: ScreenshotTransactionKind;
  writes: ScreenshotTransactionWrite[];
  assertBaseline(): Promise<void>;
  operations: ScreenshotTransactionOperations;
}

export interface ScreenshotTransactionAdapterDependencies {
  stage(
    projectPath: string,
    input: { kind: ScreenshotTransactionKind; writes: ScreenshotTransactionWrite[] },
    operations: ScreenshotTransactionOperations,
  ): Promise<ScreenshotTransactionSummary>;
  commit(
    projectPath: string,
    token: string,
    operations: ScreenshotTransactionOperations,
  ): Promise<ScreenshotTransactionCommitResult>;
  discard(projectPath: string, token: string, operations: ScreenshotTransactionOperations): Promise<void>;
}

const defaultDependencies: ScreenshotTransactionAdapterDependencies = {
  stage: stageScreenshotTransaction,
  commit: commitScreenshotTransaction,
  discard: discardScreenshotTransaction,
};

export function nextProjectMutationTimestamp(previous: string, now = new Date()): string {
  const previousTime = Date.parse(previous);
  if (!Number.isFinite(previousTime)) return now.toISOString();
  return new Date(Math.max(now.getTime(), previousTime + 1)).toISOString();
}

async function readOptionalProjectFile(projectPath: string, relativePath: string): Promise<Buffer | null> {
  const target = path.resolve(projectPath, ...relativePath.split('/'));
  if (!isWithin(projectPath, target) || target === path.resolve(projectPath))
    throw new Error(`Screenshot transaction path leaves the project: ${relativePath}`);
  await assertNoLinks(target);
  return fs.readFile(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

function sameBaseline(left: Uint8Array | null, right: Uint8Array | null): boolean {
  const leftBaseline = screenshotTransactionBaseline(left);
  const rightBaseline = screenshotTransactionBaseline(right);
  return (
    leftBaseline.state === rightBaseline.state &&
    (leftBaseline.state === 'absent' ||
      (rightBaseline.state === 'present' && leftBaseline.sha256 === rightBaseline.sha256))
  );
}

export function prepareConflictTransactionWrites(
  input: PrepareConflictTransactionInput,
): ScreenshotTransactionWrite[] {
  return [
    {
      relativePath: input.imagePath,
      after: input.imageAfter,
      expectedBefore: screenshotTransactionBaseline(null),
    },
    {
      relativePath: input.annotationPath,
      after: input.annotationAfter,
      expectedBefore: screenshotTransactionBaseline(null),
    },
    {
      relativePath: input.descriptionPath,
      after: input.descriptionAfter,
      expectedBefore: screenshotTransactionBaseline(null),
    },
    {
      relativePath: '.imnota-recovery.json',
      after: null,
      expectedBefore: screenshotTransactionBaseline(input.recoverySource),
    },
    {
      relativePath: 'project.json',
      after: input.projectAfter,
      expectedBefore: screenshotTransactionBaseline(input.projectSource),
    },
  ];
}

export async function prepareRecoveryRestoreTransaction(
  projectPath: string,
  input: PrepareRecoveryRestoreTransactionInput,
): Promise<PreparedRecoveryRestoreTransaction> {
  const observations = new Map<string, Buffer | null>([
    ['project.json', Buffer.from(input.projectSource)],
    ['.imnota-recovery.json', Buffer.from(input.recoverySource)],
  ]);
  const observe = async (relativePath: string): Promise<Buffer | null> => {
    if (!observations.has(relativePath))
      observations.set(relativePath, await readOptionalProjectFile(projectPath, relativePath));
    return observations.get(relativePath)!;
  };
  const backupSource = await observe('.imnota-recovery-backup.json');
  const writes: ScreenshotTransactionWrite[] = [
    {
      relativePath: '.imnota-recovery-backup.json',
      after: input.recoverySource,
      expectedBefore: screenshotTransactionBaseline(backupSource),
    },
    {
      relativePath: '.imnota-recovery.json',
      after: null,
      expectedBefore: screenshotTransactionBaseline(input.recoverySource),
    },
  ];
  const currentById = new Map(input.currentProject.screenshots.map((shot) => [shot.id, shot]));
  for (const shot of input.recoveredProject.screenshots) {
    if (Object.prototype.hasOwnProperty.call(input.annotations, shot.id)) {
      const annotationSource = await observe(shot.annotationFile);
      writes.push({
        relativePath: shot.annotationFile,
        after: Buffer.from(JSON.stringify(input.annotations[shot.id], null, 2)),
        expectedBefore: screenshotTransactionBaseline(annotationSource),
      });
    }
    const descriptionSource = await observe(shot.descriptionFile);
    if (currentById.get(shot.id)?.description !== shot.description)
      writes.push({
        relativePath: shot.descriptionFile,
        after: Buffer.from(shot.description),
        expectedBefore: screenshotTransactionBaseline(descriptionSource),
      });
  }
  writes.push({
    relativePath: 'project.json',
    after: Buffer.from(JSON.stringify(input.recoveredProject, null, 2)),
    expectedBefore: screenshotTransactionBaseline(input.projectSource),
  });

  const assertBaseline = async () => {
    for (const [relativePath, expected] of observations) {
      const current = await readOptionalProjectFile(projectPath, relativePath);
      if (!sameBaseline(current, expected))
        throw new Error(`${relativePath} changed while recovery was awaiting confirmation.`);
    }
  };
  await assertBaseline();
  return { writes, assertBaseline };
}

/**
 * Closes the read-to-stage race around the transaction helper. The first
 * assertion rejects an already-stale candidate; the second ensures the
 * helper captured that same baseline before any live writes can begin.
 */
export async function commitScreenshotFileTransaction(
  projectPath: string,
  input: CommitScreenshotFileTransactionInput,
  dependencies: ScreenshotTransactionAdapterDependencies = defaultDependencies,
): Promise<ScreenshotTransactionCommitResult> {
  await input.assertBaseline();
  const staged = await dependencies.stage(
    projectPath,
    { kind: input.kind, writes: input.writes },
    input.operations,
  );
  try {
    await input.assertBaseline();
  } catch (error) {
    try {
      await dependencies.discard(projectPath, staged.token, input.operations);
    } catch (discardError) {
      throw new AggregateError(
        [error, discardError],
        'The project changed before commit and the staged candidate could not be discarded safely.',
      );
    }
    throw error;
  }
  return dependencies.commit(projectPath, staged.token, input.operations);
}
