// @vitest-environment node
import { request } from 'node:http';
import { PassThrough, Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { readMcpFrames, writeMcpResponse } from './mcp-framing.js';
import { createMcpTools, handleMcpJsonRpc, LocalMcpServer } from './mcp-server.js';

const servers: LocalMcpServer[] = [];
const context = { enabled: () => true, workspacePath: () => null, appVersion: () => 'test' };
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});
const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };

async function endpoint() {
  const server = new LocalMcpServer(context);
  servers.push(server);
  return (await server.sync({ port: 0 }))!.port;
}

async function httpCall(
  port: number,
  body: string | Buffer,
  options: { path?: string; method?: string; headers?: Record<string, string> } = {},
) {
  return new Promise<{ status: number; headers: Record<string, unknown>; text: string }>(
    (resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: options.path ?? '/mcp',
          method: options.method ?? 'POST',
          headers: options.headers,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () =>
            resolve({
              status: response.statusCode!,
              headers: response.headers,
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          response.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end(body);
    },
  );
}

describe('MCP HTTP reliability', () => {
  it('refuses malformed URL targets and continues serving later requests', async () => {
    const port = await endpoint();
    expect((await httpCall(port, '', { path: 'http://[' })).status).toBe(400);
    expect((await httpCall(port, JSON.stringify(ping))).status).toBe(200);
  });
  it('rejects malformed UTF-8 instead of accepting replacement characters', async () => {
    const bytes = Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}}'),
    ]);
    const response = await httpCall(await endpoint(), bytes);
    expect(response.status).toBe(400);
    expect(JSON.parse(response.text)).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });
  it('uses JSON-RPC parse errors for malformed JSON', async () => {
    const response = await httpCall(await endpoint(), '{');
    expect(response.status).toBe(400);
    expect(JSON.parse(response.text)).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });
  it('acknowledges accepted notifications with an empty 202 response', async () => {
    const response = await httpCall(
      await endpoint(),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
  });
  it('prevents caching on successful results and refusal paths', async () => {
    const port = await endpoint();
    for (const options of [{}, { path: '/missing' }, { headers: { origin: 'https://example.com' } }]) {
      expect((await httpCall(port, JSON.stringify(ping), options)).headers['cache-control']).toBe('no-store');
    }
  });
  it('advertises POST when GET streaming is unavailable', async () => {
    const response = await httpCall(await endpoint(), '', { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('POST');
  });
  it('returns 413 for declared and streamed oversized bodies without closing the listener', async () => {
    const port = await endpoint();
    expect((await httpCall(port, '', { headers: { 'content-length': '1000001' } })).status).toBe(413);
    expect(
      (await httpCall(port, 'x'.repeat(1_000_001), { headers: { 'transfer-encoding': 'chunked' } })).status,
    ).toBe(413);
    expect((await httpCall(port, JSON.stringify(ping))).status).toBe(200);
  });
});

describe('MCP stdio reliability', () => {
  it('discards an oversized unfinished frame and recovers at the next newline', async () => {
    const frames = [];
    for await (const frame of readMcpFrames(Readable.from([Buffer.alloc(32, 120), Buffer.from('\nOK\n')]), 8))
      frames.push(frame);
    expect(frames).toEqual([{ error: 'too-large' }, { text: 'OK' }]);
  });
  it('keeps split Unicode intact and rejects malformed UTF-8 with recovery', async () => {
    const input = Readable.from([
      Buffer.from([0xc3]),
      Buffer.from([0xbc, 10, 0xc3, 0x28, 10]),
      Buffer.from('next\n'),
    ]);
    const frames = [];
    for await (const frame of readMcpFrames(input, 100)) frames.push(frame);
    expect(frames).toEqual([{ text: 'ü' }, { error: 'invalid-utf8' }, { text: 'next' }]);
  });
  it('bounds an oversized frame that ends at EOF too', async () => {
    const frames = [];
    for await (const frame of readMcpFrames(Readable.from(['x'.repeat(100)]), 8)) frames.push(frame);
    expect(frames).toEqual([{ error: 'too-large' }]);
  });
  it('does not process another request until the current write completes', async () => {
    const input = new PassThrough();
    let finishWrite!: () => void;
    let writes = 0;
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, done) {
        writes++;
        finishWrite = done;
      },
    });
    const server = new LocalMcpServer(context);
    const session = server.startStdio(input, output);
    input.end(JSON.stringify(ping) + '\n' + JSON.stringify({ ...ping, id: 2 }) + '\n');
    // An event-loop turn observes buffering; no wall-clock sleep or retry is used.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toBe(1);
    expect(output.writableLength).toBe(Buffer.byteLength('{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    finishWrite();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toBe(2);
    finishWrite();
    await session;
  });
  it('reports a failed output write without an uncaught stream error', async () => {
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done(new Error('pipe failed'));
      },
    });
    await expect(writeMcpResponse(output, {})).rejects.toThrow('pipe failed');
  });
});

describe('MCP client interoperability', () => {
  it('never echoes non-finite request ids in invalid-request errors', async () => {
    for (const id of [NaN, Infinity, -Infinity])
      expect(await handleMcpJsonRpc({ ...ping, id }, [], 'test')).toMatchObject({
        id: null,
        error: { code: -32600 },
      });
  });
  it('exposes accurate read-only local tool annotations', async () => {
    const result = (await handleMcpJsonRpc(
      { ...ping, method: 'tools/list' },
      createMcpTools(context),
      'test',
    )) as { result: { tools: Array<{ annotations: unknown }> } };
    expect(result.result.tools.length).toBeGreaterThan(0);
    for (const tool of result.result.tools)
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
  });
  it('accepts client metadata without forwarding it into tool arguments', async () => {
    let received: unknown;
    const tool = {
      name: 'fixture',
      description: '',
      inputSchema: {},
      handle: async (args: Record<string, unknown>) => {
        received = args;
        return 'ok';
      },
    };
    const result = await handleMcpJsonRpc(
      {
        ...ping,
        method: 'tools/call',
        params: { name: 'fixture', arguments: { id: 'saved' }, _meta: { progressToken: 123 } },
      },
      [tool],
      'test',
    );
    expect(received).toEqual({ id: 'saved' });
    expect(result).toMatchObject({ result: { isError: false } });
  });
});
