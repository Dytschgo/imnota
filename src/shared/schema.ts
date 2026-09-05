import { z } from 'zod';
import type { ProjectData } from './types.js';

const screenshotSchema = z.object({
  id: z.string(),
  originalFilename: z.string(),
  storedFilename: z.string(),
  title: z.string(),
  description: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tags: z.array(z.string()),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['draft', 'ready', 'needs-review', 'completed']),
  annotationFile: z.string(),
  notesFile: z.string(),
  originalWidth: z.number().positive(),
  originalHeight: z.number().positive(),
  includeInExport: z.boolean().default(true),
});

export const projectSchema = z.object({
  schemaVersion: z.number().int().positive(),
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
  return projectSchema.parse(value) as ProjectData;
}
