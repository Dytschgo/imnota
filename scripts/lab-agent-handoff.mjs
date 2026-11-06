// Lab-only verification. Run from the transferred checkout after its normal build.
// IMNOTA_PLAYWRIGHT_MODULE must name an already approved Playwright installation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const packageVersion = require('./package.json').version;
const runtimeCandidates = [
  process.env.IMNOTA_PLAYWRIGHT_MODULE,
  'playwright',
  'playwright-core',
  path.join(process.env.APPDATA || os.homedir(), 'npm/node_modules/playwright'),
  path.join(process.env.APPDATA || os.homedir(), 'npm/node_modules/playwright-core'),
].filter(Boolean);
let runtime;
for (const candidate of runtimeCandidates) {
  try {
    const entry = require.resolve(candidate);
    if (require(entry)._electron) {
      runtime = entry;
      break;
    }
  } catch {
    /* Continue read-only lookup; never install implicitly. */
  }
}
if (process.argv.includes('--runtime-probe')) {
  console.log(
    JSON.stringify({ node: process.version, runtime: runtime || null, candidates: runtimeCandidates }),
  );
  process.exit(0);
}
if (!runtime) throw new Error('No existing Playwright Electron runtime found. No tool was installed.');
const { _electron } = require(runtime);
const { PNG } = require('pngjs');
const { DEFAULT_PREFERENCE_SETTINGS } = await import(
  pathToFileURL(path.join(root, 'dist-electron/src/shared/preferences.js'))
);
const evidenceParent = path.resolve(process.env.IMNOTA_PLAYWRIGHT_ARTIFACT_DIR || '.');
await fs.mkdir(evidenceParent, { recursive: true });
const evidence = await fs.mkdtemp(path.join(evidenceParent, 'imnota-playwright-evidence-'));
const expectedSourceRevision = process.env.IMNOTA_TEST_SOURCE_REVISION;
if (!/^[a-f0-9]{40}$/.test(expectedSourceRevision || ''))
  throw new Error('Set the exact transferred source revision for evidence.');
const provenance = {
  expectedSourceRevision,
  runtime,
  node: process.version,
  mainSha256: createHash('sha256')
    .update(await fs.readFile(path.join(root, 'dist-electron/electron/main.js')))
    .digest('hex'),
  rendererSha256: createHash('sha256')
    .update(await fs.readFile(path.join(root, 'dist/index.html')))
    .digest('hex'),
};
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-playwright-owned-'));
const profile = path.join(fixture, 'profile');
const workspace = path.join(fixture, 'workspace');
const results = [];
let application;
let page;
let failed;
const passed = (name) => {
  results.push({ name, status: 'passed' });
  console.log('PASS ' + name);
};
try {
  await fs.mkdir(profile);
  await fs.mkdir(workspace);
  await fs.writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({
      workspacePath: workspace,
      preferences: {
        ...DEFAULT_PREFERENCE_SETTINGS,
        onboarding: { completed: true, completedVersion: 1 },
        updates: { whatsNewAcknowledgedVersion: packageVersion },
      },
    }),
  );
  const bootstrap = path.join(fixture, 'bootstrap.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');
