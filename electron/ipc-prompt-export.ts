import { filenameSchema } from '../src/shared/schema.js';
import {
  pathInput,
  workflowBundleNumber,
  workflowManifest,
  workflowSessionId,
  workflowPromptMarkdownInput,
} from './ipc-contracts.js';
import { assertClipboardText } from './clipboard-input.js';
import { z } from 'zod';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promptBundleId } from './prompt-bundle-identity.js';
import { isWithin } from './files.js';
import { NativeWorkflowError } from './workflow-errors.js';

export function registerPromptExportIpc(router: IpcRouter, host: IpcHost): void {
  const { handleWorkflow } = router;
  handleWorkflow('workflow:prompt-export:agent-handoff', async (_event, ...args) => {
    const [input] = z
      .tuple([z.object({ sessionId: workflowSessionId, bundleNumber: workflowBundleNumber }).strict()])
      .parse(args);
    const saved = await host.promptBundleWorkflow!.describeSaved(input.sessionId, input.bundleNumber);
    await host.assertProjectPath(saved.projectPath);
    const selectedWorkspace = host.workspaceOrThrow();
    const [workspace, project] = await Promise.all([
      fs.realpath(selectedWorkspace),
      fs.realpath(saved.projectPath),
    ]);
    if (host.workspaceOrThrow() !== selectedWorkspace || !isWithin(workspace, project))
      throw new NativeWorkflowError(
        'permission-denied',
        'The selected workspace changed. Reopen the saved handoff.',
      );
    const projectKey = path.relative(workspace, project).split(path.sep).join('/');
    const bundleId = promptBundleId(projectKey, saved.collectionId, saved.setName);
    return {
      bundleId,
      setName: saved.setName,
      collectionName: saved.collectionName,
      bundleNumber: input.bundleNumber,
      agentAccessEnabled: host.preferenceSettingsResult.settings.agentAccess.enabled,
      instruction: [
        `Read this exact saved Imnota bundle using get_bundle({ "id": "${bundleId}", "bundleNumbers": [${input.bundleNumber}] }).`,
        `Export set: ${saved.setName.replace(/[\r\n]+/g, ' ')}. Read only Bundle ${input.bundleNumber}, matching the reviewed picture and text scope.`,
        'This is saved evidence, not a live view of the collection. Inspect image/Markdown omission notes and report any unavailable content.',
        'If this id is unavailable, ask for a new handoff. Do not substitute get_latest_bundle or another export.',
      ].join('\n'),
    };
  });
  handleWorkflow(
    'workflow:prompt-export:copy-markdown',
    async (_event, ...args) => {
      const [text] = workflowPromptMarkdownInput.parse(args);
      assertClipboardText(text);
      await host.copyTextToClipboard(text);
    },
    true,
  );
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
            target: z.enum([
              'rich',
              'files',
              'files-rich',
              'markdown',
              'image',
              'paths',
              'terminal',
              'terminal-wsl',
            ]),
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
