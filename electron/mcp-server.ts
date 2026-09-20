import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { z } from 'zod';
import { orderedCollectionItems } from '../src/shared/content-items.js';
import type { ContentSearchRequest, ContentSearchResponse } from '../src/shared/content-search.js';
import { LOCAL_AGENT_ACCESS_HOST, LOCAL_AGENT_ACCESS_PORT } from '../src/shared/preferences.js';
import { filenameSchema, parseProjectFile } from '../src/shared/schema.js';
import type { ProjectData } from '../src/shared/types.js';
import { screenshotPath } from './collections.js';
import { contentItemRelativePaths } from './content-paths.js';
import {
  isReservedProjectPath,
  readSearchText,
  SEARCH_LIMITS,
  WorkspaceContentSearch,
} from './content-search.js';
import { assertNoLinks, isWithin } from './files.js';
import { MAX_PROMPT_BUNDLE_MARKDOWN_BYTES } from './prompt-bundle-store.js';
import { listWorkspaceProjects } from './project-list.js';
import { assertProjectPath } from './project-path.js';

export const BUNDLE_NOT_PREPARED = 'bundle not prepared';
export const LOCAL_MCP_PATH = '/mcp';
const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const MAX_JSON_RPC_BYTES = 1_000_000;
const SECRET_KEY = /^(pairingToken|managementToken|pairing_token|management_token)$/i;
const EXPORT_TIMESTAMP = /(\d{6}-\d{6})$/;
const BUNDLE_MARKDOWN = / - (\d{2,3})\.md$/i;
const BUNDLE_PNG = / - (\d{2,3})\.png$/i;
const BLOCKED_PATH_FRAGMENT =
  /(?:^|[\\/])(?:\.imnota-(?:backups|transactions|undo|content-undo|recovery(?:-backup)?\.json|restore-|template-|prompt-export)|hosted-shares(?:-pending|-recovery-dismissals)?\.json)(?:$|[\\/])/i;

export interface LocalMcpContext {
  enabled(): boolean;
  workspacePath(): string | null;
  appVersion(): string;
  search?(input: ContentSearchRequest): Promise<ContentSearchResponse>;
}

export interface LocalMcpListenOptions {
  host?: string;
  port?: number;
}

export interface LocalMcpAddress {
  host: string;
  port: number;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

type JsonRpcId = string | number | null;

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle(args: Record<string, unknown>): Promise<unknown>;
}

const projectPathSchema = z.string().min(1).max(2000);
const collectionIdSchema = filenameSchema;
const itemIdSchema = z.string().min(1).max(200);
const searchQuerySchema = z.string().min(1).max(500);

const listProjectsInput = z.object({}).strict();
const listCollectionItemsInput = z
  .object({ projectPath: projectPathSchema, collectionId: collectionIdSchema })
  .strict();
const getLatestBundleInput = z
  .object({ projectPath: projectPathSchema, collectionId: collectionIdSchema })
  .strict();
const getItemInput = z.object({ projectPath: projectPathSchema, itemId: itemIdSchema }).strict();
const searchSavedTextInput = z
  .object({
    query: searchQuerySchema,
    favouritesOnly: z.boolean().optional(),
    scope: z.enum(['active', 'archived']).optional(),
    refresh: z.boolean().optional(),
  })
  .strict();

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isLoopbackHostHeader(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  const allowed = new Set([
    '127.0.0.1',
    `127.0.0.1:${port}`,
    'localhost',
    `localhost:${port}`,
    '[::1]',
    `[::1]:${port}`,
  ]);
  return allowed.has(normalized);
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export function omitSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitSecretFields);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, nested]) => [key, omitSecretFields(nested)]),
    );
  return value;
}

function blockedAgentPath(target: string): boolean {
  return isReservedProjectPath(target) || BLOCKED_PATH_FRAGMENT.test(path.resolve(target));
}

async function assertContainedFile(root: string, target: string): Promise<string> {
  const resolved = path.resolve(target);
  if (!isWithin(root, resolved) || resolved === path.resolve(root) || blockedAgentPath(resolved))
    throw new Error('Requested path is outside the selected workspace.');
  await assertNoLinks(resolved);
  return resolved;
}

async function readProjectDocument(projectPath: string): Promise<ProjectData> {
  const source = await readSearchText(projectPath, 'project.json', SEARCH_LIMITS.projectBytes);
  const project = parseProjectFile(JSON.parse(source));
  if (project.schemaVersion !== 3 && project.schemaVersion !== 4)
    throw new Error('Open this project in Imnota before an agent can read its items.');
  return project;
}

