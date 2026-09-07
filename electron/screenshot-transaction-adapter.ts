import {
  commitScreenshotTransaction,
  discardScreenshotTransaction,
  stageScreenshotTransaction,
  type ScreenshotTransactionCommitResult,
  type ScreenshotTransactionKind,
  type ScreenshotTransactionOperations,
  type ScreenshotTransactionSummary,
  type ScreenshotTransactionWrite,
} from './screenshot-transactions.js';

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
