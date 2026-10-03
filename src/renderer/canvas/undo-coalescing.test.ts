import { expect, it } from 'vitest';
import { nextNudgeBurst, nudgeBurstKey, NUDGE_BURST_MS } from './undo-coalescing';

it('keeps a burst of nudges on one annotation under one key', () => {
  let burst = nextNudgeBurst(null, 'ann-1', 1000);
  const key = nudgeBurstKey(burst);
  let at = 1000;
  for (const pause of [100, 400, NUDGE_BURST_MS]) {
    at += pause;
    burst = nextNudgeBurst(burst, 'ann-1', at);
    expect(nudgeBurstKey(burst)).toBe(key);
  }
});

it('starts a new burst after a pause or when another annotation is nudged', () => {
  const first = nextNudgeBurst(null, 'ann-1', 1000);
  expect(nudgeBurstKey(nextNudgeBurst(first, 'ann-1', 1001 + NUDGE_BURST_MS))).not.toBe(nudgeBurstKey(first));
  expect(nudgeBurstKey(nextNudgeBurst(first, 'ann-2', 1100))).not.toBe(nudgeBurstKey(first));
});