for(const name of ['appData','userData','sessionData','logs','crashDumps'])app.setPath(name,${JSON.stringify(profile)});
app.setAppPath(${JSON.stringify(root)});
import(${JSON.stringify(pathToFileURL(path.join(root, 'dist-electron/electron/main.js')).href)}).catch(error=>{console.error(error);app.exit(1)});`,
  );
  const source = path.join(fixture, 'synthetic.png');
  const image = new PNG({ width: 720, height: 480 });
  for (let i = 0; i < image.data.length; i += 4) image.data.set([45, 91, 130, 255], i);
  await fs.writeFile(source, PNG.sync.write(image));
  const environment = { ...process.env };
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'IMNOTA_SMOKE',
    'IMNOTA_MCP_VERIFY_PROFILE',
    'IMNOTA_MCP_VERIFY_OWNER',
    'VITE_DEV_SERVER_URL',
  ])
    delete environment[name];
  application = await _electron.launch({
    executablePath: require('electron'),
    args: [bootstrap],
    cwd: root,
    env: environment,
    timeout: 30000,
  });
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
  page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await application.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.getByTestId('new-project-button').click();
  await page.getByTestId('project-name-input').fill('Playwright saved handoff');
  await page.getByTestId('create-project-submit').click();
  await page.locator('.workspace').waitFor();
  const projectPath = await page.evaluate(async (source) => {
    const project = (await globalThis.window.imnota.listProjects()).find(
      (item) => item.name === 'Playwright saved handoff',
    );
    const snapshot = await globalThis.window.imnota.loadProject(project.projectPath);
    await globalThis.window.imnota.importImageFiles({
      projectPath: project.projectPath,
      paths: [source],
      collectionId: snapshot.project.collections[0].id,
    });
    return project.projectPath;
  }, source);
  await page.locator('[data-testid^="screenshot-"]').first().click();
  await page.getByLabel('Description', { exact: true }).fill('SAVED_PLAYWRIGHT_EVIDENCE');
  await page.getByTestId('share-prompt-bundles').click();
  await page.locator('[data-testid="prompt-sharing-dialog"][aria-busy="false"]').waitFor();
  await page.getByTestId('copy-bundle-1').click();
  await page.getByTestId('last-saved-handoff').waitFor();
  await page.getByTestId('last-saved-handoff').click();
  const instructionBox = page.getByLabel('Agent instruction', { exact: true });
  await instructionBox.waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Copy agent instruction', exact: true }).isDisabled(),
    true,
  );
  assert.match(await page.getByRole('dialog').innerText(), /Local agent access is off/);
  const settings = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
  assert.equal(settings.preferences.agentAccess.enabled, false);
  passed('Access-off guidance leaves access disabled');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(async () => {
    const result = await globalThis.window.imnota.setPreferenceSettings({ agentAccess: { enabled: true } });
    if (!result.ok) throw new Error(result.error.message);
  });
  await page.getByTestId('last-saved-handoff').click();
  await instructionBox.waitFor();
  const instruction = await instructionBox.inputValue();
  const id = instruction.match(/b_[a-f0-9]{32}/)?.[0];
  assert.ok(id);
  assert.match(instruction, /Do not substitute get_latest_bundle/);
  await page.getByRole('button', { name: 'Copy agent instruction', exact: true }).click();
  await page
    .getByText('Agent instruction copied. Paste it into your configured agent.', { exact: true })
    .waitFor();
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), instruction);
  passed('Copy writes the exact saved bundle instruction to the native clipboard');
  const getBundle = async () => {
    const response = await globalThis.fetch('http://127.0.0.1:17384/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_bundle', arguments: { id } },
      }),
      signal: globalThis.AbortSignal.timeout(10000),
    });
    assert.equal(response.ok, true);
    return (await response.json()).result;
  };
  const bundle = await getBundle();
  assert.equal(Boolean(bundle.isError), false);
  const metadata = JSON.parse(bundle.content[0].text);
  assert.equal(metadata.id, id);
  assert.match(metadata.bundles[0].markdown, /SAVED_PLAYWRIGHT_EVIDENCE/);
  const locate = async (folder, suffix) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        const found = await locate(target, suffix);
        if (found) return found;
      } else if (entry.name === `${metadata.setName} - 01.${suffix}`) return target;
    }
  };
  const markdownPath = await locate(projectPath, 'md');
  const pngPath = await locate(projectPath, 'png');
  assert.ok(markdownPath && pngPath);
  const savedMarkdown = await fs.readFile(markdownPath, 'utf8');
  assert.equal(metadata.bundles[0].markdown, savedMarkdown);
  assert.equal(bundle.content[1].data, (await fs.readFile(pngPath)).toString('base64'));
  passed('Local MCP retrieves byte-identical saved Markdown and PNG');
  await page.screenshot({ path: path.join(evidence, 'handoff-exact.png') });
  await application.evaluate(({ shell }) => {
    globalThis.__imnotaPlaywrightOpened = [];
    shell.openPath = async (target) => {
      globalThis.__imnotaPlaywrightOpened.push(target);
      return '';
    };
  });
  await page.getByRole('button', { name: 'Open saved files', exact: true }).click();
  await page.getByText('Saved files opened.', { exact: true }).waitFor();
  const opened = await application.evaluate(() => globalThis.__imnotaPlaywrightOpened);
  assert.deepEqual(opened.sort(), [markdownPath, pngPath].sort());
  passed('Open saved files requests only the selected exact files (OS opener stubbed)');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('prompt-sharing-close').click();
  await page.getByLabel('Description', { exact: true }).fill('CURRENT_EDIT_NOT_IN_SAVED_EXPORT');
  await page.getByTestId('share-prompt-bundles').click();
  await page.locator('[data-testid="prompt-sharing-dialog"][aria-busy="false"]').waitFor();
  await page.getByTestId('last-saved-handoff').click();
  await page
    .getByText('The collection has changed since this export. This handoff still uses the saved evidence.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await instructionBox.inputValue(), instruction);
  assert.equal(await fs.readFile(markdownPath, 'utf8'), savedMarkdown);
  assert.equal(JSON.parse((await getBundle()).content[0].text).bundles[0].markdown, savedMarkdown);
  passed('Later edits are marked changed and preserve the saved ID and content');
  await page.screenshot({ path: path.join(evidence, 'handoff-changed.png') });
  // Delete only the disposable fixture's PNG, then restore it even on assertion failure.
  const png = await fs.readFile(pngPath);
  try {
    await fs.unlink(pngPath);
    await page.getByRole('button', { name: 'Open saved files', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /no longer available|not found|unavailable/i);
    assert.equal(await instructionBox.inputValue(), instruction);
    assert.equal((await application.evaluate(() => globalThis.__imnotaPlaywrightOpened)).length, 2);
    passed('Missing saved files produce an explicit error without opening a substitute');
    await page.screenshot({ path: path.join(evidence, 'handoff-missing.png') });
  } finally {
    await fs.writeFile(pngPath, png);
  }
} catch (error) {
  failed = error;
  console.error(error);
  if (page) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
} finally {
  if (application) {
    await application
      .context()
      .tracing.stop({ path: path.join(evidence, 'trace.zip') })
      .catch(() => {});
    await application.close();
  }
  // This exact path was created by this process; no pre-existing profile is removed.
  await fs.rm(fixture, { recursive: true, force: true });
  await fs.writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify(
      {
        passed: !failed && results.length === 6,
        expected: 6,
        results,
        provenance,
        error: failed?.stack,
        fixtureRemoved: true,
      },
      null,
      2,
    ),
  );
  console.log('Playwright evidence: ' + evidence);
}
if (failed) process.exitCode = 1;
