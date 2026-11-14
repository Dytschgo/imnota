import type { NativeUiDriver, SmokeCapture } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Runs only against the existing isolated, synthetic native-walkthrough project. */
export async function exerciseScreenshotComparison(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  projectPath: string,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  const before = await host.readProject(projectPath);
  const collection = before.collections.find((entry) => !entry.archived)!;
  const shots = before.screenshots
    .filter((shot) => shot.collectionId === collection.id)
    .sort((a, b) => a.position - b.position);
  if (shots.length < 2 || collection.comparison)
    throw new Error('Comparison smoke requires an unpaired synthetic collection with two screenshots.');
  if (await driver.exists({ selector: '.settings-view' }))
    await driver.click({ selector: '[aria-label="Back to workspace"]' });
  await driver.waitFor({ selector: '.workspace' });
  const chooseOption = async (label: string, index: number) => {
    if (process.platform === 'darwin') {
      // macOS owns select popups outside webContents. As in the channel walkthrough,
      // establish the option through the real React change handler; subsequent Save,
      // reopen, range keys and scrolling remain native observations.
      await driver.evaluate(`(()=>{
        const select=document.querySelector('select[aria-label="${label}"]');
        select.focus(); select.value=select.options[${index}].value;
        select.dispatchEvent(new Event('input',{bubbles:true}));
        select.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
    } else {
      await driver.evaluate(`document.querySelector('select[aria-label="${label}"]').focus()`);
      await driver.press('Home');
      for (let step = 0; step < index; step++) await driver.press('Down');
    }
  };
  await driver.click({ selector: '[data-testid="compare-screenshots"]' });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Compare screenshots' });
  // Select existing screenshots; macOS uses the documented popup setup above.
  for (const [label, index] of [
    ['Current screenshot', 0],
    ['Expected screenshot', 1],
  ] as const) {
    await chooseOption(label, index);
  }
  await driver.waitFor({ selector: 'img[alt="Expected annotated screenshot"]' });
  await driver.evaluate(
    `Promise.all(Array.from(document.querySelectorAll('.comparison-viewport img')).map((image)=>image.decode()))`,
  );
  await driver.click({ selector: 'button', text: 'Save comparison', exact: true });
  await driver.waitFor({ selector: '[role="status"]', text: 'Comparison saved.', exact: false });
  const saved = await host.readProject(projectPath);
  const expected = { kind: 'current-expected', leftId: shots[0].id, rightId: shots[1].id };
  if (
    JSON.stringify(saved.collections.find((entry) => entry.id === collection.id)?.comparison) !==
    JSON.stringify(expected)
  )
    throw new Error('Native comparison selection did not persist the intended roles.');
  if (JSON.stringify(saved.screenshots) !== JSON.stringify(before.screenshots))
    throw new Error('Pairing changed independent screenshot content or order.');
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'comparison-current-expected.png', 'none'));
  await driver.click({ selector: 'button', text: 'Done', exact: true });
  await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
  await driver.waitFor({
    selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]',
  });
  await driver.click({ selector: '[data-testid="copy-bundle-1"]' });
  await driver.waitFor({ selector: '.prompt-bundle-state-success' });
  const exportsPath = path.join(projectPath, 'collections', collection.id, 'exports');
  const sets = (await fs.readdir(exportsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  const setName = sets.at(-1);
  if (!setName) throw new Error('Comparison prompt did not publish a saved export.');
  const folder = path.join(exportsPath, setName);
  const markdownName = `${setName} - 01.md`;
  const pngName = `${setName} - 01.png`;
  const markdown = await fs.readFile(path.join(folder, markdownName), 'utf8');
  if (
    !markdown.includes('Current: Picture 1 (excluded); Expected: Picture 2') ||
    !markdown.includes('Comparison role: Expected')
  )
    throw new Error('Native saved comparison export lost its role labels or exclusion.');
  if (artifactDirectory) {
    await fs.copyFile(
      path.join(folder, markdownName),
      path.join(artifactDirectory, 'comparison-export.md'),
      fs.constants.COPYFILE_EXCL,
    );
    await fs.copyFile(
      path.join(folder, pngName),
      path.join(artifactDirectory, 'comparison-export.png'),
      fs.constants.COPYFILE_EXCL,
    );
  }
  await driver.click({ selector: '[data-testid="prompt-sharing-close"]' });
  driver.setWindow(await host.reopenWindow());
  driver.browserWindow.show();
  driver.browserWindow.focus();
  await driver.waitFor({ selector: '[data-testid="compare-screenshots"]' });
  await driver.click({ selector: '[data-testid="compare-screenshots"]' });
  await driver.waitFor({ selector: 'img[alt="Expected annotated screenshot"]' });
  const reopened = await driver.evaluate<string[]>(
    `Array.from(document.querySelectorAll('.comparison-controls select')).map((field)=>field.value)`,
  );
  if (JSON.stringify(reopened) !== JSON.stringify(['current-expected', shots[0].id, shots[1].id]))
    throw new Error('Comparison roles changed after reopening the native window.');
  await chooseOption('Comparison', 1);
  await driver.waitFor({ selector: 'img[alt="After annotated screenshot"]' });
  await driver.click({ selector: 'button', text: 'Save comparison', exact: true });
  await driver.waitFor({ selector: '[role="status"]', text: 'Comparison saved.', exact: false });
  if (
    (await host.readProject(projectPath)).collections.find((entry) => entry.id === collection.id)?.comparison
      ?.kind !== 'before-after'
  )
    throw new Error('Native comparison mode change was not persisted.');
  // The production window's minimum width is 1064px; verify its supported narrow size.
  await driver.resize({ width: 1080, height: 720 });
  await driver.evaluate(
    `Promise.all(Array.from(document.querySelectorAll('.comparison-viewport img')).map((image)=>image.decode()))`,
  );
  const layout = await driver.evaluate<boolean>(`(() => {
    const dialog=document.querySelector('[role="dialog"]');
    const content=document.querySelector('.comparison-content');
    return dialog && content && content.scrollWidth<=content.clientWidth+1 && dialog.getBoundingClientRect().right<=innerWidth;
  })()`);
  if (!layout) throw new Error('Comparison controls overflow the native narrow viewport.');
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'comparison-before-after-narrow.png', 'none'));
  // Two other unannotated fixtures have equal dimensions, so native keyboard zoom/pan can link.
  for (const [label, steps] of [
    ['Before screenshot', 1],
    ['After screenshot', 4],
  ] as const) {
    await chooseOption(label, steps);
  }
  await driver.waitFor({ selector: '.comparison-link input' }, { enabled: true });
  await driver.evaluate(
    `Promise.all(Array.from(document.querySelectorAll('.comparison-viewport img')).map((image)=>image.decode()))`,
  );
  await driver.click({ selector: 'button', text: 'Save comparison', exact: true });
  await driver.waitFor({ selector: '[role="status"]', text: 'Comparison saved.', exact: false });
  const ready = await host.readProject(projectPath);
  const readyPair = ready.collections.find((entry) => entry.id === collection.id)?.comparison;
  if (readyPair?.leftId !== shots[1].id || readyPair.rightId !== shots[4].id)
    throw new Error('The included comparison pair did not persist before its capture.');
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'comparison-ready.png', 'none'));
  await driver.evaluate(`document.querySelector('input[aria-label="Before zoom"]').focus()`);
  await driver.press('Right');
  await driver.press('Right');
  await driver.press('Right');
  const zooms = await driver.evaluate<string[]>(
    `Array.from(document.querySelectorAll('.comparison-image input[type="range"]')).map((field)=>field.value)`,
  );
  if (JSON.stringify(zooms) !== JSON.stringify(['175', '175']))
    throw new Error('Native keyboard zoom did not link the two comparison views.');
  await driver.evaluate(`document.querySelector('.comparison-viewport').focus()`);
  await driver.press('Down');
  await driver.press('Down');
  await driver.evaluate(`new Promise((resolve,reject)=>{
    const deadline=Date.now()+5000;
    const check=()=>{
      const [left,right]=document.querySelectorAll('.comparison-viewport');
      if(left?.scrollTop>0 && right?.scrollTop>0 && Math.abs(left.scrollTop-right.scrollTop)<=2) return resolve(true);
      if(Date.now()>=deadline) return reject(new Error('Native keyboard pan did not link comparison views.'));
      requestAnimationFrame(check);
    };check();
  })`);
  await driver.click({ selector: 'button', text: 'Remove comparison', exact: true });
  await driver.waitFor({ selector: '[role="dialog"]' }, { absent: true });
  const removed = await host.readProject(projectPath);
  if (
    removed.collections.find((entry) => entry.id === collection.id)?.comparison ||
    JSON.stringify(removed.screenshots) !== JSON.stringify(before.screenshots)
  )
    throw new Error('Removing comparison changed the screenshots or retained the relationship.');
  await driver.resize({ width: 1280, height: 800 });
  return captures;
}
