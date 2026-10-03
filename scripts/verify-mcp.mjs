import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRunDirectory,
  removeRunDirectory,
  nativeVerificationEnvironment,
  prepareArtifactDirectory,
} from './smoke-process.mjs';

// A real packaged process, one request at a time, no retry or replay. Bounds apply before parsing.
export async function runMcpProcess(executable, args, env, exercise, { timeoutMs = 45_000 } = {}) {
  const child = spawn(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let pending;
  let buffer = '';
  let stdoutBytes = 0;
  let stderr = '';
  let failure;
  let closed = false;
  let forceKill;
  let abandon;
  let resolveCompletion;
  const responses = [];
  const fail = (error) => {
    failure ??= error;
    pending?.reject(error);
    pending = undefined;
    // ChildProcess owns this exact spawned process. Never enumerate/kill by application name.
    if (!closed) child.kill('SIGTERM');
    forceKill ??= globalThis.setTimeout(() => {
      if (!closed) child.kill('SIGKILL');
    }, 2_000);
    abandon ??= globalThis.setTimeout(() => {
      if (closed) return;
      failure.processStillRunning = true;
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolveCompletion({ code: null, signal: null });
    }, 5_000);
  };
  const timeout = globalThis.setTimeout(() => {
    fail(new Error('Packaged MCP process exceeded its deadline.'));
  }, timeoutMs);
  const completion = new Promise((resolveExit) => {
    resolveCompletion = resolveExit;
    child.once('error', fail);
    child.once('close', (code, signal) => {
      closed = true;
      globalThis.clearTimeout(timeout);
      globalThis.clearTimeout(forceKill);
      if (pending) fail(new Error('MCP exited before answering the outstanding request.'));
      if (buffer) failure ??= new Error('MCP stdout ended with an incomplete JSON-RPC line.');
      globalThis.clearTimeout(forceKill);
      globalThis.clearTimeout(abandon);
      resolveExit({ code, signal });
    });
  });
  child.stdin.on('error', fail);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBytes += Buffer.byteLength(chunk);
    if (stdoutBytes > 1_000_000) return fail(new Error('Synthetic MCP responses exceeded 1 MB.'));
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const response = JSON.parse(line);
        assert.equal(response.jsonrpc, '2.0');
        assert.ok(pending, 'Unsolicited stdout is not an RPC response.');
        assert.equal(response.id, pending.id);
        assert.ok(Object.hasOwn(response, 'result') !== Object.hasOwn(response, 'error'));
        responses.push(response);
        pending.resolve(response);
        pending = undefined;
      } catch (error) {
        fail(error);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (Buffer.byteLength(stderr) + Buffer.byteLength(chunk) > 65_536)
      return fail(new Error('MCP stderr exceeded 64 KB.'));
    stderr += chunk;
  });
  let nextId = 0;
  const request = (method, params) =>
    new Promise((resolveResponse, reject) => {
      if (failure || closed) return reject(failure ?? new Error('MCP already exited.'));
      assert.equal(pending, undefined);
      pending = { id: ++nextId, resolve: resolveResponse, reject };
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params })}\n`);
    });
  try {
    await exercise(request);
    child.stdin.end(); // Production readline EOF and app.exit, not a test shutdown RPC.
  } catch (error) {
    fail(error);
  }
  const exit = await completion;
  globalThis.clearTimeout(timeout);
  const evidence = { ...exit, pid: child.pid, stderr, stdoutBytes, responses };
  if (failure) {
    failure.mcpProcess = evidence;
    throw failure;
  }
  return evidence;
}

async function snapshot(root) {
  const result = {};
  for (const name of (await readdir(root, { recursive: true })).sort()) {
    const target = join(root, name);
    const stat = await lstat(target);
    assert.ok(!stat.isSymbolicLink());
    result[name] = stat.isDirectory()
      ? 'directory'
      : createHash('sha256')
          .update(await readFile(target))
          .digest('hex');
  }
  return result;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyPackagedMcp(executable, packagedArtifact = executable) {
  assert.ok(executable, 'An actual packaged executable is required.');
  executable = await realpath(resolve(executable));
  assert.ok((await lstat(executable)).isFile());
  const artifacts = prepareArtifactDirectory(
    process.env.IMNOTA_MCP_ARTIFACT_DIR ?? resolve('release/imnota-verification-artifacts-mcp'),
  );
  const version =
    process.env.IMNOTA_EXPECT_VERSION ?? JSON.parse(await readFile('package.json', 'utf8')).version;
  const root = createRunDirectory();
  const owner = randomBytes(32).toString('hex');
  const report = { passed: false, platform: process.platform, version, executable, root, launches: [] };
  let safeToRemove = true;
  try {
    report.revision = spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout?.trim();
    report.executableSha256 = await sha256(executable);
    report.packagedArtifact = await realpath(resolve(packagedArtifact));
    report.artifactSha256 = await sha256(report.packagedArtifact);
    const asar = resolve(
      executable,
      '..',
      ...(process.platform === 'darwin' ? ['..', 'Resources'] : ['resources']),
      'app.asar',
    );
    report.asarSha256 = await sha256(asar);
    await writeFile(join(root, '.imnota-mcp-owned'), owner, { flag: 'wx' });
    const workspace = join(root, 'workspace');
    const projectPath = join(workspace, 'synthetic-project');
    const collectionId = '001-collection';
    const setName = 'Review - 260913-120000';
    const folder = join(projectPath, 'collections', collectionId, 'exports', setName);
    await mkdir(folder, { recursive: true });
    // Reuse the canonical synthetic-project constructor; it is not the process under test.
    const { emptyProject } = await import('../dist-electron/src/shared/utils.js');
    const { DEFAULT_PREFERENCE_SETTINGS } = await import('../dist-electron/src/shared/preferences.js');
    const project = emptyProject('MCP packaged fixture', '', 'Synthetic');
    project.collections.push({ ...project.collections[0], id: '002-empty', name: 'No exports' });
    await mkdir(join(projectPath, 'collections', '002-empty'), { recursive: true });
    await writeFile(join(projectPath, 'project.json'), JSON.stringify(project));
    const markdown = '# Saved synthetic bundle\n\nRead from the packaged executable.\n';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await writeFile(join(folder, `${setName} - 01.md`), markdown);
    await writeFile(join(folder, `${setName} - 01.png`), png);
    const before = await snapshot(workspace);
    for (const enabled of [false, true]) {
      const profile = join(root, enabled ? 'mcp-enabled' : 'mcp-disabled');
      await mkdir(profile);
      const settings = JSON.stringify({
        workspacePath: workspace,
        preferences: { ...DEFAULT_PREFERENCE_SETTINGS, agentAccess: { enabled } },
      });
      await writeFile(join(profile, 'settings.json'), settings, { flag: 'wx' });
      const env = {
        ...nativeVerificationEnvironment(process.env),
        IMNOTA_MCP_VERIFY_PROFILE: profile,
        IMNOTA_MCP_VERIFY_OWNER: owner,
      };
      for (const key of Object.keys(env)) if (key.startsWith('IMNOTA_SMOKE')) delete env[key];
      delete env.ELECTRON_ENABLE_LOGGING;
      delete env.NODE_OPTIONS;
      const result = await runMcpProcess(executable, ['--mcp'], env, async (request) => {
        if (!enabled) return;
        const init = await request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'imnota-packaged-verifier', version: '1' },
        });
        assert.equal(init.result.serverInfo.version, version);
        assert.equal(init.result.serverInfo.name, 'imnota');
        const tools = await request('tools/list', {});
        for (const name of ['list_projects', 'list_collections', 'get_bundle', 'get_latest_bundle'])
          assert.ok(
            tools.result.tools.some((tool) => tool.name === name),
            `Missing ${name}`,
          );
        const call = async (name, args) => {
          const response = await request('tools/call', { name, arguments: args });
          assert.equal(response.error, undefined);
          return response.result;
        };
        const listed = await call('list_collections', { projectPath });
        assert.equal(listed.isError, false);
        const collections = JSON.parse(listed.content[0].text).collections;
        assert.equal(collections.length, 2);
        const id = collections.find((collection) => collection.id === collectionId).preparedBundles[0].id;
        assert.match(id, /^b_[a-f0-9]{32}$/);
        for (const [name, args] of [
          ['get_bundle', { id }],
          ['get_latest_bundle', {}],
        ]) {
          const bundle = await call(name, args);
          assert.equal(bundle.isError, false);
          assert.equal(JSON.parse(bundle.content[0].text).bundles[0].markdown, markdown);
          assert.deepEqual(bundle.content[1], {
            type: 'image',
            mimeType: 'image/png',
            data: png.toString('base64'),
          });
        }
        for (const [name, args, error] of [
          ['get_bundle', { id: `b_${'0'.repeat(32)}` }, 'bundle not found'],
          ['get_latest_bundle', { projectPath, collectionId: '002-empty' }, 'bundle not prepared'],
        ]) {
          const result = await call(name, args);
          assert.equal(result.isError, true);
          assert.equal(result.content[0].text, error);
          assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024);
        }
      });
      report.launches.push({ enabled, ...result });
      assert.equal(result.signal, null);
      assert.equal(result.code, enabled ? 0 : 1);
      if (!enabled) {
        assert.equal(result.stdoutBytes, 0);
        assert.match(result.stderr, /Local agent access is off/);
      }
      assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection|Uncaught Exception|JavaScript error/i);
      const lifecycle = JSON.parse(await readFile(join(profile, 'mcp-lifecycle.json'), 'utf8'));
      report.launches.at(-1).lifecycle = lifecycle;
      assert.equal(lifecycle.packaged, true);
      assert.equal(lifecycle.version, version);
      assert.equal(await realpath(lifecycle.executable), executable);
      assert.equal(lifecycle.profile, profile);
      assert.equal(lifecycle.session, profile);
      assert.equal(lifecycle.windowsCreated, 0);
      assert.equal(lifecycle.windowsRemaining, 0);
      assert.equal(lifecycle.httpListener, null);
      assert.equal(lifecycle.started, enabled);
      assert.equal(await readFile(join(profile, 'settings.json'), 'utf8'), settings);
      assert.deepEqual(await snapshot(workspace), before);
    }
    report.workspaceHashes = before;
    report.passed = true;
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
    report.failedProcess = error.mcpProcess;
    safeToRemove = !error.processStillRunning;
    report.fixtureRetained = !safeToRemove;
    throw error;
  } finally {
    // Preserve evidence before removing only the marked fixture; never an installed profile.
    if (artifacts) await writeFile(join(artifacts, 'mcp-verification.json'), JSON.stringify(report, null, 2));
    console.log('Packaged MCP verification:', JSON.stringify(report));
    if (safeToRemove) removeRunDirectory(root);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyPackagedMcp(process.argv[2], process.argv[3]);
}
