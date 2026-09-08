import { mergeConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import base from './vitest.config';
import policy from './tests/platform-test-policy.json';

// Reject stale paths and globs: a broad exclusion would silently omit new tests.
if (
  new Set(policy.linuxQualityOnly).size !== policy.linuxQualityOnly.length ||
  policy.linuxQualityOnly.some(
    (file) => !/^src\/renderer\/[\w/-]+\.test\.tsx?$/.test(file) || !existsSync(file),
  )
) {
  throw new Error('Platform test policy must contain unique, existing renderer test file paths.');
}

// The full suite stays in quality. Only explicitly reviewed portable tests are
// omitted here; new/unclassified tests retain all-platform execution by default.
// Use IMNOTA_FULL_PLATFORM_TESTS=1 when investigating a broad platform regression.
export default mergeConfig(base, {
  test: {
    exclude: process.env.IMNOTA_FULL_PLATFORM_TESTS === '1' ? [] : policy.linuxQualityOnly,
  },
});
