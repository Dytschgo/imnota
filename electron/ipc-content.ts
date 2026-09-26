import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerContentIpc(router: IpcRouter, host: IpcHost): void {
  const { handle } = router;
  const { assertProjectPath } = host;
  handle('content:create', async (_event, input) =>
    host.contentPersistence.create({ ...input, projectPath: await assertProjectPath(input.projectPath) }),
  );
  handle('content:load', async (_event, input) =>
    host.contentPersistence.load({ ...input, projectPath: await assertProjectPath(input.projectPath) }),
  );
  handle('content:save', async (_event, input) =>
    host.contentPersistence.save({ ...input, projectPath: await assertProjectPath(input.projectPath) }),
  );
  handle('content:duplicate', async (_event, input) =>
    host.contentPersistence.duplicate({ ...input, projectPath: await assertProjectPath(input.projectPath) }),
  );
  handle('content:delete', async (_event, input) => {
    const projectPath = await assertProjectPath(input.projectPath);
    // The renderer owns confirmation; persistence still validates the item and trash transaction.
    return host.contentPersistence.delete({ ...input, projectPath });
  });
  handle('content:undo-delete', async (_event, input) =>
    host.contentPersistence.undoDelete({ ...input, projectPath: await assertProjectPath(input.projectPath) }),
  );
}
