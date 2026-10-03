// @vitest-environment node
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { filenameSchema, screenshotSchema } from '../src/shared/schema.js';
import { isPathWithin } from '../src/shared/security.js';
import { WINDOWS_RESERVED_NAME } from '../src/test/project-arbitraries.js';
import { runs } from '../src/test/property.js';
import { contracts } from './ipc-contracts.js';
import { isWithin } from './files.js';

const accepts = (value: unknown) => filenameSchema.safeParse(value).success;

const anyText = fc.oneof(
  fc.string({ maxLength: 24 }),
  fc.string({ unit: 'grapheme', maxLength: 24 }),
  fc.string({ unit: 'binary', maxLength: 24 }),
);

/** Inserts `fragment` at an arbitrary offset of arbitrary surrounding text. */
const containing = (fragment: fc.Arbitrary<string>) =>
  fc
    .tuple(anyText, fragment, anyText)
    .map(([before, value, after]) => ({ text: `${before}${value}${after}`, fragment: value }));

const controlCharacter = fc.integer({ min: 0, max: 31 }).map((code) => String.fromCharCode(code));

const reservedName = fc
  .tuple(
    fc.constantFrom('CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'),
    fc.boolean(),
    fc.constantFrom('', '.txt', '.png', '.tar.gz'),
  )
  .map(([name, lower, extension]) => `${lower ? name.toLowerCase() : name}${extension}`);

