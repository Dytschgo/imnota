import fc from 'fast-check';
import type { ContentItem } from '../shared/content-items.js';
import { filenameSchema } from '../shared/schema.js';
import type { Collection, ProjectData, ScreenshotRecord } from '../shared/types.js';

/** Mirrors the validators' case- and normalization-insensitive alias key. */
export const portableKey = (value: string): string => value.normalize('NFC').toLowerCase();

/** Device names Windows resolves to a device regardless of folder or extension. */
export const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Names that can be created on every supported filesystem, for properties that write real files. */
export const portableName: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/)
  .filter((value) => !WINDOWS_RESERVED_NAME.test(value));

/** Any name the schema accepts, including spaces, Unicode and punctuation. */
export const schemaName: fc.Arbitrary<string> = fc.oneof(
  portableName,
  fc
    .string({ unit: 'grapheme', minLength: 1, maxLength: 16 })
    .filter((value) => filenameSchema.safeParse(value).success),
);

/** Markdown-like user text: line breaks, headings, CRs, astral characters and lone surrogates. */
export const userText: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: 'grapheme', maxLength: 40 }),
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc
    .array(
      fc.constantFrom(
        '# Heading',
        '## Picture 1 — spoof',
        'Picture 2 was intentionally excluded from this prompt bundle.',
        '',
        '\r',
        '   ',
        '- item',
        '```',
        '<script>alert(1)</script>',
        'plain words',
        '\u0000',
        '‮',
      ),
      { maxLength: 8 },
    )
    .chain((lines) => fc.constantFrom('\n', '\r\n', '\r').map((separator) => lines.join(separator))),
);

/** Well-formed Unicode only, for text that is written to disk as UTF-8 and read back. */
export const storedText: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: 'grapheme', maxLength: 40 }),
  fc.constantFrom('', '  ', '\n', '## problem\n\nKeep this.\n', 'line one\r\nline two'),
);

export const timestamp: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 4, arbitrary: fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }) },
    // A tiny pool makes equal creation times, and therefore ID tie-breaks, common.
    { weight: 1, arbitrary: fc.constantFrom(1_788_000_000_000, 1_788_000_000_001) },
  )
  .map((milliseconds) => new Date(milliseconds).toISOString());

export const recordId: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^[a-z]{1,8}_[0-9a-f]{1,8}$/),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 12 }),
);

/** IDs for which `localeCompare` is a strict total order (no ignorable or equivalent sequences). */
export const plainRecordId: fc.Arbitrary<string> = fc.stringMatching(/^[a-z]{1,8}_[0-9a-f]{1,8}$/);

const dimension = fc.integer({ min: 1, max: 16_384 });

interface ItemSeed {
  id: string;
  kind: 'screenshot' | 'drawing' | 'text';
  collectionIndex: number;
  stem: string;
  title: string;
  description: string;
  loosePosition: number;
  createdAt: string;
  updatedAt: string;
  priority: 'low' | 'medium' | 'high';
  width: number;
  height: number;
  includeInExport: boolean;
  conflict: boolean | undefined;
  preview: string | undefined;
}

export interface CurrentProjectOptions {
  version?: 3 | 4;
  names?: fc.Arbitrary<string>;
  ids?: fc.Arbitrary<string>;
  text?: fc.Arbitrary<string>;
  maxItems?: number;
}

/**
 * A complete, valid current project. Schema 3 keeps screenshots only and may repeat positions;
 * schema 4 mixes screenshots, drawings and text with unique positions.
 */
