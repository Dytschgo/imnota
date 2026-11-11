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
  template: 'default' as const,
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

/** For newly generated disk names only; never rewrite stored references while loading. */
export function portableFilename(value: string): string {
  const cleaned = [...value]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && (code < 127 || code > 159);
    })
    .join('')
    .replace(/[\\/<>:"|?*]/g, '-')
    .slice(0, 254)
    .replace(/[. ]+$/g, '');
  const name = cleaned || 'untitled';
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name.split('.')[0].trimEnd()) ? `_${name}` : name;
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
  };
  return colors[priority];
}

export function collectionName(workspaceName: string, number: number): string {
  return `${workspaceName.trim() || 'Workspace'} / Collection ${String(number).padStart(2, '0')}`;
}

export function emptyProject(name: string, description: string, workspaceName = 'Workspace'): ProjectData {
  const date = nowIso();
  return {
    schemaVersion: 3,
    collections: [
      {
        id: '001-collection',
        name: collectionName(workspaceName, 1),
        archived: false,
        createdAt: date,
        updatedAt: date,
        overallContext: '',
      },
    ],
    id: createId('project'),
    name: name.trim() || 'Untitled project',
    description: description.trim(),
    createdAt: date,
    updatedAt: date,
    status: 'active',
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