function toolContent(data: unknown, isError = false) {
  return {
    content: [
      { type: 'text', text: typeof data === 'string' ? data : JSON.stringify(omitSecretFields(data)) },
    ],
    isError,
  };
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

async function latestPreparedBundle(projectPath: string, collectionId: string) {
  const exportsDirectory = path.join(projectPath, 'collections', collectionId, 'exports');
  await assertContainedFile(projectPath, exportsDirectory);
  const stat = await fs.lstat(exportsDirectory).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error(BUNDLE_NOT_PREPARED);
  const candidates: Array<{ name: string; timestamp: string; folder: string }> = [];
  const directory = await fs.opendir(exportsDirectory);
  for await (const entry of directory) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name.startsWith('.')) continue;
    const timestamp = entry.name.match(EXPORT_TIMESTAMP)?.[1];
    if (!timestamp) continue;
    const folder = path.join(exportsDirectory, entry.name);
    if (blockedAgentPath(folder)) continue;
    candidates.push({ name: entry.name, timestamp, folder });
  }
  candidates.sort(
    (left, right) => right.timestamp.localeCompare(left.timestamp) || right.name.localeCompare(left.name),
  );
  for (const candidate of candidates) {
    await assertNoLinks(candidate.folder);
    if (!isWithin(exportsDirectory, candidate.folder)) continue;
    const bundle = await readPublishedBundle(candidate.folder, candidate.name);
    if (bundle) return bundle;
  }
  throw new Error(BUNDLE_NOT_PREPARED);
}

async function readPublishedBundle(folder: string, setName: string) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const markdownFiles = new Map<number, string>();
  const pngFiles = new Map<number, string>();
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile() || entry.name.startsWith('.')) continue;
    const markdownNumber = entry.name.match(BUNDLE_MARKDOWN)?.[1];
    const pngNumber = entry.name.match(BUNDLE_PNG)?.[1];
    const target = path.join(folder, entry.name);
    if (blockedAgentPath(target)) continue;
    if (markdownNumber) markdownFiles.set(Number(markdownNumber), entry.name);
    else if (pngNumber) pngFiles.set(Number(pngNumber), entry.name);
  }
  if (!markdownFiles.size) return null;
  const bundles = [];
  for (const bundleNumber of [...markdownFiles.keys()].sort((left, right) => left - right)) {
    const markdownName = markdownFiles.get(bundleNumber);
    if (!markdownName) continue;
    const markdownPath = await assertContainedFile(folder, path.join(folder, markdownName));
    const markdown = await readSearchText(folder, markdownName, MAX_PROMPT_BUNDLE_MARKDOWN_BYTES);
    const pngName = pngFiles.get(bundleNumber);
    const pngPath = pngName ? await assertContainedFile(folder, path.join(folder, pngName)) : undefined;
    bundles.push({
      bundleNumber,
      markdownPath,
      ...(pngPath ? { pngPath } : {}),
      markdown,
    });
  }
  if (!bundles.length) return null;
  return { setName, folderPath: folder, bundles };
}

