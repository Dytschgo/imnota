// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createVitest } from 'vitest/node';
import base from '../vitest.config';

it('discovers new source tests without collecting generated files or other checkouts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'imnota-test-discovery-'));
  const sourceTests = [
    'electron/new.test.ts',
    'src/renderer/new.test.tsx',
    'src/shared/new.test.ts',
    'tests/new.test.ts',
    'future-domain/new.test.ts',
  ];
  const excludedTests = [
    'node_modules/package/new.test.ts',
    '.git/new.test.ts',
    '.claude/worktrees/other/src/new.test.ts',
    'dist/new.test.ts',
    'dist-electron/electron/new.test.js',
    'release/win-unpacked/new.test.ts',
    'out/design-harness/new.test.ts',
    'coverage/new.test.ts',
    'scripts/new.test.mjs',
    'share-service/src/new.test.js',
    'electron/hosted-share-contract.test.ts',
  ];
  let runner: Awaited<ReturnType<typeof createVitest>> | undefined;
  try {
    for (const file of [...sourceTests, ...excludedTests]) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'throw new Error("Discovery must not execute fixtures");');
    }
    runner = await createVitest('test', {
      root,
      config: false,
      watch: false,
      exclude: base.test!.exclude,
    });
    const specifications = await runner.globTestSpecifications();
    expect(
      specifications.map((spec) => path.relative(root, spec.moduleId).replaceAll('\\', '/')).sort(),
    ).toEqual(sourceTests.sort());
  } finally {
    await runner?.close();
    await rm(root, { recursive: true, force: true });
  }
});
