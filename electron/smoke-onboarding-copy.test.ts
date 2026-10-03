// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
  it('records exact ordered pairs and separately observes read consistency', () => {
    expect(onboardingCopyEvidence(input)).toMatchObject({ formatsValid: true, native: { consistent: true } });
    expect(onboardingCopyEvidence({ ...input, after: { ...input.after, changeCount: 43 } })).toMatchObject({
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
  ])('retains the failing $failed operand without weakening exact assertions', ({ failed, ...change }) => {
    const report = onboardingCopyEvidence({ ...input, ...change });
    expect(report.formatsValid).toBe(false);
    expect(report.operands[failed as keyof typeof report.operands]).toBe(false);
  });
  it('redacts outside paths and payload text while retaining lengths and comparisons', () => {
    const report = onboardingCopyEvidence({
      ...input,
      actualFiles: [path.resolve('personal/secret.md')],
      actualText: 'private clipboard payload',
      html: '<p>private html</p>',
    });
    expect(report.files.actual).toEqual([{ name: '[outside synthetic handoff]', path: '[redacted]' }]);
    expect(report.text).toMatchObject({ equal: false, actualLength: 25 });
    expect(JSON.stringify(report)).not.toMatch(/secret|private|personal/);
  });
});
