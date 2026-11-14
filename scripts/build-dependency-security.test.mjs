import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve('electron-builder'));
const appBuilder = createRequire(builder.resolve('app-builder-lib'));
const ajv = createRequire(appBuilder.resolve('ajv'));

test('the Vite server denies private fixture files even with import queries', async () => {
  const { createServer } = await import('vite');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'imnota-build-security-')));
  let server;
  try {
    await writeFile(join(root, '.env'), 'IMNOTA_SYNTHETIC_PRIVATE=fixture-owned-private-value');
    await writeFile(join(root, 'normal.txt'), 'synthetic public fixture');
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, fs: { deny: ['**/.env'] } },
    });
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    assert.equal(await (await fetch(`${url}/normal.txt`)).text(), 'synthetic public fixture');
    for (const query of ['?raw', '?import&raw', '?import&url&inline']) {
      const response = await fetch(`${url}/.env${query}`);
      assert.ok(response.status === 403 || response.status === 404, `${query}: ${response.status}`);
      assert.ok(!(await response.text()).includes('fixture-owned-private-value'));
    }
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the builder URI parser rejects encoded schemes and preserves ordinary resolution', () => {
  const uri = ajv('fast-uri');
  for (const encoded of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)']) {
    assert.notEqual(uri.normalize(encoded), 'javascript:alert(1)');
    assert.throws(() => uri.resolve('https://fixture.example/', encoded), /scheme is malformed/);
  }
  assert.equal(uri.resolve('https://fixture.example/a/', '../b'), 'https://fixture.example/b');
  assert.equal(uri.resolve('https://fixture.example/schema', '#item'), 'https://fixture.example/schema#item');
});

test('builder globs retain file selection and bound optimization-generated patterns', () => {
  const { minimatch, Minimatch } = appBuilder('minimatch');
  for (const [file, pattern, expected] of [
    ['dist/assets/app.js', 'dist/**/*', true],
    ['dist/.hidden', 'dist/**/*', false],
    ['dist-electron/electron/main.js', 'dist-electron/electron/**/*', true],
    ['node_modules/jszip/dist/jszip.js', 'node_modules/{jszip,pako}/dist/**/*', true],
    ['node_modules/pako/lib/index.js', 'node_modules/{jszip,pako}/dist/**/*', false],
    ['node_modules/fixture/app.js.map', 'node_modules/**/*.map', true],
  ]) {
    assert.equal(minimatch(file, pattern), expected, `${file}: ${pattern}`);
  }
  assert.throws(
    () => new Minimatch(`a/${'**/../x/'.repeat(4)}fixture`, { optimizationLevel: 2, braceExpandMax: 4 }),
    /too many patterns/,
  );
});

// Run the real clients in separate processes so an unhandled response-stream error
// fails the test instead of terminating the entire script suite.
const httpProbe = `
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const { fetch, Agent } = require(process.argv[1]);
  const server = http.createServer((request, response) => {
    if (request.url === '/normal') return response.end('synthetic response');
    response.writeHead(200, {
      'content-encoding': 'gzip, gzip, gzip, gzip, gzip, gzip',
      'content-length': '42',
    });
    response.flushHeaders();
    response.socket.end();
  });
  (async () => {
    const agent = new Agent({ headersTimeout: 1000, bodyTimeout: 1000 });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = 'http://127.0.0.1:' + server.address().port;
      assert.equal(await (await fetch(url + '/normal', { dispatcher: agent })).text(), 'synthetic response');
      await assert.rejects(fetch(url + '/excessive-encodings', { dispatcher: agent }));
    } finally {
      await agent.close();
      await new Promise(resolve => server.close(resolve));
    }
    console.log('Normal fetch passed; malformed response rejected; client closed cleanly.');
  })().catch(error => { console.error(error); process.exitCode = 1; });
`;

const downloader = createRequire(createRequire(require.resolve('electron')).resolve('@electron/get'));
const rebuilder = createRequire(appBuilder.resolve('@electron/rebuild'));
const nodeGyp = createRequire(rebuilder.resolve('node-gyp'));

for (const [name, client] of [
  ['Electron downloader', downloader],
  ['native rebuild', nodeGyp],
]) {
  test(`${name} HTTP client survives excessive encodings followed by an early close`, () => {
    const result = spawnSync(process.execPath, ['-e', httpProbe, client.resolve('undici')], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /client closed cleanly/);
  });
}