export function createMcpTools(context: LocalMcpContext): McpTool[] {
  const searchIndex = new WorkspaceContentSearch();
  const search = context.search ?? ((input: ContentSearchRequest) => searchIndex.search(input));
  const workspaceOrThrow = () => {
    const workspace = context.workspacePath();
    if (!workspace) throw new Error('Choose a workspace folder before opening a project.');
    return workspace;
  };
  const authorize = (projectPath: string) => assertProjectPath(workspaceOrThrow(), projectPath);

  return [
    {
      name: 'list_projects',
      description: 'List active Imnota projects in the selected workspace.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async handle(args) {
        listProjectsInput.parse(args);
        const workspace = workspaceOrThrow();
        await assertNoLinks(workspace);
        const projects = await listWorkspaceProjects(workspace);
        return {
          projects: projects
            .filter((project) => project.status === 'active')
            .map((project) => ({
              path: project.projectPath,
              name: project.name,
              updatedAt: project.updatedAt,
              status: project.status,
            })),
        };
      },
    },
    {
      name: 'list_collection_items',
      description: 'List ordered items in a collection (id, kind, title, includeInExport, priority).',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', minLength: 1, maxLength: 2000 },
          collectionId: { type: 'string', minLength: 1, maxLength: 255 },
        },
        required: ['projectPath', 'collectionId'],
        additionalProperties: false,
      },
      async handle(args) {
        const input = listCollectionItemsInput.parse(args);
        const projectPath = await authorize(input.projectPath);
        const project = await readProjectDocument(projectPath);
        const collection = project.collections.find((candidate) => candidate.id === input.collectionId);
        if (!collection) throw new Error('Collection does not belong to this project.');
        return {
          collectionId: collection.id,
          collectionName: collection.name,
          items: orderedCollectionItems(project, collection.id).map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.kind === 'text' ? item.preview || 'Text block' : item.title,
            includeInExport: item.includeInExport,
            ...(item.kind === 'screenshot' ? { priority: item.priority } : {}),
          })),
        };
      },
    },
    {
      name: 'get_latest_bundle',
      description:
        'Read the latest already-exported Markdown+PNG prompt bundle for a collection. Does not generate an export.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', minLength: 1, maxLength: 2000 },
          collectionId: { type: 'string', minLength: 1, maxLength: 255 },
        },
        required: ['projectPath', 'collectionId'],
        additionalProperties: false,
      },
      async handle(args) {
        const input = getLatestBundleInput.parse(args);
        const projectPath = await authorize(input.projectPath);
        const project = await readProjectDocument(projectPath);
        if (!project.collections.some((collection) => collection.id === input.collectionId))
          throw new Error('Collection does not belong to this project.');
        return latestPreparedBundle(projectPath, input.collectionId);
      },
    },
    {
      name: 'get_item',
      description:
        "Read one item's Markdown description or text block, plus the image path for screenshots and drawings.",
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', minLength: 1, maxLength: 2000 },
          itemId: { type: 'string', minLength: 1, maxLength: 200 },
        },
        required: ['projectPath', 'itemId'],
        additionalProperties: false,
      },
      async handle(args) {
        const input = getItemInput.parse(args);
        const projectPath = await authorize(input.projectPath);
        const project = await readProjectDocument(projectPath);
        const found = project.collections
          .flatMap((collection) => orderedCollectionItems(project, collection.id))
          .find((candidate) => candidate.id === input.itemId);
        if (!found) throw new Error('The requested item was not found in this project.');
        if (found.kind === 'screenshot') {
          const markdown = await readSearchText(
            projectPath,
            found.descriptionFile,
            SEARCH_LIMITS.textBytes,
          ).catch(() => found.description);
          const imagePath = await assertContainedFile(projectPath, screenshotPath(projectPath, found));
          return {
            id: found.id,
            kind: found.kind,
            title: found.title,
            markdown,
            imagePath,
          };
        }
        if (found.kind === 'drawing') {
          const relative = contentItemRelativePaths(found);
          const imagePath = relative.image
            ? await assertContainedFile(projectPath, path.join(projectPath, relative.image))
            : undefined;
          return {
            id: found.id,
            kind: found.kind,
            title: found.title,
            markdown: found.description ?? '',
            ...(imagePath ? { imagePath } : {}),
          };
        }
        const relative = contentItemRelativePaths(found);
        const markdown = relative.markdown
          ? await readSearchText(projectPath, relative.markdown, SEARCH_LIMITS.textBytes)
          : (found.preview ?? '');
        return {
          id: found.id,
          kind: found.kind,
          title: found.preview || 'Text block',
          markdown,
        };
      },
    },
    {
      name: 'search_saved_text',
      description:
        'Search saved project, collection, description, and Markdown text in the selected workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 500 },
          favouritesOnly: { type: 'boolean' },
          scope: { type: 'string', enum: ['active', 'archived'] },
          refresh: { type: 'boolean' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async handle(args) {
        const input = searchSavedTextInput.parse(args);
        const workspacePath = workspaceOrThrow();
        await assertNoLinks(workspacePath);
        return search({
          workspacePath,
          query: input.query,
          favouritesOnly: input.favouritesOnly,
          scope: input.scope,
          refresh: input.refresh,
        });
      },
    },
  ];
}

export function handleMcpJsonRpc(
  message: JsonRpcRequest,
  tools: readonly McpTool[],
  appVersion: string,
): Promise<unknown> | unknown {
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return jsonRpcError(idOf(message.id), -32600, 'Invalid JSON-RPC request.');
  const id = idOf(message.id);
  if (message.id === undefined) return null;
  switch (message.method) {
    case 'initialize': {
      const requested =
        message.params && typeof message.params === 'object' && !Array.isArray(message.params)
          ? (message.params as { protocolVersion?: unknown }).protocolVersion
          : undefined;
      const protocolVersion =
        typeof requested === 'string' && PROTOCOL_VERSIONS.has(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
      return jsonRpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'imnota', version: appVersion },
        instructions:
          'Read-only access to the selected Imnota workspace. Use get_latest_bundle for prepared exports; do not guess from chat images.',
      });
    }
    case 'ping':
      return jsonRpcResult(id, {});
    case 'tools/list':
      return jsonRpcResult(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case 'tools/call':
      return callTool(id, message.params, tools);
    case 'resources/list':
      return jsonRpcResult(id, { resources: [] });
    case 'prompts/list':
      return jsonRpcResult(id, { prompts: [] });
    default:
      return jsonRpcError(id, -32601, `Unknown method: ${message.method}`);
  }
}

