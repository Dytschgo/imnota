import fs from 'node:fs/promises';
import path from 'node:path';
import { projectListItem } from '../src/shared/project-list.js';
import { parseProjectFile } from '../src/shared/schema.js';
import type { ProjectListItem } from '../src/shared/types.js';
import { isReservedProjectDirectory, readSearchText, SEARCH_LIMITS } from './content-search.js';
import { assertNoLinks } from './files.js';
import { projectRevisionForSource } from './project-watch.js';

/** Stream directories and read bounded metadata one file at a time. Never migrate or hydrate content. */
export async function listWorkspaceProjects(workspacePath: string): Promise<ProjectListItem[]> {
  await assertNoLinks(workspacePath);
  const directory = await fs.opendir(workspacePath).catch(() => null);
  if (!directory) return [];
  const projects: ProjectListItem[] = [];
  for await (const entry of directory) {
    if (!entry.isDirectory() || isReservedProjectDirectory(entry.name)) continue;
    const projectPath = path.join(workspacePath, entry.name);
    try {
      const source = await readSearchText(projectPath, 'project.json', SEARCH_LIMITS.projectBytes);
      const project = parseProjectFile(JSON.parse(source));
      projects.push({
        ...projectListItem(projectPath, project),
        projectRevision: projectRevisionForSource(source),
      });
    } catch {
      // A missing, unreadable, oversized or invalid project must not hide valid siblings.
      // Explicit Open retains the existing validation/recovery path for that folder.
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
