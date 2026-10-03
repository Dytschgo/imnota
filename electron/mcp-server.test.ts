// @vitest-environment node
import fs from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../src/shared/types.js';
import { emptyProject } from '../src/shared/utils.js';
import {
  BUNDLE_NOT_PREPARED,
  createMcpTools,
  handleMcpJsonRpc,
  LocalMcpServer,
  omitSecretFields,
} from './mcp-server.js';

const fixtures: string[] = [];
const servers: LocalMcpServer[] = [];

describe('local MCP preference lifecycle', () => {
  it('does not persist opt-in when the loopback port is already occupied', async () => {
    const occupied = new LocalMcpServer({
      enabled: () => true,
      workspacePath: () => null,
      appVersion: () => 'test',
    });
    const candidate = new LocalMcpServer({
      enabled: () => false,
      workspacePath: () => null,
      appVersion: () => 'test',
    });
    servers.push(occupied, candidate);
    const address = await occupied.sync({ port: 0 });
    const persist = vi.fn(async () => {});
    await expect(candidate.savePreference(true, persist, { port: address!.port })).rejects.toThrow(
      'Your setting was not changed',
    );
    expect(persist).not.toHaveBeenCalled();
    expect(candidate.listening()).toBeNull();
    expect(occupied.listening()).toEqual(address);
  });

  it('closes a staged listener after a failed save and can retry successfully', async () => {
    let enabled = false;
    const server = new LocalMcpServer({
      enabled: () => enabled,
      workspacePath: () => null,
      appVersion: () => 'test',
    });
    servers.push(server);
    await expect(
      server.savePreference(
        true,
        async () => {
          throw new Error('disk full');
        },
        { port: 0 },
      ),
    ).rejects.toThrow('disk full');
    expect(server.listening()).toBeNull();
    expect(enabled).toBe(false);
    await server.savePreference(
      true,
      async () => {
        enabled = true;
      },
      { port: 0 },
    );
    expect(server.listening()?.host).toBe('127.0.0.1');
    await server.savePreference(false, async () => {
      enabled = false;
    });
    expect(server.listening()).toBeNull();
  });
});
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const fixture of fixtures.splice(0)) await fs.rm(fixture, { recursive: true, force: true });
});

const PAIRING_SECRET = 'pairing-secret-token-AAAAAAAAAAAAA';
const MANAGEMENT_SECRET = 'management-secret-token-BBBBBBBBBBB';
const TIMESTAMP = '2026-09-13T00:00:00.000Z';

async function workspace() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-mcp-')));
  fixtures.push(root);
  return root;
}

function projectData(id = 'review-project'): ProjectData {
  const project = emptyProject('Review', 'Review description', 'Workspace');
  project.schemaVersion = 4;
  project.id = id;
  project.createdAt = TIMESTAMP;
  project.updatedAt = TIMESTAMP;
  project.contentItems = [
    {
      id: 'text-1',
      kind: 'text',
      collectionId: '001-collection',
      position: 1,
      includeInExport: true,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      markdownFilename: 'notes.md',
      preview: 'Notes preview',
    },
  ];
  project.screenshots = [
    {
      collectionId: '001-collection',
      id: 'shot-1',
      originalFilename: 'login.png',
      storedFilename: 'login.png',
      title: 'Login screen',
      description: 'Login description',
      position: 0,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      priority: 'high',
      annotationFile: 'collections/001-collection/annotations/login.png.json',
      descriptionFile: 'collections/001-collection/descriptions/login.png.md',
      originalWidth: 100,
      originalHeight: 80,
      includeInExport: true,
    },
  ];
  return project;
}