function idOf(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

async function callTool(id: JsonRpcId, params: unknown, tools: readonly McpTool[]) {
  const parsed = z
    .object({
      name: z.string().min(1).max(100),
      arguments: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .safeParse(params);
  if (!parsed.success) return jsonRpcError(id, -32602, 'Invalid tool arguments.');
  const tool = tools.find((candidate) => candidate.name === parsed.data.name);
  if (!tool) return jsonRpcResult(id, toolContent(`Unknown tool: ${parsed.data.name}`, true));
  try {
    const data = await tool.handle(parsed.data.arguments ?? {});
    return jsonRpcResult(id, toolContent(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonRpcResult(id, toolContent(message, true));
  }
}

async function readHttpBody(request: http.IncomingMessage, maximum: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximum) throw new Error('JSON-RPC request exceeds the read limit.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class LocalMcpServer {
  private http: http.Server | null = null;
  private stdioActive = false;
  private readonly tools: McpTool[];

  constructor(private readonly context: LocalMcpContext) {
    this.tools = createMcpTools(context);
  }

  listening(): LocalMcpAddress | null {
    const address = this.http?.address();
    if (!address || typeof address === 'string') return null;
    return { host: address.address, port: address.port };
  }

  stdioStarted(): boolean {
    return this.stdioActive;
  }

  async sync(options: LocalMcpListenOptions = {}): Promise<LocalMcpAddress | null> {
    if (!this.context.enabled()) {
      await this.stop();
      return null;
    }
    if (this.listening()) return this.listening();
    return this.listen(options);
  }

  async listen(options: LocalMcpListenOptions = {}): Promise<LocalMcpAddress> {
    if (!this.context.enabled()) throw new Error('Local agent access is off.');
    const host = options.host ?? LOCAL_AGENT_ACCESS_HOST;
    if (host !== '127.0.0.1') throw new Error('Local agent access must bind to 127.0.0.1.');
    const port = options.port ?? LOCAL_AGENT_ACCESS_PORT;
    if (this.http) await this.stop();
    const server = http.createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      server.once('error', fail);
      server.listen(port, host, () => {
        server.off('error', fail);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
      server.close();
      throw new Error('Local agent access must bind to 127.0.0.1.');
    }
    this.http = server;
    return { host: address.address, port: address.port };
  }

  async startStdio(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout,
  ): Promise<boolean> {
    if (!this.context.enabled()) return false;
    this.stdioActive = true;
    try {
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let message: JsonRpcRequest;
        try {
          message = JSON.parse(trimmed) as JsonRpcRequest;
        } catch {
          output.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Parse error'))}\n`);
          continue;
        }
        const response = await handleMcpJsonRpc(message, this.tools, this.context.appVersion());
        if (response) output.write(`${JSON.stringify(response)}\n`);
      }
      return true;
    } finally {
      this.stdioActive = false;
    }
  }

  async stop(): Promise<void> {
    const server = this.http;
    this.http = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const address = this.listening();
    const port = address?.port ?? LOCAL_AGENT_ACCESS_PORT;
    const fail = (status: number, message: string) => {
      response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
      response.end(JSON.stringify({ error: message }));
    };
    if (!this.context.enabled()) return fail(403, 'Local agent access is off.');
    if (!isLoopbackAddress(request.socket.remoteAddress)) return fail(403, 'Loopback clients only.');
    if (!isLoopbackHostHeader(request.headers.host, port)) return fail(403, 'Loopback Host required.');
    if (
      !isLoopbackOrigin(
        Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin,
      )
    )
      return fail(403, 'Loopback Origin required.');
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== LOCAL_MCP_PATH) return fail(404, 'Not found.');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        Allow: 'POST, OPTIONS',
        'Access-Control-Allow-Origin': 'http://127.0.0.1',
        'Access-Control-Allow-Headers': 'content-type, mcp-protocol-version, accept',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      });
      response.end();
      return;
    }
    if (request.method !== 'POST') return fail(405, 'POST JSON-RPC to /mcp.');
    try {
      const body = await readHttpBody(request, MAX_JSON_RPC_BYTES);
      const message = JSON.parse(body) as JsonRpcRequest;
      const payload = await handleMcpJsonRpc(message, this.tools, this.context.appVersion());
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'http://127.0.0.1',
      });
      response.end(payload ? JSON.stringify(payload) : '');
    } catch (error) {
      fail(400, error instanceof Error ? error.message : 'Invalid JSON-RPC request.');
    }
  }
}
