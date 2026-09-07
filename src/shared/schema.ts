import { z } from 'zod';
import type { ProjectData } from './types.js';
import { DEFAULT_EXPORT_PREFERENCES } from './utils.js';

export const filenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/[\\/:]/.test(value) &&
      [...value].every((char) => char.charCodeAt(0) >= 32) &&
      value !== '.' &&
      value !== '..' &&
      !/[. ]$/.test(value),
    'Expected a filename without directory components',
  );
const reference = (folder: string) =>
  z
    .string()
    .refine(
      (value) =>
        value.split('/').length === 4 &&
        value.split('/')[0] === 'collections' &&
        filenameSchema.safeParse(value.split('/')[1]).success &&
        value.split('/')[2] === folder &&
        filenameSchema.safeParse(value.split('/')[3]).success,
    );

export const screenshotSchema = z.object({
  collectionId: filenameSchema,
  id: z.string().min(1),
  originalFilename: z.string(),
  storedFilename: filenameSchema,
  title: z.string(),
  description: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  annotationFile: reference('annotations'),
  descriptionFile: reference('descriptions'),
  originalWidth: z.number().positive(),
  originalHeight: z.number().positive(),
  includeInExport: z.boolean().default(true),
  conflict: z.boolean().optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(3),
  collections: z
    .array(
      z.object({
        id: filenameSchema,
        name: z.string().min(1).max(120),
        archived: z.boolean(),
        createdAt: z.string(),
        updatedAt: z.string(),
        overallContext: z.string(),
      }),
    )
    .min(1)
    .max(1000),
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['active', 'archived']),
  favourite: z.boolean(),
  screenshots: z.array(screenshotSchema),
  exportPreferences: z
    .object({
      includeOriginalScreenshots: z.boolean(),
      includeAnnotationMetadata: z.boolean(),
      template: z.literal('default'),
    })
    .optional(),
});

const legacyReference = z.string().min(1);
export const legacyScreenshotSchema = z.object({
  roundId: filenameSchema.default('001-first-feedback'),
  id: z.string().min(1),
  originalFilename: z.string(),
  storedFilename: filenameSchema,
  title: z.string(),
  description: z.string().default(''),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tags: z.array(z.string()).default([]),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  status: z.enum(['draft', 'ready', 'needs-review', 'completed']).default('draft'),
  annotationFile: legacyReference,
  notesFile: legacyReference,
  originalWidth: z.number().positive(),
  originalHeight: z.number().positive(),
  includeInExport: z.boolean().default(true),
});

export const legacyProjectSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  rounds: z
    .array(
      z.object({
        id: filenameSchema,
        name: z.string().min(1).max(120),
        archived: z.boolean(),
        createdAt: z.string(),
      }),
    )
    .min(1)
    .default([{ id: '001-first-feedback', name: 'First feedback', archived: false, createdAt: '' }]),
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['active', 'archived']),
  tags: z.array(z.string()),
  favourite: z.boolean(),
  screenshots: z.array(legacyScreenshotSchema),
  exportPreferences: z
    .object({
      includeOriginalScreenshots: z.boolean(),
      includeAnnotationMetadata: z.boolean(),
      includedFields: z.array(z.string()),
      overallInstructions: z.string(),
      desiredOutcome: z.string(),
      technicalConstraints: z.string(),
      template: z.literal('default'),
    })
    .optional(),
});

export type LegacyProjectData = z.infer<typeof legacyProjectSchema>;

