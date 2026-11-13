// Destructive only to this run's newly installed app on a disposable hosted Mac.
// Drive the real renderer/preload/controller/helper; no update transport or launch stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout as schedule, clearTimeout as cancel } from 'node:timers';
import { createRequire } from 'node:module';

assert.equal(process.platform, 'darwin', 'Requires macOS');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Requires disposable GitHub Actions');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Refuses self-hosted or personal Macs');
assert.ok(process.env.RUNNER_TEMP);
const run = promisify(execFile);
const appPath = '/Applications/Imnota.app';
const executable = `${appPath}/Contents/MacOS/Imnota`;
const plist = `${appPath}/Contents/Info.plist`;
const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const archive = path.resolve(`release/Imnota-${version}-universal-mac.zip`);
assert.ok(
  process.env.IMNOTA_MAC_UPDATE_FIXTURE_ARCHIVE,
  'Requires a separately packaged older-version fixture',
);
const fixtureArchive = path.resolve(process.env.IMNOTA_MAC_UPDATE_FIXTURE_ARCHIVE);
assert.ok(fixtureArchive.startsWith(`${path.resolve(process.env.RUNNER_TEMP)}${path.sep}`));
const evidence = path.resolve(
  process.env.IMNOTA_MAC_IN_APP_EVIDENCE ??
    `${process.env.RUNNER_TEMP}/imnota-verification-artifacts-live-update`,
);
assert.ok(evidence.startsWith(`${path.resolve(process.env.RUNNER_TEMP)}${path.sep}`));
await fs.mkdir(evidence, { recursive: true });
const exists = (target) =>
  fs.lstat(target).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
assert.equal(await exists(appPath), false, 'Never replace a pre-existing installation');
assert.equal(
  (await fs.readdir('/Applications')).some((name) => /^\.imnota-|^Imnota(?:[ .-]|$)/.test(name)),
  false,
  'Refuses pre-existing Imnota recovery paths',
);
for (const name of ['Imnota', 'imnota'])
  assert.equal(
    await exists(path.join(os.homedir(), 'Library/Application Support', name)),
    false,
    'Refuses an existing app profile',
  );

