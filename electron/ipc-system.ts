import { assertNoLinks, isWithin } from './files.js';
import { pathInput } from './ipc-contracts.js';
import { shell } from 'electron';
import fs from 'node:fs/promises';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerSystemIpc(router: IpcRouter, host: IpcHost): void {
  const { handle } = router;
  const {
    clipboardImage,
    copyBundleToClipboard,
    copyImageToClipboard,
    copyTextToClipboard,
    workspaceOrThrow,
  } = host;
  handle('system:open-path', async (_event, target: string) => {
    pathInput.parse(target);
    if (!isWithin(workspaceOrThrow(), target)) throw new Error('Folder is outside the workspace.');
    await assertNoLinks(target);
    if (!(await fs.stat(target)).isDirectory()) throw new Error('Only workspace folders can be opened.');
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  handle('system:copy-text', async (_event, text: string) => {
    await copyTextToClipboard(text);
  });
  handle('system:copy-image', async (_event, dataUrl: string) => {
    await copyImageToClipboard(dataUrl);
  });
  handle('system:copy-context', (_event, input) => copyBundleToClipboard(input.markdown, input.imageDataUrl));
  handle('onboarding:prepare-handoff', async (_event, input) => {
    clipboardImage(input.imageDataUrl);
    return host.onboardingHandoffWorkflow!.prepare(input);
  });
  handle('onboarding:copy-handoff', (_event, input) =>
    host.onboardingHandoffWorkflow!.copy(input.sessionId, input.action),
  );
  handle('onboarding:open-handoff', (_event, input) =>
    host.onboardingHandoffWorkflow!.open(input.sessionId, input.target),
  );
  // Long network operations run outside the filesystem IPC queue.
  handle('update:download', () => host.updateController.download());
  handle('update:check', () => host.updateController.check());
  handle('update:status', () => host.updateController.getStatus());
  handle('update:install', async () => {
    if (host.updateInstallPending) throw new Error('An update installation is already starting.');
    // Resolve session captures before starting an updater/helper that may outlive a cancelled quit.
    if (host.quickCaptureAccess?.store.size) {
      await host.quickCaptureAccess.show(true);
      throw new Error('Add or discard pending captures before restarting to install the update.');
    }
    host.updateInstallPending = true;
    try {
      // Close admission before draining all file work accepted before restart.
      await router.drain();
      if (host.quickCaptureAccess?.store.size)
        throw new Error('Add or discard pending captures before restarting to install the update.');
      await host.updateController.install();
    } catch (error) {
      host.updateInstallPending = false;
      throw error;
    }
  });
}
