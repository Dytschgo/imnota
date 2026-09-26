import { annotationSchema, validateProject } from '../src/shared/schema.js';
import type { ScreenshotRecord } from '../src/shared/types.js';
import { nowIso } from '../src/shared/utils.js';
import { screenshotPath } from './collections.js';
import { assertNoLinks } from './files.js';
import { nativeClipboard } from './native-clipboard.js';
import { projectRevisionForSource } from './project-watch.js';
import {
  nextProjectMutationTimestamp,
  prepareConflictTransactionWrites,
} from './screenshot-transaction-adapter.js';
import { screenshotTransactionBaseline } from './screenshot-transactions.js';
import { deleteScreenshotToTrash, undoScreenshotDelete } from './screenshot-trash.js';
import { app, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerScreenshotIpc(router: IpcRouter, host: IpcHost): void {
  const { handle } = router;
  const {
    assertProjectPath,
    assertProjectRevision,
    atomicWrite,
    commitFileTransaction,
    contentRevision,
    copyFile,
    diagnostics,
    importOne,
    loadImage,
    makeSnapshot,
    nextScreenshotPosition,
    readOptionalFile,
    readProject,
    readProjectMutationBaseline,
    readScreenshotFiles,
    screenshotTrashOperations,
    uniqueStoredName,
    withSnapshotWarnings,
  } = host;
  handle('projects:save-screenshot', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const baseline = await readProjectMutationBaseline(safePath);
    const project = baseline.project;
    const trustedShot = project.screenshots.find((s) => s.id === input.screenshot.id);
    if (!trustedShot) throw new Error('Screenshot does not belong to this project.');
    const currentContent = await readScreenshotFiles(safePath, trustedShot);
    if (currentContent.revision !== input.contentRevision) {
      const ext = path.extname(trustedShot.storedFilename);
      const storedFilename = await uniqueStoredName(
        safePath,
        `${path.basename(trustedShot.storedFilename, ext)}-copy-conflict${ext}`,
      );
      const timestamp = nextProjectMutationTimestamp(project.updatedAt);
      const conflict: ScreenshotRecord = {
        ...input.screenshot,
        id: `shot_${crypto.randomUUID()}`,
        collectionId: trustedShot.collectionId,
        originalFilename: `${trustedShot.originalFilename} Copy conflict`,
        storedFilename,
        title: `${input.screenshot.title || trustedShot.title} — Copy conflict`,
        position: nextScreenshotPosition(project, trustedShot.collectionId),
        createdAt: timestamp,
        updatedAt: timestamp,
        annotationFile: `collections/${trustedShot.collectionId}/annotations/${storedFilename}.json`,
        descriptionFile: `collections/${trustedShot.collectionId}/descriptions/${storedFilename}.md`,
        includeInExport: false,
        conflict: true,
      };
      const trustedImagePath = screenshotPath(safePath, trustedShot);
      await assertNoLinks(trustedImagePath);
      const conflictImage = await fs.readFile(trustedImagePath);
      const conflictAnnotations = JSON.stringify(input.annotations, null, 2);
      project.screenshots.push(conflict);
      project.updatedAt = timestamp;
      const savedProject = validateProject(project);
      const projectSource = JSON.stringify(savedProject, null, 2);
      const recoverySource = await readOptionalFile(path.join(safePath, '.imnota-recovery.json'));
      const warnings = await commitFileTransaction(
        safePath,
        'conflict',
        prepareConflictTransactionWrites({
          imagePath: `collections/${conflict.collectionId}/screenshots/${conflict.storedFilename}`,
          imageAfter: conflictImage,
          annotationPath: conflict.annotationFile,
          annotationAfter: Buffer.from(conflictAnnotations),
          descriptionPath: conflict.descriptionFile,
          descriptionAfter: Buffer.from(conflict.description),
          projectAfter: Buffer.from(projectSource),
          projectSource: baseline.projectSource,
          recoverySource,
        }),
        () => assertProjectRevision(safePath, baseline.projectRevision),
      );
      return {
        project: savedProject,
        savedScreenshotId: conflict.id,
        conflictCreated: true,
        contentRevision: contentRevision(conflict.description, conflictAnnotations),
        projectRevision: projectRevisionForSource(projectSource),
        warnings: warnings.length ? warnings : undefined,
      };
    }
    const timestamp = nextProjectMutationTimestamp(project.updatedAt);
    const screenshot: ScreenshotRecord = {
      ...input.screenshot,
      id: trustedShot.id,
      collectionId: trustedShot.collectionId,
      storedFilename: trustedShot.storedFilename,
      annotationFile: trustedShot.annotationFile,
      descriptionFile: trustedShot.descriptionFile,
      createdAt: trustedShot.createdAt,
      updatedAt: timestamp,
    };
    project.screenshots = project.screenshots.map((shot) => (shot.id === screenshot.id ? screenshot : shot));
    project.updatedAt = timestamp;
    const annotationsJson = JSON.stringify(input.annotations, null, 2);
    const savedProject = validateProject(project);
    const projectSource = JSON.stringify(savedProject, null, 2);
    const recoverySource = await readOptionalFile(path.join(safePath, '.imnota-recovery.json'));
    const warnings = await commitFileTransaction(
      safePath,
      'save',
      [
        {
          relativePath: screenshot.annotationFile,
          after: Buffer.from(annotationsJson),
          expectedBefore: screenshotTransactionBaseline(currentContent.annotationSource),
        },
        {
          relativePath: screenshot.descriptionFile,
          after: Buffer.from(screenshot.description),
          expectedBefore: screenshotTransactionBaseline(currentContent.descriptionSource),
        },
        {
          relativePath: '.imnota-recovery.json',
          after: null,
          expectedBefore: screenshotTransactionBaseline(recoverySource),
        },
        {
          relativePath: 'project.json',
          after: Buffer.from(projectSource),
          expectedBefore: screenshotTransactionBaseline(baseline.projectSource),
        },
      ],
      async () => {
        await assertProjectRevision(safePath, baseline.projectRevision);
        if ((await readScreenshotFiles(safePath, trustedShot)).revision !== input.contentRevision)
          throw new Error('Screenshot content changed while the save was prepared. Reload it and try again.');
      },
    );
    return {
      project: savedProject,
      savedScreenshotId: screenshot.id,
      conflictCreated: false,
      contentRevision: contentRevision(screenshot.description, annotationsJson),
      projectRevision: projectRevisionForSource(projectSource),
      warnings: warnings.length ? warnings : undefined,
    };
  });
  handle('screenshots:load-content', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const screenshot = project.screenshots.find((shot) => shot.id === input.screenshot.id);
    if (!screenshot) throw new Error('Screenshot does not belong to this project.');
    input.screenshot = screenshot;
    const annotationPath = path.join(safePath, input.screenshot.annotationFile);
    await assertNoLinks(annotationPath);
    const content = await readScreenshotFiles(safePath, input.screenshot);
    const [image] = await Promise.all([loadImage(safePath, input.screenshot)]);
    return {
      image,
      annotations: z.array(annotationSchema).parse(JSON.parse(content.annotationsJson)),
      description: content.description,
      contentRevision: content.revision,
    };
  });
  handle('screenshots:import-files', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    if (!Array.isArray(input.paths) || input.paths.length > 50)
      throw new Error('Choose up to 50 screenshots at a time.');
    for (const source of input.paths)
      await importOne(safePath, source, path.basename(source), input.collectionId);
    return makeSnapshot(safePath);
  });
  handle('screenshots:paste', async (_event, projectPath: string, collectionId?: string) => {
    const safePath = await assertProjectPath(projectPath);
    const image = await nativeClipboard.readImage();
    if (image.isEmpty())
      throw new Error('The clipboard does not contain an image. Copy a screenshot and try again.');
    const filename = `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    const temp = path.join(app.getPath('temp'), filename);
    await fs.writeFile(temp, image.toPNG());
    await importOne(safePath, temp, filename, collectionId);
    await fs.unlink(temp).catch(() => undefined);
    return makeSnapshot(safePath);
  });
  handle('screenshots:duplicate', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const source = project.screenshots.find((s) => s.id === input.screenshot.id);
    if (!source) throw new Error('Screenshot not found.');
    const collection = project.collections.find((item) => item.id === source.collectionId);
    if (!collection) throw new Error('Screenshot collection not found.');
    const ext = path.extname(source.storedFilename);
    const name = await uniqueStoredName(safePath, `${path.basename(source.storedFilename, ext)}-copy${ext}`);
    await assertNoLinks(screenshotPath(safePath, source));
    for (const [original, destination, fallback] of [
      [source.annotationFile, `collections/${source.collectionId}/annotations/${name}.json`, '[]'],
      [source.descriptionFile, `collections/${source.collectionId}/descriptions/${name}.md`, ''],
    ]) {
      await assertNoLinks(path.join(safePath, original));
      const contents = await fs
        .readFile(path.join(safePath, original), 'utf8')
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return fallback;
          throw error;
        });
      await atomicWrite(path.join(safePath, destination), contents);
    }
    await copyFile(
      screenshotPath(safePath, source),
      path.join(safePath, 'collections', source.collectionId, 'screenshots', name),
    );
    const timestamp = nowIso();
    project.screenshots.push({
      ...source,
      id: `shot_${crypto.randomUUID()}`,
      originalFilename: `${source.originalFilename} copy`,
      storedFilename: name,
      title: `${source.title} copy`,
      position: nextScreenshotPosition(project, source.collectionId),
      createdAt: timestamp,
      updatedAt: timestamp,
      annotationFile: `collections/${source.collectionId}/annotations/${name}.json`,
      descriptionFile: `collections/${source.collectionId}/descriptions/${name}.md`,
    });
    project.updatedAt = timestamp;
    collection.archived = false;
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(project, null, 2));
    return makeSnapshot(safePath);
  });
  handle('screenshots:delete', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const result = await deleteScreenshotToTrash(
      safePath,
      project,
      input.screenshotId,
      async (target) => {
        await diagnostics.filesystem('trash', target, () => shell.trashItem(target));
        host.projectWatchManager?.recordSelfDelete(target);
      },
      screenshotTrashOperations,
    );
    const projectFile = path.join(safePath, 'project.json');
    host.projectWatchManager?.recordSelfWrite(projectFile, await fs.readFile(projectFile));
    const snapshot = withSnapshotWarnings(
      await makeSnapshot(safePath),
      result.warning ? [result.warning] : [],
    );
    return { snapshot, undoToken: result.undoToken };
  });
  handle('screenshots:undo-delete', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const before = await readProject(safePath);
    const undo = await undoScreenshotDelete(safePath, before, input.undoToken, screenshotTrashOperations);
    const restored = undo.project.screenshots.find(
      (candidate) => !before.screenshots.some((existing) => existing.id === candidate.id),
    );
    if (restored)
      for (const target of [
        screenshotPath(safePath, restored),
        path.join(safePath, restored.annotationFile),
        path.join(safePath, restored.descriptionFile),
      ])
        host.projectWatchManager?.recordSelfWrite(target, await fs.readFile(target));
    const projectFile = path.join(safePath, 'project.json');
    host.projectWatchManager?.recordSelfWrite(projectFile, await fs.readFile(projectFile));
    return withSnapshotWarnings(await makeSnapshot(safePath), undo.warning ? [undo.warning] : []);
  });
}
