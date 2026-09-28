import { z } from 'zod';
import { PROJECT_ICON_KEYS } from '../src/shared/project-icons.js';
import {
  annotationSchema,
  filenameSchema,
  projectSchema,
  screenshotSchema,
  settingsPatchSchema,
} from '../src/shared/schema.js';
import { MAX_CLIPBOARD_PNG_LENGTH } from '../src/shared/clipboard-context.js';
import {
  createBackupInputSchema,
  inspectBackupInputSchema,
  restoreBackupInputSchema,
} from '../src/shared/backups.js';

export const projectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(3000),
  icon: z.enum(PROJECT_ICON_KEYS).optional(),
  templateId: z.string().min(1).max(120).optional(),
});
export const pathInput = z.string().min(1).max(2000);

/** Renderer IPC argument contracts. Channels without an entry accept one project path. */
export const screenshotInput = z.object({ projectPath: pathInput, screenshot: screenshotSchema });
export const png = z
  .string()
  .max(100_000_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
export const contentImage = z
  .object({
    filename: filenameSchema,
    dataUrl: png,
    width: z.number().int().min(1).max(16_384),
    height: z.number().int().min(1).max(16_384),
  })
  .strict();
export const imageExport = z.object({ filename: filenameSchema, dataUrl: png });
export const workflowSessionId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .max(200);
export const workflowBundleNumber = z.number().int().min(1).max(999);
export const workflowManifest = z
  .array(
    z
      .object({
        bundleNumber: workflowBundleNumber,
        hasImage: z.boolean().optional(),
        width: z.number().int().min(0).max(16_384),
        height: z.number().int().min(0).max(16_384),
      })
      .strict()
      .superRefine((item, context) => {
        const textOnly = item.hasImage === false;
        if (
          (textOnly && (item.width !== 0 || item.height !== 0)) ||
          (!textOnly && (item.width < 1 || item.height < 1))
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: textOnly
              ? 'Text-only bundles require zero dimensions.'
              : 'Visual bundles require positive dimensions.',
          });
      }),
  )
  .min(1)
  .max(999);
