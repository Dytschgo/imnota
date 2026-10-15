// @vitest-environment node
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const bypasses = [
  ['aliased helper', "const capture = driver.capture.bind(driver); capture(dir, 'unsafe.png');"],
  ['destructured helper', "const { capture } = driver; capture(dir, 'unsafe.png');"],
  ['aliased driver', "const alias = driver; alias.capture(dir, 'unsafe.png');"],
  ['computed member', "driver['capture'](dir, 'unsafe.png');"],
  ['dynamic member', "const method = 'capture'; driver[method](dir, 'unsafe.png');"],
  ['void requirement', "driver.capture(dir, 'unsafe.png', void 0);"],
  ['arbitrary requirement', "driver.capture(dir, 'unsafe.png', 'anything');"],
  ['empty expectation', "driver.capture(dir, 'unsafe.png', {});"],
  ['partial expectation', "driver.capture(dir, 'unsafe.png', { id: 'shot' });"],
  [
    'wrong dimensions',
    "driver.capture(dir, 'unsafe.png', { id: 'shot', originalWidth: 'wide', originalHeight: 10 });",
  ],
  ['unapproved canvas-free capture', "driver.capture(dir, 'unsafe.png', 'none');"],
] as const;

const accepted = [
  "driver.capture(dir, 'safe.png', screenshot);",
  "driver.capture(dir, 'safe.png', { id: 'shot', originalWidth: 10, originalHeight: 20 });",
  "driver.capture(dir, 'safe.png', 'annotation-canvas');",
  "driver.capture(dir, '1280x800-onboarding-intro.png', 'none');",
] as const;
const rejected = [
  ...bypasses.map(([, source]) => source),
  "driver.capture(dir, 'unsafe.png');",
  "driver.capture(dir, 'unsafe.png', undefined);",
  "driver.capture(dir, 'unsafe.png', null);",
  "driver.capture(dir, 'unsafe.png', false);",
  "driver.capture(dir, 'unsafe.png', {} as any);",
  "const requirement: SmokeScreenshotCanvas | 'none' = Math.random() ? screenshot : 'none'; driver.capture(dir, 'unsafe.png', requirement);",
  "driver.capture(dir, '1280x800-onboarding-intro.png');",
];
const moduleCases = [
  ['capture-smoke.ts', "driver.capture(dir, 'capture-countdown.png', 'none');", true],
  ['capture-smoke.ts', "driver.capture(dir, 'capture-annotation-synthetic.png', 'none');", false],
  ['backup-smoke.ts', "driver.capture(dir, 'next-in-place-restored.png', 'none');", false],
  ['ui-feedback-smoke.ts', "driver.capture(dir, 'feedback-annotation-target.png', 'none');", false],
  [
    'next-features-smoke.ts',
    "const filename: string = String('next-template-project.png'); driver.capture(dir, filename, 'none');",
    false,
  ],
  [
    'next-features-smoke.ts',
    "const filename = Math.random() ? 'next-template-project.png' : 'next-template-picker.png'; driver.capture(dir, filename, 'none');",
    true,
  ],
  [
    'next-features-smoke.ts',
    "const filename = Math.random() ? 'next-template-project.png' : 'unsafe.png'; driver.capture(dir, filename, 'none');",
    false,
  ],
  ['mixed-content-smoke.ts', "driver.capture(dir, 'mixed-content-drawing.png', 'none');", true],
] as const;
const smokePaths = (await fs.readdir(new URL('.', import.meta.url)))
  .filter(
    (filename) => filename.includes('smoke') && filename.endsWith('.ts') && !filename.endsWith('.test.ts'),
  )
  .sort()
  .map((filename) => fileURLToPath(new URL(filename, import.meta.url)).replaceAll('\\', '/'));