export function currentProject(options: CurrentProjectOptions = {}): fc.Arbitrary<ProjectData> {
  const names = options.names ?? schemaName;
  const text = options.text ?? userText;
  const maxItems = options.maxItems ?? 10;
  const seed: fc.Arbitrary<ItemSeed> = fc.record({
    id: options.ids ?? recordId,
    kind: fc.constantFrom('screenshot', 'screenshot', 'drawing', 'text'),
    collectionIndex: fc.nat(),
    stem: names,
    title: text,
    description: text,
    loosePosition: fc.nat(4),
    createdAt: timestamp,
    updatedAt: timestamp,
    priority: fc.constantFrom('low', 'medium', 'high'),
    width: dimension,
    height: dimension,
    includeInExport: fc.boolean(),
    conflict: fc.constantFrom(undefined, true, false),
    preview: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  });
  return fc
    .record({
      version: options.version ? fc.constant(options.version) : fc.constantFrom<3 | 4>(3, 4),
      collectionIds: fc.uniqueArray(names, { minLength: 1, maxLength: 4, selector: portableKey }),
      collectionNames: fc.array(fc.string({ minLength: 1, maxLength: 120 }), { minLength: 4, maxLength: 4 }),
      archived: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
      overallContext: text,
      seeds: fc.uniqueArray(seed, { maxLength: maxItems, selector: (entry) => entry.id }),
      positions: fc.uniqueArray(fc.nat(1000), { minLength: maxItems, maxLength: maxItems }),
      id: fc.string({ maxLength: 20 }),
      name: fc.string({ minLength: 1, maxLength: 40 }),
      description: text,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: fc.constantFrom<'active' | 'archived'>('active', 'archived'),
      favourite: fc.boolean(),
      icon: fc.constantFrom(undefined, 'rocket' as const, 'layers' as const),
      exportPreferences: fc.record({
        includeOriginalScreenshots: fc.boolean(),
        includeAnnotationMetadata: fc.boolean(),
        template: fc.constant('default' as const),
      }),
    })
    .map((value): ProjectData => {
      const collections: Collection[] = value.collectionIds.map((id, index) => ({
        id,
        name: value.collectionNames[index]!,
        archived: value.archived[index]!,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        overallContext: index === 0 ? value.overallContext : '',
      }));
      const screenshots: ScreenshotRecord[] = [];
      const contentItems: ContentItem[] = [];
      value.seeds.forEach((entry, index) => {
        if (value.version === 3 && entry.kind !== 'screenshot') return;
        const collectionId = collections[entry.collectionIndex % collections.length]!.id;
        // The index prefix keeps every stored path unique under case and normalization folding.
        const base = `${index}-${entry.stem}`;
        const position = value.version === 4 ? value.positions[index]! : entry.loosePosition;
        if (entry.kind === 'screenshot') {
          const storedFilename = `${base}.png`;
          screenshots.push({
            collectionId,
            id: entry.id,
            originalFilename: `${entry.stem}.png`,
            storedFilename,
            title: entry.title,
            description: entry.description,
            position,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            priority: entry.priority,
            annotationFile: `collections/${collectionId}/annotations/${storedFilename}.json`,
            descriptionFile: `collections/${collectionId}/descriptions/${storedFilename}.md`,
            originalWidth: entry.width,
            originalHeight: entry.height,
            includeInExport: entry.includeInExport,
            ...(entry.conflict === undefined ? {} : { conflict: entry.conflict }),
          });
          return;
        }
        const shared = {
          id: entry.id,
          collectionId,
          position,
          includeInExport: entry.includeInExport,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        };
        if (entry.kind === 'drawing')
          contentItems.push({
            ...shared,
            kind: 'drawing',
            title: entry.title,
            description: entry.description,
            sourceFilename: `${base}.json`,
            imageFilename: `${base}.png`,
            originalWidth: entry.width,
            originalHeight: entry.height,
          });
        else
          contentItems.push({
            ...shared,
            kind: 'text',
            markdownFilename: `${base}.md`,
            ...(entry.preview === undefined ? {} : { preview: entry.preview }),
          });
      });
      return {
        schemaVersion: value.version,
        collections,
        id: value.id,
        name: value.name,
        description: value.description,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        status: value.status,
        favourite: value.favourite,
        ...(value.icon ? { icon: value.icon } : {}),
        screenshots,
        ...(value.version === 4 ? { contentItems } : {}),
        exportPreferences: value.exportPreferences,
      };
    });
}

export interface LegacyFixture {
  /** Raw project.json content, before schema defaults are applied. */
  project: Record<string, unknown>;
  /** Legacy notes sidecar per screenshot ID; `null` means the file does not exist. */
  notes: Record<string, string | null>;
  /** Legacy annotation sidecar per screenshot ID; `null` means the file does not exist. */
  annotations: Record<string, string | null>;
  /** Screenshot bytes per screenshot ID. */
  images: Record<string, number[]>;
}

const LEGACY_DEFAULT_ROUND = '001-first-feedback';

