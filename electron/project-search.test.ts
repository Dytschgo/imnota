import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectData } from '../src/shared/types.js';
import { assertNoLinks, isWithin } from './files.js';
import { ProjectSearchService, SEARCH_LIMITS } from './project-search.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((folder) => fs.rm(folder, { recursive: true })));
});

async function fixture(status: ProjectData['status'] = 'active') {
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-search-')));
  temporaryDirectories.push(workspace);
  const projectPath = path.join(workspace, status === 'active' ? 'alpha' : 'archive');
  const collectionId = '001-feedback';
  const base = path.join(projectPath, 'collections', collectionId);
  await Promise.all(
    ['descriptions', 'annotations', 'text', 'drawings'].map((folder) =>
      fs.mkdir(path.join(base, folder), { recursive: true }),
    ),
  );
  const now = '2026-09-08T10:00:00.000Z';
  const project: ProjectData = {
    schemaVersion: 4,
    id: `project-${status}`,
    name: status === 'active' ? 'Checkout review' : 'Retired checkout',
    description: 'Project metadata about payments',
    createdAt: now,
    updatedAt: now,
    status,
    favourite: false,
    collections: [
      {
        id: collectionId,
        name: 'Mobile checkout',
        archived: false,
        createdAt: now,
        updatedAt: now,
        overallContext: 'Collection context for the compact breakpoint',
      },
    ],
    screenshots: [
      {
        collectionId,
        id: 'shot-one',
        originalFilename: 'checkout.png',
        storedFilename: 'checkout.png',
        title: 'Payment screen',
        description: 'stale preview only',
        position: 0,
        createdAt: now,
        updatedAt: now,
        priority: 'high',
        annotationFile: `collections/${collectionId}/annotations/checkout.png.json`,
        descriptionFile: `collections/${collectionId}/descriptions/checkout.png.md`,
        originalWidth: 800,
        originalHeight: 600,
        includeInExport: true,
      },
    ],
    contentItems: [
      {
        kind: 'text',
        id: 'text-one',
        collectionId,
        position: 1,
        includeInExport: true,
        createdAt: now,
        updatedAt: now,
        markdownFilename: 'notes.md',
        preview: 'Short preview',
      },
      {
        kind: 'drawing',
        id: 'drawing-one',
        collectionId,
        position: 2,
        includeInExport: true,
        createdAt: now,
        updatedAt: now,
        title: 'User flow',
        sourceFilename: 'flow.json',
        imageFilename: 'flow.png',
        originalWidth: 800,
        originalHeight: 600,
      },
    ],
    exportPreferences: {
      includeOriginalScreenshots: true,
      includeAnnotationMetadata: true,
      template: 'default',
    },
  };
  await Promise.all([
    fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project)),
    fs.writeFile(
      path.join(base, 'descriptions', 'checkout.png.md'),
      'The confirm button overlaps the total on a narrow screen.',
    ),
    fs.writeFile(
      path.join(base, 'annotations', 'checkout.png.json'),
      JSON.stringify([
        { id: 'annotation-one', kind: 'callout', text: 'Copy says Pay naw', x: 0, y: 0, zIndex: 1 },
      ]),
    ),
    fs.writeFile(
      path.join(base, 'text', 'notes.md'),
      '# Research\nThe preview omits this full markdown retention detail.',
    ),
    fs.writeFile(
      path.join(base, 'drawings', 'flow.json'),
      JSON.stringify({ elements: [{ type: 'text', text: 'Review basket before checkout' }] }),
    ),
  ]);
  return { workspace, projectPath, collectionId };
}

function service(
  workspace: string,
  hooks: Pick<ConstructorParameters<typeof ProjectSearchService>[0], 'beforeFileOpen' | 'afterFileOpen'> = {},
) {
  return new ProjectSearchService({
    workspace: () => workspace,
    authorizeProject: async (projectPath) => {
      if (!isWithin(workspace, projectPath)) throw new Error('outside workspace');
      await assertNoLinks(projectPath);
      return projectPath;
    },
    assertNoLinks,
    ...hooks,
  });
}

describe('ProjectSearchService', () => {
  it('searches full Markdown, descriptions, annotations, drawing text, and navigation targets', async () => {
    const { workspace } = await fixture();
    const search = service(workspace);
    expect((await search.search({ query: 'full markdown retention' })).results[0]).toMatchObject({
      kind: 'text',
      target: { itemId: 'text-one', collectionId: '001-feedback' },
    });
    expect((await search.search({ query: 'overlaps the total' })).results[0]).toMatchObject({
      kind: 'screenshot',
      target: { itemId: 'shot-one' },
    });
    expect((await search.search({ query: 'Pay naw' })).results[0]).toMatchObject({
      kind: 'annotation',
      target: { itemId: 'shot-one', annotationId: 'annotation-one' },
    });
    expect((await search.search({ query: 'Review basket' })).results[0]).toMatchObject({
      kind: 'drawing',
      target: { itemId: 'drawing-one' },
    });
  });

  it('excludes archived projects by default and supports archive-only search', async () => {
    const { workspace } = await fixture('archived');
    const search = service(workspace);
    expect((await search.search({ query: 'Retired checkout' })).results).toEqual([]);
    expect((await search.search({ query: 'Retired checkout', scope: 'archived' })).results[0]).toMatchObject({
      kind: 'project',
      projectName: 'Retired checkout',
    });
  });

  it('invalidates cached content after an external edit', async () => {
    const { workspace, projectPath, collectionId } = await fixture();
    const search = service(workspace);
    expect((await search.search({ query: 'full markdown retention' })).results).toHaveLength(1);
    await fs.writeFile(
      path.join(projectPath, 'collections', collectionId, 'text', 'notes.md'),
      '# Research\nExternal editor added the accessibility acceptance criterion.',
    );
    expect((await search.search({ query: 'accessibility acceptance' })).results[0]).toMatchObject({
      kind: 'text',
      target: { itemId: 'text-one' },
    });
  });

  it('skips oversized content and reports an incomplete search', async () => {
    const { workspace, projectPath, collectionId } = await fixture();
    await fs.writeFile(
      path.join(projectPath, 'collections', collectionId, 'text', 'notes.md'),
      `hidden-token-${'x'.repeat(SEARCH_LIMITS.fileBytes + 1)}`,
    );
    const result = await service(workspace).search({ query: 'hidden-token' });
    expect(result.results).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.warnings?.[0]).toMatch(/file was skipped/i);
  });

  it('rejects a file replaced between validation and handle identity verification', async () => {
    const { workspace, projectPath, collectionId } = await fixture();
    const target = path.join(projectPath, 'collections', collectionId, 'text', 'notes.md');
    const original = `${target}.original`;
    const replacement = `${target}.replacement`;
    const openedReplacement = `${target}.opened`;
    await fs.writeFile(replacement, 'secret replacement content');
    let swapped = false;
    const search = service(workspace, {
      beforeFileOpen: async (filePath) => {
        if (filePath !== target || swapped) return;
        swapped = true;
        await fs.rename(target, original);
        await fs.rename(replacement, target);
      },
      afterFileOpen: async (filePath) => {
        if (filePath !== target || !swapped) return;
        await fs.rename(target, openedReplacement);
        await fs.rename(original, target);
      },
    });
    const result = await search.search({ query: 'secret replacement' });
    expect(result.results).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.warnings?.[0]).toMatch(/skipped/i);
  });
});
