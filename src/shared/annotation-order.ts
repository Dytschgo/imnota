import type { Annotation } from './types';

export interface TextAnnotationReference {
  annotation: Annotation;
  noteNumber: number;
}

export function isTextAnnotation(annotation: Annotation): boolean {
  return (annotation.kind === 'text' || annotation.kind === 'callout') && Boolean(annotation.text?.trim());
}

/**
 * Text references follow persisted array order (creation order), never visual z-index.
 * Consumers in the canvas, PNG renderer, and Markdown exporter must share this helper.
 */
export function textAnnotationReferences(annotations: readonly Annotation[]): TextAnnotationReference[] {
  let noteNumber = 0;
  return annotations.flatMap((annotation) => {
    if (!isTextAnnotation(annotation)) return [];
    noteNumber += 1;
    return [{ annotation, noteNumber }];
  });
}

export function textAnnotationNoteNumbers(annotations: readonly Annotation[]): ReadonlyMap<string, number> {
  return new Map(
    textAnnotationReferences(annotations).map(({ annotation, noteNumber }) => [annotation.id, noteNumber]),
  );
}
