// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vitest defaults to jsdom for the renderer. Main-process and shared tests must opt into Node so
// they skip the jsdom boot and jest-dom setup they never use (docs/pr-test-coverage.md). A test
// that genuinely needs a DOM stays on the default only when it is listed here with its reason.
const DOM_EXEMPTIONS: Record<string, string> = {
  'electron/canvas-basics-smoke-state.test.ts': 'drives smoke state against a jsdom canvas fixture',
  'electron/smoke-native-driver.canvas-required.test.ts': 'reads rendered markup and document.fonts',
  'electron/smoke-native-driver.mixed-content.test.ts': 'reads rendered markup and document.fonts',
  'src/shared/__tests__/shortcuts.test.ts': 'matches real KeyboardEvents and editable targets',
};

const root = fileURLToPath(new URL('../..', import.meta.url));
const scanned = ['electron', 'src/shared'];
const testFile = /\.test\.(?:ts|tsx|cts|mts)$/;

function testFiles(directory: string): string[] {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return testFiles(relative);
    return testFile.test(entry.name) ? [relative] : [];
  });
}

function declaredEnvironment(file: string): string | undefined {
  return /@vitest-environment\s+([\w-]+)/.exec(fs.readFileSync(path.join(root, file), 'utf8'))?.[1];
}

describe('Vitest environment policy for electron/ and src/shared/ tests', () => {
  const files = scanned.flatMap(testFiles);

  it('finds the tests it governs', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('declares the Node environment unless a DOM exemption is recorded', () => {
    const missing = files.filter((file) => !(file in DOM_EXEMPTIONS) && declaredEnvironment(file) !== 'node');
    expect(missing, 'Add `// @vitest-environment node` or record a DOM exemption').toEqual([]);
  });

  it('keeps every exemption current and on the DOM environment', () => {
    for (const file of Object.keys(DOM_EXEMPTIONS)) {
      expect(files, `stale exemption ${file}`).toContain(file);
      expect(declaredEnvironment(file), `${file} is exempt but declares node`).not.toBe('node');
    }
  });
});
