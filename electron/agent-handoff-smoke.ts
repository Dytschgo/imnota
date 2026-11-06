import fs from 'node:fs/promises';
import path from 'node:path';
import { nativeClipboard } from './native-clipboard.js';
import type { NativeUiDriver, SmokeCapture } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';

/** Exercises only the native runner's disposable workspace/profile and its saved prompt grant. */
export async function exerciseAgentHandoff(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  projectPath: string,
  exportFolder: string,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  await driver.resize({ width: 1280, height: 800 });
  const openHandoff = async () => {
    await driver.click({ selector: '[data-testid="last-saved-handoff"]' });
    await driver.waitFor({ selector: '[role="dialog"]', text: 'Send saved bundle to agent' });
  };
  await openHandoff();
  await driver.waitFor({ selector: '[role="status"]', text: 'Local agent access is off.' });
  const disabled = await driver.evaluate<boolean>(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button)=>button.textContent==='Copy agent instruction')?.disabled===true`,
  );
  if (!disabled) throw new Error('Saved handoff enabled copying without local agent setup.');
  await driver.click({ selector: 'button', text: 'Done', exact: true });
  // Setup precondition uses the real preference contract in this isolated profile. No editor configuration is written.
  await driver.evaluate(
    `(async()=>{const result=await window.imnota.setPreferenceSettings({agentAccess:{enabled:true}});if(!result.ok)throw new Error(result.error.message);})()`,
  );
  try {
    await openHandoff();
    await driver.click({ selector: 'button', text: 'Copy agent instruction', exact: true });
    await driver.waitFor({ selector: '[role="status"]', text: 'Agent instruction copied.' });
    const instruction = await nativeClipboard.readText();
    const id = instruction.match(/b_[a-f0-9]{32}/)?.[0];
    if (!id || !instruction.includes('Do not substitute get_latest_bundle'))
      throw new Error('Native agent copy did not identify one exact saved export.');
    const result = await fetch('http://127.0.0.1:17384/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_bundle', arguments: { id } },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) throw new Error(`Local saved handoff retrieval returned HTTP ${result.status}.`);
    const response = (await result.json()) as {
      result?: { isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> };
    };
    if (!response.result || response.result.isError)
      throw new Error('The copied exact handoff id was unavailable over local MCP.');
    const metadata = JSON.parse(response.result.content[0].text!);
    const setName = path.basename(exportFolder);
    const markdownPath = path.join(exportFolder, `${setName} - 01.md`);
    const pngPath = path.join(exportFolder, `${setName} - 01.png`);
    const originalMarkdown = await fs.readFile(markdownPath, 'utf8');
    if (
      metadata.id !== id ||
      metadata.setName !== setName ||
      metadata.bundles[0]?.markdown !== originalMarkdown ||
      response.result.content[1]?.data !== (await fs.readFile(pngPath)).toString('base64')
    )
      throw new Error('Copied agent handoff did not retrieve the exact saved Markdown and PNG.');
    if (artifactDirectory)
      captures.push(await driver.capture(artifactDirectory, 'agent-handoff-exact.png', 'none'));
    await driver.click({ selector: 'button', text: 'Done', exact: true });
    await driver.click({ selector: '[data-testid="prompt-sharing-close"]' });
    const project = await host.readProject(projectPath);
    const selected = project.screenshots
      .filter((shot) => shot.includeInExport)
      .sort((a, b) => a.position - b.position)[0];
    if (!selected) throw new Error('Agent handoff smoke needs an included screenshot.');
    await driver.click({ selector: `[data-testid="screenshot-${selected.id}"]` });
    await driver.fill(
      { selector: 'textarea[aria-label="Description"]' },
      'HANDOFF_CURRENT_EDIT_NOT_IN_SAVED_EXPORT',
    );
    await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
    await driver.waitFor({
      selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]',
    });
    await openHandoff();
    await driver.waitFor({
      selector: '[role="status"]',
      text: 'The collection has changed since this export.',
    });
    const retained = await driver.evaluate<string>(`document.querySelector('textarea[readonly]').value`);
    if (retained !== instruction || (await fs.readFile(markdownPath, 'utf8')) !== originalMarkdown)
      throw new Error('Inspecting an older handoff replaced its saved evidence or id.');
    if (artifactDirectory)
      captures.push(await driver.capture(artifactDirectory, 'agent-handoff-changed.png', 'none'));
    await driver.click({ selector: 'button', text: 'Done', exact: true });
    await driver.click({ selector: '[data-testid="prompt-sharing-close"]' });
    await driver.fill({ selector: 'textarea[aria-label="Description"]' }, selected.description);
    await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
    await driver.waitFor({
      selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]',
    });
  } finally {
    await driver.evaluate(
      `(async()=>{const result=await window.imnota.setPreferenceSettings({agentAccess:{enabled:false}});if(!result.ok)throw new Error(result.error.message);})()`,
    );
  }
  return captures;
}
