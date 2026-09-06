import type { NoteFields, ProjectData } from '../src/shared/types.js';
import type { LegacyProjectData } from '../src/shared/schema.js';
import { noteToMarkdown } from '../src/shared/notes.js';
import { mergeLegacyDescription } from './collections.js';

export function normalizeRecoveredProject(
  current: ProjectData,
  recovered: ProjectData | LegacyProjectData,
  notes: Record<string, NoteFields> = {},
): ProjectData {
  const recoveredById = new Map(recovered.screenshots.map((shot) => [shot.id, shot]));
  return {
    ...current,
    screenshots: current.screenshots.map((trustedShot) => {
      const recoveredShot = recoveredById.get(trustedShot.id);
      if (!recoveredShot) return trustedShot;
      const legacyNotes = notes[trustedShot.id];
      const description =
        recovered.schemaVersion === 3
          ? recoveredShot.description
          : mergeLegacyDescription(recoveredShot.description, legacyNotes ? noteToMarkdown(legacyNotes) : '');
      return {
        ...trustedShot,
        title: recoveredShot.title,
        description,
        priority: recoveredShot.priority === 'critical' ? 'high' : recoveredShot.priority,
        includeInExport: recoveredShot.includeInExport,
        updatedAt: recoveredShot.updatedAt,
      };
    }),
  };
}
