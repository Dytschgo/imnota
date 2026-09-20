// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
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
      'list_collection_items',
      'get_latest_bundle',
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