const fixturesPath = fileURLToPath(new URL('./capture-guard-fixtures.ts', import.meta.url)).replaceAll(
  '\\',
  '/',
);
const fixtures = `
  import type { NativeUiDriver, SmokeScreenshotCanvas } from './smoke-native-driver.js';
  ${[...rejected, ...accepted, ...moduleCases.map(([, source]) => source)]
    .map(
      (source, index) => `
    async function fixture${index}(driver: NativeUiDriver, dir: string, screenshot: SmokeScreenshotCanvas) {
      ${source}
    }
  `,
    )
    .join('\n')}
`;
const options: ts.CompilerOptions = {
  strict: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
};
const host = ts.createCompilerHost(options);
const readSource = host.getSourceFile.bind(host);
host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) =>
  filename === fixturesPath
    ? ts.createSourceFile(filename, fixtures, languageVersion, true)
    : readSource(filename, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram([...smokePaths, fixturesPath], options, host);
const checker = program.getTypeChecker();
const fixtureFunctions = program.getSourceFile(fixturesPath)!.statements.filter(ts.isFunctionDeclaration);

// Only these screens may enter capture without a screenshot annotation canvas.
// Literal unions in capture helpers are checked member by member, never by the
// generic parameter name (for example, `filename`).
const canvasFreeByModule = new Map<string, Set<string>>([
  [
    'smoke-workflow.ts',
    new Set([
      // Settings replace the canvas; intro/copy/What's new never display one.
      '1280x800-onboarding-intro.png',
      '1280x800-onboarding-copy.png',
      '1280x800-whats-new.png',
      '1440x900-settings.png',
      '`${viewport.width}x${viewport.height}-settings-features.png`',
      '`${viewport.width}x${viewport.height}-settings-workspace.png`',
      '`backdrop-${preset}-settings.png`',
      'backdrop-settings.png',
      'sharing-settings.png',
    ]),
  ],
  [
    'backup-smoke.ts',
    new Set([
      'next-local-history.png', // Backups & history settings.
      'next-restored-project.png', // Restored mixed fixture opens its first item: Markdown.
    ]),
  ],
  [
    'capture-smoke.ts',
    new Set([
      'capture-countdown.png', // Separate countdown window.
      'capture-overlay-synthetic.png', // Region-selection overlay, not the annotation editor.
      'capture-cross-display-synthetic.png', // Cross-display region-selection overlay.
    ]),
  ],
  [
    'mixed-content-smoke.ts',
    new Set([
      'mixed-content-drawing.png', // Excalidraw is not the screenshot annotation canvas.
      'mixed-content-text.png', // Markdown preview.
      'recently-deleted-three-kinds.png', // Dialog after all three items are deleted.
      'recently-deleted-restored.png', // Dialog after restoring Markdown last.
      'recently-deleted-list-error.png', // Dialog over the reopened Markdown editor.
    ]),
  ],
  [
    'next-features-smoke.ts',
    new Set([
      'next-template-picker.png', // New-project dialog over the library.
      'next-clipboard-fallbacks.png', // Sharing dialog over a Markdown template.
      'next-template-project.png', // Markdown template editor.
      'next-content-search.png', // Project library search.
      'next-history-light.png', // Backups & history settings.
      'next-history-detail-light.png', // Selected snapshot in settings.
      'next-search-light.png', // Project library search.
      'next-templates-light.png', // New-project dialog over the library.
      'next-clipboard-light.png', // Sharing dialog over a Markdown template.
    ]),
  ],
  [
    'ui-feedback-smoke.ts',
    new Set([
      'feedback-generated-collection-name.png', // Collection picker in an empty project.
      'feedback-quick-collections-restored.png', // Empty collection after archive/restore.
      '1080x800-feedback-template-collection-picker.png', // Picker over a Markdown template.
      '1080x800-feedback-paste-error.png', // Clipboard error over a Markdown template.
      'feedback-search.png', // Search dialog over a Markdown template.
      'feedback-projects.png', // Project library.
      'feedback-project-delete-confirm.png', // Confirmation dialog over the library.
      'workspace-local-diagnostics.png', // Workspace settings.
      'agent-access-setup-prompt.png', // Features settings.
      '900x800-110pct-feedback-agent-access.png', // Features settings at 110% zoom.
      'feedback-dark-backdrop.png', // Appearance settings.
      'feedback-light-backdrop.png', // Appearance settings.
    ]),
  ],
]);

function filenameKeys(expression: ts.Expression | undefined): string[] {
  if (!expression) return [];
  if (ts.isTemplateExpression(expression)) return [expression.getText()];
  const type = checker.getTypeAtLocation(expression);
  const members = type.isUnion() ? type.types : [type];
  const literals = members.filter((member): member is ts.StringLiteralType => member.isStringLiteral());
  return literals.length === members.length ? literals.map((member) => member.value) : [];
}

function isDriver(type: ts.Type) {
  return type
    .getProperty('capture')
    ?.declarations?.some((declaration) =>
      declaration.getSourceFile().fileName.replaceAll('\\', '/').endsWith('/smoke-native-driver.ts'),
    );
}

function inspectCaptures(root: ts.Node, moduleName = path.basename(root.getSourceFile().fileName)) {
  const source = root.getSourceFile();
  const canvasFree = canvasFreeByModule.get(moduleName) ?? new Set<string>();
  // Capture smoke also owns independent countdown and selection-overlay drivers.
  const receivers =
    moduleName === 'capture-smoke.ts' ? ['driver', 'hudDriver', 'overlay', 'crossOverlay'] : ['driver'];
  const seenCanvasFree = new Set<string>();
  const missing: string[] = [];
  let captures = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isDriver(checker.getTypeAtLocation(node.expression))
    ) {
      // Forbid computed access and method extraction instead of trying to follow
      // bound helpers, destructured aliases, or dynamically selected methods.
      const direct = ts.isPropertyAccessExpression(node) && node.name.text === 'capture';
      if (!direct && ts.isPropertyAccessExpression(node)) return ts.forEachChild(node, visit);
      const call = node.parent;
      if (
        !direct ||
        !ts.isIdentifier(node.expression) ||
        !receivers.includes(node.expression.text) ||
        !ts.isCallExpression(call) ||
        call.expression !== node
      ) {
        missing.push(`Use a direct driver.capture call: ${node.getText(source)}`);
      } else {
        captures += 1;
        const filename = call.arguments[1]?.getText(source) ?? '<missing filename>';
        const requirement = call.arguments[2];
        const keys = filenameKeys(call.arguments[1]);
        if (keys.length && keys.every((key) => canvasFree.has(key))) {
          for (const key of keys) seenCanvasFree.add(key);
          if (!requirement || !ts.isStringLiteral(requirement) || requirement.text !== 'none')
            missing.push(`${filename}: declare 'none' for an allowlisted canvas-free capture`);
        } else {
          const parameter = checker.getResolvedSignature(call)?.parameters[2];
          const type = requirement && checker.getTypeAtLocation(requirement);
          const mayBeNone = (type?.isUnion() ? type.types : type ? [type] : []).some(
            (member) => member.isStringLiteral() && member.value === 'none',
          );
          if (
            !type ||
            !parameter ||
            mayBeNone ||
            type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never) ||
            !checker.isTypeAssignableTo(type, checker.getTypeOfSymbolAtLocation(parameter, node))
          )
            missing.push(`${filename}: require a screenshot expectation or 'annotation-canvas'`);
        }
        if (call.arguments.length !== 3) missing.push(`${filename}: require exactly three arguments`);
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name) &&
      isDriver(checker.getTypeAtLocation(node.initializer)) &&
      node.name.elements.some(
        (element) =>
          Boolean(element.dotDotDotToken) ||
          ts.isComputedPropertyName(element.propertyName ?? element.name) ||
          (element.propertyName ?? element.name).getText(source).replaceAll(/["']/g, '') === 'capture',
      )
    )
      missing.push(`Do not destructure capture helpers: ${node.getText(source)}`);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return { captures, seenCanvasFree, missing };
}

it.each(smokePaths)('checks capture requirements in smoke module %s', async (filename) => {
  const source = program.getSourceFile(filename)!;
  // The checker must inspect each real file, not a stale or unresolved virtual copy.
  expect(source.text).toBe(await fs.readFile(filename, 'utf8'));
  const { captures, seenCanvasFree, missing } = inspectCaptures(source);
  const canvasFree = canvasFreeByModule.get(path.basename(filename)) ?? new Set<string>();
  if (path.basename(filename) === 'smoke-workflow.ts') expect(captures).toBeGreaterThan(canvasFree.size);
  else if (canvasFree.size) expect(captures).toBeGreaterThan(0);
  expect(seenCanvasFree).toEqual(canvasFree);
  expect(missing).toEqual([]);
});

it.each(rejected.map((source, index) => [source, index] as const))(
  'rejects capture bypass: %s',
  (_source, index) => {
    expect(inspectCaptures(fixtureFunctions[index], 'smoke-workflow.ts').missing).not.toEqual([]);
  },
);

it.each(accepted.map((source, index) => [source, index] as const))(
  'accepts explicit requirement: %s',
  (_source, index) => {
    expect(inspectCaptures(fixtureFunctions[rejected.length + index], 'smoke-workflow.ts').missing).toEqual(
      [],
    );
  },
);

it('makes omitted and undefined capture requirements type errors', () => {
  const diagnostics = program.getSemanticDiagnostics(program.getSourceFile(fixturesPath)!);
  for (const index of [bypasses.length, bypasses.length + 1]) {
    const fixture = fixtureFunctions[index];
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.start !== undefined &&
          diagnostic.start >= fixture.getStart() &&
          diagnostic.start < fixture.end &&
          [2554, 2345].includes(diagnostic.code),
      ),
      fixture.getText(),
    ).toBe(true);
  }
});

