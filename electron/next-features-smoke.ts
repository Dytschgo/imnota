import { nativeClipboard } from './native-clipboard.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NativeUiDriver, SmokeCapture, SmokeCheckpoint } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';
import { formatTerminalHandoff } from '../src/shared/terminal-handoff.js';

/** Test-only receiver inside the modal's focus scope; never submits to an external service. */
async function verifyTerminalPaste(driver: NativeUiDriver, expected: string): Promise<void> {
  await driver.evaluate(`(() => {
    const dialog = document.querySelector('[data-testid="prompt-sharing-dialog"]')?.closest('[role="dialog"]');
    if (!dialog) throw new Error('Terminal handoff dialog is unavailable.');
    const receiver = document.createElement('textarea');
    receiver.id = 'imnota-terminal-paste-receiver';
    receiver.setAttribute('aria-label', 'Terminal handoff verification receiver');
    dialog.append(receiver);
    window.__imnotaTerminalPasteResult = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Terminal handoff native Paste timed out.')), 5000);
      receiver.addEventListener('paste', event => {
        clearTimeout(timeout);
        event.preventDefault();
        resolve({trusted: event.isTrusted, text: event.clipboardData?.getData('text/plain'),
          files: event.clipboardData?.files.length});
      }, {once: true});
    });
    receiver.focus();
    if (document.activeElement !== receiver) throw new Error('Terminal paste receiver could not receive focus.');
  })()`);
  try {
    driver.browserWindow.webContents.paste();
    const received = await driver.evaluate<{ trusted: boolean; text: string; files: number }>(
      'window.__imnotaTerminalPasteResult',
    );
    if (!received.trusted || received.text !== expected || received.files !== 0)
      throw new Error('Terminal handoff native Paste did not deliver the exact plain text.');
  } finally {
    await driver.evaluate(`(() => {
      document.getElementById('imnota-terminal-paste-receiver')?.remove();
      delete window.__imnotaTerminalPasteResult;
    })()`);
  }
}

