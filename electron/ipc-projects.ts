import type { ContentSearchRequest } from '../src/shared/content-search.js';
import type { ProjectIconKey } from '../src/shared/project-icons.js';
import { validateProject } from '../src/shared/schema.js';
import type { ProjectData } from '../src/shared/types.js';
import { emptyProject, nowIso } from '../src/shared/utils.js';
import { addEmptyCollection, ensureCollection } from './collections.js';
import { preserveMixedProjectMetadata } from './content-project-metadata.js';
import { projectInput } from './ipc-contracts.js';
import { listWorkspaceProjects } from './project-list.js';
import { createTemplateProject } from './template-project.js';
import { app, dialog, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerProjectIpc(router: IpcRouter, host: IpcHost): void {
  const { handle, handleConcurrent } = router;
  const {
    assertProjectPath,
    atomicWrite,
    contentSearch,
    diagnostics,
    makeSnapshot,
    mutateProjectMetadata,
    openWithRecovery,
    readProject,
    readProjectMutationBaseline,
    uniqueProjectFolder,
    withinProjectCreationQueue,
    workspaceOrThrow,
  } = host;
  handle('projects:list', async () => {
    contentSearch.invalidate();
    if (!host.settings.workspacePath) return [];
    await host.backupService!.recoverInterruptedRestores();
    return listWorkspaceProjects(host.settings.workspacePath, (target, error) =>
      diagnostics.record({
        category: 'integrity',
        action: 'project-list-unavailable',
        phase: 'observed',
        target,
        error,
      }),
    );
  });
  handle('projects:search-content', async (_event, input: ContentSearchRequest) => {
    const workspacePath = workspaceOrThrow();
    if (path.relative(workspacePath, input.workspacePath) !== '')
      throw new Error('The workspace changed. Retry your search in the selected workspace.');
    const response = await contentSearch.search({ ...input, workspacePath });
    if (path.relative(workspaceOrThrow(), workspacePath) !== '')
      throw new Error('The workspace changed while searching. Retry your search.');
    return response;
  });
  handleConcurrent('projects:search', async (_event, input) => host.projectSearchService!.search(input));
  handle('projects:create', async (_event, raw) =>
    withinProjectCreationQueue(async () => {
      const input = projectInput.parse(raw);
      const workspace = workspaceOrThrow();
      await fs.mkdir(workspace, { recursive: true });
      if (input.templateId) {
        const folder = await createTemplateProject(workspace, { ...input, templateId: input.templateId });
        return makeSnapshot(folder);
      }
      const folder = await uniqueProjectFolder(workspace, input.name);
      await fs.mkdir(path.join(folder, 'exports'), { recursive: true });
      await ensureCollection(folder, '001-collection');
      await atomicWrite(
        path.join(folder, 'project.json'),
        JSON.stringify(
          {
            ...emptyProject(input.name, input.description, path.basename(workspace)),
            ...(input.icon ? { icon: input.icon } : {}),
            schemaVersion: 4,
            contentItems: [],
          },
          null,
          2,
        ),
      );
      return makeSnapshot(folder);
    }),
  );
  handle('projects:open-dialog', async () => {
    const result = await dialog.showOpenDialog(host.mainWindow!, {
      title: 'Open Imnota project',
      defaultPath: host.settings.workspacePath || app.getPath('documents'),
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await host.backupService!.recoverInterruptedRestores();
    const projectPath = await assertProjectPath(result.filePaths[0]);
    return openWithRecovery(projectPath);
  });
  handle('projects:load', async (_event, projectPath: string) => {
    await host.backupService!.recoverInterruptedRestores();
    return openWithRecovery(await assertProjectPath(projectPath));
  });
  handle('projects:save', async (_event, projectPath: string, project: ProjectData) => {
    const safePath = await assertProjectPath(projectPath);
    const current = await readProject(safePath);
    const next = preserveMixedProjectMetadata(current, {
      ...project,
      id: current.id,
      updatedAt: nowIso(),
    });
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(next, null, 2));
  });
  handle('projects:update-metadata', async (_event, input) =>
    mutateProjectMetadata(input.projectPath, input.expectedRevision, (project) => ({
      ...project,
      ...(input.patch as { name?: string; description?: string; icon?: ProjectIconKey }),
    })),
  );
  handle('projects:set-archived', async (_event, input) =>
    mutateProjectMetadata(input.projectPath, input.expectedRevision, (project) => ({
      ...project,
      status: input.archived ? 'archived' : 'active',
    })),
  );
  handle('collections:edit', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    const project = await readProject(safePath);
    const source = project.collections.find((collection) => collection.id === input.collectionId);
    if (input.action !== 'create' && !source) throw new Error('Collection not found.');
    const timestamp = nowIso();
    if (input.action === 'rename') {
      if (!input.name) throw new Error('Enter a collection name.');
      source!.name = input.name;
      source!.updatedAt = timestamp;
    } else if (input.action === 'archive') {
      source!.archived = true;
      source!.updatedAt = timestamp;
    } else if (input.action === 'restore') {
      source!.archived = false;
      source!.updatedAt = timestamp;
    } else {
      const number = project.collections.length + 1;
      const workspaceName = path.basename(workspaceOrThrow());
      const id = `${String(number).padStart(3, '0')}-collection-${crypto.randomUUID().slice(0, 8)}`;
      await ensureCollection(safePath, id);
      Object.assign(project, addEmptyCollection(project, workspaceName, id, timestamp));
    }
    project.updatedAt = timestamp;
    await atomicWrite(path.join(safePath, 'project.json'), JSON.stringify(validateProject(project), null, 2));
    return makeSnapshot(safePath);
  });
  handle('projects:duplicate', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const workspace = workspaceOrThrow();
    const source = await readProject(safePath);
    const target = await uniqueProjectFolder(workspace, `${source.name} copy`);
    await fs.cp(safePath, target, { recursive: true });
    const copy = await readProject(target);
    copy.id = `project_${crypto.randomUUID()}`;
    copy.name = `${source.name} copy`;
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    await atomicWrite(path.join(target, 'project.json'), JSON.stringify(copy, null, 2));
    return makeSnapshot(target);
  });
  handle('projects:archive', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const baseline = await readProjectMutationBaseline(safePath);
    await mutateProjectMetadata(safePath, baseline.projectRevision, (project) => ({
      ...project,
      status: 'archived',
    }));
  });
  handle('projects:delete', async (_event, projectPath: string) => {
    const safePath = await assertProjectPath(projectPath);
    const smokeApproved = process.env.IMNOTA_SMOKE === '1' && host.smokeProjectDeletionPath === safePath;
    host.smokeProjectDeletionPath = null;
    const answer = smokeApproved
      ? { response: 1 }
      : await dialog.showMessageBox(host.mainWindow!, {
          type: 'warning',
          buttons: ['Cancel', 'Move to trash'],
          defaultId: 0,
          cancelId: 0,
          message: 'Delete this project?',
          detail: `All project files in ${safePath} will be moved to the system trash.`,
        });
    if (answer.response !== 1) throw new Error('Project deletion cancelled.');
    if (host.preferenceSettingsResult.settings.backups.enabled)
      await host.backupService!.createSnapshot(safePath, 'destructive-operation');
    host.projectWatchManager?.stopProject(safePath);
    await diagnostics.filesystem('trash', safePath, () => shell.trashItem(safePath));
  });
}
