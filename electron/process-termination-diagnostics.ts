const REASONS = new Set([
  'clean-exit',
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'memory-eviction',
]);
const PROCESS_TYPES = new Set([
  'Browser',
  'Tab',
  'Utility',
  'Zygote',
  'Sandbox helper',
  'GPU',
  'Pepper Plugin',
  'Pepper Plugin Broker',
]);
const MAX_PROCESSES = 4096;
const MAX_MEMORY_MIB = 1_048_576;

export interface TerminationDetails {
  type: unknown;
  reason: unknown;
  exitCode: unknown;
}

interface ProcessMetric {
  type: unknown;
  memory: { workingSetSize: number };
}

export interface TerminationMemorySources {
  mainResidentBytes(): number;
  processMetrics(): readonly ProcessMetric[];
}

/** No paths, process names, service names, messages, PIDs or raw Electron details. */
export function processTerminationObservation(
  details: TerminationDetails,
  sources: TerminationMemorySources,
) {
  let mainResidentMiB: number | undefined;
  let availableChildWorkingSetMiB: number | undefined;
  let availableChildProcessCount: number | undefined;
  try {
    const bytes = sources.mainResidentBytes();
    if (Number.isFinite(bytes) && bytes >= 0)
      mainResidentMiB = Math.min(MAX_MEMORY_MIB, Math.round(bytes / 1024 ** 2));
  } catch {
    // Process termination evidence remains useful when memory measurement fails.
  }
  try {
    let kibibytes = 0;
    let count = 0;
    for (const metric of sources.processMetrics().slice(0, MAX_PROCESSES)) {
      if (metric.type === 'Browser') continue;
      const measured = metric.memory.workingSetSize;
      if (!Number.isFinite(measured) || measured < 0) continue;
      kibibytes = Math.min(MAX_MEMORY_MIB * 1024, kibibytes + measured);
      count++;
    }
    availableChildWorkingSetMiB = Math.round(kibibytes / 1024);
    availableChildProcessCount = count;
  } catch {
    // A gone process may already be absent from the available Electron metrics.
  }
  return {
    processType:
      typeof details.type === 'string' && PROCESS_TYPES.has(details.type) ? details.type : 'Unknown',
    reason: typeof details.reason === 'string' && REASONS.has(details.reason) ? details.reason : 'unknown',
    ...(typeof details.exitCode === 'number' && Number.isSafeInteger(details.exitCode)
      ? { exitCode: Math.min(0xffff_ffff, Math.max(-0x8000_0000, details.exitCode)) }
      : {}),
    memory: {
      observedAt: 'termination',
      mainResidentMiB,
      availableChildWorkingSetMiB,
      availableChildProcessCount,
    },
  };
}
