import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function timeoutControl(source) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-share-lifetime-control-'));
  const report = path.join(directory, 'trace.json');
  const resultsFile = path.join(directory, 'vitest-results.json');
  await fs.symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  source ??= await fs.readFile(path.join(root, 'electron/hosted-share-contract.test.ts'), 'utf8');
  source = source.replace(/^import .*share-fixture-regressions.mjs.*;\r?\n/m, '');
  source = source.replace('{ afterEach, expect, it, vi }', '{ afterEach, expect, it as originalIt, vi }');
  source = source.replace(
    /(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, quote, relative) =>
      quote + path.resolve(root, 'electron', relative).replaceAll('\\', '/') + quote,
  );
  const helper = path.join(root, 'scripts/test-support/share-fixture.mjs').replaceAll('\\', '/');
  const app = path.join(root, 'share-service/src/app.js').replaceAll('\\', '/');
  const prelude = `
import { afterAll } from 'vitest';
import fsTrace from 'node:fs/promises';
import { ShareFixture as ObservedFixture } from ${JSON.stringify(helper)};
const events = [];
const bodies = [];
const services = [];
const servers = new Set();
const fixtures = [];
let settled = false;
const mark = (event, extra = {}) => events.push({event, at: performance.now(), ...extra});
const state = () => ({ bodySettled: settled, openDatabases: services.filter(s => s.db.isOpen).length,
  listening: [...servers].filter(s => s.listening).length,
  fixtures: fixtures.map(f => f.state()) });
function it(name, body) {
  originalIt(name, context => {
    mark('body.begin');
    context.signal.addEventListener('abort', () => mark('context.abort'));
    const promise = Promise.resolve().then(body);
    bodies.push(promise.then(() => { settled = true; mark('body.settled'); },
      () => { settled = true; mark('body.settled'); }));
    return promise;
  });
}
const run = ObservedFixture.prototype.run;
ObservedFixture.prototype.run = function(body) { fixtures.push(this); return run.call(this, body); };
const start = ObservedFixture.prototype.start;
ObservedFixture.prototype.start = async function(...args) {
  try { return await start.apply(this, args); }
  finally { if (this.server) servers.add(this.server); }
};
const rm = fsTrace.rm;
vi.spyOn(fsTrace, 'rm').mockImplementation(async (target, options) => {
  mark('rm.begin', {path: String(target), ...state()});
  try { await rm(target, options); mark('rm.done'); }
  catch(error) { mark('rm.error', {code: error.code}); throw error; }
});
vi.mock(${JSON.stringify(app)}, async importOriginal => {
  const original = await importOriginal();
  return { ...original, createService(options) {
    const service = original.createService(options);
    services.push(service);
    const listen = service.app.listen;
    service.app.listen = function(...args) { const server = listen.apply(this, args); servers.add(server); return server; };
    const route = service.app.router.stack.find(layer => layer.route?.path === '/api/shares' && layer.route.methods.post).route;
    const first = route.stack[0];
    let delayed = false;
    const barrier = Object.assign(Object.create(Object.getPrototypeOf(first)), first, {
      handle(request, response, next) {
        if (delayed) return next();
        delayed = true;
        mark('upload.barrier');
        return new Promise(resolve => setTimeout(resolve, 5500)).then(() => {
          mark('upload.release'); next();
        });
      }
    });
    route.stack.unshift(barrier);
    return service;
  }};
});
afterAll(async () => {
  let timer;
  try { await Promise.race([Promise.all(bodies), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Control body did not settle')), 8000);
  })]); }
  finally {
    clearTimeout(timer);
    mark('terminal', state());
    await fsTrace.writeFile(${JSON.stringify(report)}, JSON.stringify(events, null, 2));
  }
});
`;
  // Use the same test source and default 5000ms/10000ms test/hook limits.
  const testFile = path.join(directory, 'contract.test.ts');
  await fs.writeFile(testFile, prelude + source);
  const config = path.join(directory, 'vitest.config.mjs');
  await fs.writeFile(
    config,
    `export default {root: ${JSON.stringify(directory)}, test: { environment: 'node', reporters: ['verbose', 'json'], outputFile: {json: ${JSON.stringify(resultsFile)}}, include: [${JSON.stringify(testFile.replaceAll('\\', '/'))}] }};`,
  );
  const preload = path.join(directory, 'owned-processes.mjs');
  await fs.writeFile(
    preload,
    `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const children = new Set();
const spawn = cp.spawn;
cp.spawn = function(file, args, options) {
  if (!/esbuild(?:\\.exe)?$/i.test(String(file))) throw new Error('Unexpected nested process: ' + file);
  const child = spawn.call(this, file, args, options);
  children.add(child); child.once('close', () => children.delete(child)); return child;
};
cp.fork = () => { throw new Error('Use the owned thread pool'); };
syncBuiltinESMExports();
process.on('exit', () => { for (const child of children) child.kill(); });
setTimeout(() => { for (const child of children) child.kill(); process.exit(97); }, 25000).unref();
`,
  );
  const args = [
    '--import',
    pathToFileURL(preload).href,
    path.join(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    config,
    '--configLoader',
    'native',
    '--pool',
    'threads',
    '--maxWorkers',
    '1',
    '--no-cache',
    '--testNamePattern',
    'publishes and downloads every byte',
  ];
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, TEMP: directory, TMP: directory, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  let timer;
  const outcome = await new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(new Error('Owned child exceeded 30s'));
    }, 30000);
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  await fs.writeFile(path.join(directory, 'child.log'), output);
  const events = JSON.parse(await fs.readFile(report, 'utf8'));
  const results = JSON.parse(await fs.readFile(resultsFile, 'utf8'));
  return { directory, ...outcome, output, events, results };
}

