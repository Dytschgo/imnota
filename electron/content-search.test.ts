// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../src/shared/types.js';
import { readSearchText, SEARCH_LIMITS, WorkspaceContentSearch } from './content-search.js';

const fixtures: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) await fs.rm(fixture, { recursive: true, force: true });
});

async function workspace() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-content-search-')));
  fixtures.push(root);
  return root;
}

function project(index: number, count = 2): ProjectData {
  return {
    schemaVersion: 4,
    id: `project-${index}`,
    name: `Project ${index}`,
    description: 'Project description',
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    status: 'active',
    favourite: false,
    collections: [
      {
        id: `collection-${index}`,
        name: `Collection ${index}`,
        overallContext: 'Review context',
        archived: false,
        createdAt: '2026-09-13T00:00:00.000Z',
        updatedAt: '2026-09-13T00:00:00.000Z',
      },
    ],
    screenshots: [],
    contentItems: Array.from({ length: count }, (_, item) => ({
      id: `text-${index}-${item}`,
      kind: 'text',
      collectionId: `collection-${index}`,
      position: item,
      includeInExport: true,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
      markdownFilename: `text-${item}.md`,
      preview: 'Preview',
    })),
    exportPreferences: {
      includeOriginalScreenshots: false,
      includeAnnotationMetadata: false,
      template: 'default',
    },
  };
}