it.each([...canvasFreeByModule.keys(), 'new-smoke.ts'])(
  'rejects unallowlisted canvas-free captures in %s',
  (moduleName) => {
    const fixture =
      fixtureFunctions[bypasses.findIndex(([name]) => name === 'unapproved canvas-free capture')];
    expect(inspectCaptures(fixture, moduleName).missing).toContain(
      "'unsafe.png': require a screenshot expectation or 'annotation-canvas'",
    );
  },
);

it('does not share workflow canvas-free exemptions with other modules', () => {
  const fixture = fixtureFunctions[rejected.length + accepted.length - 1];
  expect(inspectCaptures(fixture, 'smoke-workflow.ts').missing).toEqual([]);
  expect(inspectCaptures(fixture, 'capture-smoke.ts').missing).toContain(
    "'1280x800-onboarding-intro.png': require a screenshot expectation or 'annotation-canvas'",
  );
});

it.each(moduleCases.map(([moduleName, source, valid], index) => [moduleName, source, valid, index] as const))(
  'checks module-specific filenames and helper unions in %s: %s',
  (moduleName, _source, valid, index) => {
    const fixture = fixtureFunctions[rejected.length + accepted.length + index];
    expect(inspectCaptures(fixture, moduleName).missing.length === 0).toBe(valid);
  },
);