async function writeProject(root: string, project: ProjectData) {
  const projectPath = path.join(root, project.id);
  const collection = path.join(projectPath, 'collections', '001-collection');
  await fs.mkdir(path.join(collection, 'screenshots'), { recursive: true });
  await fs.mkdir(path.join(collection, 'descriptions'), { recursive: true });
  await fs.mkdir(path.join(collection, 'text'), { recursive: true });
  await fs.mkdir(path.join(collection, 'exports'), { recursive: true });
  await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project));
  await fs.writeFile(path.join(collection, 'screenshots', 'login.png'), 'png-bytes');
  await fs.writeFile(path.join(collection, 'descriptions', 'login.png.md'), 'Login description');
  await fs.writeFile(path.join(collection, 'text', 'notes.md'), 'Full notes markdown');
  await fs.writeFile(
    path.join(projectPath, '.imnota-recovery.json'),
    JSON.stringify({ pairingToken: PAIRING_SECRET, project }),
  );
  return projectPath;
}

async function writeSecrets(root: string, projectPath: string) {
  const backups = path.join(root, '.imnota-backups', 'snap', 'data');
  await fs.mkdir(backups, { recursive: true });
  await fs.writeFile(path.join(backups, 'secret.txt'), MANAGEMENT_SECRET);
  await fs.writeFile(
    path.join(root, 'hosted-shares.json'),
    JSON.stringify([{ pairingToken: PAIRING_SECRET, managementToken: MANAGEMENT_SECRET }]),
  );
  await fs.mkdir(path.join(projectPath, '.imnota-transactions'), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, '.imnota-transactions', 'journal.json'),
    JSON.stringify({ pairingToken: PAIRING_SECRET }),
  );
}

function toolsFor(workspacePath: string, enabled = true) {
  return createMcpTools({
    enabled: () => enabled,
    workspacePath: () => workspacePath,
    appVersion: () => '0.2.7',
  });
}

async function callTool(workspacePath: string, name: string, args: Record<string, unknown> = {}) {
  const tool = toolsFor(workspacePath).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool.handle(args);
}

