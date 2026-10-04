import { describe, expect, it } from 'vitest';
import type { Annotation } from '../../shared/types';
import {
  describeSelectedAnnotation,
  keyboardSelectionOrder,
  nextKeyboardSelection,
  nudgeAnnotation,
  nudgeDeltaForKey,
} from './keyboard';

function annotation(id: string, patch: Partial<Annotation> = {}): Annotation {
  return { id, kind: 'rectangle', x: 10, y: 20, width: 30, height: 40, zIndex: 0, ...patch };
}

describe('nudging', () => {
  it('maps arrow keys to one image pixel, or ten with Shift', () => {
    expect(nudgeDeltaForKey('ArrowLeft', false)).toEqual({ x: -1, y: 0 });
    expect(nudgeDeltaForKey('ArrowRight', false)).toEqual({ x: 1, y: 0 });
    expect(nudgeDeltaForKey('ArrowUp', true)).toEqual({ x: 0, y: -10 });
    expect(nudgeDeltaForKey('ArrowDown', true)).toEqual({ x: 0, y: 10 });
    expect(nudgeDeltaForKey('a', false)).toBeNull();
  });

  it('moves only the selected annotation and keeps its other properties', () => {
    const arrow = annotation('b', { kind: 'arrow', points: [0, 0, 50, 5] });
    const annotations = [annotation('a'), arrow];
    const next = nudgeAnnotation(annotations, 'b', { x: -10, y: 1 });
    expect(next[0]).toBe(annotations[0]);
    expect(next[1]).toEqual({ ...arrow, x: 0, y: 21 });
  });

  it('returns the same array when the annotation is missing', () => {
    const annotations = [annotation('a')];
    expect(nudgeAnnotation(annotations, 'missing', { x: 1, y: 0 })).toBe(annotations);
  });
});

describe('keyboard selection', () => {
  const annotations = [
    annotation('top', { zIndex: 2 }),
    annotation('crop', { kind: 'crop', zIndex: 1 }),
    annotation('first', { zIndex: 0 }),
    annotation('second', { zIndex: 0 }),
  ];

  it('orders by stacking order, then creation order, and skips the crop', () => {
    expect(keyboardSelectionOrder(annotations).map((item) => item.id)).toEqual(['first', 'second', 'top']);
  });

  it('enters at the first annotation with Tab and the last with Shift+Tab', () => {
    expect(nextKeyboardSelection(annotations, null, 1)).toBe('first');
    expect(nextKeyboardSelection(annotations, null, -1)).toBe('top');
    expect(nextKeyboardSelection(annotations, 'gone', 1)).toBe('first');
  });

  it('steps through annotations and releases the selection past either end', () => {
    expect(nextKeyboardSelection(annotations, 'first', 1)).toBe('second');
    expect(nextKeyboardSelection(annotations, 'second', -1)).toBe('first');
    expect(nextKeyboardSelection(annotations, 'top', 1)).toBeNull();
    expect(nextKeyboardSelection(annotations, 'first', -1)).toBeNull();
  });

  it('selects nothing when there are no annotations', () => {
    expect(nextKeyboardSelection([], null, 1)).toBeNull();
    expect(nextKeyboardSelection([annotation('crop', { kind: 'crop' })], null, 1)).toBeNull();
  });
});

describe('describeSelectedAnnotation', () => {
  it('announces kind, position in the order and location', () => {
    const annotations = [annotation('a'), annotation('b', { kind: 'arrow', zIndex: 1, x: 4.6, y: 9.2 })];
    expect(describeSelectedAnnotation(annotations, 'b')).toBe('Arrow selected, 2 of 2, at 5, 9');
  });

  it('includes note text and step numbers', () => {
    const annotations = [
      annotation('note', { kind: 'text', text: ' Fix  this\nbutton ' }),
      annotation('step', { kind: 'step', stepNumber: 3, zIndex: 1 }),
      annotation('mask', { kind: 'blur', zIndex: 2 }),
    ];
    expect(describeSelectedAnnotation(annotations, 'note')).toBe(
      'Text note “Fix this button” selected, 1 of 3, at 10, 20',
    );
    expect(describeSelectedAnnotation(annotations, 'step')).toBe('Step 3 selected, 2 of 3, at 10, 20');
    expect(describeSelectedAnnotation(annotations, 'mask')).toBe('Redaction selected, 3 of 3, at 10, 20');
  });

  it('is empty without a selection', () => {
    expect(describeSelectedAnnotation([annotation('a')], null)).toBe('');
    expect(describeSelectedAnnotation([annotation('a')], 'missing')).toBe('');
  });
});
