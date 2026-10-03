import fc from 'fast-check';

/**
 * Shared fast-check settings for property tests.
 *
 * Every run uses the same default seed. On failure fast-check prints the seed, shrink path and
 * minimal counterexample; replay a specific test with `IMNOTA_PROPERTY_SEED=<seed>` and
 * `IMNOTA_PROPERTY_PATH=<path>`. Override the seed explicitly for exploration.
 * `IMNOTA_PROPERTY_RUNS=<factor>` multiplies the bounded run counts for a deliberate deeper search.
 */
const DEFAULT_SEED = 0x1a2b3c4d;

function integerFromEnvironment(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer, received "${raw}".`);
  return value;
}

export const propertySeed: number = integerFromEnvironment('IMNOTA_PROPERTY_SEED') ?? DEFAULT_SEED;
if (propertySeed < -0x80000000 || propertySeed > 0x7fffffff)
  throw new Error('IMNOTA_PROPERTY_SEED must be a signed 32-bit integer.');

const runFactor = integerFromEnvironment('IMNOTA_PROPERTY_RUNS') ?? 1;
if (runFactor < 1 || runFactor > 100) throw new Error('IMNOTA_PROPERTY_RUNS must be from 1 to 100.');

/** Bounded, seeded parameters for `fc.assert`. */
export function runs<T>(numRuns: number): fc.Parameters<T> {
  return {
    seed: propertySeed,
    numRuns: numRuns * runFactor,
    ...(process.env.IMNOTA_PROPERTY_PATH ? { path: process.env.IMNOTA_PROPERTY_PATH } : {}),
  };
}