describe('local MCP server lifecycle', () => {
  it('does not start a listener while local agent access is off', async () => {
    const server = new LocalMcpServer({
      enabled: () => false,
      workspacePath: () => null,
      appVersion: () => '0.2.7',
    });
    servers.push(server);
    expect(await server.sync({ port: 0 })).toBeNull();
    expect(server.listening()).toBeNull();
    expect(
      await server.startStdio(Readable.from([]), new Writable({ write: (_c, _e, done) => done() })),
    ).toBe(false);
  });

  it('listens only on 127.0.0.1 when enabled', async () => {
    const server = new LocalMcpServer({
      enabled: () => true,
      workspacePath: () => null,
      appVersion: () => '0.2.7',
    });
    servers.push(server);
    const address = await server.sync({ port: 0 });
    expect(address).toMatchObject({ host: '127.0.0.1' });
    expect(address?.port).toBeGreaterThan(0);
    const listed = await fetch(`http://127.0.0.1:${address!.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(listed.ok).toBe(true);
    expect(listed.headers.get('access-control-allow-origin')).toBeNull();
    const body = (await listed.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      'list_projects',
      'list_collections',
      'list_collection_items',
      'get_latest_bundle',
      'get_bundle',
      'get_item',
      'search_saved_text',
    ]);
    const fromBrowser = await fetch(`http://127.0.0.1:${address!.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(fromBrowser.status).toBe(403);
  });
});

describe('local MCP tools', () => {
  it('rejects path traversal and reserved backup folders', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData());
    await writeSecrets(root, projectPath);
    await expect(
      callTool(root, 'list_collection_items', {
        projectPath: path.join(root, '..', 'outside'),
        collectionId: '001-collection',
      }),
    ).rejects.toThrow(/outside the selected workspace/);
    await expect(
      callTool(root, 'get_item', {
        projectPath: path.join(root, '.imnota-backups', 'snap', 'data'),
        itemId: 'shot-1',
      }),
    ).rejects.toThrow(/Backup and recovery folders/);
    await expect(
      callTool(root, 'get_latest_bundle', {
        projectPath: path.join(projectPath, '..', '..', os.tmpdir()),
        collectionId: '001-collection',
      }),
    ).rejects.toThrow(/outside the selected workspace/);
    await expect(
      callTool(root, 'list_collection_items', {
        projectPath,
        collectionId: '../exports',
      }),
    ).rejects.toThrow();
  });

  it('errors get_latest_bundle without creating an export', async () => {
    const root = await workspace();
    const project = projectData();
    const projectPath = await writeProject(root, project);
    const exportsDirectory = path.join(projectPath, 'collections', '001-collection', 'exports');
    const before = await fs.readdir(exportsDirectory, { recursive: true });
    await expect(
      callTool(root, 'get_latest_bundle', { projectPath, collectionId: '001-collection' }),
    ).rejects.toThrow(BUNDLE_NOT_PREPARED);
    expect(await fs.readdir(exportsDirectory, { recursive: true })).toEqual(before);
  });

  it('reads an existing export and keeps hosted-share secrets out of tool output', async () => {
    const root = await workspace();
    const project = projectData();
    const projectPath = await writeProject(root, project);
    await writeSecrets(root, projectPath);
    const setName = 'Review - 260907-184205';
    const exportFolder = path.join(projectPath, 'collections', '001-collection', 'exports', setName);
    await fs.mkdir(exportFolder, { recursive: true });
    await fs.writeFile(path.join(exportFolder, `${setName} - 01.md`), '# Prompt 1\nVisible handoff text');
    await fs.writeFile(path.join(exportFolder, `${setName} - 01.png`), 'export-png');
    const outputs: unknown[] = [];
    outputs.push(await callTool(root, 'list_projects'));
    outputs.push(
      await callTool(root, 'list_collection_items', { projectPath, collectionId: '001-collection' }),
    );
    outputs.push(await callTool(root, 'get_item', { projectPath, itemId: 'shot-1' }));
    outputs.push(await callTool(root, 'get_item', { projectPath, itemId: 'text-1' }));
    outputs.push(await callTool(root, 'search_saved_text', { query: 'Login' }));
    const bundle = (await callTool(root, 'get_latest_bundle', {
      projectPath,
      collectionId: '001-collection',
    })) as {
      setName: string;
      bundles: Array<{ markdown: string; markdownPath: string; pngPath?: string }>;
    };
    outputs.push(bundle);
    expect(bundle.setName).toBe(setName);
    expect(bundle.bundles[0]?.markdown).toContain('Visible handoff text');
    expect(bundle.bundles[0]?.pngPath).toContain(`${setName} - 01.png`);
    const serialized = JSON.stringify(outputs);
    expect(serialized).not.toContain(PAIRING_SECRET);
    expect(serialized).not.toContain(MANAGEMENT_SECRET);
    expect(serialized).not.toContain('pairingToken');
    expect(serialized).not.toContain('managementToken');
    expect(omitSecretFields({ pairingToken: PAIRING_SECRET, url: 'https://app.imnota.xyz/s/x' })).toEqual({
      url: 'https://app.imnota.xyz/s/x',
    });
  });

  it('returns MCP tool errors without leaking secrets over JSON-RPC', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData());
    await writeSecrets(root, projectPath);
    const tools = toolsFor(root);
    const missing = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'get_latest_bundle', arguments: { projectPath, collectionId: '001-collection' } },
      },
      tools,
      '0.2.7',
    );
    expect(missing).toMatchObject({
      result: { isError: true, content: [{ type: 'text', text: BUNDLE_NOT_PREPARED }] },
    });
    expect(JSON.stringify(missing)).not.toContain(PAIRING_SECRET);
  });
});

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function writeBundle(
  projectPath: string,
  setName = 'Review - 260913-120000',
  markdown = '# Saved bundle',
  png: Buffer | null = TEST_PNG,
  collectionId = '001-collection',
) {
  const folder = path.join(projectPath, 'collections', collectionId, 'exports', setName);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, `${setName} - 01.md`), markdown);
  if (png) await fs.writeFile(path.join(folder, `${setName} - 01.png`), png);
  return folder;
}

