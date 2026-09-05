import type { NoteFields } from './types.js';
import { EMPTY_NOTES } from './utils.js';

export function noteToMarkdown(notes: NoteFields): string {
  return Object.entries(notes)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `## ${key}\n\n${value.trim()}\n`)
    .join('\n');
}

export function parseNotesMarkdown(markdown: string): NoteFields {
  const notes = { ...EMPTY_NOTES };
  let field: keyof NoteFields | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (\w+)\s*$/.exec(line)?.[1];
    if (heading && Object.hasOwn(notes, heading)) field = heading as keyof NoteFields;
    else if (field) notes[field] += `${line}\n`;
  }
  for (const key of Object.keys(notes) as Array<keyof NoteFields>) notes[key] = notes[key].trim();
  return notes;
}
