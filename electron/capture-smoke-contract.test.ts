// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { syntheticCaptureColor } from './capture-smoke-contract.js';

describe('capture smoke contract', () => {
  it('uses distinct opaque colors for adjacent synthetic displays', () => {
    expect(syntheticCaptureColor(0)).not.toEqual(syntheticCaptureColor(1));
    expect(syntheticCaptureColor(0)).not.toEqual(syntheticCaptureColor(4));
    expect(syntheticCaptureColor(0).alpha).toBe(255);
    expect(syntheticCaptureColor(216)).toEqual(syntheticCaptureColor(0));
  });
});