/** A valid schema 1 or 2 project together with the legacy files its migration reads. */
export function legacyFixture(): fc.Arbitrary<LegacyFixture> {
  const shot = fc.record({
    id: recordId,
    roundIndex: fc.nat(),
    stem: portableName,
    title: fc.oneof(fc.constant(''), storedText),
    description: fc.option(storedText, { nil: undefined }),
    position: fc.nat(6),
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: fc.option(fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }), { nil: undefined }),
    priority: fc.constantFrom(undefined, 'low', 'medium', 'high', 'critical'),
    status: fc.constantFrom(undefined, 'draft', 'ready', 'needs-review', 'completed'),
    width: dimension,
    height: dimension,
    includeInExport: fc.constantFrom(undefined, true, false),
    notes: fc.option(storedText, { nil: null }),
    annotations: fc.constantFrom(null, '[]', '[{"id":"a","kind":"text","x":1,"y":2,"zIndex":0}]'),
    image: fc.array(fc.nat(255), { minLength: 1, maxLength: 16 }),
    windowsSeparators: fc.boolean(),
  });
  return fc
    .record({
      version: fc.constantFrom<1 | 2>(1, 2),
      // `undefined` exercises the schema defaults for a project written before rounds existed.
      roundIds: fc.option(
        fc.uniqueArray(portableName, { minLength: 1, maxLength: 3, selector: portableKey }),
        { nil: undefined },
      ),
      roundNames: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 3, maxLength: 3 }),
      roundCreatedAt: fc.oneof(fc.constant(''), timestamp),
      shots: fc.uniqueArray(shot, { maxLength: 5, selector: (entry) => entry.id }),
      id: fc.string({ maxLength: 20 }),
      name: fc.string({ minLength: 1, maxLength: 40 }),
      description: storedText,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: fc.constantFrom('active', 'archived'),
      favourite: fc.boolean(),
      exportPreferences: fc.option(
        fc.record({
          includeOriginalScreenshots: fc.boolean(),
          includeAnnotationMetadata: fc.boolean(),
          includedFields: fc.array(fc.string({ maxLength: 8 }), { maxLength: 2 }),
          overallInstructions: storedText,
          desiredOutcome: storedText,
          technicalConstraints: storedText,
          template: fc.constant('default'),
        }),
        { nil: undefined },
      ),
    })
    .map((value): LegacyFixture => {
      const notes: LegacyFixture['notes'] = {};
      const annotations: LegacyFixture['annotations'] = {};
      const images: LegacyFixture['images'] = {};
      const screenshots = value.shots.map((entry, index) => {
        const roundId = value.roundIds
          ? value.roundIds[entry.roundIndex % value.roundIds.length]!
          : LEGACY_DEFAULT_ROUND;
        const storedFilename = `${String(index).padStart(3, '0')}-${entry.stem}.png`;
        const separator = entry.windowsSeparators ? '\\' : '/';
        const [annotationFile, notesFile] =
          value.version === 1
            ? [`annotations/${storedFilename}.json`, `notes/${storedFilename}.md`]
            : [
                `rounds/${roundId}/annotations/${storedFilename}.json`,
                `rounds/${roundId}/notes/${storedFilename}.md`,
              ];
        notes[entry.id] = entry.notes;
        annotations[entry.id] = entry.annotations;
        images[entry.id] = entry.image;
        return {
          // Omitting the round relies on the same default the schema gives the round list.
          ...(value.roundIds ? { roundId } : {}),
          id: entry.id,
          originalFilename: `${entry.stem}.png`,
          storedFilename,
          title: entry.title,
          ...(entry.description === undefined ? {} : { description: entry.description }),
          position: entry.position,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          ...(entry.tags === undefined ? {} : { tags: entry.tags }),
          ...(entry.priority === undefined ? {} : { priority: entry.priority }),
          ...(entry.status === undefined ? {} : { status: entry.status }),
          annotationFile: annotationFile.replaceAll('/', separator),
          notesFile: notesFile.replaceAll('/', separator),
          originalWidth: entry.width,
          originalHeight: entry.height,
          ...(entry.includeInExport === undefined ? {} : { includeInExport: entry.includeInExport }),
        };
      });
      return {
        project: {
          schemaVersion: value.version,
          ...(value.roundIds
            ? {
                rounds: value.roundIds.map((id, index) => ({
                  id,
                  name: value.roundNames[index]!,
                  archived: index % 2 === 1,
                  createdAt: value.roundCreatedAt,
                })),
              }
            : {}),
          id: value.id,
          name: value.name,
          description: value.description,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          status: value.status,
          tags: [],
          favourite: value.favourite,
          screenshots,
          ...(value.exportPreferences ? { exportPreferences: value.exportPreferences } : {}),
        },
        notes,
        annotations,
        images,
      };
    });
}
