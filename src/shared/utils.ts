import type { Annotation, NoteFields, Priority, ProjectData } from './types.js';

export const DEFAULT_TAGS = [
  'Bug',
  'Feature',
  'UX',
  'UI',
  'Performance',
  'Security',
  'Accessibility',
  'Question',
];

export const EMPTY_NOTES: NoteFields = {
  summary: '',
  observation: '',
  problem: '',
  expectedBehaviour: '',
  requestedChange: '',
  technicalDetails: '',
  aiInstruction: '',
  additionalNotes: '',
};

export const DEFAULT_FIELDS: Array<keyof NoteFields> = [
  'summary',
  'observation',
  'problem',
  'expectedBehaviour',
  'requestedChange',
  'technicalDetails',
  'aiInstruction',
];

export const DEFAULT_EXPORT_PREFERENCES = {
  includeOriginalScreenshots: false,
  includeAnnotationMetadata: true,
  includedFields: DEFAULT_FIELDS,
  overallInstructions: '',
  desiredOutcome: '',
  technicalConstraints: '',
  template: 'default' as const,
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function sanitizeFilename(value: string, fallback = 'untitled'): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

export function slugify(value: string, fallback = 'project'): string {
  return sanitizeFilename(value.toLowerCase(), fallback).toLowerCase();
}

export function priorityColor(priority: Priority): string {
  const colors: Record<Priority, string> = {
    low: '#8f98aa',
    medium: '#3ec6e0',
    high: '#f59e0b',
    critical: '#ef4444',
  };
  return colors[priority];
}

export function emptyProject(name: string, description: string, tags: string[] = []): ProjectData {
  const date = nowIso();
  return {
    schemaVersion: 1,
    id: createId('project'),
    name: name.trim() || 'Untitled project',
    description: description.trim(),
    createdAt: date,
    updatedAt: date,
    status: 'active',
    tags,
    favourite: false,
    screenshots: [],
    exportPreferences: { ...DEFAULT_EXPORT_PREFERENCES },
  };
}

export function annotationLabel(annotation: Annotation): string {
  if (annotation.kind === 'step')
    return `Step ${annotation.stepNumber ?? 1}${annotation.text ? `: ${annotation.text}` : ''}`;
  if (annotation.kind === 'text' || annotation.kind === 'callout')
    return annotation.text?.trim() || annotation.kind;
  return annotation.kind.replace('-', ' ');
}
