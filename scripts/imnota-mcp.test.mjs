import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WindowsMcpOutput, windowsMcpEnvironment, launchWindowsMcp, relayWindowsMcp } from './imnota-mcp.mjs';
import { runMcpProcess } from './verify-mcp.mjs';

const response = Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"text":"é"}}\n');
const adapt = async (chunks) => {
  const bytes = [];
  await pipeline(
    Readable.from(chunks),
    new WindowsMcpOutput(),
    new Writable({
      write(chunk, _encoding, done) {
        bytes.push(Buffer.from(chunk));
        done();
      },
    }),
  );
  return Buffer.concat(bytes);
};
it('consumes exactly the documented prefix even across every byte boundary', async () => {
  const raw = Buffer.concat([Buffer.from('\r\n'), response]);
  for (let split = 1; split < raw.length; split++)
    assert.deepEqual(await adapt([raw.subarray(0, split), raw.subarray(split)]), response);
  assert.equal((await adapt([Buffer.from('\r'), Buffer.from('\n')])).length, 0);
});
it('rejects absent, partial, changed, repeated or misplaced bootstrap bytes and corrupt RPC', async () => {
  for (const raw of [
    Buffer.alloc(0),
    Buffer.from('\r'),
    response,
    Buffer.from('\n'),
    Buffer.from('\rX'),
    Buffer.from('\r\n\r\n'),
    Buffer.from('\r\n \n'),
    Buffer.from('\r\n{}\n'),
    Buffer.from('\r\n{"jsonrpc":"2.0","id":1,"result":{}}'),
    Buffer.concat([Buffer.from('\r\n'), response, Buffer.from('\n')]),
    Buffer.from('\r\n{"jsonrpc":"2.0","id":1,"result":{},"error":{}}\n'),
    Buffer.from('\r\n{"jsonrpc":"2.0","id":1,"error":{}}\n'),
    Buffer.from('\r\n{"jsonrpc":"2.0","id":1,"result":"\xff"}\n', 'latin1'),
  ])
    await assert.rejects(adapt([raw]), /Windows MCP stdout/);
});
it('bounds a response and respects downstream backpressure without changing bytes', async () => {
  await assert.rejects(adapt([Buffer.from('\r\n'), Buffer.alloc(40_000_001, 120)]));
  let count = 0;
  await pipeline(
    Readable.from([Buffer.from('\r\n'), ...Array.from({ length: 500 }, () => response)]),
    new WindowsMcpOutput(),
    new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, done) {
        assert.deepEqual(chunk, response);
        count++;
        globalThis.setImmediate(done);
      },
    }),
  );
  assert.equal(count, 500);
});
it('inherits ordinary environment while excluding Node injection and verification smoke routes', () => {
  const inherited = {
    KEEP: 'yes',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--inspect',
    IMNOTA_SMOKE: '1',
    IMNOTA_SMOKE_MODE: 'smoke',
    VITE_DEV_SERVER_URL: 'http://localhost',
    ELECTRON_ENABLE_LOGGING: '1',
    IMNOTA_MCP_VERIFY_PROFILE: 'owned',
    IMNOTA_MCP_VERIFY_OWNER: 'nonce',
  };
  assert.deepEqual(windowsMcpEnvironment(inherited), {
    KEEP: 'yes',
    IMNOTA_MCP_VERIFY_PROFILE: 'owned',
    IMNOTA_MCP_VERIFY_OWNER: 'nonce',
  });
  assert.equal(inherited.ELECTRON_RUN_AS_NODE, '1');
});
const relayUrl = new URL('./imnota-mcp.mjs', import.meta.url).href;
const runRelay = (source, exercise = async () => {}, eofTimeoutMs = 1000) =>
  runMcpProcess(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {relayWindowsMcp} from ${JSON.stringify(relayUrl)};
     process.exitCode = await relayWindowsMcp(process.execPath, {args:['-e', ${JSON.stringify(source)}], eofTimeoutMs:${eofTimeoutMs}});`,
    ],
    process.env,
    exercise,
    { timeoutMs: 5000 },
  );
// These Node child fixtures verify pipe forwarding only, never actual packaged acceptance.
it('forwards actual child requests/responses and EOF; preserves refusal status and stderr', async () => {
  const result = await runRelay(
    `process.stdout.write('\\r\\n');
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const r=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{received:r.params}})+'\\n');
    });`,
    async (request) =>
      assert.deepEqual((await request('initialize', { proof: 'from pipe' })).result, {
        received: { proof: 'from pipe' },
      }),
  );
  assert.equal(result.code, 0);
  const off = await runRelay(
    `process.stdout.write('\\r\\n');process.stderr.write('Local agent access is off.\\n');process.exitCode=1;`,
  );
  assert.equal(off.code, 1);
  assert.equal(off.stdoutBytes, 0);
  assert.match(off.stderr, /Local agent access is off/);
});
it('fails closed on child pollution, missing prefix, spawn failure and stuck EOF', async () => {
  for (const source of [
    `process.stdout.write('bad\\n')`,
    `process.stdout.write('\\r\\n\\r\\n')`,
    '',
    `process.stdout.write('\\r\\n');setInterval(()=>{},1000)`,
  ]) {
    const result = await runRelay(source, undefined, 100);
    assert.equal(result.code, 1);
    assert.equal(result.stdoutBytes, 0);
    assert.match(result.stderr, /Windows MCP pipe failed/);
  }
  const result = await runMcpProcess(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {relayWindowsMcp} from ${JSON.stringify(relayUrl)}; process.exitCode=await relayWindowsMcp('Z:/missing-imnota-stdio-fixture.exe');`,
    ],
    process.env,
    async () => {},
  );
  assert.equal(result.code, 1);
});

