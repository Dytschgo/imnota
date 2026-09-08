import { clipboard, nativeImage } from 'electron';
import type { NativeUiDriver, SmokeCapture } from './smoke-native-driver.js';

/** Verify search targets and project lifecycle through the real preload and native UI. */
export async function exerciseUiFeedback(
  driver: NativeUiDriver,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  const image = nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 180), { width: 64, height: 64 });
  clipboard.writeImage(image);
  const fixture = await driver.evaluate<{
    projectPath: string;
    projectId: string;
    itemId: string;
  }>(`(async () => {
    let snapshot = await window.imnota.createProject({name:'Feedback Verification',description:'Local UI checks',icon:'rocket'});
    const projectPath = snapshot.projectPath;
    snapshot = await window.imnota.pasteImage(projectPath, snapshot.project.collections[0].id);
    const screenshot = snapshot.project.screenshots[0];
    const content = await window.imnota.loadScreenshotContent({projectPath,screenshot});
    await window.imnota.saveScreenshotContent({projectPath,screenshot,contentRevision:content.contentRevision,
      annotations:[{id:'feedback-search-note',kind:'text',x:900,y:600,width:180,height:70,text:'quartzannotationprobe',fontSize:20,fill:'#ef4444',zIndex:0}]});
    snapshot = await window.imnota.createContentItem({projectPath,collectionId:screenshot.collectionId,kind:'text'});
    const item = snapshot.project.contentItems.find(item => item.kind === 'text');
    const text = await window.imnota.loadContentItem({projectPath,itemId:item.id});
    await window.imnota.saveContentItem({projectPath,itemId:item.id,contentRevision:text.contentRevision,
      markdown:'# Search fixture\\n\\n' + 'Ordinary content. '.repeat(600) + '\\nquartzmarkdownprobe'});
    return {projectPath,projectId:snapshot.project.id,itemId:item.id};
  })()`);
  await driver.click({ selector: '[data-testid="search-trigger"]' });
  await driver.fill({ selector: '[data-testid="global-search-input"]' }, 'quartzmarkdownprobe');
  await driver.waitFor({ selector: '[data-testid="global-search-result"][data-kind="text"]' });
  if (artifactDirectory) captures.push(await driver.capture(artifactDirectory, 'feedback-search.png'));
  await driver.click({ selector: '[data-testid="global-search-result"][data-kind="text"]' });
  await driver.waitFor({ selector: '[data-testid="markdown-input"]' });
  const fullTextOpened = await driver.evaluate<boolean>(
    `document.querySelector('[data-testid="markdown-input"]').value.includes('quartzmarkdownprobe')`,
  );
  if (!fullTextOpened) throw new Error('Full Markdown search did not open its matching text block.');

  await driver.click({ selector: '[data-testid="search-trigger"]' });
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
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.waitFor({ selector: '[data-testid="settings-view"]' });
  await driver.click({ text: 'Appearance', exact: true });
  await driver.click({ selector: 'label:has(input[name="appearance-mode"][value="light"])' });
  await driver.waitFor({ selector: ':root[data-theme="light"]' });
  await driver.click({ selector: 'label:has(input[name="glass-level"][value="strong"])' });
  await driver.waitFor({ selector: ':root[data-glass-requested="strong"]' });
  await driver.click({ selector: '[data-testid="backdrop-preset-emerald"]' });
  await driver.waitFor({
    selector: '[data-testid="backdrop-preset-emerald"][aria-pressed="true"]:not(:disabled)',
  });
  await driver.click({ selector: '.imnota-backdrop-theme-link input:checked' });
  await driver.waitFor({ selector: '.imnota-backdrop-theme-link input:not(:checked):not(:disabled)' });
  await driver.click({ text: 'No image', exact: true });
  await driver.waitFor({ selector: ':root[data-background="none"]' });
  await driver.click({ selector: 'label:has(input[name="appearance-mode"][value="dark"])' });
  await driver.waitFor({
    selector: '[data-testid="backdrop-preset-emerald"][aria-pressed="true"]:not(:disabled)',
  });
  if (artifactDirectory) captures.push(await driver.capture(artifactDirectory, 'feedback-dark-backdrop.png'));
  await driver.click({ selector: 'label:has(input[name="appearance-mode"][value="light"])' });
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
