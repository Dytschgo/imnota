// @vitest-environment node
import { closeSync, fstatSync, openSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, expect, it } from 'vitest';
import { LocalMcpServer } from './mcp-server.js';
import { runMcpStdio } from './mcp-stdio.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const server = () =>
  new LocalMcpServer({
    enabled: () => true,
    workspacePath: () => '',
    appVersion: () => 'test',
    search: async () => ({ results: [], warnings: [], totalMatches: 0 }),
  });

it('reads initialize from a real descriptor, reaches EOF and closes only that descriptor', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-mcp-input-'));
  roots.push(root);
  const file = path.join(root, 'requests');
  const request = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }) + '\n';
  await fs.writeFile(file, request);
  const fd = openSync(file, 'r');
  const unrelated = openSync(file, 'r');
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  let result = '';
  const output = new Writable({
    write(chunk, _encoding, done) {
      result += chunk.toString();
      done();
    },
  });
  try {
    expect(
      await runMcpStdio({ startStdio: (input) => server().startStdio(input, output) }, true, 'win32', fd),
    ).toBe(true);
    expect(JSON.parse(result)).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: { serverInfo: { version: 'test' } },
    });
    expect(() => fstatSync(fd)).toThrow();
    expect(fstatSync(unrelated).isFile()).toBe(true);
    expect(Object.getOwnPropertyDescriptor(process, 'stdin')).toEqual(original);
  } finally {
    closeSync(unrelated);
  }
});
it('propagates real descriptor read failures', async () => {
  await expect(
    runMcpStdio({ startStdio: (input) => server().startStdio(input) }, true, 'win32', 2147483647),
  ).rejects.toThrow();
});
it('leaves access-off and other platforms on the existing stream route', async () => {
  for (const [enabled, platform] of [
    [false, 'win32'],
    [true, 'linux'],
    [true, 'darwin'],
  ] as const) {
    let argumentsReceived: unknown[] = [];
    const started = await runMcpStdio(
      {
        async startStdio(...args) {
          argumentsReceived = args;
          return enabled;
        },
      },
      enabled,
      platform,
      -1,
    );
    expect(started).toBe(enabled);
    expect(argumentsReceived).toEqual([]);
  }
});

it('rejects a broken reply pipe instead of leaving an unhandled stream error', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-mcp-input-'));
  roots.push(root);
  const file = path.join(root, 'request');
  await fs.writeFile(
    file,
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n',
  );
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done(new Error('EPIPE fixture'));
    },
  });
  await expect(runMcpStdio(server(), true, 'win32', openSync(file, 'r'), output)).rejects.toThrow(
    'EPIPE fixture',
  );
});
