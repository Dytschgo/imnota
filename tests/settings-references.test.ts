// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SETTINGS_CATEGORIES } from '../src/renderer/settings/SettingsView';

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['electron', 'src', 'scripts', 'docs'];
const TOP_LEVEL = ['README.md'];
const EXTENSIONS = /\.(ts|tsx|cts|mjs|md)$/;
// docs/history records past plans verbatim; it is not user-facing guidance.
const IGNORED = [/(^|\/)node_modules\//, /\.test\.[^/]+$/, /^docs\/history\//];

function sourceFiles(): string[] {
  const files = SOURCES.flatMap((directory) =>
    readdirSync(path.join(ROOT, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && EXTENSIONS.test(entry.name))
      .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')),
  );
  return [...files, ...TOP_LEVEL].filter((file) => !IGNORED.some((pattern) => pattern.test(file)));
}

/** "Settings → X" (also "->"), skipping the operating system's "System Settings → …". */
const REFERENCE =
  /(?<!System )Settings\s*(?:→|->)\s*\**\s*([^→*\n\\.,;:()'"`]+?)\s*(?=→|->|\*|[\\.,;:()'"`\n]|$)/g;

it('finds Settings references to check', () => {
  const found = sourceFiles().flatMap((file) => [
    ...readFileSync(path.join(ROOT, file), 'utf8').matchAll(REFERENCE),
  ]);
  expect(found.length).toBeGreaterThan(5);
});

it('every "Settings → X" string names a real settings section', () => {
  const bad: string[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of text.matchAll(REFERENCE)) {
      if (!(SETTINGS_CATEGORIES as readonly string[]).includes(match[1])) {
        const line = text.slice(0, match.index).split('\n').length;
        bad.push(`${file}:${line}: "${match[0].trim()}"`);
      }
    }
  }
  expect(bad, `Use one of: ${SETTINGS_CATEGORIES.join(', ')}`).toEqual([]);
});