interface BundleResult {
  id: string;
  setName: string;
  collectionId: string;
  bundles: Array<{
    bundleNumber: number;
    markdown: string;
    image: string;
    markdownOmitted?: boolean;
    pngPath?: string;
  }>;
  imagesIncluded: number;
  imagesOmitted: number;
  imagesInvalid: number;
  markdownOmitted: number;
  notes: string[];
}
interface CollectionResult {
  collections: Array<{
    id: string;
    archived: boolean;
    itemCount: number;
    preparedBundles: Array<{ id: string; setName: string }>;
  }>;
}
interface RpcResponse {
  error?: { code: number; message: string };
  result?: {
    isError: boolean;
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  };
}

async function protocolCall(
  tools: ReturnType<typeof createMcpTools>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<RpcResponse> {
  return (await handleMcpJsonRpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    tools,
    'test',
  )) as RpcResponse;
}

async function savedFiles(root: string) {
  const names = (await fs.readdir(root, { recursive: true })).sort();
  const files: Record<string, string> = {};
  for (const name of names) {
    const target = path.join(root, name);
    if ((await fs.lstat(target)).isFile()) files[name] = (await fs.readFile(target)).toString('base64');
  }
  return files;
}

describe('prepared MCP bundle discovery and read boundaries', () => {
  it('lists active projects and all collection states, with stable discoverable bundle ids and no writes', async () => {
    const root = await workspace();
    const project = projectData();
    project.collections.push({
      ...project.collections[0]!,
      id: '002-archived',
      name: 'Archived',
      archived: true,
    });
    const projectPath = await writeProject(root, project);
    const archived = projectData('archived-project');
    archived.status = 'archived';
    await writeProject(root, archived);
    await writeSecrets(root, projectPath);
    await writeBundle(projectPath);
    await writeBundle(projectPath, 'Archived - 260914-120000', '# Archived snapshot', null, '002-archived');
    const before = await savedFiles(root);
    expect(await callTool(root, 'list_projects')).toMatchObject({
      projects: [{ path: projectPath, name: 'Review', status: 'active' }],
    });
    const listed = (await callTool(root, 'list_collections', { projectPath })) as CollectionResult;
    expect(listed.collections).toMatchObject([
      { id: '001-collection', itemCount: 2, archived: false },
      { id: '002-archived', itemCount: 0, archived: true },
    ]);
    const id = listed.collections[0]!.preparedBundles[0]!.id;
    expect(id).toMatch(/^b_[0-9a-f]{32}$/);
    expect(
      ((await callTool(root, 'list_collections', { projectPath })) as CollectionResult).collections[0]!
        .preparedBundles[0]!.id,
    ).toBe(id);
    const tools = toolsFor(root);
    const read = await protocolCall(tools, 'get_bundle', { id });
    expect(read.result?.isError).toBe(false);
    expect(read.result?.content[0]?.text).toContain('# Saved bundle');
    expect(read.result?.content[1]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: TEST_PNG.toString('base64'),
    });
    const archivedId = listed.collections[1]!.preparedBundles[0]!.id;
    expect(
      ((await callTool(root, 'get_bundle', { id: archivedId })) as BundleResult).bundles[0]!.markdown,
    ).toBe('# Archived snapshot');
    expect(((await callTool(root, 'get_latest_bundle')) as BundleResult).setName).toBe(
      'Review - 260913-120000',
    );
    expect(
      (
        (await callTool(root, 'get_latest_bundle', {
          projectPath,
          collectionId: '002-archived',
        })) as BundleResult
      ).setName,
    ).toBe('Archived - 260914-120000');
    expect(await savedFiles(root)).toEqual(before);
  });

  it('ignores staging, empty, malformed and far-future exports and resolves timestamp ties deterministically', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData('a-project'));
    const second = await writeProject(root, projectData('b-project'));
    const exportsDirectory = path.join(projectPath, 'collections', '001-collection', 'exports');
    for (const name of [
      '.imnota-prompt-export-staging',
      'Review - 991231-235959',
      'Review - 260231-120000',
      'Review - 260915-120000',
      'not-an-export',
    ])
      await fs.mkdir(path.join(exportsDirectory, name));
    await fs.writeFile(path.join(exportsDirectory, 'Review - 260915-120000', 'unrelated.md'), 'not a bundle');
    await writeBundle(second);
    await writeBundle(projectPath);
    const listed = (await callTool(root, 'list_collections', { projectPath })) as CollectionResult;
    expect(listed.collections[0]!.preparedBundles.map((bundle) => bundle.setName)).toEqual([
      'Review - 260913-120000',
    ]);
    const latest = (await callTool(root, 'get_latest_bundle')) as BundleResult & { projectPath: string };
    expect(latest.projectPath).toBe(projectPath);
    await writeBundle(second, 'Review - 260914-120000', '# Newer');
    expect(((await callTool(root, 'get_latest_bundle')) as BundleResult).setName).toBe(
      'Review - 260914-120000',
    );
    expect(((await callTool(root, 'get_latest_bundle', { projectPath })) as BundleResult).setName).toBe(
      'Review - 260913-120000',
    );
  });

  it('bounds discoverable set metadata and skips a corrupt linked newest set without following it', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData());
    for (let day = 1; day <= 12; day++)
      await writeBundle(projectPath, `Review - 2609${String(day).padStart(2, '0')}-120000`, '# saved', null);
    const listed = (await callTool(root, 'list_collections', { projectPath })) as CollectionResult;
    expect(listed.collections[0]!.preparedBundles).toHaveLength(10);
    expect(listed.collections[0]!.preparedBundles[0]!.setName).toBe('Review - 260912-120000');
    const foreign = await workspace();
    const external = await writeBundle(foreign, 'Review - 260915-120000', 'foreign secret');
    const alias = path.join(
      projectPath,
      'collections',
      '001-collection',
      'exports',
      'Review - 260915-120000',
    );
    await fs.symlink(external, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const latest = await protocolCall(toolsFor(root), 'get_latest_bundle', { projectPath });
    expect(latest.result?.isError).toBe(false);
    expect(latest.result?.content[0]?.text).toContain('Review - 260912-120000');
    expect(JSON.stringify(latest)).not.toContain('foreign secret');
  });

  it('rejects an export directory replaced with a junction while its image is opened', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData());
    const folder = await writeBundle(projectPath);
    const foreign = await workspace();
    const foreignFolder = await writeBundle(foreign, 'Review - 260913-120000', 'foreign secret');
    const pngPath = path.join(folder, 'Review - 260913-120000 - 01.png');
    const originalOpen = fs.open.bind(fs);
    let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      if (!replaced && String(target) === pngPath) {
        await fs.rename(folder, `${folder}-held`);
        await fs.symlink(foreignFolder, folder, process.platform === 'win32' ? 'junction' : 'dir');
        replaced = true;
      }
      return originalOpen(target, flags, mode);
    });
    const response = await protocolCall(toolsFor(root), 'get_latest_bundle', { projectPath });
    expect(replaced).toBe(true);
    expect((await fs.lstat(folder)).isSymbolicLink()).toBe(true);
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain('foreign secret');
  });

  it('rejects project aliases, outside paths, reserved folders, unknown ids and malformed arguments without leaking them', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData());
    const foreign = await workspace();
    const alias = path.join(root, 'alias');
    await fs.symlink(projectPath, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const tools = toolsFor(root);
    for (const args of [
      { projectPath: foreign },
      { projectPath: alias },
      { projectPath: path.join(root, '.imnota-backups', 'snapshot') },
      { projectPath, unexpected: PAIRING_SECRET },
    ]) {
      const response = await protocolCall(tools, 'list_collections', args);
      expect(response.result?.isError).toBe(true);
      expect(JSON.stringify(response)).not.toContain(PAIRING_SECRET);
      expect(JSON.stringify(response)).not.toContain(foreign);
    }
    expect((await protocolCall(tools, 'get_bundle', { id: '../' + MANAGEMENT_SECRET })).result?.isError).toBe(
      true,
    );
    expect(
      (await protocolCall(tools, 'get_bundle', { id: 'b_' + '0'.repeat(32) })).result?.content[0]?.text,
    ).toBe('bundle not found');
    expect(
      (await protocolCall(tools, 'get_latest_bundle', { collectionId: '001-collection' })).result?.isError,
    ).toBe(true);
    expect(
      (await protocolCall(tools, 'get_latest_bundle', { projectPath, collectionId: '../secret' })).result
        ?.isError,
    ).toBe(true);
  });

  it('returns bounded image/Markdown omissions truthfully, validates PNGs, and accepts text-only sets', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData());
    const folder = await writeBundle(projectPath, undefined, '1234567890');
    const setName = path.basename(folder);
    await fs.writeFile(path.join(folder, `${setName} - 02.md`), 'second');
    await fs.writeFile(path.join(folder, `${setName} - 02.png`), TEST_PNG);
    const tools = createMcpTools(
      { enabled: () => true, workspacePath: () => root, appVersion: () => 'test' },
      { maxImages: 1, maxMarkdownBytes: 10 },
    );
    const response = await protocolCall(tools, 'get_latest_bundle', { projectPath });
    const data = JSON.parse(response.result!.content[0]!.text!) as BundleResult;
    expect(data).toMatchObject({ imagesIncluded: 1, imagesOmitted: 1, markdownOmitted: 1 });
    expect(data.bundles[1]).toMatchObject({
      markdown: '',
      markdownOmitted: true,
      image: 'omitted-too-large',
    });
    expect(data.notes.join(' ')).toContain('too large');
    expect(response.result!.content.filter((content) => content.type === 'image')).toHaveLength(1);
    const tiny = createMcpTools(
      { enabled: () => true, workspacePath: () => root, appVersion: () => 'test' },
      { maxImageBytes: TEST_PNG.length - 1 },
    );
    expect(
      JSON.parse((await protocolCall(tiny, 'get_latest_bundle', { projectPath })).result!.content[0]!.text!)
        .imagesOmitted,
    ).toBe(2);
    const total = createMcpTools(
      { enabled: () => true, workspacePath: () => root, appVersion: () => 'test' },
      { maxTotalImageBytes: TEST_PNG.length },
    );
    expect(
      JSON.parse((await protocolCall(total, 'get_latest_bundle', { projectPath })).result!.content[0]!.text!)
        .imagesOmitted,
    ).toBe(1);
    await writeBundle(projectPath, 'Review - 260914-120000', '# damaged image', Buffer.from('not PNG'));
    expect(((await callTool(root, 'get_latest_bundle', { projectPath })) as BundleResult).imagesInvalid).toBe(
      1,
    );
    await writeBundle(projectPath, 'Review - 260915-120000', '# text only', null);
    expect((await callTool(root, 'get_latest_bundle', { projectPath })) as BundleResult).toMatchObject({
      imagesIncluded: 0,
      bundles: [{ markdown: '# text only', image: 'none' }],
    });
  });

  it('keeps an empty workspace and unprepared collection read-only and diagnoses damaged JSON safely', async () => {
    const root = await workspace();
    expect(await callTool(root, 'list_projects')).toEqual({ projects: [] });
    expect((await protocolCall(toolsFor(root), 'get_latest_bundle')).result?.content[0]?.text).toBe(
      BUNDLE_NOT_PREPARED,
    );
    const projectPath = await writeProject(root, projectData());
    expect(
      ((await callTool(root, 'list_collections', { projectPath })) as CollectionResult).collections[0]!
        .preparedBundles,
    ).toEqual([]);
    const before = await savedFiles(root);
    await protocolCall(toolsFor(root), 'get_latest_bundle', { projectPath });
    expect(await savedFiles(root)).toEqual(before);
    await fs.writeFile(path.join(projectPath, 'project.json'), '{' + PAIRING_SECRET);
    const response = await protocolCall(toolsFor(root), 'list_collections', { projectPath });
    expect(response.result?.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain(PAIRING_SECRET);
  });
});

