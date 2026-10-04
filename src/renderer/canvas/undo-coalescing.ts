/** Options accepted alongside an annotation change. */
export interface AnnotationChangeOptions {
  /**
   * Consecutive changes carrying the same key form one undo step. A change with a different key, or
   * without one, starts a new step.
   */
  coalesce?: string;
}

/** Whether a change continues the undo step opened by the previous change instead of starting a new one. */
export function continuesUndoStep(
  previousKey: string | null,
  options: AnnotationChangeOptions | undefined,
): boolean {
  return Boolean(options?.coalesce) && options?.coalesce === previousKey;
}

/** Keyboard nudges separated by more than this pause are separate undo steps. */
export const NUDGE_BURST_MS = 1000;

export interface NudgeBurst {
  annotationId: string;
  startedAt: number;
  lastAt: number;
}

/** Extends the current burst while the same annotation keeps being nudged without a long pause. */
export function nextNudgeBurst(previous: NudgeBurst | null, annotationId: string, now: number): NudgeBurst {
  if (previous && previous.annotationId === annotationId && now - previous.lastAt <= NUDGE_BURST_MS)
    return { ...previous, lastAt: now };
  return { annotationId, startedAt: now, lastAt: now };
}

export function nudgeBurstKey(burst: NudgeBurst): string {
  return `nudge:${burst.annotationId}:${burst.startedAt}`;
}
