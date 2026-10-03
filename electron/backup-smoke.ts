import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { nativeImage } from 'electron';
import type { ProjectData, ProjectSnapshot } from '../src/shared/types.js';
import { nativeClipboard } from './native-clipboard.js';
import { contentItemRelativePaths } from './content-paths.js';
import type { NativeUiDriver, SmokeCapture, SmokeCheckpoint } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';

/** Uses only projects created by the isolated native smoke workflow. */
export async function exerciseLocalHistory(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  artifactDirectory?: string,
  checkpoint: SmokeCheckpoint = async () => undefined,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  await checkpoint('history: locating mixed fixture');
  const sourcePath = await driver.evaluate<string>(`(async () => {
    const projects = await window.imnota.listProjects();
    return projects.find(project => project.name === 'Mixed Content Verification').projectPath;
  })()`);
  const project = await host.readProject(sourcePath);
  const initialPixels = Buffer.alloc(48 * 32 * 4, 0xcc);
  for (let offset = 3; offset < initialPixels.length; offset += 4) initialPixels[offset] = 255;
  await checkpoint('history: writing fixture image to clipboard');
  await nativeClipboard.writeImage(nativeImage.createFromBitmap(initialPixels, { width: 48, height: 32 }));
  await checkpoint('history: pasting fixture image');
  const pasted = await driver.evaluate<ProjectSnapshot>(
    `window.imnota.pasteImage(${JSON.stringify(sourcePath)}, ${JSON.stringify(project.collections[0].id)})`,
  );
  const historyShots = pasted.project.screenshots.filter(
    (shot) => !project.screenshots.some((existing) => existing.id === shot.id),
  );
  if (historyShots.length !== 1) throw new Error('History paste did not create exactly one screenshot.');
  const historyShotId = historyShots[0].id;
  const expected = pasted.project;
  if (
    expected.schemaVersion !== 4 ||
    project.screenshots.length !== 1 ||
    expected.screenshots.length !== 2 ||
    expected.contentItems?.filter((item) => item.kind === 'drawing').length !== 2 ||
    expected.contentItems?.filter((item) => item.kind === 'text').length !== 1
  )
    throw new Error('History requires the complete Recently deleted mixed-content fixture.');
  if (!expected.screenshots.some((shot) => shot.id === project.screenshots[0].id))
    throw new Error('History paste lost the Recently deleted screenshot.');
  const verifyMembership = (actual: ProjectData) => {
    const membership = (value: ProjectData) => ({
      schemaVersion: value.schemaVersion,
      collections: value.collections.map((collection) => collection.id).sort(),
      screenshots: value.screenshots.map((shot) => [shot.id, shot.collectionId]).sort(),
      contentItems: (value.contentItems ?? []).map((item) => [item.id, item.collectionId, item.kind]).sort(),
    });
    deepStrictEqual(
      membership(actual),
      membership(expected),
      'History changed the complete fixture membership.',
    );
  };
  await checkpoint('history: mixed fixture image inserted');
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Backups & history', exact: true });
  await driver.waitFor({ selector: '[aria-label="Project snapshots"][aria-busy="false"]' });
  const projectOption = await driver.evaluate<number>(
    `[...document.querySelector('[aria-label="Project to snapshot"]').options].findIndex(option => option.value === ${JSON.stringify(sourcePath)})`,
  );
  if (projectOption < 0) throw new Error('The mixed fixture is absent from the snapshot chooser.');
  // Like the existing update-channel smoke selector, drive React's native-select
  // change path directly: the OS popup does not receive webContents key events.
  await driver.evaluate(`(() => {
    const select = document.querySelector('[aria-label="Project to snapshot"]');
    select.value = ${JSON.stringify(sourcePath)};
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const selectedPath = await driver.evaluate<string>(`new Promise(resolve => requestAnimationFrame(() =>
    resolve(document.querySelector('[aria-label="Project to snapshot"]').value)))`);
  if (selectedPath !== sourcePath)
    throw new Error('The snapshot chooser did not retain its selected project.');
  await checkpoint('history: creating snapshot');
  await driver.click({ selector: '.imnota-backup-manual button', text: 'Create snapshot', exact: true });
  await checkpoint('history: snapshot click returned');
  await driver.waitFor({
    selector: '.imnota-backup-status',
    text: 'Snapshot created for Mixed Content Verification.',
  });
  await driver.waitFor({
    selector: '.imnota-history-actions button',
    text: 'Restore as new project',
    exact: true,
  });
  await checkpoint('history: snapshot status and restore action observed');
  const snapshot = await driver.evaluate<{
    snapshotId: string;
    files: Array<{ path: string }>;
  }>(`(async () => {
    const history = await window.imnota.getBackupHistory();
    const entry = history.snapshots.find(snapshot => snapshot.sourceProjectName === 'Mixed Content Verification');
    return (await window.imnota.inspectBackupSnapshot({ snapshotId: entry.snapshotId })).manifest;
  })()`);
  await checkpoint('history: snapshot listed and inspected');
  const originals = new Map<string, Buffer>();
  for (const file of snapshot.files)
    originals.set(file.path, await fs.readFile(path.join(sourcePath, file.path)));
  const fixtureFiles = expected.screenshots.flatMap((shot) => [
    `collections/${shot.collectionId}/screenshots/${shot.storedFilename}`,
    shot.annotationFile,
    shot.descriptionFile,
  ]);
  for (const item of expected.contentItems ?? [])
    fixtureFiles.push(...Object.values(contentItemRelativePaths(item)));
  for (const relative of ['project.json', ...fixtureFiles])
    if (!originals.has(relative)) throw new Error(`History snapshot omitted fixture file ${relative}.`);
  const verifyContent = async (projectPath: string, editedDescription?: string) => {
    for (const [relative, source] of originals) {
      if (relative === 'project.json' || relative === editedDescription) continue;
      if (!(await fs.readFile(path.join(projectPath, relative))).equals(source))
        throw new Error(`History changed the restored content ${relative}.`);
    }
  };
  await checkpoint('history: original fixture files read');
  const backupRoot = await driver.evaluate<string>(
    'window.imnota.getBackupHistory().then(value => value.location)',
  );
  const snapshotDataPath = path.join(
    backupRoot,
    'snapshots',
    createHash('sha256').update(project.id).digest('hex').slice(0, 32),
    snapshot.snapshotId,
    'data',
  );
  verifyMembership(
    JSON.parse(await fs.readFile(path.join(snapshotDataPath, 'project.json'), 'utf8')) as ProjectData,
  );
  await verifyContent(snapshotDataPath);
  const rejectedBackupOpen =
    await driver.evaluate<boolean>(`window.imnota.loadProject(${JSON.stringify(snapshotDataPath)})
    .then(() => false, error => error.message.includes('Backup and recovery folders cannot be opened'))`);
  if (!rejectedBackupOpen) throw new Error('Snapshot data was admitted as an active project.');
  if (
    !(await fs.readFile(path.join(snapshotDataPath, 'project.json'))).equals(originals.get('project.json')!)
  )
    throw new Error('Rejected backup open modified the snapshot metadata.');
  await checkpoint('history: reserved-path rejection verified');
  if (artifactDirectory) {
    driver.browserWindow.show();
    driver.browserWindow.focus();
    await driver.resize({ width: 1280, height: 800 });
    await checkpoint('history: viewport resized; waiting for rendered frames');
    await driver.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await checkpoint('history: rendered frames ready; capturing history');
    captures.push(await driver.capture(artifactDirectory, 'next-local-history.png'));
    await checkpoint('history: history capture completed');
  }
  // Closing and reopening must not depend on an in-memory backup grant.
  await checkpoint('history: snapshot verified; reopening before restore');
  driver.setWindow(await host.reopenWindow());
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Backups & history', exact: true });
  await driver.waitFor({ selector: '[aria-label="Project snapshots"][aria-busy="false"]' });
  await driver.click({ selector: '.imnota-history-row', text: 'Mixed Content Verification' });
  await driver.click({
    selector: '.imnota-history-actions button',
    text: 'Restore as new project',
    exact: true,
  });
  await driver.waitFor({ selector: '[data-testid="workspace"]' });
  const restoredPath = await driver.evaluate<string>(`(async () => {
    const projects = await window.imnota.listProjects();
    return projects.find(project => project.name === 'Mixed Content Verification restored').projectPath;
  })()`);
  if (restoredPath === sourcePath) throw new Error('Restore-as-new reused the source project folder.');
  const restored = await host.readProject(restoredPath);
  verifyMembership(restored);
  for (const [relative, source] of originals) {
    if (!(await fs.readFile(path.join(sourcePath, relative))).equals(source))
      throw new Error(`Restore-as-new changed the source ${relative}.`);
    if (relative !== 'project.json' && !(await fs.readFile(path.join(restoredPath, relative))).equals(source))
      throw new Error(`Restore-as-new changed the restored content ${relative}.`);
  }
  driver.setWindow(await host.reopenWindow());
  await driver.waitFor({ selector: '[data-testid="workspace"]' });
  await driver.waitFor({
    selector: '.crumb-muted',
    text: 'Mixed Content Verification restored',
    exact: true,
  });
  verifyMembership(await host.readProject(restoredPath));
  await verifyContent(restoredPath);
  if (artifactDirectory) {
    driver.browserWindow.show();
    driver.browserWindow.focus();
    await driver.resize({ width: 1280, height: 800 });
    await driver.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    captures.push(await driver.capture(artifactDirectory, 'next-restored-project.png'));
  }

  // Exercise the same path/ID with a newer image already loaded in the editor.
  await checkpoint('history: restored copy reopened; checking in-place restore');
  // Only this isolated source fixture is modified; no real desktop or user files.
  const shot = restored.screenshots.find((item) => item.id === historyShotId);
  if (!shot) throw new Error('The pasted history screenshot was lost on restore.');
  await driver.click({ selector: `[data-testid="screenshot-${shot.id}"]` });
  const before = '204,204,204,255';
  await waitForCanvasPixel(driver, before);
  const originalImage = snapshot.files.find((file) =>
    file.path.endsWith(`/screenshots/${shot.storedFilename}`),
  );
  if (!originalImage) throw new Error('Snapshot original image is absent.');
  const newer = Buffer.alloc(48 * 32 * 4);
  for (let offset = 0; offset < newer.length; offset += 4) {
    newer[offset] = 85;
    newer[offset + 1] = 85;
    newer[offset + 2] = 85;
    newer[offset + 3] = 255;
  }
  await fs.writeFile(
    path.join(sourcePath, originalImage.path),
    nativeImage.createFromBitmap(newer, { width: 48, height: 32 }).toPNG(),
  );
  await openFixtureProject(driver, 'Mixed Content Verification');
  await driver.click({ selector: `[data-testid="screenshot-${shot.id}"]` });
  await waitForCanvasPixel(driver, '85,85,85,255');
  await driver.fill({ selector: '[aria-label="Description"]' }, 'Before restoring');
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Backups & history', exact: true });
  await driver.waitFor({ selector: '[aria-label="Project snapshots"][aria-busy="false"]' });
  await driver.click({ selector: '.imnota-history-row', text: 'Mixed Content Verification' });
  await driver.click({ selector: '.imnota-restore-in-place-link' });
  await host.approveNextBackupRestore(sourcePath);
  await driver.click({ selector: '.imnota-restore-confirm button', text: 'Restore in place', exact: true });
  await driver.waitFor({ selector: '[data-testid="workspace"]' });
  await driver.click({ selector: `[data-testid="screenshot-${shot.id}"]` });
  await waitForCanvasPixel(driver, before);
  const description = await driver.evaluate<string>(
    'document.querySelector("[aria-label=Description]").value',
  );
  if (description === 'Before restoring') throw new Error('In-place restore retained the old editor draft.');
  verifyMembership(await host.readProject(sourcePath));
  await verifyContent(sourcePath);
  await driver.fill({ selector: '[aria-label="Description"]' }, 'Edited after restoring');
  await driver.click({ selector: '.nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.project-list' });
  const edited = await host.readProject(sourcePath);
  verifyMembership(edited);
  if (edited.screenshots.find((item) => item.id === historyShotId)?.description !== 'Edited after restoring')
    throw new Error('Editing after restore did not persist against the restored revision.');
  driver.setWindow(await host.reopenWindow());
  await driver.waitFor({ selector: '[data-testid="workspace"]' });
  await driver.click({ selector: `[data-testid="screenshot-${shot.id}"]` });
  await waitForCanvasPixel(driver, before);
  const reopenedProject = await host.readProject(sourcePath);
  verifyMembership(reopenedProject);
  if (
    reopenedProject.screenshots.find((item) => item.id === historyShotId)?.description !==
    'Edited after restoring'
  )
    throw new Error('The history screenshot edit was lost on reopen.');
  await verifyContent(sourcePath, shot.descriptionFile);
  if (
    !(await fs.readFile(path.join(sourcePath, originalImage.path))).equals(originals.get(originalImage.path)!)
  )
    throw new Error('Editing after restore changed the restored source image.');
  const reopened = await driver.evaluate<string>('document.querySelector("[aria-label=Description]").value');
  if (reopened !== 'Edited after restoring') throw new Error('The post-restore edit was lost on reopen.');
  if (artifactDirectory) captures.push(await driver.capture(artifactDirectory, 'next-in-place-restored.png'));
  return captures;
}

async function openFixtureProject(driver: NativeUiDriver, name: string): Promise<void> {
  await driver.click({ selector: '.nav-item', text: 'Projects', exact: true });
  if (await driver.exists({ selector: '[aria-label="Search projects"]' }))
    await driver.fill({ selector: '[aria-label="Search projects"]' }, '');
  await driver.click({ selector: '.project-row strong', text: name, exact: true });
  await driver.waitFor({ selector: '[data-testid="workspace"]' });
}

async function canvasPixel(driver: NativeUiDriver): Promise<string> {
  await driver.waitFor({ selector: '.canvas-meta > span:first-child', text: '48 × 32' });
  return driver.evaluate<string>(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const wrap = document.querySelector('[data-testid="annotation-canvas"]');
    const canvas = wrap.querySelector('.konvajs-content canvas');
    const scale = Number(wrap.dataset.imageScale);
    const x = (Number(wrap.dataset.imageX) + (Number(wrap.dataset.sourceX || 0) + 24) * scale) * canvas.width / canvas.clientWidth;
    const y = (Number(wrap.dataset.imageY) + (Number(wrap.dataset.sourceY || 0) + 16) * scale) * canvas.height / canvas.clientHeight;
    resolve([...canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data].join(','));
  })))`);
}

async function waitForCanvasPixel(driver: NativeUiDriver, expected: string): Promise<void> {
  const start = Date.now();
  let actual = '';
  do {
    actual = await canvasPixel(driver);
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() - start < 5_000);
  throw new Error(`Expected restored canvas pixel ${expected}, received ${actual}.`);
}
