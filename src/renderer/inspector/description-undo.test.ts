import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_TYPING_PAUSE_MS,
  DESCRIPTION_UNDO_LIMIT,
  EMPTY_DESCRIPTION_UNDO,
  canUndoDescription,
  recordDescriptionEdit,
  undoDescriptionEdit,
  type DescriptionUndo,
} from './description-undo';

/** Types `text` one character at a time, `gapMs` apart, starting from `base`. */
function type(state: DescriptionUndo, shotId: string, base: string, text: string, start: number, gapMs = 50) {
  let current = base;
  for (const [index, character] of [...text].entries()) {
    state = recordDescriptionEdit(state, shotId, current, start + index * gapMs);
    current += character;
  }
  return { state, text: current };
}

describe('description undo', () => {
  it('restores the text from before a typing burst in one step', () => {
    const typed = type(EMPTY_DESCRIPTION_UNDO, 'shot', 'Original', ' plus more words', 0);
    expect(typed.state.stacks.shot).toEqual(['Original']);
    const undone = undoDescriptionEdit(typed.state, 'shot');
    expect(undone.previous).toBe('Original');
    expect(canUndoDescription(undone.state, 'shot')).toBe(false);
  });

  it('starts a new step after a pause, another screenshot or an undo', () => {
    let state = type(EMPTY_DESCRIPTION_UNDO, 'shot', 'A', 'b', 0).state;
    state = recordDescriptionEdit(state, 'shot', 'Ab', DESCRIPTION_TYPING_PAUSE_MS + 1);
    expect(state.stacks.shot).toEqual(['A', 'Ab']);

    state = recordDescriptionEdit(state, 'other', 'X', DESCRIPTION_TYPING_PAUSE_MS + 2);
    state = recordDescriptionEdit(state, 'shot', 'Abc', DESCRIPTION_TYPING_PAUSE_MS + 3);
    expect(state.stacks.shot).toEqual(['A', 'Ab', 'Abc']);
    expect(state.stacks.other).toEqual(['X']);

    const undone = undoDescriptionEdit(state, 'shot');
    expect(undone.previous).toBe('Abc');
    const next = recordDescriptionEdit(undone.state, 'shot', 'Abc', DESCRIPTION_TYPING_PAUSE_MS + 4);
    expect(next.stacks.shot).toEqual(['A', 'Ab', 'Abc']);
  });

  it('keeps at most the newest steps per screenshot', () => {
    let state = EMPTY_DESCRIPTION_UNDO;
    const steps = DESCRIPTION_UNDO_LIMIT + 25;
    for (let index = 0; index < steps; index += 1)
      state = recordDescriptionEdit(state, 'shot', `v${index}`, index * (DESCRIPTION_TYPING_PAUSE_MS + 1));
    expect(state.stacks.shot).toHaveLength(DESCRIPTION_UNDO_LIMIT);
    expect(state.stacks.shot?.[0]).toBe(`v${steps - DESCRIPTION_UNDO_LIMIT}`);
    expect(state.stacks.shot?.at(-1)).toBe(`v${steps - 1}`);
  });

  it('leaves an empty history unchanged on undo', () => {
    const undone = undoDescriptionEdit(EMPTY_DESCRIPTION_UNDO, 'shot');
    expect(undone.previous).toBeUndefined();
    expect(undone.state).toBe(EMPTY_DESCRIPTION_UNDO);
    expect(canUndoDescription(EMPTY_DESCRIPTION_UNDO, undefined)).toBe(false);
  });
});