const receipt = {
  sourceSha: (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(),
  sourceTree: (await run('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim(),
  sourcePackageVersion: version,
  archiveSha256: createHash('sha256')
    .update(await fs.readFile(archive))
    .digest('hex'),
  fixtureVersion: '0.0.0',
  fixtureArchiveSha256: createHash('sha256')
    .update(await fs.readFile(fixtureArchive))
    .digest('hex'),
  declaration:
    'Same compiled candidate application code, separately packaged with extraMetadata.version=0.0.0. Package and bundle versions agree. Every extracted application file is compared with the normal candidate except root package.json version. This is a declared older-version fixture, not the published distributable.',
  passed: false,
};
let failure;
let owned = false,
  child,
  socket,
  stderr = '',
  cdpId = 0;
const pending = new Map();
async function waitFor(label, read, timeout = 30_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value) return value;
    assert.ok(Date.now() < end, `Timed out waiting for ${label}`);
    await delay(100);
  }
}
function send(method, params = {}) {
  assert.equal(socket.readyState, globalThis.WebSocket.OPEN, 'Renderer connection closed');
  return new Promise((resolve, reject) => {
    const id = ++cdpId;
    const timer = schedule(() => {
      pending.delete(id);
      reject(new Error(`Renderer command timed out: ${method}`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const status = () => evaluate('window.imnota.getUpdateStatus()');
async function click(selector, text) {
  const point = await waitFor(`visible ${text ?? selector}`, () =>
    evaluate(`(() => {
    for (const node of document.querySelectorAll(${JSON.stringify(selector)})) {
      if (!(${text === undefined ? 'true' : `node.textContent.trim() === ${JSON.stringify(text)}`}) || node.disabled) continue;
      node.scrollIntoView({block:'center'});
      const r = node.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
      if (r.width > 0 && r.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight &&
        node.contains(document.elementFromPoint(x,y))) return {x,y};
    }
    return null;
  })()`),
  );
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function capture(name) {
  const image = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(evidence, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function appPids() {
  const listing = (await run('/bin/ps', ['-ww', '-axo', 'pid=,comm='])).stdout;
  return listing.split('\n').flatMap((line) => {
    const row = /^\s*(\d+)\s+(.+)$/.exec(line);
    return row && row[2].startsWith(`${appPath}/`) ? [{ pid: Number(row[1]), command: row[2] }] : [];
  });
}
async function prepareFixtureWorkspace(profileDirectories) {
  const workspace = await fs.realpath(
    await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'imnota-live-update-workspace-')),
  );
  const ownedProfiles = new Set();
  for (const directory of profileDirectories) {
    try {
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      // On a case-insensitive Mac, Imnota and imnota name the same newly owned directory.
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.lstat(directory);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Profile fixture must be a physical directory');
      assert.ok(ownedProfiles.has(await fs.realpath(directory)), 'Never seed a pre-existing profile');
      continue;
    }
    const stat = await fs.lstat(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Profile fixture must be a physical directory');
    ownedProfiles.add(await fs.realpath(directory));
    // Existing legacy fixture shape, also used by verify-mcp; normal startup migrates it.
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ workspacePath: workspace }), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  receipt.workspace = workspace;
  return workspace;
}
async function removeOwnedInstallation() {
  for (const { pid } of await appPids()) {
    const current = await run('/bin/ps', ['-ww', '-o', 'comm=', '-p', String(pid)]).catch((error) => {
      if (error.code === 1) return { stdout: '' };
      throw error;
    });
    if (!current.stdout.trim()) continue;
    assert.ok(current.stdout.trim().startsWith(`${appPath}/`), 'Refuse a reused process ID');
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await waitFor('owned app shutdown', async () => (await appPids()).length === 0, 10_000);
  if (await exists(appPath)) {
    assert.equal(await fs.realpath(appPath), appPath, 'Refuse cleanup after a path substitution');
    await fs.rm(appPath, { recursive: true });
  }
}
async function verifyFixtureCode(normalAsar, fixtureAsar) {
  // Reuse electron-builder's pinned ASAR dependency rather than adding another packager.
  const require = createRequire(import.meta.url);
  const builder = createRequire(require.resolve('electron-builder'));
  const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar');
  const scratch = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'imnota-update-compare-'));
  const original = path.join(scratch, 'original'),
    fixture = path.join(scratch, 'fixture');
  const manifest = async (directory, relative = '') => {
    const result = {};
    for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name),
        target = path.join(directory, name);
      if (entry.isSymbolicLink()) result[name] = `link:${await fs.readlink(target)}`;
      else if (entry.isDirectory()) Object.assign(result, await manifest(directory, name));
      else if (name !== 'package.json')
        result[name] = createHash('sha256')
          .update(await fs.readFile(target))
          .digest('hex');
    }
    return result;
  };
  try {
    asar.extractAll(normalAsar, original);
    asar.extractAll(fixtureAsar, fixture);
    receipt.sourceAsarSha256 = createHash('sha256')
      .update(await fs.readFile(normalAsar))
      .digest('hex');
    const files = await manifest(original);
    assert.deepEqual(await manifest(fixture), files, 'Fixture must preserve all candidate application bytes');
    const originalPackage = JSON.parse(await fs.readFile(path.join(original, 'package.json'), 'utf8'));
    const fixturePackage = JSON.parse(await fs.readFile(path.join(fixture, 'package.json'), 'utf8'));
    assert.equal(originalPackage.version, version);
    assert.equal(fixturePackage.version, '0.0.0');
    assert.deepEqual(
      { ...fixturePackage, version },
      originalPackage,
      'Only fixture version metadata may differ',
    );
    receipt.identicalApplicationFiles = Object.keys(files).length;
    await fs.writeFile(path.join(evidence, 'candidate-code-manifest.json'), JSON.stringify(files, null, 2));
  } finally {
    assert.ok(
      (await fs.realpath(scratch)).startsWith(`${await fs.realpath(process.env.RUNNER_TEMP)}${path.sep}`),
    );
    await fs.rm(scratch, { recursive: true });
  }
}
try {
  const sourceBundle = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'imnota-update-source-'));
  await run('/usr/bin/ditto', ['-x', '-k', archive, sourceBundle]);
  // The hosted runner starts without Imnota; this run owns the destination from here.
  owned = true;
  await run('/usr/bin/ditto', ['-x', '-k', fixtureArchive, '/Applications']);
  assert.equal(await fs.realpath(appPath), appPath);
  receipt.asarSha256 = createHash('sha256')
    .update(await fs.readFile(`${appPath}/Contents/Resources/app.asar`))
    .digest('hex');
  await verifyFixtureCode(
    `${sourceBundle}/Imnota.app/Contents/Resources/app.asar`,
    `${appPath}/Contents/Resources/app.asar`,
  );
  assert.equal(
    (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist])).stdout.trim(),
    '0.0.0',
  );
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', appPath]);
  await prepareFixtureWorkspace(
    ['Imnota', 'imnota'].map((name) => path.join(os.homedir(), 'Library/Application Support', name)),
  );
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('IMNOTA_')) delete env[key];
  child = spawn(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-65536);
  });
  const browserUrl = await waitFor('owned DevTools endpoint', () => {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, 'App exited before the walkthrough');
    return /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(stderr)?.[1];
  });
  const pages = await waitFor('renderer target', async () => {
    const list = await globalThis
      .fetch(`http://${new URL(browserUrl).host}/json/list`)
      .then((response) => response.json());
    return list.find((page) => page.type === 'page' && page.url.startsWith('file:'));
  });
  socket = new globalThis.WebSocket(pages.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data),
      waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    cancel(waiter.timer);
    if (data.error) waiter.reject(new Error(JSON.stringify(data.error)));
    else waiter.resolve(data.result);
  });
  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) {
      cancel(waiter.timer);
      waiter.reject(new Error('Renderer connection closed'));
    }
    pending.clear();
  });
  await waitFor('production preload', () => evaluate('Boolean(window.imnota)'));
  // The seeded legacy profile represents an existing installation, not first-run onboarding.
  assert.equal(
    await evaluate('window.imnota.getSettings().then(value => value.workspacePath)'),
    receipt.workspace,
    'The running app must load the owned workspace fixture',
  );
  await waitFor('workspace renderer', () =>
    evaluate(
      'Boolean(document.querySelector("[data-testid=settings-button]")) && !document.querySelector(".welcome")',
    ),
  );
  await click('[data-testid="settings-button"]');
  await click('.settings-navigation button', 'Updates & about');
  // Set the empty fixture's channel through public IPC; exercise download/restart with real input.
  await waitFor('initial discovery to settle', async () => (await status()).state !== 'checking');
  await evaluate('window.imnota.setSettings({updateChannel:"nightly"})');
  const available = await waitFor('a newer selected release', async () => {
    const value = await status();
    assert.notEqual(value.state, 'error', value.message);
    return value.state === 'available' && value;
  });
  assert.equal(available.currentVersion, '0.0.0', 'Fixture version must be reported by the running app');
  assert.equal(available.manualDownload, false, 'Mac update must use the in-app path');
  receipt.targetVersion = available.version;
  receipt.targetRelease = available.releaseUrl;
  await capture('download-available');
  await click('.update-settings button', 'Download update');
  await waitFor('download progress', async () => {
    const value = await status();
    assert.notEqual(value.state, 'error', value.message);
    return value.state === 'downloading' && evaluate('Boolean(document.querySelector("[role=progressbar]"))');
  });
  await capture('download-progress');
  await waitFor(
    'verified download',
    async () => {
      const value = await status();
      assert.notEqual(value.state, 'error', value.message);
      return value.state === 'downloaded';
    },
    10 * 60_000,
  );
  await capture('restart-ready');
  receipt.originalPid = child.pid;
  await click('.update-settings button', 'Restart to install').catch((error) => {
    if (error.message !== 'Renderer connection closed') throw error;
    // The release of the native click can close its own renderer before CDP acknowledges it.
  });
  await waitFor('original app exit', () => child.exitCode !== null || child.signalCode !== null, 70_000);
  await waitFor(
    'new installed version and replacement process',
    async () => {
      const installed = (
        await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]).catch(
          () => ({ stdout: '' }),
        )
      ).stdout.trim();
      const process = (await appPids()).find(
        (row) => row.command === executable && row.pid !== receipt.originalPid,
      );
      if (installed !== receipt.targetVersion || !process) return false;
      receipt.reopenedPid = process.pid;
      return true;
    },
    120_000,
  );
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', appPath]);
  await waitFor(
    'verified transaction commit',
    async () =>
      !(await exists('/Applications/.imnota-backups.noindex')) &&
      !(await exists('/Applications/.imnota-update.lock')),
  );
  await run('/usr/sbin/screencapture', ['-x', path.join(evidence, 'reopened-desktop.png')]);
  receipt.passed = true;
} catch (error) {
  receipt.error = String(error);
  await run('/usr/sbin/screencapture', ['-x', path.join(evidence, 'failure-desktop.png')]).catch(
    () => undefined,
  );
  failure = error;
} finally {
  socket?.close();
  try {
    // On failure preserve the transaction and its processes for evidence. The hosted runner
    // is disposable; never remove files while a detached helper could still be repairing them.
    if (owned && receipt.passed) {
      await removeOwnedInstallation();
      receipt.cleanup = 'Owned installation removed; disposable hosted profile is left to runner disposal.';
    } else {
      receipt.cleanup = 'Failed transaction preserved for inspection and disposable hosted runner disposal.';
    }
  } catch (error) {
    receipt.passed = false;
    receipt.cleanupError = String(error);
    failure ??= error;
  } finally {
    await fs.writeFile(path.join(evidence, 'verification-report.json'), JSON.stringify(receipt, null, 2));
    await fs.writeFile(path.join(evidence, 'application-stderr.log'), stderr);
  }
}
if (failure) throw failure;
