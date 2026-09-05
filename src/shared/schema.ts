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
        value.startsWith(`${folder}/`) && filenameSchema.safeParse(value.slice(folder.length + 1)).success,
    );

export const screenshotSchema = z.object({
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
  schemaVersion: z.literal(1),
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
  arrowhead: z.boolean().optional(),
  blurIntensity: z.number().nonnegative().optional(),
});
export const settingsPatchSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    interfaceScale: z.number().min(0.75).max(2).optional(),
    openRecentOnLaunch: z.boolean().optional(),
    confirmBeforeDeletion: z.boolean().optional(),
  })
  .strict();