async function writeProject(
  root: string,
  value: ProjectData,
  body = 'Full Markdown content beyond the preview',
) {
  const projectPath = path.join(root, value.id);
  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(value));
  for (const item of value.contentItems ?? []) {
    if (item.kind !== 'text') continue;
    const folder = path.join(projectPath, 'collections', item.collectionId, 'text');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, item.markdownFilename), body);
  }
  return projectPath;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('workspace content search', () => {
  it('indexes 100 projects / 1,000 items once, with subsequent queries using memory', async () => {
    const root = await workspace();
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeProject(root, project(index, 10), `Full Markdown body identifier-${index}.`),
      ),
    );
    const readText = vi.fn(readSearchText);
    const service = new WorkspaceContentSearch({ readText });
    const start = performance.now();
    const response = await service.search({ workspacePath: root, query: 'BODY identifier-99.' });
    const cold = performance.now() - start;
    expect(response.results).toHaveLength(10);
    expect(response.warnings).toEqual([]);
    expect(response.results[9]).toMatchObject({
      projectId: 'project-99',
      itemId: 'text-99-9',
      matchSource: 'markdown',
    });
    expect(readText).toHaveBeenCalledTimes(1100);
    const warmStart = performance.now();
    await service.search({ workspacePath: root, query: 'identifier-98.' });
    const warm = performance.now() - warmStart;
    expect(readText).toHaveBeenCalledTimes(1100);
    // Cold disk timings vary with concurrent filesystem tests. Gate bounded I/O and
    // cached-query responsiveness; report cold timing rather than asserting disk speed.
    expect(warm).toBeLessThan(1000);
    console.info(
      `Search fixture: cold ${cold.toFixed(1)}ms, warm ${warm.toFixed(1)}ms; 100 projects, 1000 items, 1100 file reads total.`,
    );
  }, 30_000);

  it('retains metadata and readable siblings when a Markdown file is unreadable', async () => {
    const root = await workspace();
    await writeProject(root, project(0));
    const readText = vi.fn(async (projectPath: string, relative: string, maximum: number) => {
      if (relative.endsWith('text-0.md')) throw new Error('EACCES');
      return readSearchText(projectPath, relative, maximum);
    });
    const service = new WorkspaceContentSearch({ readText });
    const body = await service.search({ workspacePath: root, query: 'beyond' });
    expect(body.results.map((result) => result.itemId)).toEqual(['text-0-1']);
    expect(body.warnings.join(' ')).toMatch(/1 unavailable/);
    expect((await service.search({ workspacePath: root, query: 'Project 0' })).results[0].kind).toBe(
      'project',
    );
    expect((await service.search({ workspacePath: root, query: 'preview' })).results[0].itemId).toBe(
      'text-0-0',
    );
  });

  it('does not let non-project folders consume the project cap and reports every applied limit', async () => {
    const root = await workspace();
    await Promise.all(Array.from({ length: 501 }, (_, index) => fs.mkdir(path.join(root, `aaa-${index}`))));
    await writeProject(root, project(0, 0));
    await writeProject(root, project(1, 0));
    const uncapped = new WorkspaceContentSearch();
    expect((await uncapped.search({ workspacePath: root, query: 'Project' })).results).toHaveLength(2);
    const capped = new WorkspaceContentSearch({ limits: { ...SEARCH_LIMITS, projects: 1 } });
    expect((await capped.search({ workspacePath: root, query: 'Project' })).warnings.join(' ')).toMatch(
      /limited to 1 projects/,
    );
    const memory = new WorkspaceContentSearch({ limits: { ...SEARCH_LIMITS, characters: 1 } });
    const partial = await memory.search({ workspacePath: root, query: 'Project' });
    expect(partial.results).toEqual([]);
    expect(partial.warnings.join(' ')).toMatch(/index limit/);
    const documents = new WorkspaceContentSearch({ limits: { ...SEARCH_LIMITS, documents: 1 } });
    expect((await documents.search({ workspacePath: root, query: 'Project' })).warnings.join(' ')).toMatch(
      /index limit/,
    );
  });

  it('filters favourites before limiting results and reports result truncation', async () => {
    const root = await workspace();
    await writeProject(root, project(0));
    await writeProject(root, { ...project(1), favourite: true, status: 'archived' });
    const service = new WorkspaceContentSearch({ limits: { ...SEARCH_LIMITS, results: 1 } });
    const response = await service.search({
      workspacePath: root,
      query: 'Markdown',
      scope: 'archived',
      favouritesOnly: true,
    });
    expect(response.results[0].projectId).toBe('project-1');
    expect(response.totalMatches).toBe(2);
    expect(response.warnings.join(' ')).toMatch(/first 1 of 2/);
  });

  it('isolates active and archived results before applying the favourites filter', async () => {
    const root = await workspace();
    await writeProject(root, project(0));
    await writeProject(root, { ...project(1), favourite: true });
    await writeProject(root, { ...project(2), status: 'archived' });
    await writeProject(root, { ...project(3), status: 'archived', favourite: true });
    const service = new WorkspaceContentSearch();
    const ids = async (scope: 'active' | 'archived', favouritesOnly = false) =>
      new Set(
        (await service.search({ workspacePath: root, query: 'Markdown', scope, favouritesOnly })).results.map(
          (result) => result.projectId,
        ),
      );

    expect(await ids('active')).toEqual(new Set(['project-0', 'project-1']));
    expect(await ids('archived')).toEqual(new Set(['project-2', 'project-3']));
    expect(await ids('active', true)).toEqual(new Set(['project-1']));
    expect(await ids('archived', true)).toEqual(new Set(['project-3']));
  });

  it('skips reserved restore/template folders before reading metadata or consuming limits, but includes other hidden projects', async () => {
    const root = await workspace();
    const value = project(0, 0);
    const originalPath = await writeProject(root, value);
    const reserved = [
      `.imnota-restore-rollback-${'a'.repeat(32)}`,
      `.imnota-restore-stage-${'b'.repeat(32)}`,
      `.IMNOTA-RESTORE-STAGE-${'C'.repeat(32)}`,
      '.imnota-template-synthetic-stage',
    ];
    const visible = [
      '.private-notes',
      '.imnota-personal',
      '.imnota-restore-stage-not-a-token',
      '.imnota-template',
    ];
    // Internal directories carry the same original project identity, like rollback copies.
    for (const name of [...reserved, ...visible]) {
      const folder = path.join(root, name);
      await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, 'project.json'), JSON.stringify(value));
    }
    const readText = vi.fn(readSearchText);
    const service = new WorkspaceContentSearch({
      readText,
      limits: { ...SEARCH_LIMITS, projects: visible.length + 1 },
    });
    const response = await service.search({ workspacePath: root, query: 'Project' });
    expect(response.results.map((result) => result.projectPath).sort()).toEqual(
      [originalPath, ...visible.map((name) => path.join(root, name))].sort(),
    );
    expect(response.warnings).toEqual([]);
    expect(readText).toHaveBeenCalledTimes(visible.length + 1);
    expect(readText.mock.calls.every(([folder]) => !reserved.includes(path.basename(folder)))).toBe(true);
  });

  it('refreshes content and metadata on invalidation, and keeps only the selected workspace', async () => {
    const root = await workspace();
    const value = project(0, 1);
    const projectPath = await writeProject(root, value, 'old text');
    const service = new WorkspaceContentSearch();
    await service.search({ workspacePath: root, query: 'old' });
    await writeProject(root, { ...value, name: 'Renamed' }, 'new body');
    service.invalidatePath(path.join(projectPath, 'project.json'));
    expect((await service.search({ workspacePath: root, query: 'old' })).results).toEqual([]);
    expect((await service.search({ workspacePath: root, query: 'new' })).results[0].projectName).toBe(
      'Renamed',
    );
    await writeProject(root, value, 'watcher edit');
    service.invalidatePath(path.join(projectPath, 'collections', 'collection-0', 'text', 'text-0.md'));
    expect((await service.search({ workspacePath: root, query: 'watcher' })).results).toHaveLength(1);
    const other = await workspace();
    expect((await service.search({ workspacePath: other, query: 'watcher' })).results).toEqual([]);
  });

  it('shares one in-flight scan across queries and rejects obsolete responses', async () => {
    const root = await workspace();
    await writeProject(root, project(0, 1));
    const started = deferred();
    const release = deferred();
    const readText = vi.fn(async (...args: Parameters<typeof readSearchText>) => {
      if (args[1] === 'project.json') {
        started.resolve();
        await release.promise;
      }
      return readSearchText(...args);
    });
    const service = new WorkspaceContentSearch({ readText });
    const first = service
      .search({ workspacePath: root, query: 'old' })
      .catch((error: Error) => error.message);
    await started.promise;
    const second = service.search({ workspacePath: root, query: 'Markdown' });
    release.resolve();
    expect(await first).toMatch(/Search changed/);
    expect((await second).results).toHaveLength(1);
    expect(readText).toHaveBeenCalledTimes(2);
  });

  it('cancels invalidated scans before starting the next bounded read', async () => {
    const root = await workspace();
    await writeProject(root, project(0, 1));
    const started = deferred();
    const release = deferred();
    let active = 0;
    let peak = 0;
    let pause = true;
    const readText = async (...args: Parameters<typeof readSearchText>) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        if (pause) {
          pause = false;
          started.resolve();
          await release.promise;
        }
        return await readSearchText(...args);
      } finally {
        active -= 1;
      }
    };
    const service = new WorkspaceContentSearch({ readText });
    const first = service
      .search({ workspacePath: root, query: 'old' })
      .catch((error: Error) => error.message);
    await started.promise;
    const latest = service.search({ workspacePath: root, query: 'Markdown', refresh: true });
    release.resolve();
    expect(await first).toMatch(/changed/);
    expect((await latest).results).toHaveLength(1);
    expect(peak).toBe(1);
  });

  it('rejects escaping and oversized reads and reports skipped files without losing metadata', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, project(0, 1), 'x'.repeat(200));
    await expect(readSearchText(projectPath, '../outside.md', 500)).rejects.toThrow(/leaves/);
    await expect(readSearchText(projectPath, 'project.json', 10)).rejects.toThrow(/limit/);
    const service = new WorkspaceContentSearch({ limits: { ...SEARCH_LIMITS, textBytes: 100 } });
    const response = await service.search({ workspacePath: root, query: 'Project 0' });
    expect(response.results[0].kind).toBe('project');
    expect(response.warnings.join(' ')).toMatch(/oversized/);
  });

  it.each([1, 2])(
    'searches legacy v%s metadata without migrating or writing any file',
    async (schemaVersion) => {
      const root = await workspace();
      const folder = path.join(root, 'legacy');
      await fs.mkdir(folder);
      const source = JSON.stringify({
        schemaVersion,
        id: 'legacy',
        name: 'Legacy searchable',
        description: 'Legacy description',
        createdAt: '2020-01-01',
        updatedAt: '2020-01-02',
        status: 'active',
        favourite: false,
        tags: [],
        screenshots: [],
      });
      await fs.writeFile(path.join(folder, 'project.json'), source);
      await fs.writeFile(path.join(folder, 'untouched.md'), 'Keep this byte-for-byte.');
      const before = await fs.stat(path.join(folder, 'project.json'));
      const write = vi.spyOn(fs, 'writeFile');
      const rename = vi.spyOn(fs, 'rename');
      const mkdir = vi.spyOn(fs, 'mkdir');
      const response = await new WorkspaceContentSearch().search({
        workspacePath: root,
        query: 'legacy searchable',
      });
      expect(response.results[0]).toMatchObject({ projectId: 'legacy', kind: 'project' });
      expect(response.warnings.join(' ')).toMatch(/Open them/);
      expect(write).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      expect(await fs.readdir(folder)).toEqual(['project.json', 'untouched.md']);
      expect(await fs.readFile(path.join(folder, 'project.json'), 'utf8')).toBe(source);
      expect(await fs.readFile(path.join(folder, 'untouched.md'), 'utf8')).toBe('Keep this byte-for-byte.');
      expect((await fs.stat(path.join(folder, 'project.json'))).mtimeMs).toBe(before.mtimeMs);
    },
  );
});
