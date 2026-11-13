import fs from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import { nativeClipboard } from './native-clipboard.js';
import type { NativeUiDriver, SmokeCapture } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';

/** Actual packaged import, inspector persistence and Markdown export in a disposable workspace. */
export async function exerciseSourceContext(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  fixtureRoot: string,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  const png = path.join(fixtureRoot, 'source-context.png');
  await fs.writeFile(
    png,
    nativeImage
      .createFromBitmap(Buffer.alloc(32 * 24 * 4, 255), {
        width: 32,
        height: 24,
      })
      .toPNG(),
    { flag: 'wx' },
  );
  const json = JSON.stringify;
  const initial = await driver.evaluate<boolean>(
    `(async () => {
      const result=await window.imnota.getPreferenceSettings();
      if(!result.ok) throw new Error(result.error.message);
      return result.value.settings.promptExport.includeSourceContext;
    })()`,
  );
  if (initial !== false) throw new Error('Source recording was not off before opt-in.');
  const projectPath = await driver.evaluate<string>(`(async () => {
    const snapshot = await window.imnota.createProject({name:'Source context verification',description:''});
    await window.imnota.importImageFiles({projectPath:snapshot.projectPath,
      collectionId:snapshot.project.collections[0].id,paths:[${json(png)}]});
    return snapshot.projectPath;
  })()`);
  if ((await host.readProject(projectPath)).screenshots.some((shot) => shot.source))
    throw new Error('Import recorded source without opt-in.');
  const setEnabled = async (enabled: boolean) => {
    await driver.evaluate(`(async () => {
      const result=await window.imnota.setPreferenceSettings({promptExport:{includeSourceContext:${enabled}}});
      if(!result.ok) throw new Error(result.error.message);
    })()`);
    driver.setWindow(await host.reopenWindow());
  };
  const openProject = async () => {
    if (await driver.exists({ selector: '.settings-view' }))
      await driver.click({ selector: '[aria-label="Back to workspace"]' });
    await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
    await driver.click({ selector: '.project-row-main', text: 'Source context verification', exact: false });
  };
  const waitForSource = async (condition: string) => {
    await driver.evaluate(`new Promise((resolve,reject) => {
      const deadline=Date.now()+15000;
      const check=async()=>{
        try {
          const snapshot=await window.imnota.loadProject(${json(projectPath)});
          const source=snapshot.project.screenshots.at(-1).source;
          if(${condition}) return resolve(true);
          if(Date.now()>deadline) return reject(new Error('Source persistence did not reach expected state'));
          requestAnimationFrame(check);
        } catch(error) { reject(error); }
      }; check();
    })`);
  };
  const markdown = async () => {
    await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
    await driver.waitFor({
      selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]',
    });
    await driver.click({ selector: '[aria-label="Copy options"]' });
    await driver.click({ selector: '[role="menuitem"]', text: 'Copy Markdown', exact: true });
    await driver.waitFor({
      selector: '.prompt-bundle-state-success',
      text: 'Last copied: Markdown',
      exact: true,
    });
    const result = await nativeClipboard.readText();
    await driver.press('Escape');
    return result;
  };
  await setEnabled(true);
  await driver.evaluate(
    `window.imnota.importImageFiles({projectPath:${json(projectPath)},paths:[${json(png)}]})`,
  );
  const recorded = (await host.readProject(projectPath)).screenshots.at(-1)!;
  if (recorded.source?.via !== 'import' || Number.isNaN(Date.parse(recorded.source.capturedAt)))
    throw new Error('Opt-in import did not persist its source timestamp.');
  await openProject();
  await driver.click({ selector: `[data-testid="screenshot-${recorded.id}"]` });
  await driver.fill({ selector: '[data-testid="source-app"]' }, 'Synthetic source app');
  await waitForSource(`source?.app === 'Synthetic source app'`);
  await driver.fill({ selector: '[data-testid="source-window-title"]' }, 'Synthetic source window');
  await waitForSource(`source?.windowTitle === 'Synthetic source window'`);
  await driver.fill({ selector: '[data-testid="source-url"]' }, 'https://example.com/source');
  await waitForSource(`source?.url === 'https://example.com/source'`);
  driver.setWindow(await host.reopenWindow());
  await driver.waitFor({ selector: '[data-testid="source-app"]' });
  if (
    (await driver.evaluate(`document.querySelector('[data-testid="source-app"]').value`)) !==
    'Synthetic source app'
  )
    throw new Error('Edited source was not rendered after reopening.');
  if (artifactDirectory)
    captures.push(await driver.capture(artifactDirectory, 'source-context-edited.png', recorded));
  const included = await markdown();
  if (
    !included.includes('Source:') ||
    !included.includes('Synthetic source app') ||
    !included.includes('https://example.com/source')
  )
    throw new Error('Enabled Markdown export omitted edited source.');
  await setEnabled(false);
  const excluded = await markdown();
  if (excluded.includes('Source:') || excluded.includes('Synthetic source app'))
    throw new Error('Disabled Markdown export leaked retained source.');
  if ((await host.readProject(projectPath)).screenshots.at(-1)?.source?.app !== 'Synthetic source app')
    throw new Error('Disabling source removed existing data.');
  await driver.click({ selector: '.source-section button', text: 'Remove source info', exact: true });
  await waitForSource('source === undefined');
  driver.setWindow(await host.reopenWindow());
  await driver.waitFor({ selector: '.source-section', text: 'Source info is off.' });
  if ((await host.readProject(projectPath)).screenshots.at(-1)?.source !== undefined)
    throw new Error('Removed source reappeared after reopening.');
  return captures;
}
