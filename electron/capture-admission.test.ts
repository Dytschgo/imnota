// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CaptureAdmissionGate } from './capture-admission.js';

describe('capture admission gate', () => {
  it('admits only one rapid capture request until its full lifecycle releases', () => {
    const gate = new CaptureAdmissionGate();
    const first = gate.acquire();
    expect(first).not.toBeNull();
    expect(gate.acquire()).toBeNull();
    gate.release(first!);
    expect(gate.acquire()).not.toBeNull();
  });

  it('revokes a destroyed initiator before it can commit', () => {
    const gate = new CaptureAdmissionGate();
    const admission = gate.acquire()!;
    gate.revoke(admission);
    expect(gate.isActive(admission)).toBe(false);
    gate.release(admission);
  });
});
