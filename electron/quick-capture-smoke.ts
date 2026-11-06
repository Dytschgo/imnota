import { nativeImage, screen } from 'electron';
import { openScreenshotProject, startCapture } from './capture-smoke.js';
import { exerciseQuickCaptureNativeDrag } from './quick-capture-drag-smoke.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nativeClipboard } from './native-clipboard.js';
import { NativeUiDriver, type SmokeCapture } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';

async function until(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Only the marked native runner's synthetic profile, workspace and screen source. */
export async function exerciseQuickCaptures(
  host: SmokeWorkflowHost,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  const artifacts: SmokeCapture[] = [];
  const floatingStates: { count: number; alwaysOnTop: boolean; visible: boolean }[] = [];
  const manager = host.quickCaptures();
  let dragFailure: Error | undefined;
  const verifyDrag = async (card: ReturnType<typeof manager.store.cards>[number]) => {
    if (dragFailure) return;
    try {
      await exerciseQuickCaptureNativeDrag(manager, card);
    } catch (error) {
      if (process.platform !== 'darwin') throw error;
      dragFailure = error instanceof Error ? error : new Error(String(error));
      // Still collect the remaining platform evidence, then fail this walkthrough.
      // A test host without input permission never becomes a drag pass or skip.
      console.error('macOS native drag evidence failed:', dragFailure.message);
    }
  };
  if (manager.store.size) throw new Error('Quick capture smoke requires a fresh isolated pending store.');
  const main = new NativeUiDriver(await host.reopenWindow());
  main.browserWindow.show();
  main.browserWindow.focus();
  await main.waitFor({ selector: '.workspace' });
  const projectPath = await openScreenshotProject(main);
  const before = await host.readProject(projectPath);
  const destination = { projectPath, collectionId: before.collections.find((item) => !item.archived)!.id };
  await main.evaluate(
    `(async()=>{const result=await window.imnota.setPreferenceSettings({capture:{quickAccessCorner:'right'}});if(!result.ok)throw new Error(result.error.message);})()`,
  );
  try {
    // Exercise the real opt-in capture workflow on Windows/macOS. Linux retains its
    // explicit Import/Paste capability boundary; use a synthetic in-memory PNG there.
    for (let index = 0; index < 3; index++) {
      if (process.platform === 'win32' || process.platform === 'darwin') {
        const overlay = await startCapture(main);
        const viewport = await overlay.evaluate<{ width: number; height: number }>(
          `({width:innerWidth,height:innerHeight})`,
        );
        await overlay.drag(
          { x: Math.round(viewport.width * 0.2), y: Math.round(viewport.height * 0.25) },
          { x: Math.round(viewport.width * (0.5 + index * 0.1)), y: Math.round(viewport.height * 0.7) },
        );
        await overlay.click({ selector: '[data-action="save"]' });
      } else {
        const width = 480 + index * 120,
          height = 300;
        const bitmap = Buffer.alloc(width * height * 4, 0xff);
        for (let offset = 0; offset < bitmap.length; offset += 4) bitmap[offset] = 30 + index * 60;
        await manager.add(nativeImage.createFromBitmap(bitmap, { width, height }).toPNG());
      }
      await until(
        () => manager.store.size === index + 1 && Boolean(manager.browserWindow?.isVisible()),
        'The selected capture did not appear in a persistent card.',
      );
      floatingStates.push({
        count: manager.store.size,
        alwaysOnTop: manager.browserWindow!.isAlwaysOnTop(),
        visible: manager.browserWindow!.isVisible(),
      });
    }
    if ((await host.readProject(projectPath)).screenshots.length !== before.screenshots.length)
      throw new Error('Quick capture wrote to the project before an explicit Add.');
    const window = manager.browserWindow!;
    if (window.isFocused()) throw new Error('Showing quick capture stole focus after capture.');
    if (window.isModal() || !window.isAlwaysOnTop())
      throw new Error(
        `Quick capture is not a nonmodal floating window: ${JSON.stringify({
          modal: window.isModal(),
          alwaysOnTop: window.isAlwaysOnTop(),
          visible: window.isVisible(),
          focused: window.isFocused(),
          url: window.webContents.getURL(),
          bounds: window.getBounds(),
          floatingStates,
        })}`,
      );
    const bounds = window.getBounds(),
      workArea = screen.getDisplayMatching(bounds).workArea;
    if (
      bounds.x < workArea.x ||
      bounds.y < workArea.y ||
      bounds.x + bounds.width > workArea.x + workArea.width ||
      bounds.y + bounds.height > workArea.y + workArea.height
    )
      throw new Error('Quick capture escaped the display work area.');
    const driver = new NativeUiDriver(window);
    window.show();
    window.focus();
    const cards = manager.store.cards();
    // The native store can fill before React paints, especially when Linux adds
    // synthetic PNGs without the intervening real capture-overlay interaction.
    for (const card of cards) await driver.waitFor({ selector: `[data-testid="quick-capture-${card.id}"]` });
    await verifyDrag(cards[0]);
    const second = cards[1];
    const expectedPixels = nativeImage
      .createFromBuffer(manager.store.item(second.id, second.revision).renderedPng)
      .toBitmap();
    await driver.evaluate(`document.querySelector('[data-testid="quick-capture-${second.id}"]').focus()`);
    await driver.press('Enter');
    await driver.waitFor({ selector: '[role="status"]', text: 'Image copied.', exact: true });
    if (!(await nativeClipboard.readImage()).toBitmap().equals(expectedPixels))
      throw new Error('Quick capture copied a different pending image.');
    if (artifactDirectory)
      artifacts.push(await driver.capture(artifactDirectory, 'quick-capture-three-cards.png', 'none'));
    await driver.press('E');
    await driver.waitForScreenshotCanvas({
      id: second.id,
      originalWidth: second.width,
      originalHeight: second.height,
      surface: 'quick-capture',
    });
    await driver.click({ selector: 'button', text: 'Redact', exact: true });
    const canvas = await driver.evaluate<{ x: number; y: number; width: number; height: number }>(
      `(()=>{const bounds=document.querySelector('.annotation-canvas').getBoundingClientRect();return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};})()`,
    );
    await driver.drag(
      { x: Math.round(canvas.x + canvas.width * 0.35), y: Math.round(canvas.y + canvas.height * 0.4) },
      { x: Math.round(canvas.x + canvas.width * 0.55), y: Math.round(canvas.y + canvas.height * 0.6) },
    );
    if (artifactDirectory)
      artifacts.push(
        await driver.capture(artifactDirectory, 'quick-capture-annotation.png', {
          id: second.id,
          originalWidth: second.width,
          originalHeight: second.height,
          surface: 'quick-capture',
        }),
      );
    await driver.click({ selector: 'button', text: 'Apply edits', exact: true });
    await until(
      () => manager.store.cards().find((item) => item.id === second.id)?.revision === 2,
      'Quick capture annotation did not apply.',
    );
    const edited = manager.store.item(second.id, 2);
    if (!edited.annotations.some((item) => item.kind === 'blur'))
      throw new Error('Quick capture did not preserve editable redaction annotations.');
    await driver.click({
      selector: `[data-testid="quick-capture-${second.id}"] button`,
      text: 'Copy image',
      exact: true,
    });
    await driver.waitFor({ selector: '[role="status"]', text: 'Image copied.', exact: true });
    if (
      !(await nativeClipboard.readImage())
        .toBitmap()
        .equals(nativeImage.createFromBuffer(edited.renderedPng).toBitmap())
    )
      throw new Error('Quick capture copy ignored applied annotations.');
    await verifyDrag(manager.store.cards().find((item) => item.id === second.id)!);
    const destinationSelector = `[data-testid="quick-capture-${second.id}"] select`;
    const destinationValue = JSON.stringify([destination.projectPath, destination.collectionId]);
    const destinationIndex = await driver.evaluate<number>(
      `(()=>{const select=document.querySelector(${JSON.stringify(destinationSelector)});select.focus();return [...select.options].findIndex(option=>option.value===${JSON.stringify(destinationValue)});})()`,
    );
    if (destinationIndex < 1) throw new Error('Quick Add did not offer the active fixture collection.');
    if (process.platform === 'darwin') {
      // macOS owns select popups outside webContents. Establish this setup through
      // the real React change handler; Add itself remains a trusted native click.
      await driver.evaluate(
        `(()=>{const select=document.querySelector(${JSON.stringify(destinationSelector)});select.value=${JSON.stringify(destinationValue)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    } else {
      await driver.press('Home');
      for (let step = 0; step < destinationIndex; step++) await driver.press('Down');
    }
    await driver.click({
      selector: `[data-testid="quick-capture-${second.id}"] button`,
      text: 'Add',
      exact: true,
    });
    await until(
      () => !manager.store.cards().some((item) => item.id === second.id),
      'Quick Add did not commit from its chosen collection control.',
    );
    // Replaying the same native contract after completion cannot insert again.
    const results = await driver.evaluate<Array<{ ok: boolean }>>(
      `Promise.all([window.imnotaQuickCapture.add(${JSON.stringify({ id: second.id, revision: 2, destination })}),window.imnotaQuickCapture.add(${JSON.stringify({ id: second.id, revision: 2, destination })})])`,
    );
    if (results.some((result) => result.ok)) throw new Error('Repeated quick Add reused a consumed capture.');
    const added = await host.readProject(projectPath);
    if (
      added.screenshots.filter((item) => item.id === second.id).length !== 1 ||
      added.screenshots.length !== before.screenshots.length + 1 ||
      manager.store.size !== 2
    )
      throw new Error('Quick Add duplicated the capture or disturbed another pending image.');
    const savedScreenshot = added.screenshots.find((item) => item.id === second.id)!;
    if (
      JSON.stringify(
        JSON.parse(await fs.readFile(path.join(projectPath, savedScreenshot.annotationFile), 'utf8')),
      ) !== JSON.stringify(edited.annotations)
    )
      throw new Error('Quick Add lost the editable annotations.');
    // Overlay Annotate must open this capture's compact editor without another
    // project write, while the two older pending captures remain intact.
    main.browserWindow.show();
    main.browserWindow.focus();
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const overlay = await startCapture(main);
      const viewport = await overlay.evaluate<{ width: number; height: number }>(
        `({width:innerWidth,height:innerHeight})`,
      );
      await overlay.drag(
        { x: Math.round(viewport.width * 0.2), y: Math.round(viewport.height * 0.25) },
        { x: Math.round(viewport.width * 0.55), y: Math.round(viewport.height * 0.6) },
      );
      await overlay.click({ selector: '[data-action="annotate"]' });
    } else {
      const bitmap = Buffer.alloc(400 * 300 * 4, 0xff);
      await manager.add(nativeImage.createFromBitmap(bitmap, { width: 400, height: 300 }).toPNG(), true);
    }
    await until(() => manager.store.size === 3, 'Overlay Annotate did not preserve its pending capture.');
    const automatic = manager.store
      .cards()
      .find((item) => !cards.some((original) => original.id === item.id))!;
    if (!automatic) throw new Error('Overlay Annotate did not identify one new capture.');
    await driver.waitForScreenshotCanvas({
      id: automatic.id,
      originalWidth: automatic.width,
      originalHeight: automatic.height,
      surface: 'quick-capture',
    });
    await driver.click({ selector: 'button', text: 'Cancel edits', exact: true });
    await driver.click({
      selector: `[data-testid="quick-capture-${automatic.id}"] button`,
      text: 'Discard',
      exact: true,
    });
    await until(
      () => manager.store.size === 2,
      'Closing overlay annotation disturbed another pending capture.',
    );
    // Discard only one of the other captures, then close/hide and explicitly reopen
    // the remaining card before discarding it. No pending data is silently evicted.
    await driver.click({
      selector: `[data-testid="quick-capture-${cards[0].id}"] button`,
      text: 'Discard',
      exact: true,
    });
    await until(() => manager.store.size === 1, 'Quick Discard changed the wrong pending capture.');
    await driver.evaluate(`document.querySelector('[data-testid="quick-capture-${cards[2].id}"]').focus()`);
    await driver.press('Escape');
    await until(() => !window.isVisible(), 'Escape did not hide quick capture.');
    if (Number(manager.store.size) !== 1) throw new Error('Hiding quick capture discarded a pending item.');
    await manager.show(true);
    window.close();
    if (window.isDestroyed() || Number(manager.store.size) !== 1)
      throw new Error('Closing quick access destroyed its pending capture.');
    await manager.show(true);
    await driver.waitFor({ selector: `[data-testid="quick-capture-${cards[2].id}"]` });
    await driver.click({
      selector: `[data-testid="quick-capture-${cards[2].id}"] button`,
      text: 'Discard',
      exact: true,
    });
    await until(() => manager.store.size === 0, 'Final Discard left a stuck quick capture.');
    if ((await host.readProject(projectPath)).screenshots.length !== before.screenshots.length + 1)
      throw new Error('Copy or Discard created extra project items.');
    if (dragFailure) throw new Error('macOS native PNG drag remains unverified: ' + dragFailure.message);
  } finally {
    await main.evaluate(
      `(async()=>{const result=await window.imnota.setPreferenceSettings({capture:{quickAccessCorner:'off'}});if(!result.ok)throw new Error(result.error.message);})()`,
    );
  }
  return artifacts;
}
