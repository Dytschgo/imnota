import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { classifyChanges, isDocsOnlyDiff } from './ci-changes.mjs';

const hash = 'a'.repeat(40);
const entry = (path, modes = '100644 100644', status = 'M') =>
  `:${modes} ${hash} ${hash} ${status}\0${path}\0`;

test('only reviewed regular prose paths qualify', () => {
  for (const path of ['README.md', 'AGENTS.md', 'docs/development.md', 'docs/archive/old-plan.md']) {
    assert.equal(isDocsOnlyDiff(entry(path)), true, path);
    assert.equal(isDocsOnlyDiff(entry(path, '000000 100644', 'A')), true);
    assert.equal(isDocsOnlyDiff(entry(path, '100644 000000', 'D')), true);
  }
  for (const path of [
    'CHANGELOG.md',
    'SECURITY.md',
    'share-service/README.md',
    '.github/README.md',
    'src/fixture.md',
    'docs/a.MD',
    'docs/a.md.ts',
    'docs/../src/a.md',
    'docs/a\nb.md',
    'docs/a b.md',
    'docs/.hidden.md',
    'docs/image.png',
    'AGENT.md',
  ])
    assert.equal(isDocsOnlyDiff(entry(path)), false, path);
});

test('unknown, malformed, mixed, renamed or non-regular changes require full checks', () => {
  for (const diff of [
    '',
    '\0',
    entry('README.md').slice(0, -1),
    'invalid\0README.md\0',
    entry('README.md') + entry('src/main.ts'),
    entry('docs/a.md', '120000 120000'),
    entry('README.md', '100644 100755'),
    entry('README.md', '000000 100644', 'M'),
    entry('README.md', '100644 100644', 'T'),
    `:100644 100644 ${hash} ${hash} R100\0src/main.ts\0docs/main.md\0`,
  ])
    assert.equal(isDocsOnlyDiff(diff), false, JSON.stringify(diff));
});

test('real git history classifies docs and exposes both sides of source renames', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'imnota-ci-changes-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'ci-fixture@example.invalid');
  await mkdir(join(cwd, 'docs'));
  await writeFile(join(cwd, 'README.md'), 'Initial\n');
  await writeFile(join(cwd, 'source.ts'), 'export const fixture = true;\n');
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  await writeFile(join(cwd, 'README.md'), 'Revised\n');
  git('add', '.');
  git('commit', '-m', 'docs');
  const head = git('rev-parse', 'HEAD');
  const options = { eventName: 'pull_request', base, head, cwd };
  assert.equal(classifyChanges(options), true);
  const output = join(cwd, 'github-output');
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-changes.mjs', import.meta.url))], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request',
      IMNOTA_BASE_SHA: base,
      IMNOTA_HEAD_SHA: head,
      GITHUB_OUTPUT: output,
    },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(await readFile(output, 'utf8'), 'docs_only=true\n');
  await rm(output);
  for (const override of [
    { eventName: 'push' },
    { eventName: undefined },
    { base: head },
    { base: '0'.repeat(40) },
    { head: '--output=unsafe' },
    { base: '' },
    { cwd: join(cwd, 'missing') },
  ])
    assert.equal(classifyChanges({ ...options, ...override }), false);
  await rename(join(cwd, 'source.ts'), join(cwd, 'docs', 'source.md'));
  git('add', '-A');
  git('commit', '-m', 'source renamed to prose');
  assert.equal(classifyChanges({ ...options, head: git('rev-parse', 'HEAD') }), false);
});
