import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { StringDecoder } from 'node:string_decoder';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createRunDirectory,
  removeRunDirectory,
  nativeVerificationEnvironment,
  prepareArtifactDirectory,
} from './smoke-process.mjs';

// A real packaged process, one request at a time, no retry or replay. Bounds apply before parsing.
export async function runMcpProcess(
  executable,
  args,
  env,
  exercise,
  { timeoutMs = 45_000, launch, relayLifecycle = false } = {},
) {
  const launched = launch?.(executable, env, args);
  const child =
    launched?.child ??
    spawn(executable, args, {
      env,
      stdio: relayLifecycle ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  const protocolStdout = launched?.stdout ?? child.stdout;
  let pending;
  let buffer = '';
  let stdoutBytes = 0;
  let stdoutPrefix = Buffer.alloc(0);
  let rawStdoutBytes = 0;
  const decoder = new StringDecoder('utf8');
  let stderr = '';
  let failure;
  let closed = false;
  let forceKill;
  let abandon;
  let resolveCompletion;
  const responses = [];
  const serverLifecycle = [];
  let serverClosed = false;
  const fail = (error) => {
    failure ??= error;
    pending?.reject(error);
    pending = undefined;
    // ChildProcess owns this exact spawned process. Never enumerate/kill by application name.
    if (!closed) {
      if (relayLifecycle) {
        // Let the relay terminate its exact server handle before terminating the outer process.
        if (child.connected) child.send({ type: 'imnota-mcp-stop' }, () => {});
      } else child.kill('SIGTERM');
    }
    forceKill ??= globalThis.setTimeout(() => {
      if (!closed && (!relayLifecycle || serverClosed)) child.kill('SIGKILL');
    }, 2_000);
    abandon ??= globalThis.setTimeout(() => {
      if (closed) return;
      failure.processStillRunning = true;
      child.stdin.destroy();
      protocolStdout.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      child.channel?.unref();
      resolveCompletion({ code: null, signal: null });
    }, 5_000);
  };
  if (relayLifecycle)
    child.on('message', (message) => {
      try {
        assert.equal(message?.type, 'imnota-mcp-child');
        assert.ok(Number.isSafeInteger(message.pid) && message.pid > 0);
        assert.equal(message.event, serverLifecycle.length === 0 ? 'spawn' : 'close');
        assert.ok(serverLifecycle.length < 2);
        if (message.event === 'close') {
          assert.equal(message.pid, serverLifecycle[0].pid);
          serverClosed = true;
        }
        serverLifecycle.push(message);
      } catch (error) {
        fail(error);
      }
    });
  const timeout = globalThis.setTimeout(() => {
    fail(new Error('Packaged MCP process exceeded its deadline.'));
  }, timeoutMs);
  const completion = new Promise((resolveExit) => {
    resolveCompletion = resolveExit;
    child.once('error', fail);
    child.once('close', (code, signal) => {
      closed = true;
      if (relayLifecycle && !serverClosed) {
        failure ??= new Error('Relay exited without confirming its server closed.');
        failure.processStillRunning = true;
      }
      globalThis.clearTimeout(timeout);
      globalThis.clearTimeout(forceKill);
      if (pending) fail(new Error('MCP exited before answering the outstanding request.'));
      buffer += decoder.end();
      if (buffer) failure ??= new Error('MCP stdout ended with an incomplete JSON-RPC line.');
      globalThis.clearTimeout(forceKill);
      globalThis.clearTimeout(abandon);
      resolveExit({ code, signal });
    });
  });
  child.stdin.on('error', fail);
  child.stdout.on('data', (chunk) => {
    rawStdoutBytes += chunk.length;
    // Retain literal bytes before decoding/parsing, including rejected startup output.
    stdoutPrefix = Buffer.concat([stdoutPrefix, chunk.subarray(0, 65_536 - stdoutPrefix.length)]);
    if (rawStdoutBytes > 1_000_000 + (launched ? 2 : 0))
      fail(new Error('Synthetic MCP raw stdout exceeded 1 MB plus its exact bootstrap prefix.'));
  });
  protocolStdout.on('error', fail);
  protocolStdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 1_000_000) return fail(new Error('Synthetic MCP responses exceeded 1 MB.'));
    buffer += decoder.write(chunk);
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
  const evidence = {
    ...exit,
    pid: child.pid,
    stderr,
    stdoutBytes,
    responses,
    stdoutPrefixHex: stdoutPrefix.toString('hex'),
    stdoutPrefixTruncated: rawStdoutBytes > stdoutPrefix.length,
    rawStdoutBytes,
    ...(relayLifecycle ? { serverLifecycle } : {}),
  };
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

export function inspectMcpClientNode(configured = process.env.IMNOTA_MCP_CLIENT_NODE, probe = spawnSync) {
  const executable = configured ?? process.execPath;
  const result = probe(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0)
    throw new Error(
      `MCP client Node binary is unavailable: ${executable}${result.error ? ` (${result.error.message})` : ''}`,
    );
  const version = result.stdout.trim();
  const major = /^v(\d+)\.\d+\.\d+$/.exec(version)?.[1];
  if (!major)
    throw new Error(`MCP client Node binary returned an invalid version: ${executable} (${version})`);
  if (configured !== undefined && Number(major) < 24)
    throw new Error(`MCP client Node must be version 24 or later: ${executable} is ${version}`);
  return { executable, version };
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
  const roots = [root];
  let safeToRemove = true;
  let activeProfile;
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
    let launch;
    if (process.platform === 'win32') {
      report.clientNode = inspectMcpClientNode();
      const relay = resolve(executable, '..', 'resources', 'imnota-mcp.mjs');
      report.relay = relay;
      report.relaySha256 = await sha256(relay);
      ({ launchWindowsMcp: launch } = await import(pathToFileURL(relay).href));
      report.transport = 'bundled-windows-relay';
    } else report.transport = 'direct';
    for (const outer of process.platform === 'win32' ? [false, true] : [false]) {
      const runRoot = outer ? createRunDirectory() : root;
      if (outer) roots.push(runRoot);
      await writeFile(join(runRoot, '.imnota-mcp-owned'), owner, { flag: 'wx' });
      const workspace = join(runRoot, 'workspace');
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
        const profile = join(runRoot, enabled ? 'mcp-enabled' : 'mcp-disabled');
        activeProfile = profile;
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
        const result = await runMcpProcess(
          outer ? report.clientNode.executable : executable,
          outer ? [report.relay] : ['--mcp'],
          env,
          async (request) => {
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
          },
          { launch: outer ? undefined : launch, relayLifecycle: outer },
        );
        report.launches.push({
          enabled,
          transport: outer ? 'installed-node-command' : report.transport,
          root: runRoot,
          workspaceHashes: before,
          command: outer ? [report.clientNode.executable, report.relay] : [executable, '--mcp'],
          ...result,
        });
        assert.equal(result.rawStdoutBytes, result.stdoutBytes + (launch && !outer ? 2 : 0));
        if (launch && !outer) assert.ok(result.stdoutPrefixHex.startsWith('0d0a'));
        if (outer) {
          assert.equal(result.serverLifecycle.length, 2);
          assert.equal(result.serverLifecycle[1].code, enabled ? 0 : 1);
          assert.equal(result.serverLifecycle[1].signal, null);
        }
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
      if (!outer) report.workspaceHashes = before;
    }
    report.passed = true;
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
    report.failedProcess = error.mcpProcess;
    // A confirmed exit does not mean diagnostics are disposable. Preserve failed fixtures.
    safeToRemove = false;
    report.fixtureRetained = true;
    report.retainedRoots = roots;
    report.processStillRunning = Boolean(error.processStillRunning);
    report.failedProfile = activeProfile;
    if (activeProfile) {
      try {
        const file = join(activeProfile, 'mcp-lifecycle.json');
        const stat = await lstat(file);
        assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 65_536);
        report.failedLifecycle = JSON.parse(await readFile(file, 'utf8'));
      } catch (captureError) {
        report.lifecycleCaptureError = captureError.message;
      }
    }
    throw error;
  } finally {
    // Preserve evidence before removing only the marked fixture; never an installed profile.
    if (artifacts) await writeFile(join(artifacts, 'mcp-verification.json'), JSON.stringify(report, null, 2));
    console.log('Packaged MCP verification:', JSON.stringify(report));
    if (safeToRemove) for (const directory of roots) removeRunDirectory(directory);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyPackagedMcp(process.argv[2], process.argv[3]);
}
