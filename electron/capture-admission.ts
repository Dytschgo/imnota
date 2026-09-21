export interface CaptureAdmission {
  readonly id: number;
  revoked: boolean;
}

/** One main-process admission spans queued IPC, source capture, and overlay selection. */
export class CaptureAdmissionGate {
  private active: CaptureAdmission | null = null;
  private nextId = 1;

  acquire(): CaptureAdmission | null {
    if (this.active) return null;
    const admission: CaptureAdmission = { id: this.nextId++, revoked: false };
    this.active = admission;
    return admission;
  }

  revoke(admission: CaptureAdmission): void {
    if (this.active === admission) admission.revoked = true;
  }

  isActive(admission: CaptureAdmission): boolean {
    return this.active === admission && !admission.revoked;
  }

  release(admission: CaptureAdmission): void {
    if (this.active === admission) this.active = null;
  }

  isOccupied(): boolean {
    return this.active !== null;
  }
}
