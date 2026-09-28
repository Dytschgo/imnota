import { filenameSchema } from '../src/shared/schema.js';
import { pathInput, workflowBundleNumber, workflowManifest, workflowSessionId } from './ipc-contracts.js';
import { z } from 'zod';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerPromptExportIpc(router: IpcRouter, host: IpcHost): void {
  const { handleWorkflow } = router;
  handleWorkflow(
    'workflow:prompt-export:start',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              projectPath: pathInput,
              collectionId: filenameSchema,
              bundles: workflowManifest,
            })
            .strict(),
        ])
        .parse(args);
      return host.promptBundleWorkflow!.start(input.projectPath, input.collectionId, input.bundles);
    },
    true,
  );
  handleWorkflow(
    'workflow:prompt-export:write',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              sessionId: workflowSessionId,
              bundleNumber: workflowBundleNumber,
              pngDataUrl: z
                .string()
                .max(134_000_000)
                .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
                .optional(),
              markdown: z.string().min(1).max(2_000_000),
              sourceAssets: z
                .array(
                  z
                    .object({
                      filename: filenameSchema.refine((value) => value.endsWith('.json'), {
                        message: 'Drawing source filename must end in .json.',
                      }),
                      source: z.string().max(20_000_000),
                    })
                    .strict(),
                )
                .max(10_000)
                .optional(),
            })
            .strict(),
        ])
        .parse(args);
      // The export worker owns this method's optional fifth argument; keep this worktree
      // compatible with the pre-integration class type while forwarding the validated assets.
      const writeWithSources = host.promptBundleWorkflow!.write.bind(host.promptBundleWorkflow!) as (
        sessionId: string,
        bundleNumber: number,
        pngDataUrl: string | undefined,
        markdown: string,
        sourceAssets?: readonly { filename: string; source: string }[],
      ) => Promise<unknown>;
      return writeWithSources(
        input.sessionId,
        input.bundleNumber,
        input.pngDataUrl,
        input.markdown,
        input.sourceAssets,
      );
    },
    true,
  );
  handleWorkflow(
    'workflow:prompt-export:finish',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              sessionId: workflowSessionId,
              masterMarkdown: z.string().max(2_000_000).optional(),
            })
            .strict(),
        ])
        .parse(args);
      return host.promptBundleWorkflow!.finish(input.sessionId, input.masterMarkdown);
    },
    true,
  );
  handleWorkflow('workflow:prompt-export:cancel', async (_event, ...args) => {
    const [input] = z.tuple([z.object({ sessionId: workflowSessionId }).strict()]).parse(args);
    return host.promptBundleWorkflow!.cancel(input.sessionId);
  });
  handleWorkflow('workflow:prompt-export:read', async (_event, ...args) => {
    const [input] = z
      .tuple([z.object({ sessionId: workflowSessionId, bundleNumber: workflowBundleNumber }).strict()])
      .parse(args);
    return host.promptBundleWorkflow!.read(input.sessionId, input.bundleNumber);
  });
  handleWorkflow('workflow:prompt-export:copy', async (_event, ...args) => {
    const [input] = z
      .tuple([
        z
          .object({
            sessionId: workflowSessionId,
            bundleNumber: workflowBundleNumber,
            target: z.enum(['rich', 'files', 'files-rich', 'markdown', 'image', 'paths']),
          })
          .strict(),
      ])
      .parse(args);
    return host.promptBundleWorkflow!.copy(input.sessionId, input.bundleNumber, input.target);
  });
  handleWorkflow('workflow:prompt-export:open', async (_event, ...args) => {
    const [input] = z
      .tuple([
        z
          .object({
            sessionId: workflowSessionId,
            bundleNumber: workflowBundleNumber,
            target: z.enum(['folder', 'png', 'markdown', 'master']),
          })
          .strict(),
      ])
      .parse(args);
    await host.promptBundleWorkflow!.open(input.sessionId, input.bundleNumber, input.target);
  });
}