describe('filename validation properties', () => {
  it('rejects every string that contains a path separator or a drive colon', () => {
    fc.assert(
      fc.property(containing(fc.constantFrom('/', '\\', ':')), ({ text }) => {
        expect(accepts(text)).toBe(false);
      }),
      runs(300),
    );
  });

  it('rejects traversal, drive, UNC and device-namespace shapes', () => {
    const hostile = fc.oneof(
      fc.constantFrom('.', '..', '', '../x', '..\\x', 'a/../b', '/etc/passwd', '~/x', './x'),
      fc.tuple(fc.constantFrom('C', 'd', 'Z'), anyText).map(([drive, rest]) => `${drive}:${rest}`),
      anyText.map((rest) => `\\\\server\\share\\${rest}`),
      anyText.map((rest) => `//server/share/${rest}`),
      anyText.map((rest) => `\\\\?\\${rest}`),
      anyText.map((rest) => `\\\\.\\${rest}`),
      fc
        .array(fc.constantFrom('..', '.', 'a', 'screenshots'), { minLength: 2, maxLength: 6 })
        .chain((parts) => fc.constantFrom('/', '\\').map((separator) => parts.join(separator))),
    );
    fc.assert(
      fc.property(hostile, (value) => {
        expect(accepts(value)).toBe(false);
      }),
      runs(300),
    );
  });

  it('rejects every string that contains a C0 control character', () => {
    fc.assert(
      fc.property(containing(controlCharacter), ({ text }) => {
        expect(accepts(text)).toBe(false);
      }),
      runs(300),
    );
  });

  it('rejects names that Windows would silently rename by trimming a trailing dot or space', () => {
    fc.assert(
      fc.property(anyText, fc.constantFrom('.', ' ', '. ', ' .', '...'), (stem, tail) => {
        expect(accepts(`${stem}${tail}`)).toBe(false);
      }),
      runs(200),
    );
  });

  it('rejects non-strings, the empty string and names longer than 255 code units', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.anything().filter((value) => typeof value !== 'string'),
          fc.string({ minLength: 256, maxLength: 400 }),
          fc.constant(''),
        ),
        (value) => {
          expect(accepts(value)).toBe(false);
        },
      ),
      runs(200),
    );
  });

  it('keeps every accepted name a single, unchanged path component on Windows and POSIX', () => {
    fc.assert(
      fc.property(anyText, (value) => {
        fc.pre(accepts(value));
        // Parsing returns the input itself: no trimming, normalization or case folding.
        expect(filenameSchema.parse(value)).toBe(value);
        for (const [flavour, root] of [
          [path.win32, 'C:\\workspace\\project'],
          [path.win32, '\\\\server\\share\\project'],
          [path.posix, '/workspace/project'],
        ] as const) {
          const joined = flavour.join(root, value);
          expect(flavour.basename(joined)).toBe(value);
          expect(flavour.dirname(joined)).toBe(root);
          expect(flavour.resolve(root, value)).toBe(joined);
          expect(flavour.relative(root, joined)).toBe(value);
          expect(flavour.isAbsolute(value)).toBe(false);
        }
        // The same name is still accepted after it has been stored and read back.
        expect(accepts(path.basename(path.join(process.cwd(), value)))).toBe(true);
      }),
      runs(500),
    );
  });

  // FINDING (not fixed here): `filenameSchema` accepts Windows reserved device names. On Windows
  // `collections\NUL\...` or a stored file called `CON.png` addresses a device, not a file, so a
  // write can vanish or fail. Identifiers the app generates itself never take this shape, but the
  // schema is also the IPC boundary for `collectionId`, export filenames and undo tokens, and the
  // validator for project.json content written by other tools.
  // Assert the known bug directly: unexpected setup/validation errors must fail this test.
  // Invert these acceptance expectations when the separately scoped product fix lands.
  it('records known acceptance of Windows reserved device names', () => {
    for (const value of ['NUL', 'CON.txt', 'COM1']) expect(accepts(value)).toBe(true);
  });

  it('records known acceptance of every Windows reserved device name, with or without an extension', () => {
    fc.assert(
      fc.property(reservedName, (value) => {
        expect(WINDOWS_RESERVED_NAME.test(value)).toBe(true);
        expect(accepts(value)).toBe(true);
      }),
      runs(50),
    );
  });

  // FINDING (not fixed here): only C0 controls are rejected. DEL and the C1 range pass, as do the
  // characters Windows forbids in names (`< > " | ? *`). Windows rejects such a write with an
  // error rather than corrupting data, so this is a portability gap, not data loss.
  it('records known acceptance of DEL, C1 controls and Windows-forbidden filename characters', () => {
    for (const value of ['a\u007fb', 'a\u0085b', 'a?b', 'a*b', 'a<b', 'a>b', 'a|b', 'a"b'])
      expect(accepts(value)).toBe(true);
  });

  it('applies the same rule to stored content references and IPC filename inputs', () => {
    const shot = {
      collectionId: 'c',
      id: 'shot',
      originalFilename: 'a.png',
      storedFilename: 'a.png',
      title: '',
      description: '',
      position: 0,
      createdAt: '',
      updatedAt: '',
      priority: 'medium',
      annotationFile: 'collections/c/annotations/a.png.json',
      descriptionFile: 'collections/c/descriptions/a.png.md',
      originalWidth: 1,
      originalHeight: 1,
    };
    expect(screenshotSchema.safeParse(shot).success).toBe(true);
    const undo = contracts['screenshots:undo-delete'];
    expect(undo.safeParse([{ projectPath: 'p', undoToken: 'token' }]).success).toBe(true);
    const hostile = fc.oneof(
      containing(fc.constantFrom('/', '\\', ':')).map(({ text }) => text),
      containing(controlCharacter).map(({ text }) => text),
      fc.constantFrom('.', '..', ''),
    );
    fc.assert(
      fc.property(hostile, fc.constantFrom('collectionId', 'storedFilename'), (value, field) => {
        expect(screenshotSchema.safeParse({ ...shot, [field]: value }).success).toBe(false);
        for (const reference of ['annotationFile', 'descriptionFile'] as const) {
          const folder = reference === 'annotationFile' ? 'annotations' : 'descriptions';
          for (const candidate of [
            `collections/${value}/${folder}/a.png.json`,
            `collections/c/${folder}/${value}`,
            `collections/c/${folder}/../${folder}/a.png.json`,
            `/collections/c/${folder}/a.png.json`,
            `collections\\c\\${folder}\\a.png.json`,
          ])
            expect(screenshotSchema.safeParse({ ...shot, [reference]: candidate }).success).toBe(false);
        }
        expect(undo.safeParse([{ projectPath: 'p', undoToken: value }]).success).toBe(false);
      }),
      runs(200),
    );
  });
});

/** Independent model of containment: normalize the component stack and compare prefixes. */
function modelWithin(parentParts: readonly string[], segments: readonly string[]): boolean {
  const stack = [...parentParts];
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  return parentParts.every((part, index) => stack[index] === part);
}