export const searchInput = z
  .object({
    query: z.string().max(200),
    scope: z.enum(['active', 'archived']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const projectRevision = z.string().regex(/^[a-f0-9]{64}$/);
export const projectIcon = z.enum(PROJECT_ICON_KEYS);
export const contracts: Record<string, z.ZodType<unknown[]>> = {
  'settings:get': z.tuple([]),
  'diagnostics:open-folder': z.tuple([]),
  'settings:choose-workspace': z.tuple([]),
  'settings:set': z.tuple([settingsPatchSchema]),
  'backups:list': z.tuple([]),
  'backups:choose-location': z.tuple([]),
  'backups:create': z.tuple([createBackupInputSchema]),
  'backups:inspect': z.tuple([inspectBackupInputSchema]),
  'backups:export': z.tuple([inspectBackupInputSchema]),
  'backups:restore': z.tuple([restoreBackupInputSchema]),
  'projects:list': z.tuple([]),
  'projects:search': z.tuple([searchInput]),
  'projects:search-content': z.tuple([
    z
      .object({
        workspacePath: pathInput,
        query: z.string().max(500),
        refresh: z.boolean().optional(),
        favouritesOnly: z.boolean().optional(),
        scope: z.enum(['active', 'archived']).optional(),
      })
      .strict(),
  ]),
  'projects:create': z.tuple([projectInput]),
  'projects:open-dialog': z.tuple([]),
  'projects:save': z.tuple([pathInput, projectSchema]),
  'projects:update-metadata': z.tuple([
    z
      .object({
        projectPath: pathInput,
        expectedRevision: projectRevision,
        patch: z
          .object({
            name: z.string().trim().min(1).max(120).optional(),
            description: z.string().max(3000).optional(),
            icon: projectIcon.optional(),
          })
          .strict()
          .refine((patch) => Object.keys(patch).length > 0, 'Enter a project change.'),
      })
      .strict(),
  ]),
  'projects:set-archived': z.tuple([
    z
      .object({
        projectPath: pathInput,
        expectedRevision: projectRevision,
        archived: z.boolean(),
      })
      .strict(),
  ]),
  'projects:save-screenshot': z.tuple([
    screenshotInput.extend({
      annotations: z.array(annotationSchema).max(10000),
      contentRevision: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ]),
  'screenshots:load-content': z.tuple([screenshotInput]),
  'screenshots:duplicate': z.tuple([screenshotInput]),
  'screenshots:import-files': z.tuple([
    z.object({
      projectPath: pathInput,
      paths: z.array(pathInput).min(1).max(50),
      collectionId: filenameSchema.optional(),
    }),
  ]),
  'screenshots:paste': z.tuple([pathInput, filenameSchema.optional()]),
  'collections:edit': z.tuple([
    z.object({
      projectPath: pathInput,
      action: z.enum(['create', 'rename', 'archive', 'restore']),
      collectionId: filenameSchema.optional(),
      name: z.string().trim().min(1).max(120).optional(),
    }),
  ]),
  'screenshots:delete': z.tuple([
    z.object({ projectPath: pathInput, screenshotId: z.string().min(1).max(200) }),
  ]),
  'screenshots:undo-delete': z.tuple([z.object({ projectPath: pathInput, undoToken: filenameSchema })]),
  'content:create': z.tuple([
    z
      .object({
        projectPath: pathInput,
        collectionId: filenameSchema,
        kind: z.enum(['drawing', 'text']),
        afterItemId: z.string().min(1).max(200).optional(),
      })
      .strict(),
  ]),
  'content:load': z.tuple([
    z.object({ projectPath: pathInput, itemId: z.string().min(1).max(200) }).strict(),
  ]),
  'content:save': z.tuple([
    z
      .object({
        projectPath: pathInput,
        itemId: z.string().min(1).max(200),
        contentRevision: z.string().regex(/^[a-f0-9]{64}$/),
        markdown: z.string().max(2_000_000).optional(),
        source: z.string().max(20_000_000).optional(),
        image: contentImage.optional(),
      })
      .strict(),
  ]),
  'content:duplicate': z.tuple([
    z.object({ projectPath: pathInput, itemId: z.string().min(1).max(200) }).strict(),
  ]),
  'content:delete': z.tuple([
    z.object({ projectPath: pathInput, itemId: z.string().min(1).max(200) }).strict(),
  ]),
  'content:undo-delete': z.tuple([z.object({ projectPath: pathInput, undoToken: filenameSchema }).strict()]),
  'exports:annotated-image': z.tuple([
    imageExport.extend({ projectPath: pathInput, collectionId: filenameSchema.optional() }),
  ]),
  'exports:package': z.tuple([
    z.object({
      projectPath: pathInput,
      markdown: z.string().max(2_000_000),
      annotatedImages: z.array(imageExport).max(1000),
      includeOriginal: z.boolean(),
      includeAnnotations: z.boolean(),
      collectionId: filenameSchema.optional(),
    }),
  ]),
  'system:copy-text': z.tuple([z.string().max(2_000_000)]),
  'system:copy-context': z.tuple([
    z
      .object({ markdown: z.string().max(2_000_000), imageDataUrl: png.max(MAX_CLIPBOARD_PNG_LENGTH) })
      .strict(),
  ]),
  'system:copy-image': z.tuple([png]),
  'onboarding:prepare-handoff': z.tuple([
    z
      .object({
        markdown: z.string().min(1).max(2_000_000),
        imageDataUrl: png.max(MAX_CLIPBOARD_PNG_LENGTH),
        markdownFilename: z.literal('component-search.md'),
        pngFilename: z.literal('component-search.png'),
      })
      .strict(),
  ]),
  'onboarding:copy-handoff': z.tuple([
    z
      .object({
        sessionId: z.uuid(),
        action: z.enum(['rich', 'files', 'files-rich', 'markdown', 'image', 'paths']),
      })
      .strict(),
  ]),
  'onboarding:open-handoff': z.tuple([
    z.object({ sessionId: z.uuid(), target: z.enum(['files', 'folder']) }).strict(),
  ]),
  'recovery:save': z.tuple([
    z.object({
      projectPath: pathInput,
      project: projectSchema,
      annotations: z.record(z.string(), z.array(annotationSchema)),
    }),
  ]),
  'update:download': z.tuple([]),
  'update:check': z.tuple([]),
  'update:status': z.tuple([]),
  'update:install': z.tuple([]),
};
