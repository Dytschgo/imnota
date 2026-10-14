import { z } from 'zod';

/** Closed verification catalog. No plan, path, code or JavaScript comes from the renderer. */
export const NATIVE_FAULT_CASE_SETS = [
  'restore-eio',
  'restore-eacces',
  'restore-eperm',
  'restore-confirmation',
  'restore-marker',
  'restore-later-change',
  'restore-renderer-readback',
  'recovery-lineage-eio',
  'recovery-lineage-eacces',
  'recovery-lineage-eperm',
  'recovery-repair',
  'recovery-ui',
] as const;
export const faultCaseSetSchema = z.enum(NATIVE_FAULT_CASE_SETS);
export type NativeFaultCaseSet = z.infer<typeof faultCaseSetSchema>;
export const faultKinds = ['screenshot', 'drawing', 'text'] as const;
export type NativeFaultKind = (typeof faultKinds)[number];
export function nativeFaultCases(set: NativeFaultCaseSet): string[] {
  if (set === 'restore-confirmation')
    return faultKinds.flatMap((kind) => ['changed', 'unreadable'].map((reason) => `${kind}-${reason}`));
  if (set.startsWith('restore-')) return [...faultKinds];
  if (set.startsWith('recovery-lineage-')) return ['healthy', 'foreign'];
  if (set === 'recovery-repair') return ['baseline-repair', 'failed-repair'];
  return ['panel-retry-reset', 'undo-hover', 'undo-focus'];
}
export const faultHash = z.string().regex(/^[a-f0-9]{64}$/);
export const faultOwnershipSchema = z
  .object({
    schemaVersion: z.literal(1),
    nonce: z.uuid(),
    grantId: z.string().min(1).max(160),
    runRoot: z.string().min(1),
    profileRoot: z.string().min(1),
    artifactRoot: z.string().min(1),
    launcherPid: z.number().int().positive(),
    caseSet: faultCaseSetSchema,
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    sourceTree: z.string().regex(/^[a-f0-9]{40}$/),
    version: z.string().min(1).max(100),
    suppliedExecutable: z.string().min(1),
    suppliedSha256: faultHash,
    executableSha256: faultHash,
    asarSha256: faultHash,
    buildSha256: faultHash,
  })
  .strict();
export type NativeFaultOwnership = z.infer<typeof faultOwnershipSchema>;
export const faultCommandSchema = z
  .object({
    nonce: z.uuid(),
    caseId: z.string().min(1).max(80),
    requestId: z.uuid(),
    projectPath: z.string().min(1),
    projectId: z.string().regex(/^project_[a-f0-9-]{36}$/),
    action: z.enum([
      'observe',
      'arm-save',
      'queue-fixture-metadata',
      'stage-recovery-drafts',
      'render-app-failure',
      'render-panel-failure',
      'clear-render-failure',
      'disarm',
    ]),
  })
  .strict();
export type FaultCommand = z.infer<typeof faultCommandSchema>;
export const faultObservationSchema = z
  .object({
    nonce: z.uuid(),
    caseId: z.string().min(1).max(80),
    requestId: z.uuid(),
    projectPath: z.string(),
    projectId: z.string(),
    acceptedRevision: faultHash.nullable(),
    snapshotRevision: faultHash.nullable(),
    pendingMetadata: z.boolean(),
    pendingScreenshot: z.boolean(),
    pendingContent: z.boolean(),
    nativeMutations: z.number().int().nonnegative(),
    selectedItemId: z.string().nullable(),
    externalChange: z.string().nullable(),
    warning: z.string().max(16000),
    error: z.string().max(16000),
    event: z.string().max(80),
  })
  .strict();
export type FaultObservation = z.infer<typeof faultObservationSchema>;
export interface NativeFaultReceiver {
  readonly nonce: string;
  onCommand(callback: (command: unknown) => void): () => void;
  report(observation: FaultObservation): void;
}
export const FAULT_QUEUED_NAME = 'Fixture queued metadata';
export const FAULT_MARKDOWN = '# Fixture recovery\n\nfixture-draft-text\n';
export const FAULT_DESCRIPTION = 'fixture-draft-shot';
