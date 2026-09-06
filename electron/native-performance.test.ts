// @vitest-environment node
import { expect, it } from 'vitest';
import { classifyNativePerformance } from './native-performance.js';

it('returns coarse safe performance guidance without exposing raw machine values', () => {
  expect(
    classifyNativePerformance({
      platform: 'win32',
      totalMemoryBytes: 4 * 1024 ** 3,
      logicalCpuCount: 2,
    }),
  ).toEqual({
    platform: 'windows',
    performanceClass: 'constrained',
    reducedEffectsRecommended: true,
    reasons: ['low-memory', 'low-cpu-count'],
  });
  expect(
    classifyNativePerformance({
      platform: 'linux',
      totalMemoryBytes: 16 * 1024 ** 3,
      logicalCpuCount: 8,
    }).performanceClass,
  ).toBe('standard');
});
