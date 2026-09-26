import { projectSchema, validateProject } from '../src/shared/schema.js';
import { pathInput, workflowSessionId } from './ipc-contracts.js';
import { z } from 'zod';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerProjectWatchIpc(router: IpcRouter, host: IpcHost): void {
  const { handleWorkflow } = router;
  const { assertProjectPath } = host;
  handleWorkflow(
    'workflow:project-watch:start',
    async (_event, ...args) => {
      const [input] = z.tuple([z.object({ projectPath: pathInput }).strict()]).parse(args);
      return host.projectWatchManager!.start(await assertProjectPath(input.projectPath));
    },
    true,
  );
  handleWorkflow('workflow:project-watch:stop', (_event, ...args) => {
    const [input] = z.tuple([z.object({ watchId: workflowSessionId }).strict()]).parse(args);
    host.projectWatchManager!.stop(input.watchId);
  });
  handleWorkflow('workflow:project-watch:reload', async (_event, ...args) => {
    const [input] = z.tuple([z.object({ watchId: workflowSessionId }).strict()]).parse(args);
    return host.projectWatchManager!.reload(input.watchId);
  });
  handleWorkflow(
    'workflow:project-watch:cas',
    async (_event, ...args) => {
      const [input] = z
        .tuple([
          z
            .object({
              watchId: workflowSessionId,
              expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
              project: projectSchema,
            })
            .strict(),
        ])
        .parse(args);
      return host.projectWatchManager!.compareAndSwap(
        input.watchId,
        input.expectedRevision,
        validateProject(input.project),
      );
    },
    true,
  );
}