it('the Windows descriptor binding receives real parent pipe bytes and EOF', async () => {
  const inputUrl = new URL('../electron/mcp-stdio.ts', import.meta.url).href;
  const result = await runMcpProcess(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {runMcpStdio} from ${JSON.stringify(inputUrl)};
     import readline from 'node:readline';
     await runMcpStdio({ async startStdio(input) {
       for await (const line of readline.createInterface({input})) {
         const r = JSON.parse(line);
         process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{received:r.params}})+'\\n');
       }
       return true;
     }}, true, 'win32');`,
    ],
    process.env,
    async (request) =>
      assert.deepEqual((await request('initialize', { pipe: 'actual' })).result, {
        received: { pipe: 'actual' },
      }),
  );
  assert.equal(result.code, 0);
});

it('the packaged-verifier launch path retains raw bytes and rejects repeated startup framing', async () => {
  const off = await runMcpProcess(
    process.execPath,
    ['-e', "process.stdout.write('\\r\\n');process.exitCode=1"],
    process.env,
    async () => {},
    { launch: launchWindowsMcp },
  );
  assert.equal(off.code, 1);
  assert.equal(off.stdoutBytes, 0);
  assert.equal(off.rawStdoutBytes, 2);
  assert.equal(off.stdoutPrefixHex, '0d0a');
  await assert.rejects(
    runMcpProcess(
      process.execPath,
      ['-e', "process.stdout.write('\\r\\n\\r\\n')"],
      process.env,
      async () => {},
      { launch: launchWindowsMcp },
    ),
    (error) => {
      assert.equal(error.mcpProcess.stdoutPrefixHex, '0d0a0d0a');
      return true;
    },
  );
});
it('a broken client output terminates only the relay-owned child', async () => {
  let stderr = '';
  const code = await relayWindowsMcp(process.execPath, {
    args: [
      '-e',
      `process.stderr.write(String(process.pid)+'\\n');process.stdout.write('\\r\\n'+${JSON.stringify(response.toString())});setInterval(()=>{},1000);`,
    ],
    input: Readable.from([]),
    output: new Writable({
      write(_chunk, _encoding, done) {
        done(new Error('client disconnected'));
      },
    }),
    errorOutput: new Writable({
      write(chunk, _encoding, done) {
        stderr += chunk.toString();
        done();
      },
    }),
    eofTimeoutMs: 1000,
  });
  assert.equal(code, 1);
  const pid = Number(stderr.split('\n')[0]);
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0));
});

it('allows the existing tool aggregate above the synthetic verifier 1 MB cap', async () => {
  const maximumToolShape = Buffer.from(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          { type: 'image', mimeType: 'image/png', data: 'A'.repeat(Math.ceil(20_000_000 / 3) * 4) },
          { type: 'text', text: '\\'.repeat(5_000_000) },
        ],
      },
    }) + '\n',
  );
  assert.ok(maximumToolShape.length > 36_000_000 && maximumToolShape.length < 40_000_000);
  assert.deepEqual(await adapt([Buffer.from('\r\n'), maximumToolShape]), maximumToolShape);
});
