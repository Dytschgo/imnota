import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type {
  ContentItem,
  ContentItemContent,
  ContentItemKind,
  SaveContentItemResult,
} from '../src/shared/content-items.js';
import type { ImagePayload, ProjectData, ProjectSnapshot } from '../src/shared/types.js';
import { filenameSchema, validateProject } from '../src/shared/schema.js';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';
import {
  screenshotTransactionBaseline,
  type ScreenshotTransactionOperations,
  type ScreenshotTransactionWrite,
} from './screenshot-transactions.js';
import {
  commitScreenshotFileTransaction,
  nextProjectMutationTimestamp,
} from './screenshot-transaction-adapter.js';
import {
  deleteContentItemToTrash,
  undoContentItemDelete,
  type ContentTrashOperations,
} from './content-trash.js';
import { contentItemRelativePaths } from './content-paths.js';

const MAX_PROJECT_BYTES = 20_000_000;
const MAX_MARKDOWN_BYTES = 2_000_000;
const MAX_DRAWING_SOURCE_BYTES = 20_000_000;
const MAX_DRAWING_PNG_BYTES = 100_000_000;
const MAX_DRAWING_PIXELS = 40_000_000;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

export const EMPTY_EXCALIDRAW_SOURCE = JSON.stringify(
  {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  },
  null,
  2,
);

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.byteLength);
  output.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(output, 4);
  Buffer.from(data).copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return output;
}

function whitePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = width * 4;
  const pixels = Buffer.alloc((rowBytes + 1) * height, 255);
  for (let row = 0; row < height; row++) pixels[row * (rowBytes + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Empty editor canvas: deterministic opaque white, then decoded again by Electron in production.
export const EMPTY_DRAWING_PNG = whitePng(160, 120);

export interface ContentPersistenceDependencies {
  snapshot(projectPath: string): Promise<ProjectSnapshot>;
  transactionOperations?: ScreenshotTransactionOperations;
  trashOperations?: ContentTrashOperations;
  trashItem(target: string): Promise<void>;
  randomId?: () => string;
  now?: () => Date;
  validatePng?: (png: Uint8Array, dimensions: { width: number; height: number }) => void;
}

interface ProjectBaseline {
  project: ProjectData;
  source: Buffer;
  revision: string;
}

function sha256(...values: Array<string | Uint8Array>): string {
  const hash = createHash('sha256');
  for (const value of values) hash.update(value).update('\0');
  return hash.digest('hex');
}

function projectRevision(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

function strictRelativePath(value: string): string {
  if (
    !value ||
    value.length > 1000 ||
    value.includes('\\') ||
    value.includes(':') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe content path: ${value}`);
  return value;
}

function resolveContentPath(projectPath: string, relativePath: string): string {
  const target = path.resolve(projectPath, ...strictRelativePath(relativePath).split('/'));
  if (target === path.resolve(projectPath) || !isWithin(projectPath, target))
    throw new Error('Content path leaves the project.');
  return target;
}

async function readOptionalBounded(target: string, maximum: number): Promise<Buffer | null> {
  await assertNoLinks(target);
  const stat = await fs.stat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile()) throw new Error(`Expected a regular content file: ${path.basename(target)}`);
  if (stat.size > maximum) throw new Error(`Content file is too large: ${path.basename(target)}`);
  const value = await fs.readFile(target);
  if (value.byteLength > maximum) throw new Error(`Content file is too large: ${path.basename(target)}`);
  return value;
}

async function readRequiredBounded(target: string, maximum: number): Promise<Buffer> {
  const value = await readOptionalBounded(target, maximum);
  if (!value) throw new Error(`Content file is missing: ${path.basename(target)}`);
  return value;
}

function pngDimensions(value: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (
    buffer.byteLength < 33 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('Drawing image is not a valid PNG.');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 16_384 || height > 16_384 || width * height > MAX_DRAWING_PIXELS)
    throw new Error('Drawing image dimensions are outside supported limits.');
  if (
    buffer[24] !== 8 ||
    ![0, 2, 3, 4, 6].includes(buffer[25]) ||
    buffer[26] !== 0 ||
    buffer[27] !== 0 ||
    ![0, 1].includes(buffer[28])
  )
    throw new Error('Drawing PNG uses unsupported encoding.');
  let offset = 8;
  let chunks = 0;
  let sawIdat = false;
  let sawIend = false;
  while (offset < buffer.byteLength) {
    if (offset + 12 > buffer.byteLength) throw new Error('Drawing PNG is truncated.');
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > buffer.byteLength)
      throw new Error('Drawing PNG contains a truncated chunk.');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(buffer.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) throw new Error(`Drawing PNG ${type} chunk failed CRC validation.`);
    chunks += 1;
    if (chunks > 10_000) throw new Error('Drawing PNG contains too many chunks.');
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (length !== 0 || end !== buffer.byteLength) throw new Error('Drawing PNG has an invalid ending.');
      sawIend = true;
    }
    offset = end;
  }
  if (!sawIdat || !sawIend) throw new Error('Drawing PNG is incomplete.');
  return { width, height };
}

function parsePngPayload(image: ImagePayload, expectedFilename: string): Buffer {
  filenameSchema.parse(image.filename);
  if (image.filename !== expectedFilename) throw new Error('Drawing image filename does not match its item.');
  const match = PNG_DATA_URL.exec(image.dataUrl);
  if (!match) throw new Error('Drawing image must be a base64 PNG data URL.');
  const value = Buffer.from(match[1], 'base64');
  if (value.byteLength > MAX_DRAWING_PNG_BYTES) throw new Error('Drawing PNG is too large.');
  const dimensions = pngDimensions(value);
  if (image.width !== dimensions.width || image.height !== dimensions.height)
    throw new Error('Drawing image dimensions do not match the PNG bytes.');
  return value;
}

function validateDrawingSource(source: string): void {
  if (Buffer.byteLength(source, 'utf8') > MAX_DRAWING_SOURCE_BYTES)
    throw new Error('Drawing source is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Drawing source is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Drawing source must be an Excalidraw scene.');
  const scene = parsed as Record<string, unknown>;
  if (
    scene.type !== 'excalidraw' ||
    !Number.isInteger(scene.version) ||
    !Array.isArray(scene.elements) ||
    !scene.appState ||
    typeof scene.appState !== 'object' ||
    !scene.files ||
    typeof scene.files !== 'object'
  )
    throw new Error('Drawing source must be a genuine Excalidraw-compatible scene.');
  if (scene.elements.length > 100_000) throw new Error('Drawing contains too many elements.');
  if (Object.keys(scene.files as Record<string, unknown>).length)
    throw new Error('Drawing embeds and external files are not supported.');
  const allowedTypes = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text']);
  const ids = new Set<string>();
  const referencedElementIds: string[] = [];
  let totalPoints = 0;
  const finiteGeometry = (value: unknown, allowNegative = true) =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= 10_000_000 &&
    (allowNegative || value >= 0);
  for (const raw of scene.elements) {
    if (!raw || typeof raw !== 'object') throw new Error('Drawing contains an invalid element.');
    const element = raw as Record<string, unknown>;
    if (
      typeof element.id !== 'string' ||
      !element.id ||
      element.id.length > 200 ||
      ids.has(element.id) ||
      typeof element.type !== 'string' ||
      !allowedTypes.has(element.type) ||
      !finiteGeometry(element.x) ||
      !finiteGeometry(element.y) ||
      !finiteGeometry(element.width, false) ||
      !finiteGeometry(element.height, false) ||
      !Number.isInteger(element.version) ||
      (element.version as number) < 1
    )
      throw new Error('Drawing contains an invalid Excalidraw element.');
    ids.add(element.id);
    if (element.link !== undefined && element.link !== null && element.link !== '')
      throw new Error('Drawing element links are not supported.');
    if (element.fileId !== undefined && element.fileId !== null)
      throw new Error('Drawing file elements are not supported.');
    if (element.angle !== undefined && !finiteGeometry(element.angle))
      throw new Error('Drawing contains a non-finite angle.');
    if (element.points !== undefined) {
      if (!Array.isArray(element.points) || element.points.length > 200_000)
        throw new Error('Drawing element points are invalid.');
      totalPoints += element.points.length;
      if (
        totalPoints > 400_000 ||
        element.points.some(
          (point) =>
            !Array.isArray(point) ||
            point.length !== 2 ||
            !finiteGeometry(point[0]) ||
            !finiteGeometry(point[1]),
        )
      )
        throw new Error('Drawing element points are outside supported limits.');
    }
    if (
      element.groupIds !== undefined &&
      (!Array.isArray(element.groupIds) ||
        element.groupIds.length > 100 ||
        element.groupIds.some((id) => typeof id !== 'string' || !id || id.length > 200))
    )
      throw new Error('Drawing group references are invalid.');
    for (const key of ['startBinding', 'endBinding'] as const) {
      const binding = element[key];
      if (
        binding !== undefined &&
        binding !== null &&
        (typeof binding !== 'object' ||
          typeof (binding as Record<string, unknown>).elementId !== 'string' ||
          !(binding as Record<string, unknown>).elementId)
      )
        throw new Error('Drawing connector binding is invalid.');
      if (binding && typeof binding === 'object')
        referencedElementIds.push((binding as Record<string, unknown>).elementId as string);
    }
    if (
      element.boundElements !== undefined &&
      element.boundElements !== null &&
      (!Array.isArray(element.boundElements) ||
        element.boundElements.length > 10_000 ||
        element.boundElements.some(
          (binding) =>
            !binding ||
            typeof binding !== 'object' ||
            typeof (binding as Record<string, unknown>).id !== 'string',
        ))
    )
      throw new Error('Drawing bound-element references are invalid.');
    if (Array.isArray(element.boundElements))
      for (const binding of element.boundElements)
        referencedElementIds.push((binding as Record<string, unknown>).id as string);
    if (element.text !== undefined && (typeof element.text !== 'string' || element.text.length > 2_000_000))
      throw new Error('Drawing text is invalid.');
  }
  if (referencedElementIds.some((id) => !ids.has(id)))
    throw new Error('Drawing contains a dangling element binding.');
}

function textPreview(markdown: string): string | undefined {
  const firstLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, 500);
}

function nextTimestamp(project: ProjectData, now: Date): string {
  return nextProjectMutationTimestamp(project.updatedAt, now);
}

function withMixedInsertion(project: ProjectData, item: ContentItem, afterItemId?: string): ProjectData {
  const existing = [
    ...project.screenshots.filter((entry) => entry.collectionId === item.collectionId),
    ...(project.contentItems ?? []).filter((entry) => entry.collectionId === item.collectionId),
  ].sort(
    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  let insertion = existing.length;
  if (afterItemId) {
    const index = existing.findIndex((entry) => entry.id === afterItemId);
    if (index < 0) throw new Error('The requested insertion item is not in this collection.');
    insertion = index + 1;
  }
  existing.splice(insertion, 0, item);
  const positions = new Map(existing.map((entry, position) => [entry.id, position]));
  return validateProject({
    ...project,
    schemaVersion: 4,
    screenshots: project.screenshots.map((entry) =>
      entry.collectionId === item.collectionId ? { ...entry, position: positions.get(entry.id)! } : entry,
    ),
    contentItems: [...(project.contentItems ?? []), item].map((entry) =>
      entry.collectionId === item.collectionId ? { ...entry, position: positions.get(entry.id)! } : entry,
    ),
  });
}

function withWarning(snapshot: ProjectSnapshot, warning?: string): ProjectSnapshot {
  if (!warning) return snapshot;
  return { ...snapshot, warnings: [...(snapshot.warnings ?? []), warning] };
}

export class ContentPersistenceService {
  private readonly randomId: () => string;
  private readonly now: () => Date;

  constructor(private readonly dependencies: ContentPersistenceDependencies) {
    this.randomId = dependencies.randomId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  private async baseline(projectPath: string): Promise<ProjectBaseline> {
    const root = path.resolve(projectPath);
    if (root === path.parse(root).root) throw new Error('A filesystem root cannot be a project.');
    await assertNoLinks(root);
    const rootStat = await fs.stat(root).catch(() => null);
    if (!rootStat?.isDirectory()) throw new Error('The project directory is unavailable.');
    const metadataPath = path.join(root, 'project.json');
    const source = await readRequiredBounded(metadataPath, MAX_PROJECT_BYTES);
    const project = validateProject(JSON.parse(source.toString('utf8')));
    return { project, source, revision: projectRevision(source) };
  }

  private async assertBaseline(projectPath: string, baseline: ProjectBaseline): Promise<void> {
    const source = await readRequiredBounded(path.join(projectPath, 'project.json'), MAX_PROJECT_BYTES);
    if (projectRevision(source) !== baseline.revision)
      throw new Error('The project changed while content was being saved. Reload it and try again.');
  }

  private async commit(
    projectPath: string,
    kind: 'content-create' | 'content-save' | 'content-conflict' | 'content-duplicate',
    baseline: ProjectBaseline,
    writes: ScreenshotTransactionWrite[],
    assertContent?: () => Promise<void>,
  ): Promise<string | undefined> {
    const result = await commitScreenshotFileTransaction(projectPath, {
      kind,
      writes,
      assertBaseline: async () => {
        await this.assertBaseline(projectPath, baseline);
        await assertContent?.();
      },
      operations: this.dependencies.transactionOperations ?? {
        write: atomicWrite,
        unlink: (target) => fs.unlink(target),
        removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
      },
    });
    return result.warning;
  }

  async create(input: {
    projectPath: string;
    collectionId: string;
    kind: ContentItemKind;
    afterItemId?: string;
  }): Promise<ProjectSnapshot> {
    filenameSchema.parse(input.collectionId);
    const baseline = await this.baseline(input.projectPath);
    const collection = baseline.project.collections.find((entry) => entry.id === input.collectionId);
    if (!collection || collection.archived)
      throw new Error('Choose a current collection before adding content.');
    const identifier = `${input.kind}_${this.randomId()}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(identifier) || identifier.length > 200)
      throw new Error('Could not create a safe content identifier.');
    const timestamp = nextTimestamp(baseline.project, this.now());
    let item: ContentItem;
    let contentWrites: ScreenshotTransactionWrite[];
    if (input.kind === 'drawing') {
      const drawingNumber =
        (baseline.project.contentItems ?? []).filter(
          (entry) => entry.collectionId === collection.id && entry.kind === 'drawing',
        ).length + 1;
      item = {
        id: identifier,
        collectionId: collection.id,
        kind: 'drawing',
        position: 0,
        includeInExport: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        title: `Drawing ${drawingNumber}`,
        sourceFilename: `${identifier}.json`,
        imageFilename: `${identifier}.png`,
        originalWidth: 160,
        originalHeight: 120,
      };
      const paths = contentItemRelativePaths(item);
      this.dependencies.validatePng?.(EMPTY_DRAWING_PNG, { width: 160, height: 120 });
      contentWrites = [
        {
          relativePath: paths.source!,
          after: Buffer.from(EMPTY_EXCALIDRAW_SOURCE),
          expectedBefore: screenshotTransactionBaseline(null),
        },
        {
          relativePath: paths.image!,
          after: EMPTY_DRAWING_PNG,
          expectedBefore: screenshotTransactionBaseline(null),
        },
      ];
    } else {
      item = {
        id: identifier,
        collectionId: collection.id,
        kind: 'text',
        position: 0,
        includeInExport: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        markdownFilename: `${identifier}.md`,
      };
      contentWrites = [
        {
          relativePath: contentItemRelativePaths(item).markdown!,
          after: Buffer.alloc(0),
          expectedBefore: screenshotTransactionBaseline(null),
        },
      ];
    }
    if (
      baseline.project.screenshots.some((entry) => entry.id === item.id) ||
      (baseline.project.contentItems ?? []).some((entry) => entry.id === item.id)
    )
      throw new Error('Content identifier collision. Try again.');
    const next = withMixedInsertion({ ...baseline.project, updatedAt: timestamp }, item, input.afterItemId);
    const projectAfter = Buffer.from(JSON.stringify(next, null, 2));
    const backupPath = 'project.v3.backup.json';
    const writes = [...contentWrites];
    if (baseline.project.schemaVersion === 3) {
      const existingBackup = await readOptionalBounded(
        path.join(input.projectPath, backupPath),
        MAX_PROJECT_BYTES,
      );
      if (existingBackup) {
        const backupProject = validateProject(JSON.parse(existingBackup.toString('utf8')));
        if (backupProject.schemaVersion !== 3 || backupProject.id !== baseline.project.id)
          throw new Error('Existing version 3 backup does not belong to this project.');
        if (!existingBackup.equals(baseline.source))
          throw new Error(
            'Existing version 3 backup differs from the current project. Preserve or rename the backup before upgrading.',
          );
      } else {
        writes.push({
          relativePath: backupPath,
          after: baseline.source,
          expectedBefore: screenshotTransactionBaseline(null),
        });
      }
    }
    writes.push({
      relativePath: 'project.json',
      after: projectAfter,
      expectedBefore: screenshotTransactionBaseline(baseline.source),
    });
    const warning = await this.commit(input.projectPath, 'content-create', baseline, writes);
    return withWarning(await this.dependencies.snapshot(input.projectPath), warning);
  }

  private async readItemFiles(
    projectPath: string,
    item: ContentItem,
  ): Promise<{
    source?: Buffer;
    image?: Buffer;
    markdown?: Buffer;
    revision: string;
  }> {
    const paths = contentItemRelativePaths(item);
    if (item.kind === 'drawing') {
      const [source, image] = await Promise.all([
        readRequiredBounded(resolveContentPath(projectPath, paths.source!), MAX_DRAWING_SOURCE_BYTES),
        readRequiredBounded(resolveContentPath(projectPath, paths.image!), MAX_DRAWING_PNG_BYTES),
      ]);
      validateDrawingSource(source.toString('utf8'));
      const dimensions = pngDimensions(image);
      this.dependencies.validatePng?.(image, dimensions);
      if (dimensions.width !== item.originalWidth || dimensions.height !== item.originalHeight)
        throw new Error('Drawing PNG dimensions do not match project metadata.');
      return { source, image, revision: sha256('drawing', source, image) };
    }
    const markdown = await readRequiredBounded(
      resolveContentPath(projectPath, paths.markdown!),
      MAX_MARKDOWN_BYTES,
    );
    return { markdown, revision: sha256('text', markdown) };
  }

  async load(input: { projectPath: string; itemId: string }): Promise<ContentItemContent> {
    const baseline = await this.baseline(input.projectPath);
    const item = (baseline.project.contentItems ?? []).find((entry) => entry.id === input.itemId);
    if (!item) throw new Error('Content item does not belong to this project.');
    const files = await this.readItemFiles(input.projectPath, item);
    await this.assertBaseline(input.projectPath, baseline);
    if (item.kind === 'drawing') {
      return {
        item,
        source: files.source!.toString('utf8'),
        image: {
          filename: item.imageFilename,
          dataUrl: `data:image/png;base64,${files.image!.toString('base64')}`,
          width: item.originalWidth,
          height: item.originalHeight,
        },
        contentRevision: files.revision,
      };
    }
    return {
      item,
      markdown: files.markdown!.toString('utf8'),
      contentRevision: files.revision,
    };
  }

  private preparedContent(
    item: ContentItem,
    input: { markdown?: string; source?: string; image?: ImagePayload },
  ): { source?: Buffer; image?: Buffer; markdown?: Buffer; width?: number; height?: number } {
    if (item.kind === 'drawing') {
      if (input.markdown !== undefined || input.source === undefined || input.image === undefined)
        throw new Error('Drawing saves require source and PNG together.');
      validateDrawingSource(input.source);
      const image = parsePngPayload(input.image, item.imageFilename);
      return {
        source: Buffer.from(input.source),
        image,
        width: input.image.width,
        height: input.image.height,
      };
    }
    if (input.source !== undefined || input.image !== undefined || input.markdown === undefined)
      throw new Error('Text saves require Markdown only.');
    if (Buffer.byteLength(input.markdown, 'utf8') > MAX_MARKDOWN_BYTES)
      throw new Error('Text block is too large.');
    return { markdown: Buffer.from(input.markdown) };
  }

  async save(input: {
    projectPath: string;
    itemId: string;
    contentRevision: string;
    markdown?: string;
    source?: string;
    image?: ImagePayload;
  }): Promise<SaveContentItemResult> {
    if (!/^[a-f0-9]{64}$/.test(input.contentRevision)) throw new Error('Invalid content revision.');
    const baseline = await this.baseline(input.projectPath);
    const trusted = (baseline.project.contentItems ?? []).find((entry) => entry.id === input.itemId);
    if (!trusted) throw new Error('Content item does not belong to this project.');
    const prepared = this.preparedContent(trusted, input);
    if (prepared.image)
      this.dependencies.validatePng?.(prepared.image, {
        width: prepared.width!,
        height: prepared.height!,
      });
    const current = await this.readItemFiles(input.projectPath, trusted);
    const conflict = current.revision !== input.contentRevision;
    const timestamp = nextTimestamp(baseline.project, this.now());
    let savedItem: ContentItem;
    let next: ProjectData;
    let writes: ScreenshotTransactionWrite[];
    if (conflict) {
      const identifier = `${trusted.kind}_${this.randomId()}`;
      if (!/^[a-zA-Z0-9_-]+$/.test(identifier) || identifier.length > 200)
        throw new Error('Could not create a safe conflict identifier.');
      savedItem =
        trusted.kind === 'drawing'
          ? {
              ...trusted,
              id: identifier,
              title: `${trusted.title} — Copy conflict`,
              sourceFilename: `${identifier}.json`,
              imageFilename: `${identifier}.png`,
              originalWidth: prepared.width!,
              originalHeight: prepared.height!,
              includeInExport: false,
              createdAt: timestamp,
              updatedAt: timestamp,
            }
          : {
              ...trusted,
              id: identifier,
              markdownFilename: `${identifier}.md`,
              preview: textPreview(input.markdown!),
              includeInExport: false,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
      next = withMixedInsertion({ ...baseline.project, updatedAt: timestamp }, savedItem);
      const paths = contentItemRelativePaths(savedItem);
      writes =
        savedItem.kind === 'drawing'
          ? [
              {
                relativePath: paths.source!,
                after: prepared.source!,
                expectedBefore: screenshotTransactionBaseline(null),
              },
              {
                relativePath: paths.image!,
                after: prepared.image!,
                expectedBefore: screenshotTransactionBaseline(null),
              },
            ]
          : [
              {
                relativePath: paths.markdown!,
                after: prepared.markdown!,
                expectedBefore: screenshotTransactionBaseline(null),
              },
            ];
    } else {
      savedItem =
        trusted.kind === 'drawing'
          ? {
              ...trusted,
              originalWidth: prepared.width!,
              originalHeight: prepared.height!,
              updatedAt: timestamp,
            }
          : { ...trusted, preview: textPreview(input.markdown!), updatedAt: timestamp };
      next = validateProject({
        ...baseline.project,
        updatedAt: timestamp,
        contentItems: (baseline.project.contentItems ?? []).map((entry) =>
          entry.id === trusted.id ? savedItem : entry,
        ),
      });
      const paths = contentItemRelativePaths(trusted);
      writes =
        trusted.kind === 'drawing'
          ? [
              {
                relativePath: paths.source!,
                after: prepared.source!,
                expectedBefore: screenshotTransactionBaseline(current.source!),
              },
              {
                relativePath: paths.image!,
                after: prepared.image!,
                expectedBefore: screenshotTransactionBaseline(current.image!),
              },
            ]
          : [
              {
                relativePath: paths.markdown!,
                after: prepared.markdown!,
                expectedBefore: screenshotTransactionBaseline(current.markdown!),
              },
            ];
    }
    const projectAfter = Buffer.from(JSON.stringify(next, null, 2));
    writes.push({
      relativePath: 'project.json',
      after: projectAfter,
      expectedBefore: screenshotTransactionBaseline(baseline.source),
    });
    const warning = await this.commit(
      input.projectPath,
      conflict ? 'content-conflict' : 'content-save',
      baseline,
      writes,
      async () => {
        const fresh = await this.readItemFiles(input.projectPath, trusted);
        if (fresh.revision !== current.revision)
          throw new Error('Content changed while the save was prepared. Reload it and try again.');
      },
    );
    const revision =
      savedItem.kind === 'drawing'
        ? sha256('drawing', prepared.source!, prepared.image!)
        : sha256('text', prepared.markdown!);
    return {
      snapshot: withWarning(await this.dependencies.snapshot(input.projectPath), warning),
      itemId: savedItem.id,
      contentRevision: revision,
      conflictCreated: conflict,
    };
  }

  async duplicate(input: { projectPath: string; itemId: string }): Promise<ProjectSnapshot> {
    const baseline = await this.baseline(input.projectPath);
    const source = (baseline.project.contentItems ?? []).find((entry) => entry.id === input.itemId);
    if (!source) throw new Error('Content item does not belong to this project.');
    const files = await this.readItemFiles(input.projectPath, source);
    const identifier = `${source.kind}_${this.randomId()}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(identifier) || identifier.length > 200)
      throw new Error('Could not create a safe duplicate identifier.');
    const timestamp = nextTimestamp(baseline.project, this.now());
    const duplicate: ContentItem =
      source.kind === 'drawing'
        ? {
            ...source,
            id: identifier,
            title: `${source.title} copy`,
            sourceFilename: `${identifier}.json`,
            imageFilename: `${identifier}.png`,
            includeInExport: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          }
        : {
            ...source,
            id: identifier,
            markdownFilename: `${identifier}.md`,
            includeInExport: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
    const next = withMixedInsertion({ ...baseline.project, updatedAt: timestamp }, duplicate, source.id);
    const paths = contentItemRelativePaths(duplicate);
    const writes: ScreenshotTransactionWrite[] =
      duplicate.kind === 'drawing'
        ? [
            {
              relativePath: paths.source!,
              after: files.source!,
              expectedBefore: screenshotTransactionBaseline(null),
            },
            {
              relativePath: paths.image!,
              after: files.image!,
              expectedBefore: screenshotTransactionBaseline(null),
            },
          ]
        : [
            {
              relativePath: paths.markdown!,
              after: files.markdown!,
              expectedBefore: screenshotTransactionBaseline(null),
            },
          ];
    writes.push({
      relativePath: 'project.json',
      after: Buffer.from(JSON.stringify(next, null, 2)),
      expectedBefore: screenshotTransactionBaseline(baseline.source),
    });
    const warning = await this.commit(input.projectPath, 'content-duplicate', baseline, writes, async () => {
      if ((await this.readItemFiles(input.projectPath, source)).revision !== files.revision)
        throw new Error('Content changed while duplication was prepared. Reload it and try again.');
    });
    return withWarning(await this.dependencies.snapshot(input.projectPath), warning);
  }

  async delete(input: {
    projectPath: string;
    itemId: string;
  }): Promise<{ snapshot: ProjectSnapshot; undoToken: string }> {
    const baseline = await this.baseline(input.projectPath);
    const result = await deleteContentItemToTrash(
      input.projectPath,
      baseline.project,
      input.itemId,
      this.dependencies.trashItem,
      this.dependencies.trashOperations,
    );
    return {
      snapshot: withWarning(await this.dependencies.snapshot(input.projectPath), result.warning),
      undoToken: result.undoToken,
    };
  }

  async undoDelete(input: { projectPath: string; undoToken: string }): Promise<ProjectSnapshot> {
    const baseline = await this.baseline(input.projectPath);
    const result = await undoContentItemDelete(
      input.projectPath,
      baseline.project,
      input.undoToken,
      this.dependencies.trashOperations,
    );
    return withWarning(await this.dependencies.snapshot(input.projectPath), result.warning);
  }
}
