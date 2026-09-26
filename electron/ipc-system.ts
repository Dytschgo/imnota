import type { ExportRequest } from '../src/shared/types.js';
import { nowIso, sanitizeFilename } from '../src/shared/utils.js';
import { screenshotPath } from './collections.js';
import { assertNoLinks, isWithin } from './files.js';
import { pathInput } from './ipc-contracts.js';
import { shell } from 'electron';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerSystemIpc(router: IpcRouter, host: IpcHost): void {
  const { handle } = router;
  const {
    assertProjectPath,
    atomicWrite,
    clipboardImage,
    copyBundleToClipboard,
    copyImageToClipboard,
    copyTextToClipboard,
    readProject,
    workspaceOrThrow,
  } = host;
  handle('exports:annotated-image', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    if (input.collectionId && !project.collections.some((item) => item.id === input.collectionId))
      throw new Error('Collection not found.');
    const folder = input.collectionId
      ? path.join(safePath, 'collections', input.collectionId, 'exports')
      : path.join(safePath, 'exports');
    const filename = sanitizeFilename(input.filename, 'annotated.png').replace(/\.png$/i, '') + '.png';
    const target = path.join(folder, filename);
    await atomicWrite(target, Buffer.from(input.dataUrl.split(',')[1], 'base64'));
    return target;
  });
  handle('exports:package', async (_event, input: ExportRequest) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    if (input.collectionId && !project.collections.some((item) => item.id === input.collectionId))
      throw new Error('Collection not found.');
    const exportDir = input.collectionId
      ? path.join(safePath, 'collections', input.collectionId, 'exports')
      : path.join(safePath, 'exports');
    await assertNoLinks(exportDir);
    await fs.mkdir(exportDir, { recursive: true });
    const included = project.screenshots.filter(
      (s) => s.includeInExport && (!input.collectionId || s.collectionId === input.collectionId),
    );
    const includedContent = project.contentItems?.filter(
      (item) => item.includeInExport && (!input.collectionId || item.collectionId === input.collectionId),
    );
    const briefPath = path.join(exportDir, 'context.md');
    await atomicWrite(briefPath, input.markdown);
    const zip = new JSZip();
    zip.file('context.md', input.markdown);
    zip.file(
      'project.json',
      JSON.stringify(
        {
          ...project,
          screenshots: included,
          ...(includedContent ? { contentItems: includedContent } : {}),
          collections: input.collectionId
            ? project.collections.filter((collection) => collection.id === input.collectionId)
            : project.collections,
        },
        null,
        2,
      ),
    );
    for (const image of input.annotatedImages) {
      const buffer = Buffer.from(image.dataUrl.split(',')[1], 'base64');
      await atomicWrite(path.join(exportDir, image.filename), buffer);
      zip.file(image.filename, buffer);
    }
    if (input.includeOriginal) {
      for (const shot of included) {
        await assertNoLinks(screenshotPath(safePath, shot));
        const buffer = await fs.readFile(screenshotPath(safePath, shot));
        zip.file(`collections/${shot.collectionId}/screenshots/${shot.storedFilename}`, buffer);
      }
    }
    if (input.includeAnnotations)
      for (const shot of included) {
        await assertNoLinks(path.join(safePath, shot.annotationFile));
        const json = await fs.readFile(path.join(safePath, shot.annotationFile), 'utf8').catch(() => '[]');
        zip.file(shot.annotationFile, json);
      }
    for (const shot of included) zip.file(shot.descriptionFile, shot.description);
    for (const item of includedContent ?? []) {
      const content = await host.contentPersistence.load({ projectPath: safePath, itemId: item.id });
      const folder = `collections/${item.collectionId}`;
      if (item.kind === 'text') {
        zip.file(`${folder}/text/${item.markdownFilename}`, content.markdown ?? '');
      } else {
        if (!content.source || !content.image) throw new Error('Drawing export files are missing.');
        zip.file(`${folder}/drawings/${item.sourceFilename}`, content.source);
        zip.file(
          `${folder}/drawings/${item.imageFilename}`,
          Buffer.from(content.image.dataUrl.split(',')[1], 'base64'),
        );
      }
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const zipPath = path.join(exportDir, `${sanitizeFilename(project.name, 'imnota-project')}-package.zip`);
    await atomicWrite(zipPath, zipBuffer);
    return { folderPath: exportDir, zipPath, count: input.annotatedImages.length };
  });
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
  handle('recovery:save', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    await atomicWrite(
      path.join(safePath, '.imnota-recovery.json'),
      JSON.stringify({ savedAt: nowIso(), project: input.project, annotations: input.annotations }, null, 2),
    );
  });
  handle('recovery:clear', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    await fs.unlink(path.join(safePath, '.imnota-recovery.json')).catch(() => undefined);
  });
  // Long network operations run outside the filesystem IPC queue.
  handle('update:download', () => host.updateController.download());
  handle('update:check', () => host.updateController.check());
  handle('update:status', () => host.updateController.getStatus());
  handle('update:install', async () => {
    if (host.updateInstallPending) throw new Error('An update installation is already starting.');
    host.updateInstallPending = true;
    try {
      // Close admission before draining all file work accepted before restart.
      await router.drain();
      await host.updateController.install();
    } catch (error) {
      host.updateInstallPending = false;
      throw error;
    }
  });
}
