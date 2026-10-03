// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { onboardingCopyEvidence } from './smoke-onboarding-copy.js';

const files = [
  path.resolve('synthetic-handoff/component-search.md'),
  path.resolve('synthetic-handoff/component-search.png'),
];
const input = {
  attempt: 3,
  action: 'files-rich' as const,
  expectedFiles: files,
  actualFiles: files,
  expectedText: '# Synthetic Markdown\n',
  actualText: '# Synthetic Markdown\n',
  html: '',
  image: { empty: true, width: 0, height: 0 },
  before: { changeCount: 42, types: ['public.file-url', 'public.utf8-plain-text'] },
  after: { changeCount: 42, types: ['public.file-url', 'public.utf8-plain-text'] },
};

describe('synthetic onboarding copy evidence', () => {
  it('records exact ordered pairs and separately observes read consistency', async () => {
    expect(await onboardingCopyEvidence(input)).toMatchObject({
      formatsValid: true,
      native: { consistent: true },
    });
    expect(
      await onboardingCopyEvidence({ ...input, after: { ...input.after, changeCount: 43 } }),
    ).toMatchObject({
      formatsValid: true,
      native: { consistent: false },
    });
  });
  it.each([
    { actualFiles: files.slice(0, 1), failed: 'count' },
    { actualFiles: [...files].reverse(), failed: 'orderedPaths' },
    { actualText: '', failed: 'text' },
    { html: '<p>unexpected</p>', failed: 'noHtml' },
    { image: { empty: false, width: 1, height: 1 }, failed: 'noImage' },
  ])(
    'retains the failing $failed operand without weakening exact assertions',
    async ({ failed, ...change }) => {
      const report = await onboardingCopyEvidence({ ...input, ...change });
      expect(report.formatsValid).toBe(false);
      expect(report.operands[failed as keyof typeof report.operands]).toBe(false);
    },
  );
  it('redacts outside paths and payload text while retaining lengths and comparisons', async () => {
    const report = await onboardingCopyEvidence({
      ...input,
      actualFiles: [path.resolve('personal/secret.md')],
      actualText: 'private clipboard payload',
      html: '<p>private html</p>',
      before: { changeCount: 42, types: ['public.file-url', 'dyn.secret-type-name'] },
      after: { changeCount: 42, types: ['public.file-url', 'private'.repeat(5000)] },
    });
    expect(report.files.actual).toEqual([{ name: '[outside synthetic handoff]', path: '[redacted]' }]);
    expect(report.text).toMatchObject({ equal: false, actualLength: 25 });
    expect(JSON.stringify(report)).not.toMatch(/secret|private|personal/);
  });
  it('retains alias paths to real synthetic files while the exact-path assertion still fails', async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-evidence-alias-')));
    try {
      const handoff = path.join(parent, 'handoff');
      const alias = path.join(parent, 'handoff-alias');
      const outside = path.join(parent, 'outside');
      await fs.mkdir(handoff);
      await fs.mkdir(outside);
      const expectedFiles = ['component-search.md', 'component-search.png'].map((name) =>
        path.join(handoff, name),
      );
      for (const file of expectedFiles) await fs.writeFile(file, 'synthetic fixture');
      await fs.symlink(handoff, alias, process.platform === 'win32' ? 'junction' : 'dir');
      const actualFiles = expectedFiles.map((file) => path.join(alias, path.basename(file)));
      const report = await onboardingCopyEvidence({ ...input, expectedFiles, actualFiles });
      expect(report.formatsValid).toBe(false);
      expect(report.operands.orderedPaths).toBe(false);
      expect(report.files.actual).toEqual(
        actualFiles.map((file, index) => ({
          name: path.basename(file),
          path: file,
          resolvedPath: expectedFiles[index],
        })),
      );
      const personalFile = path.join(outside, 'personal.md');
      await fs.writeFile(personalFile, 'unrelated payload');
      const escape = path.join(handoff, 'escaped');
      await fs.symlink(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
      const escaped = await onboardingCopyEvidence({
        ...input,
        expectedFiles,
        actualFiles: [path.join(escape, 'personal.md'), path.join(parent, 'handoff-sibling', 'missing.md')],
      });
      expect(escaped.files.actual).toEqual([
        { name: '[outside synthetic handoff]', path: '[redacted]' },
        { name: '[outside synthetic handoff]', path: '[redacted]' },
      ]);
      expect(JSON.stringify(escaped)).not.toMatch(/personal|escaped|handoff-sibling/);
    } finally {
      await fs.rm(parent, { recursive: true });
    }
  });
});
