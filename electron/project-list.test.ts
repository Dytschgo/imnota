// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { parseProjectFile, type LegacyProjectData } from '../src/shared/schema.js';
import type { ProjectData, ProjectListItem } from '../src/shared/types.js';
import { emptyProject } from '../src/shared/utils.js';
import { migrateProject } from './collections.js';
import { SEARCH_LIMITS, WorkspaceContentSearch, isReservedProjectPath } from './content-search.js';
import { listWorkspaceProjects } from './project-list.js';

const fixtures: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) await fs.rm(fixture, { recursive: true, force: true });
});

async function workspace() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-project-list-')));
  fixtures.push(root);
  return root;
}

async function writeProject(root: string, folder: string, project: unknown) {
  const projectPath = path.join(root, folder);
  await fs.mkdir(projectPath);
  await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project));
  return projectPath;
}

async function tree(root: string): Promise<unknown[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      const { mtimeMs } = await fs.stat(target);
      return entry.isDirectory()
        ? { name: entry.name, mtimeMs, children: await tree(target) }
        : { name: entry.name, mtimeMs, bytes: await fs.readFile(target) };
    }),
  );
}

describe('read-only project listing', () => {
  it('rejects backup and recovery ancestry even when the selected workspace is inside it', () => {
    expect(isReservedProjectPath(path.join('workspace', '.imnota-backups', 'snapshots', 'id', 'data'))).toBe(
      true,
    );
    expect(isReservedProjectPath(path.join('workspace', '.IMNOTA-BACKUPS', 'nested-project'))).toBe(true);
    expect(
      isReservedProjectPath(path.join('workspace', `.imnota-restore-rollback-${'a'.repeat(32)}`, 'data')),
    ).toBe(true);
    expect(isReservedProjectPath(path.join('workspace', '.private-project'))).toBe(false);
  });

  it.each([3, 4] as const)(
    'returns v%s display summaries and metadata search text without content reads',
    async (schemaVersion) => {
      const root = await workspace();
      const project: ProjectData = {
        ...emptyProject('Current', 'Project description'),
        schemaVersion,
        id: 'current',
        status: 'archived',
        favourite: true,
        icon: 'code-2',
        updatedAt: '2026-09-13',
      };
      const collection = project.collections[0];
      collection.archived = true;
      collection.overallContext = 'Context is not display data';
      project.screenshots.push({
        id: 'shot',
        collectionId: collection.id,
        originalFilename: 'example.png',
        storedFilename: 'example.png',
        title: 'Screenshot title',
        description: 'Metadata description',
        position: 0,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        priority: 'high',
        annotationFile: `collections/${collection.id}/annotations/example.png.json`,
        descriptionFile: `collections/${collection.id}/descriptions/example.png.md`,
        originalWidth: 1,
        originalHeight: 1,
        includeInExport: true,
      });
      if (schemaVersion === 4) {
        const common = {
          collectionId: collection.id,
          includeInExport: true,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
        project.contentItems = [
          {
            ...common,
            id: 'drawing',
            kind: 'drawing',
            position: 1,
            title: 'Drawing title',
            sourceFilename: 'drawing.json',
            imageFilename: 'drawing.png',
            originalWidth: 1,
            originalHeight: 1,
          },
          {
            ...common,
            id: 'text',
            kind: 'text',
            position: 2,
            markdownFilename: 'text.md',
            preview: 'Text preview',
          },
        ];
      }
      const projectPath = await writeProject(root, 'current', project);
      // The on-disk description intentionally differs: listing uses metadata only.
      const descriptionPath = path.join(projectPath, project.screenshots[0].descriptionFile);
      await fs.mkdir(path.dirname(descriptionPath), { recursive: true });
      await fs.writeFile(descriptionPath, 'Do not hydrate this description during listing');
      await writeProject(root, 'older', { ...emptyProject('Older', ''), updatedAt: '2020-01-01' });
      const open = vi.spyOn(fs, 'open');
      const readFile = vi.spyOn(fs, 'readFile');
      const listed = await listWorkspaceProjects(root);
      expect(listed.map((item) => item.name)).toEqual(['Current', 'Older']);
      expect(listed[0]).toEqual({
        projectPath,
        id: project.id,
        name: project.name,
        description: project.description,
        status: 'archived',
        favourite: true,
        icon: 'code-2',
        projectRevision: createHash('sha256').update(JSON.stringify(project)).digest('hex'),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        collections: [
          {
            id: collection.id,
            name: collection.name,
            archived: true,
            createdAt: collection.createdAt,
            updatedAt: collection.updatedAt,
          },
        ],
        screenshots: [{ id: 'shot' }],
        searchText:
          'current project description archived screenshot title metadata description high' +
          (schemaVersion === 4 ? ' drawing title text preview' : ''),
      });
      expectTypeOf<ProjectListItem>().not.toMatchTypeOf<ProjectData>();
      expect(open).toHaveBeenCalledTimes(2);
      expect(
        open.mock.calls.every(
          ([target, mode]) => path.basename(String(target)) === 'project.json' && mode === 'r',
        ),
      ).toBe(true);
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2] as const)(
    'lists then searches a real legacy v%s tree without writes; explicit open migration still works',
    async (schemaVersion) => {
      const root = await workspace();
      const roundId = '001-first-feedback';
      const storedFilename = '001-example.png';
      const prefix = schemaVersion === 1 ? '' : `rounds/${roundId}/`;
      const annotationFile = `${prefix}annotations/${schemaVersion === 1 ? 'example.json' : `${storedFilename}.json`}`;
      const notesFile = `${prefix}notes/${schemaVersion === 1 ? 'example.md' : `${storedFilename}.md`}`;
      const project: LegacyProjectData = {
        schemaVersion,
        id: 'legacy',
        name: 'Legacy searchable',
        description: 'Legacy description',
        createdAt: '2020-01-01',
        updatedAt: '2020-01-02',
        status: 'active',
        favourite: true,
        tags: [],
        rounds: [
          { id: roundId, name: 'First feedback', archived: false, createdAt: '' },
          { id: '002-archived', name: 'Archived feedback', archived: true, createdAt: '2020-01-02' },
        ],
        screenshots: [
          {
            roundId,
            id: 'shot',
            originalFilename: 'example.png',
            storedFilename,
            title: 'Legacy screenshot',
            description: 'Original description',
            position: 0,
            createdAt: '2020-01-01',
            updatedAt: '2020-01-02',
            tags: [],
            priority: 'critical',
            status: 'ready',
            annotationFile,
            notesFile,
            originalWidth: 1,
            originalHeight: 1,
            includeInExport: true,
          },
        ],
      };
      const projectPath = await writeProject(root, 'legacy', project);
      const notes = '\r\n## Legacy notes\r\n\r\nKeep exact bytes.\r\n';
      for (const [relative, body] of [
        [`${prefix}screenshots/${storedFilename}`, Buffer.from([0x89, 0x50, 0x4e, 0x47])],
        [annotationFile, '[]'],
        [notesFile, notes],
      ] as const) {
        const target = path.join(projectPath, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, body);
      }
      const before = await tree(root);
      const writes = [
        vi.spyOn(fs, 'writeFile'),
        vi.spyOn(fs, 'mkdir'),
        vi.spyOn(fs, 'rename'),
        vi.spyOn(fs, 'copyFile'),
        vi.spyOn(fs, 'unlink'),
        vi.spyOn(fs, 'rm'),
      ];
      const open = vi.spyOn(fs, 'open');
      const readFile = vi.spyOn(fs, 'readFile');
      const [summary] = await listWorkspaceProjects(root);
      expect(summary).toMatchObject({
        id: project.id,
        name: project.name,
        favourite: true,
        screenshots: [{ id: 'shot' }],
        collections: [
          {
            id: roundId,
            name: 'First feedback',
            archived: false,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          },
          {
            id: '002-archived',
            name: 'Archived feedback',
            archived: true,
            createdAt: '2020-01-02',
            updatedAt: project.updatedAt,
          },
        ],
      });
      expect(summary.searchText).toContain('legacy screenshot original description critical');
      expect(summary).not.toHaveProperty('schemaVersion');
      expect(summary).not.toHaveProperty('exportPreferences');
      const response = await new WorkspaceContentSearch().search({
        workspacePath: root,
        query: ' LEGACY searchable ',
      });
      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        projectId: summary.id,
        projectPath: summary.projectPath,
        kind: 'project',
      });
      expect(response.warnings.join(' ')).toMatch(/Open them/);
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      expect(open.mock.calls).toEqual([
        [path.join(projectPath, 'project.json'), 'r'],
        [path.join(projectPath, 'project.json'), 'r'],
      ]);
      expect(readFile).not.toHaveBeenCalled();
      vi.restoreAllMocks();
      expect(await tree(root)).toEqual(before);

      // Only the explicit open path invokes this existing migration boundary.
      const migrated = await migrateProject(
        projectPath,
        parseProjectFile(JSON.parse(await fs.readFile(path.join(projectPath, 'project.json'), 'utf8'))),
      );
      expect(migrated.schemaVersion).toBe(3);
      expect(migrated.collections.map(({ id }) => id)).toEqual(summary.collections.map(({ id }) => id));
      expect(migrated.screenshots[0].description).toContain(notes);
      expect(
        JSON.parse(
          await fs.readFile(path.join(projectPath, `project.v${schemaVersion}.backup.json`), 'utf8'),
        ),
      ).toEqual(project);
      expect(
        JSON.parse(await fs.readFile(path.join(projectPath, 'project.json'), 'utf8')).schemaVersion,
      ).toBe(3);
    },
  );

  it('isolates missing, corrupt, invalid and oversized metadata from usable projects', async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, 'not-a-project'));
    await writeProject(root, 'invalid', { schemaVersion: 3, name: 'Incomplete' });
    const corrupt = await writeProject(root, 'corrupt', null);
    await fs.writeFile(path.join(corrupt, 'project.json'), '{');
    const oversized = await writeProject(root, 'oversized', emptyProject('Too large', ''));
    await fs.truncate(path.join(oversized, 'project.json'), SEARCH_LIMITS.projectBytes + 1);
    await writeProject(root, 'valid', emptyProject('Usable', ''));
    const read = vi.spyOn(Buffer, 'alloc');
    expect((await listWorkspaceProjects(root)).map(({ name }) => name)).toEqual(['Usable']);
    expect(read.mock.calls.every(([size]) => size <= SEARCH_LIMITS.projectBytes)).toBe(true);
  });

  it('excludes only reserved restore/template directories, retaining ordinary hidden projects', async () => {
    const root = await workspace();
    const reserved = [
      `.imnota-restore-rollback-${'a'.repeat(32)}`,
      `.IMNOTA-RESTORE-STAGE-${'B'.repeat(32)}`,
      '.imnota-template-stage',
    ];
    const visible = ['.private-project', '.imnota-restore-stage-personal', '.imnota-template'];
    for (const name of [...reserved, ...visible]) await writeProject(root, name, emptyProject(name, ''));
    const open = vi.spyOn(fs, 'open');
    expect((await listWorkspaceProjects(root)).map(({ name }) => name).sort()).toEqual([...visible].sort());
    expect(open).toHaveBeenCalledTimes(visible.length);
  });

  it('does not follow linked project directories, metadata or workspace paths', async () => {
    const root = await workspace();
    const valid = await writeProject(root, 'valid', emptyProject('Usable', ''));
    const linked = path.join(root, 'linked');
    await fs.symlink(valid, linked, 'junction');
    const metadataLink = path.join(root, 'linked-metadata');
    await fs.mkdir(metadataLink);
    await fs.symlink(valid, path.join(metadataLink, 'project.json'), 'junction');
    expect((await listWorkspaceProjects(root)).map(({ name }) => name)).toEqual(['Usable']);
    await expect(listWorkspaceProjects(linked)).rejects.toThrow(/Linked workspace/);
  });

  it('returns an empty list for an empty or missing workspace without creating it', async () => {
    const root = await workspace();
    expect(await listWorkspaceProjects(root)).toEqual([]);
    expect(await listWorkspaceProjects(path.join(root, 'missing'))).toEqual([]);
    expect(await fs.readdir(root)).toEqual([]);
  });
});