function portablePathKey(value: string): string {
  return value.replaceAll('\\', '/').normalize('NFC').toLowerCase();
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateLegacyProject(value: unknown): LegacyProjectData {
  const parsed = legacyProjectSchema.parse(value);
  const collectionIds = new Set(parsed.rounds.map((round) => round.id));
  if (collectionIds.size !== parsed.rounds.length)
    throw new Error('Legacy project contains duplicate collection IDs.');
  if (hasDuplicates(parsed.screenshots.map((shot) => shot.id)))
    throw new Error('Legacy project contains duplicate screenshot IDs.');
  if (parsed.screenshots.some((shot) => !collectionIds.has(shot.roundId)))
    throw new Error('Legacy project contains a dangling collection reference.');
  if (
    parsed.schemaVersion === 2 &&
    parsed.screenshots.some(
      (shot) =>
        shot.annotationFile.replaceAll('\\', '/') !==
          `rounds/${shot.roundId}/annotations/${shot.storedFilename}.json` ||
        shot.notesFile.replaceAll('\\', '/') !== `rounds/${shot.roundId}/notes/${shot.storedFilename}.md`,
    )
  )
    throw new Error('Legacy v2 screenshot content paths do not match their collection and filename.');
  const imageKeys = parsed.screenshots.map((shot) =>
    portablePathKey(
      parsed.schemaVersion === 1 ? shot.storedFilename : `${shot.roundId}/${shot.storedFilename}`,
    ),
  );
  const contentKeys = parsed.screenshots.flatMap((shot) => [
    portablePathKey(shot.annotationFile),
    portablePathKey(shot.notesFile),
  ]);
  if (hasDuplicates(imageKeys) || hasDuplicates(contentKeys))
    throw new Error('Legacy screenshots contain aliased content paths. Migration was not started.');
  return parsed;
}

export function validateProject(value: unknown): ProjectData {
  const parsed = projectSchema.parse(value);
  const ids = new Set(parsed.collections.map((collection) => collection.id));
  if (
    ids.size !== parsed.collections.length ||
    parsed.screenshots.some((shot) => !ids.has(shot.collectionId))
  )
    throw new Error('Project contains invalid collection references.');
  if (new Set(parsed.screenshots.map((shot) => shot.id)).size !== parsed.screenshots.length)
    throw new Error('Project contains duplicate screenshot IDs.');
  if (
    hasDuplicates(
      parsed.screenshots.map((shot) => portablePathKey(`${shot.collectionId}/${shot.storedFilename}`)),
    )
  )
    throw new Error('Screenshots contain aliased per-collection storage paths.');
  if (
    parsed.screenshots.some(
      (shot) =>
        shot.annotationFile !== `collections/${shot.collectionId}/annotations/${shot.storedFilename}.json` ||
        shot.descriptionFile !== `collections/${shot.collectionId}/descriptions/${shot.storedFilename}.md`,
    )
  )
    throw new Error('Screenshot file references do not match its collection.');
  return { ...parsed, exportPreferences: parsed.exportPreferences ?? { ...DEFAULT_EXPORT_PREFERENCES } };
}

export function parseProjectFile(value: unknown): ProjectData | LegacyProjectData {
  const version = z.object({ schemaVersion: z.number().int() }).parse(value).schemaVersion;
  if (version === 3) return validateProject(value);
  if (version === 1 || version === 2) return validateLegacyProject(value);
  throw new Error(`Unsupported project schema version: ${version}.`);
}

export const notesSchema = z.object({
  summary: z.string(),
  observation: z.string(),
  problem: z.string(),
  expectedBehaviour: z.string(),
  requestedChange: z.string(),
  technicalDetails: z.string(),
  aiInstruction: z.string(),
  additionalNotes: z.string(),
});
export const annotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'arrow',
    'line',
    'rectangle',
    'rounded-rectangle',
    'ellipse',
    'highlight',
    'pen',
    'text',
    'callout',
    'step',
    'blur',
    'pixelate',
    'crop',
  ]),
  x: z.number().finite(),
  y: z.number().finite(),
  zIndex: z.number().finite(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
  rotation: z.number().finite().optional(),
  points: z.array(z.number().finite()).max(200000).optional(),
  text: z.string().optional(),
  stepNumber: z.number().int().positive().optional(),
  stroke: z.string().optional(),
  fill: z.string().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  opacity: z.number().min(0).max(1).optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  fontStyle: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  arrowhead: z.boolean().optional(),
  blurIntensity: z.number().nonnegative().optional(),
});
export const settingsPatchSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    interfaceScale: z.number().min(0.75).max(2).optional(),
    openRecentOnLaunch: z.boolean().optional(),
    confirmBeforeDeletion: z.boolean().optional(),
    updateChannel: z.enum(['stable', 'nightly']).optional(),
  })
  .strict();
