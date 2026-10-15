// @vitest-environment node
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import ts from 'typescript';

it('requires every workflow capture to declare its annotation canvas or be explicitly canvas-free', async () => {
  const source = await fs.readFile(new URL('./smoke-workflow.ts', import.meta.url), 'utf8');
  const workflow = ts.createSourceFile('smoke-workflow.ts', source, ts.ScriptTarget.Latest, true);
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
  const seenCanvasFree = new Set<string>();
  const missing: string[] = [];
  let captures = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(workflow) === 'driver.capture') {
      captures += 1;
      const filename = node.arguments[1]?.getText(workflow) ?? '<missing filename>';
      const requirement = node.arguments[2]?.getText(workflow);
      if (canvasFree.has(filename)) {
        seenCanvasFree.add(filename);
        expect(requirement, filename).toBeUndefined();
      } else if (!requirement || ['undefined', 'null', 'false'].includes(requirement)) {
        missing.push(filename);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(workflow);
  expect(captures).toBeGreaterThan(canvasFree.size);
  expect(seenCanvasFree).toEqual(canvasFree);
  expect(missing).toEqual([]);
});
