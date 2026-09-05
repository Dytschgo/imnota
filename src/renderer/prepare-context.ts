import { generateMarkdown } from '../shared/markdown';
import type { Annotation, ImagePayload, ImnotaBridge, NoteFields, ProjectData } from '../shared/types';

type Content = Awaited<ReturnType<ImnotaBridge['loadScreenshotContent']>>;

/** Capture selection and in-memory edits before awaiting any disk read or render. */
export async function prepareContext(
  input: {
    project: ProjectData;
    projectPath: string;
    roundId?: string;
    active?: { id: string; content: Content };
  },
  load: ImnotaBridge['loadScreenshotContent'],
  render: (image: ImagePayload, annotations: Annotation[]) => Promise<string>,
  progress: (index: number, count: number) => void,
) {
  const snapshot = structuredClone(input);
  const shots = snapshot.project.screenshots.filter(
    (shot) => shot.includeInExport && (!snapshot.roundId || shot.roundId === snapshot.roundId),
  );
  const notes: Record<string, NoteFields> = {};
  const annotations: Record<string, Annotation[]> = {};
  const images = [];
  for (const [index, shot] of shots.entries()) {
    progress(index + 1, shots.length);
    const content =
      snapshot.active?.id === shot.id
        ? snapshot.active.content
        : await load({ projectPath: snapshot.projectPath, screenshot: shot });
    // Each reference is read once; the same content supplies text and pixels.
    notes[shot.id] = content.notes;
    annotations[shot.id] = content.annotations;
    images.push({
      filename: `${shot.storedFilename.replace(/\.[^.]+$/, '')}-annotated.png`,
      dataUrl: await render(content.image, content.annotations),
    });
  }
  return {
    markdown: generateMarkdown(snapshot.project, shots, notes, annotations),
    images,
    projectPath: snapshot.projectPath,
    roundId: snapshot.roundId,
    preferences: snapshot.project.exportPreferences,
  };
}
