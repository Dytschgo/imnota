import os from 'node:os';
import type { NativePerformanceProfile } from '../src/shared/workflow-bridge.js';

export interface NativePerformanceInputs {
  platform: NodeJS.Platform;
  totalMemoryBytes: number;
  logicalCpuCount: number;
}

export function classifyNativePerformance(input: NativePerformanceInputs): NativePerformanceProfile {
  const platform =
    input.platform === 'win32'
      ? 'windows'
      : input.platform === 'darwin'
        ? 'macos'
        : input.platform === 'linux'
          ? 'linux'
          : 'unknown';
  const reasons: NativePerformanceProfile['reasons'][number][] = [];
  if (!Number.isFinite(input.totalMemoryBytes) || input.totalMemoryBytes < 8 * 1024 ** 3)
    reasons.push('low-memory');
  if (!Number.isSafeInteger(input.logicalCpuCount) || input.logicalCpuCount < 4)
    reasons.push('low-cpu-count');
  if (platform === 'unknown') reasons.push('unknown-platform');
  return {
    platform,
    performanceClass: reasons.length ? 'constrained' : 'standard',
    reducedEffectsRecommended: reasons.length > 0,
    reasons,
  };
}

export function nativePerformanceProfile(): NativePerformanceProfile {
  return classifyNativePerformance({
    platform: process.platform,
    totalMemoryBytes: os.totalmem(),
    logicalCpuCount: os.cpus().length,
  });
}
