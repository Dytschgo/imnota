import { clipboard, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import { nativeClipboard } from './native-clipboard.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';
import { agentAccessSetupPrompt } from '../src/shared/preferences.js';
import type { ImnotaBridge, ProjectSnapshot } from '../src/shared/types.js';
import type { NativeUiDriver, SmokeCapture } from './smoke-native-driver.js';

type FeedbackFixtureMethod =
  | 'createProject'
  | 'pasteImage'
  | 'loadScreenshotContent'
  | 'saveScreenshotContent'
  | 'createContentItem'
  | 'loadContentItem'
  | 'saveContentItem'
  | 'editCollection';

async function feedbackFixtureStep<Method extends FeedbackFixtureMethod>(
  driver: NativeUiDriver,
  step: string,
  method: Method,
  args: Parameters<ImnotaBridge[Method]>,
): Promise<Awaited<ReturnType<ImnotaBridge[Method]>>> {
  // Each native operation keeps the driver's normal deadline. The outer smoke
  // process still bounds the complete walkthrough, including this fixture.
  try {
    return await driver.evaluate<Awaited<ReturnType<ImnotaBridge[Method]>>>(
      `window.imnota[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Feedback fixture ${step} failed: ${message}`, { cause: error });
  }
}

async function waitForEmptySearch(driver: NativeUiDriver): Promise<void> {
  // Reopening clears the previous query/results in an effect. That changes the
  // centered dialog's position, so input presence alone is not click readiness.
  await driver.evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      const input = document.querySelector('[data-testid="global-search-input"]');
      const dialog = document.querySelector('[data-testid="global-search-dialog"]');
      if (input instanceof HTMLInputElement && input.value === '' &&
          dialog?.getAttribute('aria-busy') === 'false' &&
          !dialog.querySelector('[data-testid="global-search-result"]')) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('Search did not reset its previous query and results.'));
      requestAnimationFrame(check);
    };
    check();
  })`);
}

async function captureCollectionPicker(
  driver: NativeUiDriver,
  artifactDirectory: string | undefined,
  captures: SmokeCapture[],
  filename: string,
  expectedStates: readonly string[] = ['Active'],
): Promise<void> {
  await driver.click({ selector: '[data-testid="collection-picker"]' });
  await driver.waitFor({ selector: '[role="menu"][aria-label="Collections"]' });
  const validPicker = await driver.evaluate<boolean>(`(() => {
    const trigger = document.querySelector('[data-testid="collection-picker"]');
    const menu = document.querySelector('[role="menu"][aria-label="Collections"]');
    const options = [...document.querySelectorAll('[role="menuitemradio"]')];
    const actions = [...document.querySelectorAll('[role="menuitem"]')];
    const expectedStates = ${JSON.stringify(expectedStates)};
    if (!trigger || !menu || options.length !== expectedStates.length || actions.length !== options.length * 2) return false;
    const triggerBox = trigger.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    return trigger.querySelectorAll('svg').length === 1 &&
      options.every(option => option.querySelectorAll('svg').length === 0) &&
      options.every(option => {
        const label = option.querySelector('span');
        const labelBox = label?.getBoundingClientRect();
        const optionBox = option.getBoundingClientRect();
        const actionBoxes = [...option.parentElement.querySelectorAll('[role="menuitem"]')]
          .map(action => action.getBoundingClientRect());
        return labelBox && labelBox.left >= optionBox.left && labelBox.right <= optionBox.right &&
          actionBoxes.every(box => box.left >= optionBox.right);
      }) &&
      JSON.stringify(options.map(option => option.getAttribute('aria-description')).sort()) === JSON.stringify(expectedStates.sort()) &&
      trigger.getAttribute('aria-description') === 'Current collection is active' &&
      menu.scrollWidth <= menu.clientWidth &&
      menuBox.left >= 0 && menuBox.right <= innerWidth && menuBox.top >= triggerBox.bottom;
  })()`);
  if (!validPicker)
    throw new Error('Collection picker retained decorative status icons or overflowed its visible bounds.');
  if (artifactDirectory) captures.push(await driver.capture(artifactDirectory, filename));
  await driver.press('Escape');
  await driver.waitFor({ selector: '[role="menu"][aria-label="Collections"]' }, { absent: true });
}

async function captureAgentAccess(
  driver: NativeUiDriver,
  artifactDirectory: string | undefined,
  captures: SmokeCapture[],
  filename: string,
): Promise<void> {
  await driver.evaluate(`(async () => {
    document.querySelector('[aria-labelledby="agent-access-title"]').scrollIntoView({block:'start'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  if (artifactDirectory) captures.push(await driver.capture(artifactDirectory, filename));
  const copyFits = await driver.evaluate<boolean>(`(() => {
    const section = document.querySelector('[aria-labelledby="agent-access-title"]');
    const copy = section?.querySelector('.settings-switch small');
    const toggle = section?.querySelector('[data-testid="agent-access-toggle"]');
    if (!section || !copy || !toggle) return false;
    const sectionBox = section.getBoundingClientRect();
    const copyBox = copy.getBoundingClientRect();
    const toggleBox = toggle.getBoundingClientRect();
    const mcp = copy.querySelector('kbd');
    const mcpBox = mcp?.getBoundingClientRect();
    // At 110% zoom a shared edge can differ by 0.000004 CSS px in DOMRect.
    // Compare painted edges in device pixels; keep overflow and separation exact.
    const pixel = value => Math.round(value * devicePixelRatio);
    const contains = (outer, inner) => pixel(inner.left) >= pixel(outer.left) &&
      pixel(inner.right) <= pixel(outer.right);
    const separate = copyBox.right <= toggleBox.left ||
      copyBox.bottom <= toggleBox.top || toggleBox.bottom <= copyBox.top;
    return copy.scrollWidth <= copy.clientWidth && copy.scrollHeight <= copy.clientHeight &&
      contains(sectionBox, copyBox) && contains(sectionBox, toggleBox) && separate &&
      !!mcpBox && mcpBox.width > 0 && mcpBox.height > 0 && mcp.getClientRects().length === 1 &&
      contains(copyBox, mcpBox) &&
      pixel(mcpBox.top) >= pixel(copyBox.top) && pixel(mcpBox.bottom) <= pixel(copyBox.bottom);
  })()`);
  if (!copyFits) {
    const geometry = await driver.evaluate(`(() => {
      const section = document.querySelector('[aria-labelledby="agent-access-title"]');
      return Object.fromEntries([':scope', '.settings-switch small', '.settings-switch kbd', '[data-testid="agent-access-toggle"]']
        .map(selector => { const element = selector === ':scope' ? section : section?.querySelector(selector);
          return [selector, element ? {box: element.getBoundingClientRect().toJSON(),
            client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight],
            rects: element.getClientRects().length} : null]; }));
    })()`);
    throw new Error(
      `Local agent access text or --mcp token clipped or overlapped: ${filename}: ${JSON.stringify(geometry)}`,
    );
  }
}

/** Verify search targets and project lifecycle through the real preload and native UI. */
export async function exerciseUiFeedback(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  const minimumWindowSize = driver.browserWindow.getMinimumSize();
  const image = nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 180), { width: 64, height: 64 });
  await nativeClipboard.writeImage(image);
  const created = await feedbackFixtureStep(driver, 'create project', 'createProject', [
    { name: 'Feedback Verification', description: 'Local UI checks', icon: 'rocket' },
  ]);
  const projectPath = created.projectPath;
  const collection = created.project.collections[0];
  if (!projectPath || !created.project.id || created.project.name !== 'Feedback Verification' || !collection)
    throw new Error('Feedback fixture create project returned an unexpected project or no collection.');
  const verifyProject = (snapshot: ProjectSnapshot, step: string): void => {
    if (snapshot.projectPath !== projectPath || snapshot.project.id !== created.project.id)
      throw new Error(`Feedback fixture ${step} returned a different project.`);
  };
  const pasted = await feedbackFixtureStep(driver, 'paste screenshot', 'pasteImage', [
    projectPath,
    collection.id,
  ]);
  verifyProject(pasted, 'paste screenshot');
  const screenshot = pasted.project.screenshots[0];
  if (!screenshot || screenshot.collectionId !== collection.id)
    throw new Error('Feedback fixture paste screenshot did not populate the expected collection.');
  const content = await feedbackFixtureStep(driver, 'load screenshot', 'loadScreenshotContent', [
    { projectPath, screenshot },
  ]);
  const savedScreenshot = await feedbackFixtureStep(driver, 'save annotation', 'saveScreenshotContent', [
    {
      projectPath,
      screenshot,
      contentRevision: content.contentRevision,
      annotations: [
        {
          id: 'feedback-search-note',
          kind: 'text',
          x: 900,
          y: 600,
          width: 180,
          height: 70,
          text: 'quartzannotationprobe',
          fontSize: 20,
          fill: '#ef4444',
          zIndex: 0,
        },
      ],
    },
  ]);
  if (
    savedScreenshot.savedScreenshotId !== screenshot.id ||
    savedScreenshot.conflictCreated ||
    savedScreenshot.project.id !== created.project.id
  )
    throw new Error(
      'Feedback fixture save annotation did not save the expected screenshot without a conflict.',
    );
  const withText = await feedbackFixtureStep(driver, 'create text item', 'createContentItem', [
    { projectPath, collectionId: collection.id, kind: 'text' },
  ]);
  verifyProject(withText, 'create text item');
  const item = withText.project.contentItems?.find((candidate) => candidate.kind === 'text');
  if (!item || item.collectionId !== collection.id)
    throw new Error('Feedback fixture create text item did not populate the expected collection.');
  const text = await feedbackFixtureStep(driver, 'load text item', 'loadContentItem', [
    { projectPath, itemId: item.id },
  ]);
  if (text.item.id !== item.id || text.item.kind !== 'text')
    throw new Error('Feedback fixture load text item returned a different item.');
  const savedText = await feedbackFixtureStep(driver, 'save markdown', 'saveContentItem', [
    {
      projectPath,
      itemId: item.id,
      contentRevision: text.contentRevision,
      markdown: '# Search fixture\n\n' + 'Ordinary content. '.repeat(600) + '\nquartzmarkdownprobe',
    },
  ]);
  verifyProject(savedText.snapshot, 'save markdown');
  if (savedText.itemId !== item.id || savedText.conflictCreated)
    throw new Error('Feedback fixture save markdown did not save the expected item without a conflict.');
  const additional = await feedbackFixtureStep(driver, 'create second collection', 'editCollection', [
    { projectPath, action: 'create' },
  ]);
  verifyProject(additional, 'create second collection');
  const archived = additional.project.collections.find((candidate) => candidate.id !== collection.id);
  if (!archived) throw new Error('Feedback fixture create second collection did not create a collection.');
  const renamed = await feedbackFixtureStep(driver, 'rename second collection', 'editCollection', [
    { projectPath, action: 'rename', collectionId: archived.id, name: 'Archived feedback' },
  ]);
  verifyProject(renamed, 'rename second collection');
  if (
    renamed.project.collections.find((candidate) => candidate.id === archived.id)?.name !==
    'Archived feedback'
  )
    throw new Error('Feedback fixture rename second collection did not retain its name.');
  const archivedSnapshot = await feedbackFixtureStep(driver, 'archive second collection', 'editCollection', [
    { projectPath, action: 'archive', collectionId: archived.id },
  ]);
  verifyProject(archivedSnapshot, 'archive second collection');
  if (
    archivedSnapshot.project.collections.find((candidate) => candidate.id === archived.id)?.archived !== true
  )
    throw new Error('Feedback fixture archive second collection did not retain its archived state.');
  const restored = await feedbackFixtureStep(driver, 'restore current collection', 'editCollection', [
    { projectPath, action: 'restore', collectionId: collection.id },
  ]);
  verifyProject(restored, 'restore current collection');
  if (restored.project.collections.find((candidate) => candidate.id === collection.id)?.archived !== false)
    throw new Error('Feedback fixture restore current collection did not retain its active state.');
  const currentName = 'Current feedback collection with a deliberately long name';
  const finalSnapshot = await feedbackFixtureStep(driver, 'rename current collection', 'editCollection', [
    { projectPath, action: 'rename', collectionId: collection.id, name: currentName },
  ]);
  verifyProject(finalSnapshot, 'rename current collection');
  if (
    finalSnapshot.project.collections.find((candidate) => candidate.id === collection.id)?.name !==
    currentName
  )
    throw new Error('Feedback fixture rename current collection did not retain its name.');
  const fixture = { projectPath, projectId: created.project.id, itemId: item.id };
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Verification' });
  await driver.click({ selector: '.project-row-main', text: 'Feedback Verification' });
  await driver.waitFor({ selector: '[data-testid="workspace"]' });
  // Linux window decorations add 16px to the production minimum width.
  await driver.resize({ width: 1080, height: 800 });
  await captureCollectionPicker(
    driver,
    artifactDirectory,
    captures,
    '1080x800-feedback-normal-collection-picker.png',
    ['Active', 'Archived'],
  );
  const templateProjectPath = await driver.evaluate<string>(`(async () => {
    const snapshot = await window.imnota.createProject({
      name: 'Feedback Template',
      description: 'Template collection picker verification',
      templateId: 'bug-report',
    });
    return snapshot.projectPath;
  })()`);
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Template' });
  await driver.click({ selector: '.project-row-main', text: 'Feedback Template' });
  await driver.waitFor({ selector: '[data-testid="workspace"]' });
  await captureCollectionPicker(
    driver,
    artifactDirectory,
    captures,
    '1080x800-feedback-template-collection-picker.png',
  );
  const templateProjectExists = await driver.evaluate<boolean>(
    `(async () => (await window.imnota.loadProject(${JSON.stringify(templateProjectPath)})).project.name === 'Feedback Template')()`,
  );
  if (!templateProjectExists)
    throw new Error('Template picker verification did not retain its template project.');
  clipboard.clear();
  await driver.click({ text: 'Paste from clipboard', exact: true });
  await driver.waitFor({ selector: '[data-testid="error-toast"]' });
  await driver.evaluate(`(async () => {
    const error = document.querySelector('[data-testid="error-toast"]');
    if (!error) throw new Error('Clipboard error disappeared before layout verification.');
    await Promise.all(error.getAnimations().map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, '1080x800-feedback-paste-error.png'));
  const pasteError = await driver.evaluate<{
    passed: boolean;
    box?: { left: number; top: number; right: number; bottom: number; width: number };
    viewport?: { width: number; height: number };
    text?: string;
    position?: string;
  }>(`(() => {
    const error = document.querySelector('[data-testid="error-toast"]');
    const success = document.querySelector('.toast:not(.error-toast)');
    if (!error || success) return {passed:false};
    const box = error.getBoundingClientRect();
    const text = error.querySelector('span')?.textContent;
    const position = getComputedStyle(error).position;
    return {
      passed: error.getAttribute('role') === 'alert' && position === 'fixed' &&
        text?.startsWith('The clipboard does not contain an image. Copy a screenshot and try again. [Diagnostic reference: ') &&
        /[a-f0-9-]{36}\\]$/.test(text) &&
        box.left >= 0 && box.top >= 0 && box.right <= innerWidth - 20 &&
        box.bottom <= innerHeight - 18 && box.width < innerWidth / 2,
      box: {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width},
      viewport: {width:innerWidth,height:innerHeight},text,position,
    };
  })()`);
  if (!pasteError.passed)
    throw new Error(`Clipboard notification postcondition failed: ${JSON.stringify(pasteError)}`);
  await driver.click({ selector: '[data-testid="error-toast"] button[aria-label="Dismiss error"]' });
  await driver.waitFor({ selector: '[data-testid="error-toast"]' }, { absent: true });
  await driver.resize({ width: 1280, height: 800 });
  await driver.click({ selector: '[data-testid="search-trigger"]' });
  await waitForEmptySearch(driver);
  await driver.fill({ selector: '[data-testid="global-search-input"]' }, 'quartzmarkdownprobe');
  await driver.waitFor({ selector: '[data-testid="global-search-result"][data-kind="text"]' });
  if (artifactDirectory) {
    // Move focus off the input so its blinking caret cannot keep capture pixels changing.
    await driver.press('Tab');
    captures.push(await driver.capture(artifactDirectory, 'feedback-search.png'));
  }
  await driver.click({ selector: '[data-testid="global-search-result"][data-kind="text"]' });
  // The previous project's editor remains mounted while the search target loads.
  // Its presence alone does not prove that navigation has completed.
  await driver.evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const check = () => {
      const editor = document.querySelector('[data-testid="markdown-input"]');
      if (!document.querySelector('[data-testid="global-search-input"]') &&
          editor?.value.includes('quartzmarkdownprobe')) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('Full Markdown search did not open its matching text block.'));
      requestAnimationFrame(check);
    };
    check();
  })`);

  await driver.click({ selector: '[data-testid="search-trigger"]' });
  await waitForEmptySearch(driver);
  await driver.fill({ selector: '[data-testid="global-search-input"]' }, 'quartzannotationprobe');
  await driver.click({
    selector: '[data-testid="global-search-result"][data-annotation-id="feedback-search-note"]',
  });
  await driver.waitFor({ selector: '[data-image-scale]' });
  await driver.evaluate(`new Promise((resolve,reject) => {
    const deadline=Date.now()+10000;
    const check=() => {
      const canvas=document.querySelector('[data-image-scale]');
      const scale=Number(canvas?.dataset.imageScale), x=Number(canvas?.dataset.imageX), y=Number(canvas?.dataset.imageY);
      if(canvas && x+990*scale>0 && x+990*scale<canvas.clientWidth && y+635*scale>0 && y+635*scale<canvas.clientHeight) return resolve(true);
      if(Date.now()>deadline) return reject(new Error('Annotation search target remained outside the viewport.'));
      requestAnimationFrame(check);
    };check();
  })`);
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'feedback-annotation-target.png'));

  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Shortcuts', exact: true });
  await driver.click({ selector: '.topbar [aria-label="Back"]' });
  await driver.waitFor({ selector: '[data-image-scale]' });
  await driver.click({ selector: '.topbar [aria-label="Forward"]' });
  await driver.waitFor({
    selector: '.settings-navigation button[aria-current="page"]',
    text: 'Shortcuts',
    exact: true,
  });
  await driver.click({ selector: '.topbar [aria-label="Back"]' });
  await driver.waitFor({ selector: '[data-image-scale]' });

  // Exercise the same revision-protected contracts used by project row actions.
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
  await driver.click({ selector: `[data-testid="project-edit-${fixture.projectId}"]` });
  await driver.fill({ selector: '[data-testid="project-name-input"]' }, 'Feedback Edited');
  await driver.fill(
    { selector: '[data-testid="project-description-input"]' },
    'Edited through the project dialog',
  );
  await driver.click({ text: 'Use target icon', exact: true });
  await driver.click({ text: 'Save changes', exact: true });
  await driver.waitFor({ selector: '[data-testid="project-edit-dialog"]' }, { absent: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Edited' });
  await driver.click({ selector: `[data-testid="project-archive-${fixture.projectId}"]` });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Edited' }, { absent: true });
  await driver.click({ selector: '.toast button', text: 'Undo', exact: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Edited' });
  await driver.click({ selector: `[data-testid="project-archive-${fixture.projectId}"]` });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Edited' }, { absent: true });
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Archived', exact: true });
  await driver.click({ selector: `[data-testid="project-restore-${fixture.projectId}"]` });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Edited' }, { absent: true });
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Edited' });
  if (artifactDirectory) captures.push(await driver.capture(artifactDirectory, 'feedback-projects.png'));
  await driver.evaluate(`(async () => {
    const projectPath=${JSON.stringify(fixture.projectPath)};
    let snapshot=await window.imnota.loadProject(projectPath);
    if(snapshot.project.name!=='Feedback Edited' || snapshot.project.icon!=='target' || snapshot.project.description!=='Edited through the project dialog') throw new Error('Project edit dialog did not persist all three fields.');
    const stale=snapshot.projectRevision;
    snapshot=await window.imnota.updateProjectMetadata({projectPath,expectedRevision:stale,patch:{name:'Feedback Renamed',description:'Edited description',icon:'target'}});
    if(snapshot.project.icon!=='target' || snapshot.projectPath!==projectPath) throw new Error('Project edit lost icon or folder identity.');
    let rejected=false;
    try {await window.imnota.setProjectArchived({projectPath,expectedRevision:stale,archived:true});} catch {rejected=true;}
    if(!rejected) throw new Error('Stale archive revision was accepted.');
    snapshot=await window.imnota.setProjectArchived({projectPath,expectedRevision:snapshot.projectRevision,archived:true});
    const active=await window.imnota.searchProjects({query:'quartzmarkdownprobe',scope:'active'});
    const archived=await window.imnota.searchProjects({query:'quartzmarkdownprobe',scope:'archived'});
    if(active.results.some(result=>result.target.projectPath===projectPath) || !archived.results.some(result=>result.target.itemId===${JSON.stringify(fixture.itemId)})) throw new Error('Archive search scopes were not isolated.');
    await window.imnota.setProjectArchived({projectPath,expectedRevision:snapshot.projectRevision,archived:false});
    const restored=await window.imnota.searchProjects({query:'quartzmarkdownprobe',scope:'active'});
    if(!restored.results.some(result=>result.target.projectPath===projectPath)) throw new Error('Restored project was missing from search.');
  })()`);
  // Direct bridge mutations do not update the renderer's cached library list.
  // Re-entering the library performs the production refresh before row actions.
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Archived', exact: true });
  await driver.waitFor({
    selector: '.side-nav-primary .nav-item[aria-current="page"]',
    text: 'Archived',
    exact: true,
  });
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Renamed' });
  await driver.click({ selector: `[data-testid="project-delete-${fixture.projectId}"]` });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Delete Feedback Renamed?' });
  await driver.click({ text: 'Keep project', exact: true });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Delete Feedback Renamed?' }, { absent: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Renamed' });
  await fs.access(fixture.projectPath);
  await fs.access(`${fixture.projectPath}/project.json`);

  await driver.click({ selector: `[data-testid="project-delete-${fixture.projectId}"]` });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Delete Feedback Renamed?' });
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'feedback-project-delete-confirm.png'));
  await host.approveNextProjectDeletion(fixture.projectPath);
  await driver.click({ text: 'Move to trash', exact: true });
  await driver.waitFor({ selector: '[role="dialog"]', text: 'Delete Feedback Renamed?' }, { absent: true });
  await driver.waitFor({ selector: '.project-row-main', text: 'Feedback Renamed' }, { absent: true });
  await driver.waitFor({ selector: '.toast', text: 'Project moved to the system trash', exact: true });
  try {
    await fs.access(fixture.projectPath);
    throw new Error('Deleted feedback fixture remained in the synthetic workspace.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.waitFor({ selector: '[data-testid="settings-view"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Workspace', exact: true });
  await driver.waitFor({ text: 'Open diagnostics folder', exact: true });
  await driver.evaluate(`document.querySelector('#diagnostics-title')?.scrollIntoView({ block: 'center' })`);
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'workspace-local-diagnostics.png'));
  await driver.waitFor({ selector: '[data-testid="agent-access-prompt"]' });
  await driver.resize({ width: 1080, height: 800 });
  await captureAgentAccess(driver, artifactDirectory, captures, 'agent-access-setup-prompt.png');
  await driver.click({
    selector: '[aria-labelledby="agent-access-title"] button',
    text: 'Copy prompt',
    exact: true,
  });
  await driver.waitFor({
    selector: '[aria-labelledby="agent-access-title"] button',
    text: 'Copied',
    exact: true,
  });
  if ((await nativeClipboard.readText()) !== agentAccessSetupPrompt())
    throw new Error('Local agent setup did not copy the complete prompt to the native clipboard.');
  // Stress wrapping below the ordinary minimum in this disposable smoke window only.
  try {
    driver.browserWindow.setMinimumSize(800, 680);
    await driver.resize({ width: 900, height: 800 });
    driver.browserWindow.webContents.setZoomFactor(1.1);
    await captureAgentAccess(driver, artifactDirectory, captures, '900x800-110pct-feedback-agent-access.png');
  } finally {
    driver.browserWindow.webContents.setZoomFactor(1);
    await driver.resize({ width: 1280, height: 800 });
    driver.browserWindow.setMinimumSize(minimumWindowSize[0], minimumWindowSize[1]);
  }
  await driver.click({ text: 'Appearance', exact: true });
  await driver.click({ selector: 'label:has(input[name="appearance-mode"][value="light"]:not(:disabled))' });
  await driver.waitFor({ selector: ':root[data-theme="light"]' });
  await driver.click({ selector: 'label:has(input[name="glass-level"][value="strong"]:not(:disabled))' });
  await driver.waitFor({ selector: ':root[data-glass-requested="strong"]' });
  await driver.click({ selector: '[data-testid="backdrop-preset-emerald"]' });
  await driver.waitFor({
    selector: '[data-testid="backdrop-preset-emerald"][aria-pressed="true"]:not(:disabled)',
  });
  await driver.click({ selector: '.imnota-backdrop-theme-link input:checked' });
  await driver.waitFor({ selector: '.imnota-backdrop-theme-link input:not(:checked):not(:disabled)' });
  await driver.click({ text: 'No image', exact: true });
  await driver.waitFor({ selector: ':root[data-background="none"]' });
  await driver.click({ selector: 'label:has(input[name="appearance-mode"][value="dark"]:not(:disabled))' });
  await driver.waitFor({
    selector: '[data-testid="backdrop-preset-emerald"][aria-pressed="true"]:not(:disabled)',
  });
  if (artifactDirectory) captures.push(await driver.capture(artifactDirectory, 'feedback-dark-backdrop.png'));
  await driver.click({ selector: 'label:has(input[name="appearance-mode"][value="light"]:not(:disabled))' });
  await driver.waitFor({ selector: ':root[data-background="none"][data-theme="light"]' });
  await driver.click({ selector: '[data-testid="backdrop-preset-emerald"]' });
  await driver.waitFor({
    selector: '[data-testid="backdrop-preset-emerald"][aria-pressed="true"]:not(:disabled)',
  });
  await driver.evaluate(`(() => {
    const navigation=document.querySelector('.settings-navigation');
    if(['sticky','fixed'].includes(getComputedStyle(navigation).position)) throw new Error('Settings categories still stick to the viewport.');
    document.querySelector('.settings-view').scrollTop=0;
  })()`);
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'feedback-light-backdrop.png'));
  return captures;
}
