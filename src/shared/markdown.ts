import type { Annotation, ProjectData, ScreenshotRecord } from './types.js';

export interface NumberedScreenshot {
  pictureNumber: number;
  screenshot: ScreenshotRecord;
}

/** Assign Picture numbers from collection sort order before export filtering. */
export function numberCollectionScreenshots(
  project: ProjectData,
  collectionId: string,
): NumberedScreenshot[] {
  return project.screenshots
    .filter((shot) => shot.collectionId === collectionId)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
    .map((screenshot, index) => ({ pictureNumber: index + 1, screenshot }));
}

function priorityLabel(priority: ScreenshotRecord['priority']): string {
  return priority[0].toUpperCase() + priority.slice(1);
}

export function generateMarkdown(
  project: ProjectData,
  collectionId: string,
  annotations: Record<string, Annotation[]>,
): string {
  const collection = project.collections.find((item) => item.id === collectionId);
  if (!collection) throw new Error('Collection not found.');
  const out = [`# ${collection.name}`, ''];
  if (collection.overallContext.trim())
    out.push('## Overall context', '', collection.overallContext.trim(), '');

  for (const { screenshot: shot, pictureNumber } of numberCollectionScreenshots(project, collectionId)) {
    if (!shot.includeInExport) {
      out.push(`Picture ${pictureNumber} was intentionally excluded from this prompt bundle.`, '');
      continue;
    }
    out.push(
      `## Picture ${pictureNumber} — ${shot.title || shot.originalFilename}`,
      '',
      `Priority for agent: ${priorityLabel(shot.priority)}`,
      '',
    );
    if (shot.description.trim()) out.push(shot.description.trim(), '');
    const textAnnotations = [...(annotations[shot.id] ?? [])]
      .sort((a, b) => a.zIndex - b.zIndex)
      .filter((annotation) => ['text', 'callout'].includes(annotation.kind) && annotation.text?.trim());
    textAnnotations.forEach((annotation, noteIndex) => {
      out.push(`### Picture ${pictureNumber} / Note ${noteIndex + 1}`, '', annotation.text!.trim(), '');
    });
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
