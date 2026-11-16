import { continuesUndoStep } from '../canvas/undo-coalescing';
import { pushBounded } from '../canvas/undo-history';

/** Undo steps kept per screenshot description; older steps are dropped first. */
export const DESCRIPTION_UNDO_LIMIT = 100;
/** Keystrokes on one description separated by more than this pause are separate undo steps. */
export const DESCRIPTION_TYPING_PAUSE_MS = 1000;

export interface DescriptionUndo {
  /** Text before each undo step, oldest first, per screenshot id. */
  readonly stacks: Readonly<Record<string, readonly string[]>>;
  /** The open typing step: consecutive edits with the same key form one undo step. */
  readonly step: { readonly key: string; readonly shotId: string; readonly lastAt: number } | null;
}

export const EMPTY_DESCRIPTION_UNDO: DescriptionUndo = { stacks: {}, step: null };

/** Records an edit of `shotId`, whose text was `previous`, at time `now` (milliseconds). */
export function recordDescriptionEdit(
  state: DescriptionUndo,
  shotId: string,
  previous: string,
  now: number,
): DescriptionUndo {
  const resumable =
    state.step && state.step.shotId === shotId && now - state.step.lastAt <= DESCRIPTION_TYPING_PAUSE_MS;
  const key = resumable && state.step ? state.step.key : `description:${shotId}:${now}`;
  const step = { key, shotId, lastAt: now };
  if (continuesUndoStep(state.step?.key ?? null, { coalesce: key })) return { stacks: state.stacks, step };
  return {
    stacks: {
      ...state.stacks,
      [shotId]: pushBounded(state.stacks[shotId] ?? [], previous, DESCRIPTION_UNDO_LIMIT),
    },
    step,
  };
}

/** Removes the latest step of `shotId`. The next edit always starts a new step. */
export function undoDescriptionEdit(
  state: DescriptionUndo,
  shotId: string,
): { state: DescriptionUndo; previous: string | undefined } {
  const values = state.stacks[shotId] ?? [];
  const previous = values.at(-1);
  if (previous === undefined) return { state: state.step ? { ...state, step: null } : state, previous };
  return { state: { stacks: { ...state.stacks, [shotId]: values.slice(0, -1) }, step: null }, previous };
}

/** Ends the open typing step, so the next edit starts a new undo step (e.g. after navigation). */
export function closeDescriptionStep(state: DescriptionUndo): DescriptionUndo {
  return state.step ? { ...state, step: null } : state;
}

export function canUndoDescription(state: DescriptionUndo, shotId: string | undefined): boolean {
  return Boolean(shotId && state.stacks[shotId]?.length);
}