/** Runs only from the isolated native verification workflow, with disposable projects. */
export async function exerciseNextFeatures(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  artifactDirectory?: string,
  checkpoint: SmokeCheckpoint = async () => undefined,
): Promise<SmokeCapture[]> {
  const captures: SmokeCapture[] = [];
  const capture = async (
    filename:
      | 'next-template-picker.png'
      | 'next-clipboard-fallbacks.png'
      | 'next-terminal-handoff.png'
      | 'next-template-project.png'
      | 'next-content-search.png',
  ) => {
    if (!artifactDirectory) return;
    driver.browserWindow.show();
    driver.browserWindow.focus();
    await driver.resize({ width: 1280, height: 800 });
    await driver.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    captures.push(await driver.capture(artifactDirectory, filename, 'none'));
  };
  await driver.resize({ width: 1280, height: 800 });
  if (await driver.exists({ selector: '.settings-view' }))
    await driver.click({ selector: '[aria-label="Back to workspace"]' });
  await driver.waitFor({ selector: '.settings-view' }, { absent: true });
  await driver.waitFor({ selector: '.workspace, .library' });
  await driver.click({ selector: '.nav-item', text: 'Projects', exact: true });
  await driver.click({ selector: '[data-testid="new-project-button"]' });
  await driver.fill({ selector: '[data-testid="project-name-input"]' }, 'Feature verification');
  await driver.click({ selector: '.template-picker-option', text: 'Bug report' });
  await capture('next-template-picker.png');
  await driver.click({ selector: '[data-testid="create-project-submit"]' });
  await driver.waitFor({ selector: '[data-testid="markdown-input"]' });
  await driver.fill(
    { selector: '[data-testid="markdown-input"]' },
    '# Reproducible issue\n\nUnique scene: orbital lantern.',
  );
  await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
  await driver.waitFor({
    selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]',
  });
  await driver.click({ selector: '[aria-label="Copy options"]' });
  await driver.click({
    selector: '[role="menuitem"]',
    text: 'Copy Markdown',
    exact: true,
  });
  await driver.waitFor({
    selector: '.prompt-bundle-state-success',
    text: 'Last copied: Markdown',
    exact: true,
  });
  if (
    !(await nativeClipboard.readText()).includes('orbital lantern') ||
    !(await nativeClipboard.readImage()).isEmpty()
  )
    throw new Error('Independent Markdown copy did not use the latest edited template.');
  await driver.click({ selector: '[aria-label="Copy options"]' });
  await driver.click({ selector: '[role="menuitem"]', text: 'Copy file paths', exact: true });
  await driver.waitFor({
    selector: '.prompt-bundle-state-success',
    text: 'Last copied: File paths',
    exact: true,
  });
  const copiedPaths = await nativeClipboard.readText();
  if (!copiedPaths.endsWith('.md') || copiedPaths.includes('.png'))
    throw new Error('Text-only file paths must point to a real Markdown export without a fake image.');
  await capture('next-clipboard-fallbacks.png');
  const savedMarkdown = await fs.readFile(copiedPaths, 'utf8');
  for (const wsl of process.platform === 'win32' ? [false, true] : [false]) {
    await driver.click({ selector: '[aria-label="Copy options"]' });
    if (!wsl) await capture('next-terminal-handoff.png');
    await driver.click({
      selector: '[role="menuitem"]',
      text: wsl ? 'Copy for terminal (WSL paths)' : 'Copy for terminal',
      exact: true,
    });
    await driver.waitFor({
      selector: '.prompt-bundle-state-success',
      text: 'Last copied: Terminal hand-off',
      exact: true,
    });
    const expected = formatTerminalHandoff({
      markdownPath: copiedPaths,
      markdown: savedMarkdown,
      style: process.platform === 'win32' ? 'windows' : 'posix',
      wsl,
    });
    if ((await nativeClipboard.readText()) !== expected || !(await nativeClipboard.readImage()).isEmpty())
      throw new Error('Terminal handoff did not copy the saved Markdown path without a fake image.');
    await verifyTerminalPaste(driver, expected);
  }
  await driver.click({ selector: '[data-testid="prompt-sharing-close"]' });
  const projectPath = await driver.evaluate<string>(`(async () => {
    const projects = await window.imnota.listProjects();
    return projects.find((project) => project.name === 'Feature verification').projectPath;
  })()`);
  const project = await host.readProject(projectPath);
  if (project.schemaVersion !== 4 || project.contentItems?.length !== 5)
    throw new Error('Bug report template did not create five ordered Markdown blocks.');
  driver.setWindow(await host.reopenWindow());
  if (!driver.browserWindow.isVisible()) driver.browserWindow.show();
  driver.browserWindow.focus();
  await driver.waitFor({ selector: '[data-testid="markdown-input"]' });
  const reopened = await driver.evaluate<string>(
    'document.querySelector("[data-testid=markdown-input]").value',
  );
  if (!reopened.includes('orbital lantern'))
    throw new Error('Template edits were not retained after reopen.');
  await capture('next-template-project.png');
  const beforeSearch = await fs.readFile(path.join(projectPath, 'project.json'));
  await driver.click({ selector: '.nav-item', text: 'Projects', exact: true });
  await driver.fill({ selector: '[aria-label="Search projects"]' }, 'orbital lantern');
  await driver.waitFor({ selector: '.content-search-result', text: 'Feature verification' });
  await capture('next-content-search.png');
  await checkpoint('library search: opening focused result');
  await driver.click({ selector: '.content-search-result', text: 'Feature verification' });
  await driver.waitFor({ selector: '[data-testid="markdown-input"]:focus' });
  await driver.evaluate(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const editor = document.querySelector('[data-testid="markdown-input"]');
      const selected = editor?.value.slice(editor.selectionStart, editor.selectionEnd);
      if (document.activeElement === editor && selected?.toLowerCase().includes('orbital')) return resolve(true);
      if (Date.now() - started > 5000) return reject(new Error('Search did not select the matching Markdown.'));
      setTimeout(check, 25);
    };
    check();
  })`);
  await checkpoint('library search: focused match selected; verifying unchanged metadata');
  if (!(await fs.readFile(path.join(projectPath, 'project.json'))).equals(beforeSearch))
    throw new Error('Content search modified project metadata or item order.');
  return captures;
}

/** Visual evidence uses the real appearance preference, in the disposable smoke profile. */
export async function captureNextFeatureLightViews(
  driver: NativeUiDriver,
  artifactDirectory?: string,
): Promise<SmokeCapture[]> {
  if (!artifactDirectory) return [];
  const captures: SmokeCapture[] = [];
  const capture = async (
    filename:
      | 'next-history-light.png'
      | 'next-history-detail-light.png'
      | 'next-search-light.png'
      | 'next-templates-light.png'
      | 'next-clipboard-light.png',
  ) => {
    await driver.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    captures.push(await driver.capture(artifactDirectory, filename, 'none'));
  };
  driver.browserWindow.show();
  driver.browserWindow.focus();
  await driver.resize({ width: 1280, height: 800 });
  await driver.click({ selector: '[data-testid="settings-button"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Appearance', exact: true });
  await driver.click({ selector: '[aria-label="Application theme"] label:has(input[value="light"])' });
  await driver.waitFor({ selector: ':root[data-theme="light"]' });
  await driver.click({ selector: '.settings-navigation button', text: 'Backups & history', exact: true });
  await driver.waitFor({ selector: '[aria-label="Project snapshots"][aria-busy="false"]' });
  await driver.evaluate('document.querySelector(".settings-view > .settings-grid").scrollTop = 0');
  await capture('next-history-light.png');
  await driver.click({ selector: '.imnota-history-row', text: 'Mixed Content Verification' });
  await driver.waitFor({
    selector: '.imnota-history-actions button',
    text: 'Restore as new project',
    exact: true,
  });
  await capture('next-history-detail-light.png');
  await driver.click({ selector: '[aria-label="Back to workspace"]' });
  await driver.click({ selector: '.nav-item', text: 'Projects', exact: true });
  await driver.fill({ selector: '[aria-label="Search projects"]' }, 'orbital lantern');
  await driver.waitFor({ selector: '.content-search-result', text: 'Feature verification' });
  await capture('next-search-light.png');
  await driver.click({ selector: '[data-testid="new-project-button"]' });
  await driver.click({ selector: '.template-picker-option', text: 'UI review', exact: false });
  await capture('next-templates-light.png');
  await driver.click({ selector: '[role="dialog"] button', text: 'Cancel', exact: true });
  await driver.click({ selector: '.content-search-result', text: 'Feature verification' });
  await driver.waitFor({ selector: '[data-testid="markdown-input"]:focus' });
  await driver.click({ selector: '[data-testid="share-prompt-bundles"]' });
  await driver.waitFor({
    selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"] [data-testid="copy-bundle-1"]',
  });
  await driver.click({ selector: '[aria-label="Copy options"]' });
  await driver.click({
    selector: '[role="menuitem"]',
    text: 'Copy Markdown',
    exact: true,
  });
  await driver.waitFor({
    selector: '.prompt-bundle-state-success',
    text: 'Last copied: Markdown',
    exact: true,
  });
  await capture('next-clipboard-light.png');
  await driver.click({ selector: '[data-testid="prompt-sharing-close"]' });
  return captures;
}
