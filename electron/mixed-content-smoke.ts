import fs from 'node:fs/promises';
import path from 'node:path';
import { clipboard, nativeImage } from 'electron';
import JSZip from 'jszip';
import type { NativeUiDriver, SmokeCapture } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';

/** Exercises the real preload, local files, editor input and autosave in disposable fixtures. */
export async function exerciseMixedContent(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  const projectPath = await driver.evaluate<string>(`(async () => {
    const snapshot = await window.imnota.createProject({name:'Mixed Content Verification',description:''});
    await window.imnota.createContentItem({projectPath:snapshot.projectPath,collectionId:snapshot.project.collections[0].id,kind:'text'});
    return snapshot.projectPath;
  })()`);
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Mixed Content Verification' });
  await driver.click({ selector: '.project-row-main', text: 'Mixed Content Verification' });
  await driver.waitFor({ selector: '[data-testid="markdown-input"]' });
  driver.setWindow(await host.reopenWindow());
  await driver.fill(
    { selector: '[data-testid="markdown-input"]' },
    '# System overview\n\nThe API sends work to the queue.',
  );
  await driver.click({ text: 'Preview', exact: true });
  await driver.waitFor({ selector: '.markdown-preview h1', text: 'System overview' });
  await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
  await driver.waitFor(
    {
      selector:
        '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]:not(:disabled)',
    },
    { timeoutMs: 30_000 },
  );
  await driver.click({ selector: '[data-testid="copy-bundle-1"]' });
  await driver.waitFor(
    {
      selector:
        '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"].is-copied',
    },
    { timeoutMs: 30_000 },
  );
  if (!clipboard.readText().includes('# System overview') || !clipboard.readImage().isEmpty())
    throw new Error('Text-only prompt copy must contain Markdown without a placeholder image.');
  await driver.click({ selector: '[data-testid="prompt-sharing-close"]' });
  await driver.resize({ width: 1280, height: 800 });
  await driver.click({ text: 'Add item', exact: true });
  await driver.click({ selector: '.add-item-popover [role="menuitem"]', text: 'Drawing' });
  await driver.waitFor({ selector: '[data-testid="drawing-editor"]' });
  await driver.click({ selector: '[data-testid="drawing-tool-rectangle"]' });
  const canvas = await driver.waitFor({ selector: '.drawing-editor .excalidraw__canvas.interactive' });
  const point = (x: number, y: number) => ({
    x: Math.round(canvas.x + canvas.width * x),
    y: Math.round(canvas.y + canvas.height * y),
  });
  await driver.drag(point(0.1, 0.25), point(0.35, 0.4));
  await driver.click({ selector: '[data-testid="drawing-tool-rectangle"]' });
  await driver.drag(point(0.6, 0.25), point(0.85, 0.4));
  await driver.click({ selector: '[data-testid="drawing-tool-arrow"]' });
  await driver.drag(point(0.35, 0.325), point(0.6, 0.325));
  await driver.click({ selector: '[data-testid="drawing-tool-select"]' });
  await driver.drag(point(0.1, 0.325), point(0.1, 0.525));
  if (artifactDirectory) {
    await driver.resize({ width: 1440, height: 900 });
    captures.push(await driver.capture(artifactDirectory, 'mixed-content-drawing.png'));
  }
  // Leaving the canvas flushes the source and PNG before selection can change.
  const savedTextId = (await host.readProject(projectPath)).contentItems?.find(
    (item) => item.kind === 'text',
  )?.id;
  if (!savedTextId) throw new Error('Text item was lost while creating a drawing.');
  await driver.click({ selector: `[data-testid="screenshot-${savedTextId}"]` });
  await driver.waitFor({ selector: '[data-testid="markdown-input"]' });
  const project = await host.readProject(projectPath);
  const drawing = project.contentItems?.find((item) => item.kind === 'drawing');
  const text = project.contentItems?.find((item) => item.kind === 'text');
  if (!drawing || !text || project.schemaVersion !== 4)
    throw new Error('Mixed project records were not persisted.');
  const directory = path.join(projectPath, 'collections', drawing.collectionId);
  const source = JSON.parse(
    await fs.readFile(path.join(directory, 'drawings', drawing.sourceFilename), 'utf8'),
  ) as {
    type: string;
    elements: Array<{
      type: string;
      startBinding?: { elementId: string };
      endBinding?: { elementId: string };
    }>;
  };
  if (source.type !== 'excalidraw' || !source.elements.some((element) => element.type === 'rectangle'))
    throw new Error('Drawing interaction did not persist an editable rectangle.');
  const connector = source.elements.find((element) => element.type === 'arrow');
  if (!connector?.startBinding?.elementId || !connector.endBinding?.elementId)
    throw new Error('Architecture connector did not remain attached after moving a shape.');
  const png = nativeImage.createFromPath(path.join(directory, 'drawings', drawing.imageFilename));
  const dimensions = png.getSize();
  if (png.isEmpty() || dimensions.width <= 100 || dimensions.height <= 80)
    throw new Error('Drawing PNG was not rendered.');
  const pixels = png.toBitmap();
  if (pixels[0] !== 255 || pixels[1] !== 255 || pixels[2] !== 255 || pixels[3] !== 255)
    throw new Error('Drawing PNG does not have a white padded background.');
  let darkPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4)
    if (pixels[offset] < 180 && pixels[offset + 1] < 180 && pixels[offset + 2] < 180) darkPixels += 1;
  if (darkPixels < 100) throw new Error('Drawing PNG lost its visible shapes.');
  if (artifactDirectory)
    await fs.copyFile(
      path.join(directory, 'drawings', drawing.imageFilename),
      path.join(artifactDirectory, 'drawing-output.png'),
    );
  const markdown = await fs.readFile(path.join(directory, 'text', text.markdownFilename), 'utf8');
  if (!markdown.includes('# System overview'))
    throw new Error('Text Markdown did not autosave before navigation.');
  await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
  await driver.waitFor(
    {
      selector:
        '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]:not(:disabled)',
    },
    { timeoutMs: 30_000 },
  );
  await driver.click({ selector: '[data-testid="copy-bundle-1"]' });
  await driver.waitFor(
    {
      selector:
        '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"].is-copied',
    },
    { timeoutMs: 30_000 },
  );
  const mixedMarkdown = clipboard.readText();
  if (
    !mixedMarkdown.includes('# System overview') ||
    !mixedMarkdown.includes('Drawing 1') ||
    clipboard.readImage().isEmpty()
  )
    throw new Error('Mixed prompt copy must combine the written explanation and rendered drawing.');
  if (mixedMarkdown.indexOf('# System overview') > mixedMarkdown.indexOf('Drawing 1'))
    throw new Error('Mixed prompt Markdown changed the collection order.');
  const packagePath = await driver.evaluate<string>(`(async () => {
    const result = await window.imnota.exportPackage({projectPath:${JSON.stringify(projectPath)},collectionId:${JSON.stringify(drawing.collectionId)},markdown:${JSON.stringify(mixedMarkdown)},annotatedImages:[],includeOriginal:true,includeAnnotations:true});
    return result.zipPath;
  })()`);
  const archive = await JSZip.loadAsync(await fs.readFile(packagePath));
  const archiveFolder = `collections/${drawing.collectionId}`;
  if (
    !(await archive.file(`${archiveFolder}/text/${text.markdownFilename}`)?.async('string'))?.includes(
      '# System overview',
    ) ||
    !archive.file(`${archiveFolder}/drawings/${drawing.sourceFilename}`) ||
    !archive.file(`${archiveFolder}/drawings/${drawing.imageFilename}`)
  )
    throw new Error('Package export omitted local Markdown, editable drawing source, or its PNG.');
  await driver.click({ selector: '[data-testid="prompt-sharing-close"]' });
  await driver.evaluate(`(async () => {
    const input = {projectPath:${JSON.stringify(projectPath)},itemId:${JSON.stringify(drawing.id)}};
    const copy = await window.imnota.duplicateContentItem(input);
    if (copy.project.contentItems.length !== 3) throw new Error('Drawing duplication failed');
    const result = await window.imnota.deleteContentItem(input);
    const restored = await window.imnota.undoDeleteContentItem({projectPath:input.projectPath,undoToken:result.undoToken});
    if (!restored.project.contentItems.some(item=>item.id===input.itemId)) throw new Error('Drawing Undo failed');
    return true;
  })()`);
  // The bridge copy operation for Markdown has no image dependency.
  await driver.evaluate(`window.imnota.copyText(${JSON.stringify(markdown)})`);
  if (clipboard.readText() !== markdown) throw new Error('Text-only clipboard content changed.');
  driver.setWindow(await host.reopenWindow());
  await driver.waitFor({ selector: '[data-testid="markdown-input"]' });
  if (artifactDirectory) {
    await driver.resize({ width: 1440, height: 900 });
    await driver.click({ text: 'Preview', exact: true });
    await driver.waitFor({ selector: '.markdown-preview h1', text: 'System overview' });
    await driver.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    captures.push(await driver.capture(artifactDirectory, 'mixed-content-text.png'));
  }
  return captures;
}
