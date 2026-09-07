import { generateMarkdown, numberCollectionScreenshots } from '../shared/markdown';
import type { Annotation, ImagePayload, ImnotaBridge, ProjectData } from '../shared/types';

type Content = Awaited<ReturnType<ImnotaBridge['loadScreenshotContent']>>;

/** Capture ordering, export visibility, and in-memory edits before awaiting disk reads. */
export async function prepareContext(
  input: {
    project: ProjectData;
    projectPath: string;
    collectionId: string;
    active?: { id: string; content: Content };
  },
  load: ImnotaBridge['loadScreenshotContent'],
  render: (image: ImagePayload, annotations: Annotation[]) => Promise<string>,
  progress: (index: number, count: number) => void,
) {
  const snapshot = structuredClone(input);
  const numbered = numberCollectionScreenshots(snapshot.project, snapshot.collectionId);
  const included = numbered.filter(({ screenshot }) => screenshot.includeInExport);
  const annotations: Record<string, Annotation[]> = {};
  const images = [];
  for (const [index, { screenshot: shot, pictureNumber }] of included.entries()) {
    progress(index + 1, included.length);
    const content =
      snapshot.active?.id === shot.id
        ? snapshot.active.content
        : await load({ projectPath: snapshot.projectPath, screenshot: shot });
    annotations[shot.id] = content.annotations;
    images.push({
      filename: `${String(pictureNumber).padStart(2, '0')}-${shot.storedFilename.replace(/\.[^.]+$/, '')}-annotated.png`,
      dataUrl: await render(content.image, content.annotations),
    });
  }
  return {
    markdown: generateMarkdown(snapshot.project, snapshot.collectionId, annotations),
    images,
    projectPath: snapshot.projectPath,
    collectionId: snapshot.collectionId,
    preferences: snapshot.project.exportPreferences,
  };
}