describe('MCP wire protocol for prepared data', () => {
  it('initializes, lists, discovers and reads the identical PNG over real HTTP and stdio', async () => {
    const root = await workspace();
    const projectPath = await writeProject(root, projectData());
    await writeBundle(projectPath);
    const server = new LocalMcpServer({
      enabled: () => true,
      workspacePath: () => root,
      appVersion: () => 'test',
    });
    servers.push(server);
    const address = await server.sync({ port: 0 });
    const request = async (message: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address!.port}/mcp`, {
        method: 'POST',
        body: JSON.stringify(message),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as RpcResponse;
    };
    expect(
      await request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    ).toMatchObject({
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'imnota', version: 'test' } },
    });
    const listed = await request({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_collections', arguments: { projectPath } },
    });
    const collections = JSON.parse(listed.result!.content[0]!.text!) as CollectionResult;
    const id = collections.collections[0]!.preparedBundles[0]!.id;
    const message = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_bundle', arguments: { id } },
    };
    const httpResponse = await request(message);
    const chunks: string[] = [];
    await server.startStdio(
      Readable.from([
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) +
          '\n' +
          JSON.stringify(message) +
          '\n',
      ]),
      new Writable({
        write(chunk, _encoding, done) {
          chunks.push(chunk.toString());
          done();
        },
      }),
    );
    const stdioResponse = JSON.parse(chunks.join('').trim()) as RpcResponse;
    expect(stdioResponse).toEqual(httpResponse);
    expect(httpResponse.result!.content[1]!.data).toBe(TEST_PNG.toString('base64'));
  });

  it('rejects malformed requests, large JSON, foreign Host/Origin and revoked opt-in over real HTTP', async () => {
    const root = await workspace();
    let enabled = true;
    const server = new LocalMcpServer({
      enabled: () => enabled,
      workspacePath: () => root,
      appVersion: () => 'test',
    });
    servers.push(server);
    const address = await server.sync({ port: 0 });
    const url = `http://127.0.0.1:${address!.port}/mcp`;
    for (const invalid of [null, [], 7, { jsonrpc: '2.0', id: {}, method: 'tools/list' }]) {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify(invalid) });
      expect(await response.json()).toMatchObject({ error: { code: -32600 } });
    }
    const malformed = await fetch(url, { method: 'POST', body: '{' + PAIRING_SECRET });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain(PAIRING_SECRET);
    const huge = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ padding: 'x'.repeat(1_000_001) }),
    });
    expect(huge.status).toBe(400);
    // Undici may replace Host; send the wire header explicitly to exercise DNS-rebinding protection.
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        url,
        { method: 'POST', headers: { Host: 'foreign.example' } },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      request.on('error', reject);
      request.end('{}');
    });
    expect(foreignHostStatus).toBe(403);
    expect(
      (await fetch(url, { method: 'POST', headers: { origin: 'http://localhost' }, body: '{}' })).status,
    ).toBe(403);
    enabled = false;
    expect(
      (
        await fetch(url, {
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'list_projects' },
          }),
        })
      ).status,
    ).toBe(403);
  });

  it('rejects later stdio reads after opt-in is revoked, and bounds text responses', async () => {
    const root = await workspace();
    let enabled = true;
    const chunks: string[] = [];
    const server = new LocalMcpServer({
      enabled: () => enabled,
      workspacePath: () => root,
      appVersion: () => 'test',
    });
    const first = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const second = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_projects' },
    });
    await server.startStdio(
      Readable.from([first + '\n' + second + '\n']),
      new Writable({
        write(chunk, _encoding, done) {
          chunks.push(chunk.toString());
          enabled = false;
          done();
        },
      }),
    );
    expect(JSON.parse(chunks[1]!).error.message).toBe('Local agent access is off.');
    expect((await protocolCall(toolsFor(root, false), 'list_projects')).result?.isError).toBe(true);
    const tool = {
      name: 'oversized',
      description: '',
      inputSchema: {},
      handle: async () => ({ text: 'x'.repeat(5_000_001) }),
    };
    const response = await protocolCall([tool], 'oversized');
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content[0]?.text).toContain('exceeds the read limit');
    expect(JSON.stringify(response).length).toBeLessThan(1000);
  });
});
