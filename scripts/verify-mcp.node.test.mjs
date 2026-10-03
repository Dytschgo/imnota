import { it } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { runMcpProcess } from './verify-mcp.mjs';

// Node fixtures test only the launcher failure contract. They are never packaged acceptance evidence.
const run = (source, exercise = async () => {}, options) =>
  runMcpProcess(process.execPath, ['-e', source], process.env, exercise, options);
it('waits for the matching response and exits normally on EOF', async () => {
  const result = await run(
    `const readline = require('node:readline');
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', line => { const request = JSON.parse(line); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ready: true } }) + '\\n'); });`,
    async (request) => assert.deepEqual((await request('initialize', {})).result, { ready: true }),
  );
  assert.equal(result.code, 0);
  assert.equal(result.responses.length, 1);
});
it('rejects stdout pollution, incomplete framing and unbounded output', async () => {
  for (const source of [
    `process.stdout.write('diagnostic\\n')`,
    `process.stdout.write('{"jsonrpc":"2.0"}')`,
    `process.stdout.write('x'.repeat(1_000_001))`,
  ])
    await assert.rejects(run(source));
});
it('rejects a wrong response id and a missing response without retrying', async () => {
  await assert.rejects(
    run(
      `process.stdin.once('data', () => process.stdout.write('{"jsonrpc":"2.0","id":999,"result":{}}\\n'))`,
      (request) => request('initialize', {}),
    ),
  );
  await assert.rejects(
    run(`process.stdin.once('data', () => process.exit(0))`, (request) => request('initialize', {})),
    /before answering/,
  );
});
it('bounds stderr and kills only its own stuck process at the deadline', async () => {
  await assert.rejects(run(`process.stderr.write('x'.repeat(65_537))`), /stderr exceeded/);
  await assert.rejects(run(`setInterval(() => {}, 1000)`, undefined, { timeoutMs: 250 }), /deadline/);
});

it('retains literal rejected bytes without treating blank stdout as protocol framing', async () => {
  for (const bytes of [[13, 10], [10], [255, 10], [32, 10]]) {
    await assert.rejects(run(`process.stdout.write(Buffer.from(${JSON.stringify(bytes)}))`), (error) => {
      assert.equal(error.mcpProcess.stdoutPrefixHex, Buffer.from(bytes).toString('hex'));
      assert.equal(error.mcpProcess.stdoutBytes, bytes.length);
      assert.equal(error.mcpProcess.stdoutPrefixTruncated, false);
      assert.deepEqual(error.mcpProcess.responses, []);
      return true;
    });
  }
});
it('caps raw failure evidence while preserving the actual byte count', async () => {
  await assert.rejects(run(`process.stdout.write(Buffer.alloc(1_000_001, 120))`), (error) => {
    assert.equal(error.mcpProcess.stdoutPrefixHex.length, 65_536 * 2);
    assert.equal(error.mcpProcess.stdoutPrefixTruncated, true);
    assert.ok(error.mcpProcess.stdoutBytes > 1_000_000);
    return true;
  });
});
