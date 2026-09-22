// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import base from '../vitest.config';
import policy from './platform-test-policy.json';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('./platform-test-policy.json');
  vi.resetModules();
});

it('adds only the reviewed exclusions without changing the full-suite configuration', async () => {
  vi.stubEnv('IMNOTA_FULL_PLATFORM_TESTS', '0');
  const { default: platform } = await import('../vitest.platform.config');
  expect(platform.test?.exclude).toEqual([...base.test!.exclude!, ...policy.linuxQualityOnly]);
  expect(base.test?.exclude).not.toContain(policy.linuxQualityOnly[0]);
});

it('restores the full suite for platform investigations, including runner-specific exclusions', async () => {
  vi.stubEnv('IMNOTA_FULL_PLATFORM_TESTS', '1');
  const { default: platform } = await import('../vitest.platform.config');
  expect(platform.test?.exclude).toEqual(base.test?.exclude);
});

it.each([
  ['duplicate', [policy.linuxQualityOnly[0], policy.linuxQualityOnly[0]]],
  ['wildcard', ['src/renderer/**/*.test.tsx']],
  ['missing', ['src/renderer/missing-policy-fixture.test.ts']],
  ['native', ['electron/project-watch.test.ts']],
  ['shared', ['src/shared/__tests__/schema.test.ts']],
])('rejects %s exclusions instead of silently dropping coverage', async (_label, paths) => {
  vi.doMock('./platform-test-policy.json', () => ({ default: { linuxQualityOnly: paths } }));
  await expect(import('../vitest.platform.config')).rejects.toThrow(
    'Platform test policy must contain unique, existing renderer test file paths.',
  );
});
