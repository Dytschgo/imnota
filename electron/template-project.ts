import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectData } from '../src/shared/types.js';
import type { ProjectIconKey } from '../src/shared/project-icons.js';
import { getWorkflowTemplate } from '../src/shared/workflow-templates.js';
import { validateProject } from '../src/shared/schema.js';
import { emptyProject, slugify } from '../src/shared/utils.js';
import { assertNoLinks, atomicWrite } from './files.js';
import { ensureCollection } from './collections.js';

const COLLECTION_ID = '001-collection';

export interface TemplateProjectInput {
  name: string;
  description: string;
  templateId: string;
  icon?: ProjectIconKey;
}

export interface TemplateProjectDependencies {
  now?: () => string;
  randomId?: () => string;
  write?: (target: string, value: string) => Promise<void>;
}

let projectCreationQueue: Promise<void> = Promise.resolve();

async function withinProjectCreationQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = projectCreationQueue;
  let release!: () => void;
  projectCreationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function pathExistsOrIsLinked(target: string): Promise<boolean> {
  try {
    const entry = await fs.lstat(target);
    if (entry.isSymbolicLink()) throw new Error('Linked project paths are not supported.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function availableProjectFolder(workspace: string, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = path.join(workspace, base);
  let suffix = 2;
  while (await pathExistsOrIsLinked(candidate)) candidate = path.join(workspace, `${base}-${suffix++}`);
  return candidate;
}

function preview(markdown: string): string | undefined {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 500);
}

/** Reserve the directory atomically; project.json is published only after its content. */
async function publishTemplate(temporary: string, folder: string): Promise<void> {
  try {
    await fs.mkdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('A project folder was created while this template was being prepared. Try again.');
    throw error;
  }
  const directories = [folder];
  const copyDirectory = async (source: string, target: string): Promise<void> => {
    const entries = await fs.readdir(source, { withFileTypes: true });
    // Metadata is the publication point used by the project library.
    entries.sort((a, b) => Number(a.name === 'project.json') - Number(b.name === 'project.json'));
    for (const entry of entries) {
      const from = path.join(source, entry.name);
      const to = path.join(target, entry.name);
      await assertNoLinks(from);
      await assertNoLinks(to);
      if (entry.isDirectory()) {
        await fs.mkdir(to);
        directories.push(to);
        await copyDirectory(from, to);
      } else if (entry.isFile()) {
        await fs.copyFile(from, to, constants.COPYFILE_EXCL);
      } else throw new Error('A template staging file is not a regular file.');
    }
  };
  try {
    await copyDirectory(temporary, folder);
  } catch (error) {
    // Another process may edit files once they reach the destination. Preserve them:
    // even a compare-then-unlink could delete an edit made after the comparison.
    for (const directory of directories.reverse()) {
      try {
        await assertNoLinks(directory);
        await fs.rmdir(directory);
      } catch {
        /* Never remove a populated folder. */
      }
    }
    if (await pathExistsOrIsLinked(folder))
      throw new Error(`Template creation did not finish. Files were preserved at ${folder}.`, {
        cause: error,
      });
    throw error;
  }
}

/**
 * Materializes a template in a sibling temporary directory, reserves its destination,
 * then publishes metadata last. Neither empty nor populated destinations are replaced.
 */
export async function createTemplateProject(
  workspace: string,
  input: TemplateProjectInput,
  dependencies: TemplateProjectDependencies = {},
): Promise<string> {
  return withinProjectCreationQueue(async () => {
    const template = getWorkflowTemplate(input.templateId);
    if (!template)
      throw new Error('This workflow template is unavailable. Choose another template or start blank.');
    const now = dependencies.now ?? (() => new Date().toISOString());
    const randomId = dependencies.randomId ?? randomUUID;
    const write = dependencies.write ?? atomicWrite;
    await assertNoLinks(workspace);
    await fs.mkdir(workspace, { recursive: true });
    const folder = await availableProjectFolder(workspace, input.name);
    const identifier = randomId();
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(identifier))
      throw new Error('Could not create a safe temporary project identifier.');
    const temporary = path.join(workspace, `.imnota-template-${identifier}.tmp`);
    await assertNoLinks(temporary);
    await fs.mkdir(temporary);
    try {
      await fs.mkdir(path.join(temporary, 'exports'));
      await ensureCollection(temporary, COLLECTION_ID);
      const timestamp = now();
      const project = emptyProject(input.name, input.description, path.basename(workspace));
      const collection = project.collections[0]!;
      collection.name = template.collectionName;
      collection.createdAt = timestamp;
      collection.updatedAt = timestamp;
      const contentItems = template.textBlocks.map((block, index) => {
        const id = `template-text-${index + 1}`;
        return {
          id,
          collectionId: COLLECTION_ID,
          kind: 'text' as const,
          position: block.position,
          includeInExport: true,
          createdAt: timestamp,
          updatedAt: timestamp,
          markdownFilename: `${id}.md`,
          preview: preview(block.markdown),
        };
      });
      const next: ProjectData = validateProject({
        ...project,
        ...(input.icon ? { icon: input.icon } : {}),
        schemaVersion: 4,
        createdAt: timestamp,
        updatedAt: timestamp,
        collections: [collection],
        contentItems,
      });
      for (const [index, block] of template.textBlocks.entries())
        await write(
          path.join(temporary, 'collections', COLLECTION_ID, 'text', `template-text-${index + 1}.md`),
          block.markdown,
        );
      await write(path.join(temporary, 'project.json'), JSON.stringify(next, null, 2));
      await publishTemplate(temporary, folder);
      // Publication succeeded. A cleanup failure must not invite a duplicate retry.
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      return folder;
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });
}