export function assertTimeoutLifecycle(result) {
  const { events, output } = result;
  assert.equal(result.code, 1, `Child must FAIL, not pass: ${result.directory}`);
  assert.equal(result.signal, null);
  assert.match(output, /Test timed out in 5000ms/);
  assert.equal(result.results.success, false);
  assert.equal(result.results.numTotalTests, 3);
  assert.equal(result.results.numFailedTests, 1);
  assert.equal(result.results.numPendingTests, 2);
  assert.equal(result.results.numPassedTests, 0);
  assert.equal(result.results.testResults.length, 1);
  const failed = result.results.testResults[0].assertionResults.filter((test) => test.status === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(
    failed[0].title,
    'publishes and downloads every byte of oversized Unicode Markdown through split links',
  );
  assert.equal(failed[0].failureMessages.length, 1);
  // Vitest JSON emits e.stack (STACK_TRACE_ERROR for timeout registration),
  // so the exact timeout message is asserted against its verbose report above.
  assert.doesNotMatch(output, /EBUSY|ENOENT|Unhandled|unhandled|teardown deadline/);
  const index = (event) => events.findIndex((entry) => entry.event === event);
  assert.ok(index('upload.barrier') >= 0);
  assert.ok(index('context.abort') > index('upload.barrier'));
  assert.ok(index('upload.release') > index('context.abort'));
  assert.ok(index('body.settled') > index('upload.release'));
  const removals = events.filter(
    (entry) => entry.event === 'rm.begin' && /imnota-share-split-(data|user)-[^\\/]+$/.test(entry.path),
  );
  assert.equal(removals.length, 2);
  for (const removal of removals) {
    // Service-owned staging cleanup may occur within a successful request. Only
    // the fixture root removals must wait for the entire test's lifetime.
    assert.equal(removal.bodySettled, true);
    assert.equal(removal.openDatabases, 0);
    assert.equal(removal.listening, 0);
    for (const fixture of removal.fixtures) {
      assert.equal(fixture.operations, 0);
      assert.equal(fixture.requests, 0);
    }
  }
  const terminal = events.at(-1);
  assert.equal(terminal.event, 'terminal');
  assert.equal(terminal.bodySettled, true);
  assert.equal(terminal.openDatabases, 0);
  assert.equal(terminal.listening, 0);
  for (const fixture of terminal.fixtures) {
    assert.equal(fixture.bodySettled, true);
    assert.equal(fixture.operations, 0);
    assert.equal(fixture.requests, 0);
    assert.equal(fixture.openDatabases, 0);
    assert.equal(fixture.listening, false);
    assert.equal(fixture.retained, false);
  }
}
