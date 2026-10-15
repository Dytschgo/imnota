// @vitest-environment node
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
const workflowPath = fileURLToPath(new URL('./smoke-workflow.ts', import.meta.url)).replaceAll('\\', '/');
const fixturesPath = fileURLToPath(new URL('./capture-guard-fixtures.ts', import.meta.url)).replaceAll(
  '\\',
  '/',
);
const fixtures = `
  import type { NativeUiDriver, SmokeScreenshotCanvas } from './smoke-native-driver.js';
  ${[...rejected, ...accepted]
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
const program = ts.createProgram([workflowPath, fixturesPath], options, host);
const checker = program.getTypeChecker();
const workflow = program.getSourceFile(workflowPath)!;
const fixtureFunctions = program.getSourceFile(fixturesPath)!.statements.filter(ts.isFunctionDeclaration);

// Settings replace the canvas; intro/copy/What's new never display one.
const canvasFree = new Set([
  "'1280x800-onboarding-intro.png'",
  "'1280x800-onboarding-copy.png'",
  "'1280x800-whats-new.png'",
  "'1440x900-settings.png'",
  '`${viewport.width}x${viewport.height}-settings-features.png`',
  '`${viewport.width}x${viewport.height}-settings-workspace.png`',
  '`backdrop-${preset}-settings.png`',
  "'backdrop-settings.png'",
  "'sharing-settings.png'",
]);

function isDriver(type: ts.Type) {
  return type
    .getProperty('capture')
    ?.declarations?.some((declaration) =>
      declaration.getSourceFile().fileName.replaceAll('\\', '/').endsWith('/smoke-native-driver.ts'),
    );
}

function inspectCaptures(root: ts.Node) {
  const source = root.getSourceFile();
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
        node.expression.text !== 'driver' ||
        !ts.isCallExpression(call) ||
        call.expression !== node
      ) {
        missing.push(`Use a direct driver.capture call: ${node.getText(source)}`);
      } else {
        captures += 1;
        const filename = call.arguments[1]?.getText(source) ?? '<missing filename>';
        const requirement = call.arguments[2];
        if (canvasFree.has(filename)) {
          seenCanvasFree.add(filename);
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

it('requires every workflow capture to declare its annotation canvas or be explicitly canvas-free', async () => {
  // The checker must inspect the real file, not a stale or unresolved virtual copy.
  expect(workflow.text).toBe(await fs.readFile(workflowPath, 'utf8'));
  const { captures, seenCanvasFree, missing } = inspectCaptures(workflow);
  expect(captures).toBeGreaterThan(canvasFree.size);
  expect(seenCanvasFree).toEqual(canvasFree);
  expect(missing).toEqual([]);
});

it.each(rejected.map((source, index) => [source, index] as const))(
  'rejects capture bypass: %s',
  (_source, index) => {
    expect(inspectCaptures(fixtureFunctions[index]).missing).not.toEqual([]);
  },
);

it.each(accepted.map((source, index) => [source, index] as const))(
  'accepts explicit requirement: %s',
  (_source, index) => {
    expect(inspectCaptures(fixtureFunctions[rejected.length + index]).missing).toEqual([]);
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
