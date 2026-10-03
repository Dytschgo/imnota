import fs from 'node:fs/promises';
import path from 'node:path';
import { projectListItem } from '../src/shared/project-list.js';
import { parseProjectFile } from '../src/shared/schema.js';
import type { ProjectListItem } from '../src/shared/types.js';
import { isReservedProjectDirectory, readSearchText, SEARCH_LIMITS } from './content-search.js';
import { assertNoLinks } from './files.js';
import { projectRevisionForSource } from './project-watch.js';

interface ProjectListLimits {
  maxEntries?: number;
  maxResponseBytes?: number;
}

class ProjectListLimitError extends Error {}

/** Stream directories and read bounded metadata one file at a time. Never migrate or hydrate content. */
export async function listWorkspaceProjects(
  workspacePath: string,
  report: (target: string, error: unknown) => Promise<unknown> = async () => undefined,
  limits: ProjectListLimits = {},
): Promise<ProjectListItem[]> {
  await assertNoLinks(workspacePath);
  const directory = await fs.opendir(workspacePath).catch(async (error: NodeJS.ErrnoException) => {
    await report(workspacePath, error);
    if (error.code === 'ENOENT') return null;
    throw new Error(
      'The workspace could not be read. Check that its drive is connected and you have access. Existing project files have not been changed.',
      { cause: error },
    );
  });
  if (!directory) return [];
  const projects: ProjectListItem[] = [];
  let entries = 0;
  let responseBytes = 0;
  for await (const entry of directory) {
    if (++entries > (limits.maxEntries ?? Infinity))
      throw new ProjectListLimitError(
        'The workspace has too many entries to read safely. Specify a project path.',
      );
    if (!entry.isDirectory() || isReservedProjectDirectory(entry.name)) continue;
    const projectPath = path.join(workspacePath, entry.name);
    try {
      const source = await readSearchText(projectPath, 'project.json', SEARCH_LIMITS.projectBytes);
      const project = parseProjectFile(JSON.parse(source));
      const listed = {
        ...projectListItem(projectPath, project),
        projectRevision: projectRevisionForSource(source),
      };
      if (limits.maxResponseBytes !== undefined) {
        responseBytes += Buffer.byteLength(JSON.stringify(listed), 'utf8');
        if (responseBytes > limits.maxResponseBytes)
          throw new ProjectListLimitError('The project list exceeds the read limit. Specify a project path.');
      }
      projects.push(listed);
    } catch (error) {
      if (error instanceof ProjectListLimitError) throw error;
      await report(projectPath, error);
      // A missing, unreadable, oversized or invalid project must not hide valid siblings.
      // Explicit Open retains the existing validation/recovery path for that folder.
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
