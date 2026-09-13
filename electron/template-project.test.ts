import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateProject } from '../src/shared/schema.js';
import { WORKFLOW_TEMPLATES } from '../src/shared/workflow-templates.js';
import { createTemplateProject } from './template-project.js';

const temporaryRoots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-template-')));
  temporaryRoots.push(root);
  return root;
}

describe('template project creation', () => {
  it.each(WORKFLOW_TEMPLATES)(
    'creates and reopens $name with normal ordered text blocks',
    async (template) => {
      const root = await workspace();
      const projectPath = await createTemplateProject(root, {
        name: `${template.name} project`,
        description: 'A local project',
        templateId: template.id,
        icon: 'code-2',
      });
      const project = validateProject(
        JSON.parse(await fs.readFile(path.join(projectPath, 'project.json'), 'utf8')),
      );
      expect(project.schemaVersion).toBe(4);
      expect(project.icon).toBe('code-2');
      expect(project.collections[0]?.name).toBe(template.collectionName);
      expect(project.contentItems?.map((item) => item.position)).toEqual(
        template.textBlocks.map((block) => block.position),
      );
      await expect(
        fs.readFile(
          path.join(projectPath, 'collections', '001-collection', 'text', 'template-text-1.md'),
          'utf8',
        ),
      ).resolves.toBe(template.textBlocks[0]?.markdown);
    },
  );

  it('rejects an unknown template without creating a project', async () => {
    const root = await workspace();
    await expect(
      createTemplateProject(root, { name: 'Unknown', description: '', templateId: 'not-a-template' }),
    ).rejects.toThrow('unavailable');
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('cleans a failed staging directory so retry creates only one project', async () => {
    const root = await workspace();
    await expect(
      createTemplateProject(
        root,
        { name: 'Retry', description: '', templateId: 'bug-report' },
        {
          randomId: () => 'fixed',
          write: async () => {
            throw new Error('disk unavailable');
          },
        },
      ),
    ).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
    await createTemplateProject(
      root,
      { name: 'Retry', description: '', templateId: 'bug-report' },
      { randomId: () => 'fixed' },
    );
    expect((await fs.readdir(root)).filter((entry) => !entry.startsWith('.'))).toEqual(['retry']);
  });

  it('waits for every started writer before cleanup and never leaves a late staging file', async () => {
    const root = await workspace();
    let calls = 0;
    await expect(
      createTemplateProject(
        root,
        { name: 'Delayed failure', description: '', templateId: 'bug-report' },
        {
          randomId: () => 'delayed',
          write: async (target, value) => {
            calls += 1;
            if (calls === 2) throw new Error('disk unavailable');
            await new Promise((resolve) => setTimeout(resolve, 25));
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, value);
          },
        },
      ),
    ).rejects.toThrow('disk unavailable');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(2);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('refuses to replace a destination that appears before publish', async () => {
    const root = await workspace();
    await expect(
      createTemplateProject(
        root,
        { name: 'Race', description: '', templateId: 'bug-report' },
        {
          write: async (target, value) => {
            if (path.basename(target) === 'project.json') await fs.mkdir(path.join(root, 'race'));
            await fs.writeFile(target, value);
          },
        },
      ),
    ).rejects.toThrow('created while');
    await expect(fs.readdir(path.join(root, 'race'))).resolves.toEqual([]);
    expect((await fs.readdir(root)).sort()).toEqual(['race']);
  });

  it('atomically refuses an empty destination created at the reservation boundary', async () => {
    const root = await workspace();
    const destination = path.join(root, 'race');
    const mkdir = fs.mkdir.bind(fs);
    const reserve = vi.spyOn(fs, 'mkdir').mockImplementation(async (target, options) => {
      if (String(target) === destination) {
        // Simulates the other process winning immediately before our mkdir syscall.
        await mkdir(destination);
      }
      return mkdir(target, options as never);
    });
    await expect(
      createTemplateProject(root, { name: 'Race', description: '', templateId: 'bug-report' }),
    ).rejects.toThrow('created while');
    reserve.mockRestore();
    expect(await fs.readdir(destination)).toEqual([]);
    expect(await fs.readdir(root)).toEqual(['race']);
  });

  it('preserves an external file created inside the reserved folder during publication', async () => {
    const root = await workspace();
    const destination = path.join(root, 'race');
    const external = path.join(destination, 'collections', '001-collection', 'text', 'template-text-1.md');
    const copyFile = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'copyFile').mockImplementation(async (source, target, mode) => {
      if (String(target) === external) await fs.writeFile(external, 'External content');
      return copyFile(source, target, mode);
    });
    await expect(
      createTemplateProject(root, { name: 'Race', description: '', templateId: 'bug-report' }),
    ).rejects.toThrow();
    expect(await fs.readFile(external, 'utf8')).toBe('External content');
    await expect(fs.stat(path.join(destination, 'project.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never unlinks materialized content after a later publication failure', async () => {
    const root = await workspace();
    const destination = path.join(root, 'race');
    const markdown = path.join(destination, 'collections', '001-collection', 'text', 'template-text-1.md');
    const metadata = path.join(destination, 'project.json');
    const copyFile = fs.copyFile.bind(fs);
    const unlink = vi.spyOn(fs, 'unlink');
    vi.spyOn(fs, 'copyFile').mockImplementation(async (source, target, mode) => {
      if (String(target) === metadata) {
        await fs.writeFile(markdown, 'An external edit after the copy');
        await fs.writeFile(metadata, 'An external file at the commit boundary');
      }
      return copyFile(source, target, mode);
    });
    await expect(
      createTemplateProject(root, { name: 'Race', description: '', templateId: 'bug-report' }),
    ).rejects.toThrow('Files were preserved');
    expect(await fs.readFile(markdown, 'utf8')).toBe('An external edit after the copy');
    expect(await fs.readFile(metadata, 'utf8')).toBe('An external file at the commit boundary');
    expect(unlink.mock.calls.some(([target]) => String(target).startsWith(destination))).toBe(false);
  });
});