const windows = process.platform === 'win32';
const root = windows ? 'C:\\' : '/';
// Windows compares path components case-insensitively, so the model uses one case there.
const component = fc.oneof(
  fc.stringMatching(/^[a-z0-9_-]{1,8}$/),
  // Names that merely start with dots are ordinary children, a classic prefix-check mistake.
  fc.constantFrom('..hidden', '...', '..a', '.config', 'a..b', 'x.y'),
);
const segment = fc.oneof(
  { weight: 3, arbitrary: component },
  { weight: 2, arbitrary: fc.constant('..') },
  { weight: 1, arbitrary: fc.constant('.') },
);
const parentParts = fc.array(component, { minLength: 1, maxLength: 4 });

describe('path containment properties', () => {
  it('agrees with a component-stack model for arbitrary relative navigation', () => {
    fc.assert(
      fc.property(parentParts, fc.array(segment, { maxLength: 8 }), (parts, segments) => {
        const parent = path.join(root, ...parts);
        const target = [parent, ...segments].join(path.sep);
        const expected = modelWithin(parts, segments);
        expect(isWithin(parent, target)).toBe(expected);
        expect(isPathWithin(parent, target)).toBe(expected);
        // Trailing separators and redundant separators do not change the answer.
        expect(isWithin(`${parent}${path.sep}`, `${target}${path.sep}${path.sep}`)).toBe(expected);
      }),
      runs(500),
    );
  });

  it('contains itself and every descendant, and never an ancestor or sibling', () => {
    fc.assert(
      fc.property(
        parentParts,
        fc.array(component, { minLength: 1, maxLength: 4 }),
        component,
        (parts, children, suffix) => {
          const parent = path.join(root, ...parts);
          const child = path.join(parent, ...children);
          expect(isWithin(parent, parent)).toBe(true);
          expect(isWithin(parent, child)).toBe(true);
          expect(isWithin(child, parent)).toBe(false);
          expect(isWithin(parent, path.dirname(parent))).toBe(false);
          // A sibling whose name merely starts with the parent's name is not inside it.
          expect(isWithin(parent, `${parent}${suffix}`)).toBe(false);
          expect(isWithin(parent, path.join(`${parent}${suffix}`, ...children))).toBe(false);
        },
      ),
      runs(300),
    );
  });

  it('never accepts a target that climbs above the parent, however it is spelled', () => {
    fc.assert(
      fc.property(parentParts, fc.array(component, { maxLength: 3 }), fc.nat(3), (parts, tail, extra) => {
        const parent = path.join(root, ...parts);
        const climb = Array.from({ length: parts.length + extra }, () => '..');
        // Climbing to the root (or past it) and descending into a different tree.
        const elsewhere = ['outside-tree', ...tail];
        for (const separator of windows ? ['\\', '/'] : ['/'])
          expect(isWithin(parent, [parent, ...climb, ...elsewhere].join(separator))).toBe(false);
      }),
      runs(300),
    );
  });

  it.runIf(windows)('rejects other drives, UNC shares and device paths on Windows', () => {
    fc.assert(
      fc.property(parentParts, fc.array(component, { maxLength: 3 }), (parts, tail) => {
        const parent = path.join(root, ...parts);
        const rest = [...parts, ...tail].join('\\');
        for (const target of [
          `D:\\${rest}`,
          `\\\\server\\share\\${rest}`,
          `\\\\?\\D:\\${rest}`,
          `\\\\.\\pipe\\${rest}`,
          `D:${rest}`,
        ])
          expect(isWithin(parent, target)).toBe(false);
        // Windows paths are case-insensitive: a different spelling of a child is still inside.
        expect(isWithin(parent.toUpperCase(), path.join(parent, ...tail))).toBe(true);
      }),
      runs(200),
    );
  });

  it.runIf(!windows)('treats backslashes and drive letters as ordinary characters on POSIX', () => {
    fc.assert(
      fc.property(parentParts, component, (parts, name) => {
        const parent = path.join(root, ...parts);
        expect(isWithin(parent, path.join(parent, `..\\${name}`))).toBe(true);
        expect(isWithin(parent, path.join(parent, `C:\\${name}`))).toBe(true);
        expect(isWithin(parent, `/${name}-elsewhere/${parts.join('/')}`)).toBe(false);
      }),
      runs(100),
    );
  });
});
