import type { Annotation, ProjectData, ProjectSnapshot } from '../src/shared/types.js';
import type { QuickCaptureDestination } from '../src/shared/quick-capture.js';
import type { PendingQuickCapture } from './quick-capture-store.js';

export interface QuickCaptureCommitHost {
  authorize(projectPath: string): Promise<string>;
  read(projectPath: string): Promise<ProjectData>;
  snapshot(projectPath: string): Promise<ProjectSnapshot>;
  insert(
    projectPath: string,
    collectionId: string,
    png: Buffer,
    assertAdmission: () => void,
    content: { id: string; annotations: Annotation[] },
  ): Promise<unknown>;
  assertAdmission(): void;
}

/** Called within the existing filesystem queue, including retries after an uncertain result. */
export async function commitQuickCapture(
  item: PendingQuickCapture,
  destination: QuickCaptureDestination,
  host: QuickCaptureCommitHost,
): Promise<void> {
  const projectPath = await host.authorize(destination.projectPath);
  const project = await host.read(projectPath);
  const existing = project.screenshots.find((shot) => shot.id === item.id);
  if (existing) {
    if (existing.collectionId !== destination.collectionId)
      throw new Error('The saved capture moved to another collection. Reload the project to review it.');
    // A committed insert may have lost only its snapshot response. Reopen it;
    // never write its PNG/annotations again or create another screenshot.
    await host.snapshot(projectPath);
    return;
  }
  if (
    project.status !== 'active' ||
    !project.collections.some(
      (collection) => collection.id === destination.collectionId && !collection.archived,
    )
  )
    throw new Error('That project or collection is no longer active. The capture is kept.');
  host.assertAdmission();
  await host.insert(projectPath, destination.collectionId, item.originalPng, host.assertAdmission, {
    id: item.id,
    annotations: item.annotations,
  });
}
