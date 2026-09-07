import { generateMarkdown, orderedCollectionItems, type CollectionContentItem } from '../shared/markdown';
import type { Annotation, ImagePayload, ImnotaBridge, ProjectData, ScreenshotRecord } from '../shared/types';

type ScreenshotContent = Awaited<ReturnType<ImnotaBridge['loadScreenshotContent']>>;
type ContentItemLoad = {
  item: CollectionContentItem;
  markdown?: string;
  source?: string;
  image?: ImagePayload;
  contentRevision: string;
};

/** Capture ordering, export visibility, and in-memory edits before awaiting disk reads. */
export async function prepareContext(
  input: {
    project: ProjectData;
    projectPath: string;
    collectionId: string;
    active?: { id: string; content: ScreenshotContent };
  },
  load: ImnotaBridge['loadScreenshotContent'],
  render: (image: ImagePayload, annotations: Annotation[]) => Promise<string>,
  progress: (index: number, count: number) => void,
  loadContentItem?: (input: { projectPath: string; itemId: string }) => Promise<ContentItemLoad>,
) {
  const snapshot = structuredClone(input);
  const annotations: Record<string, Annotation[]> = {};
  const markdownByTextItem: Record<string, string> = {};
  const images: Array<{ filename: string; dataUrl: string }> = [];
  const sourceAssets: Array<{ filename: string; source: string }> = [];
  const ordered = orderedCollectionItems(snapshot.project, snapshot.collectionId);
  const visualCount = ordered.filter((item) => item.kind !== 'text' && item.item.includeInExport).length;
  let visualNumber = 0;
  let progressIndex = 0;

  for (const entry of ordered) {
    if (entry.kind === 'text') {
      if (!entry.item.includeInExport) continue;
      if (!loadContentItem) throw new Error('Mixed text export requires the native content-item bridge.');
      const content = await loadContentItem({ projectPath: snapshot.projectPath, itemId: entry.item.id });
      markdownByTextItem[entry.item.id] = content.markdown ?? '';
      continue;
    }

    visualNumber += 1;
    if (!entry.item.includeInExport) continue;
    progress(++progressIndex, visualCount);

    if (entry.kind === 'drawing') {
      if (!loadContentItem) throw new Error('Mixed drawing export requires the native content-item bridge.');
      const content = await loadContentItem({ projectPath: snapshot.projectPath, itemId: entry.item.id });
      if (!content.image) throw new Error('Drawing image is unavailable. Save the drawing and try again.');
      images.push({
        filename: `${String(visualNumber).padStart(2, '0')}-${content.image.filename.replace(/\.[^.]+$/, '')}-drawing.png`,
        dataUrl: content.image.dataUrl,
      });
      if (content.source && entry.item.sourceFilename)
        sourceAssets.push({ filename: entry.item.sourceFilename, source: content.source });
      continue;
    }

    const shot = entry.item as ScreenshotRecord;
    const content =
      snapshot.active?.id === shot.id
        ? snapshot.active.content
        : await load({ projectPath: snapshot.projectPath, screenshot: shot });
    annotations[shot.id] = content.annotations;
    images.push({
      filename: `${String(visualNumber).padStart(2, '0')}-${shot.storedFilename.replace(/\.[^.]+$/, '')}-annotated.png`,
      dataUrl: await render(content.image, content.annotations),
    });
  }
  return {
    markdown: generateMarkdown(snapshot.project, snapshot.collectionId, annotations, markdownByTextItem),
    images,
    sourceAssets,
    projectPath: snapshot.projectPath,
    collectionId: snapshot.collectionId,
    preferences: snapshot.project.exportPreferences,
  };
}
