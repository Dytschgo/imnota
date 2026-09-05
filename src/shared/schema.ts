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
        (value.startsWith(`${folder}/`) &&
          filenameSchema.safeParse(value.slice(folder.length + 1)).success) ||
        (value.split('/').length === 4 &&
          value.split('/')[0] === 'rounds' &&
          filenameSchema.safeParse(value.split('/')[1]).success &&
          value.split('/')[2] === folder &&
          filenameSchema.safeParse(value.split('/')[3]).success),
    );

export const screenshotSchema = z.object({
  roundId: filenameSchema.default('001-first-feedback'),
  id: z.string(),
  originalFilename: z.string(),
  storedFilename: filenameSchema,
  title: z.string(),
  description: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tags: z.array(z.string()),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['draft', 'ready', 'needs-review', 'completed']),
  annotationFile: reference('annotations'),
  notesFile: reference('notes'),
  originalWidth: z.number().positive(),
  originalHeight: z.number().positive(),
  includeInExport: z.boolean().default(true),
});

export const projectSchema = z.object({
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
  screenshots: z.array(screenshotSchema),
  exportPreferences: z
    .object({
      includeOriginalScreenshots: z.boolean(),
      includeAnnotationMetadata: z.boolean(),
      includedFields: z.array(
        z.enum([
          'summary',
          'observation',
          'problem',
          'expectedBehaviour',
          'requestedChange',
          'technicalDetails',
          'aiInstruction',
          'additionalNotes',
        ]),
      ),
      overallInstructions: z.string(),
      desiredOutcome: z.string(),
      technicalConstraints: z.string(),
      template: z.literal('default'),
    })
    .optional(),
});

export function validateProject(value: unknown): ProjectData {
  const parsed = projectSchema.parse(value);
  const ids = new Set(parsed.rounds.map((round) => round.id));
  if (ids.size !== parsed.rounds.length || parsed.screenshots.some((shot) => !ids.has(shot.roundId)))
    throw new Error('Project contains invalid subfolder references.');
  if (new Set(parsed.screenshots.map((shot) => shot.id)).size !== parsed.screenshots.length)
    throw new Error('Project contains duplicate screenshot IDs.');
  if (
    parsed.schemaVersion === 2 &&
    parsed.screenshots.some(
      (shot) =>
        shot.annotationFile !== `rounds/${shot.roundId}/annotations/${shot.storedFilename}.json` ||
        shot.notesFile !== `rounds/${shot.roundId}/notes/${shot.storedFilename}.md`,
    )
  )
    throw new Error('Screenshot file references do not match its subfolder.');
  return { ...parsed, exportPreferences: parsed.exportPreferences ?? { ...DEFAULT_EXPORT_PREFERENCES } };
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
