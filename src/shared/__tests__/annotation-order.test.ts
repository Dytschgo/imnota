import { describe, expect, test } from 'vitest';
import type { Annotation } from '../types';
import { textAnnotationNoteNumbers, textAnnotationReferences } from '../annotation-order';

describe('text annotation references', () => {
  test('uses original creation order independently of z-index and ignores visual-only annotations', () => {
    const annotations: Annotation[] = [
      { id: 'first', kind: 'text', x: 0, y: 0, text: 'First', zIndex: 20 },
      { id: 'blank', kind: 'text', x: 0, y: 0, text: '   ', zIndex: 50 },
      { id: 'arrow', kind: 'arrow', x: 0, y: 0, zIndex: 0 },
      { id: 'second', kind: 'text', x: 0, y: 0, text: 'Second', zIndex: -10 },
      { id: 'callout', kind: 'callout', x: 0, y: 0, text: 'Textual callout', zIndex: 1 },
    ];

    expect(
      textAnnotationReferences(annotations).map(({ annotation, noteNumber }) => [annotation.id, noteNumber]),
    ).toEqual([
      ['first', 1],
      ['second', 2],
      ['callout', 3],
    ]);
    expect([...textAnnotationNoteNumbers(annotations)]).toEqual([
      ['first', 1],
      ['second', 2],
      ['callout', 3],
    ]);
  });
});
