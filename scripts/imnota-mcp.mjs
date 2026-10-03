import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

// Electron 44.2.0 BasicStartupComplete writes exactly CR LF before application JS:
// https://github.com/electron/electron/blob/v44.2.0/shell/app/electron_main_delegate.cc#L185-L191
// This is a Windows launch adapter, never a general blank-line-tolerant MCP parser.
export class WindowsMcpOutput extends Transform {
  #prefix = 0;
  #line = Buffer.alloc(0);
  #decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  _transform(chunk, _encoding, callback) {
    try {
      let offset = 0;
      while (this.#prefix < 2 && offset < chunk.length) {
        if (chunk[offset++] !== [13, 10][this.#prefix++])
          throw new Error('Unexpected Windows MCP bootstrap prefix; expected exactly one CR LF.');
      }
      while (offset < chunk.length) {
        const end = chunk.indexOf(10, offset);
        const part = chunk.subarray(offset, end < 0 ? chunk.length : end + 1);
        // Covers existing 20 MB PNG/base64 + 5 MB JSON-text result limits, with envelope room.
        if (this.#line.length + part.length > 40_000_000)
          throw new Error('Windows MCP response exceeded the 40 MB transport limit.');
        this.#line = Buffer.concat([this.#line, part]);
        offset += part.length;
        if (end < 0) break;
        const message = JSON.parse(this.#decoder.decode(this.#line));
        if (
          !message ||
          Array.isArray(message) ||
          message.jsonrpc !== '2.0' ||
          !Object.hasOwn(message, 'id') ||
          ![null, 'string', 'number'].includes(message.id === null ? null : typeof message.id) ||
          Object.hasOwn(message, 'method') ||
          Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error') ||
          (Object.hasOwn(message, 'error') &&
            (!message.error ||
              !Number.isInteger(message.error.code) ||
              typeof message.error.message !== 'string'))
        )
          throw new Error('Windows MCP stdout contained a non-response JSON-RPC line.');
        this.push(this.#line); // Forward original bytes, never serialize or invent a response.
        this.#line = Buffer.alloc(0);
      }
      callback();
    } catch {
      callback(new Error('Invalid Windows MCP stdout: expected one CR LF then complete JSON-RPC responses.'));
    }
  }

  _flush(callback) {
    callback(
      this.#prefix !== 2 || this.#line.length
        ? new Error('Windows MCP stdout ended before its prefix or response line completed.')
        : undefined,
    );
  }
}

export function windowsMcpEnvironment(inherited) {
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    if (
      key.toUpperCase().startsWith('IMNOTA_SMOKE') ||
      ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_ENABLE_LOGGING'].includes(
        key.toUpperCase(),
      )
    )
      delete env[key];
  }
  return env;
}

// Both the installed client command and packaged verifier use this exact launch path.
// The verifier retains the actual ChildProcess so its deadline cannot orphan a relay grandchild.
export function launchWindowsMcp(executable, env, args = ['--mcp']) {
  const child = spawn(executable, args, {
    env: windowsMcpEnvironment(env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = child.stdout.pipe(new WindowsMcpOutput());
  return { child, stdout };
}

export async function relayWindowsMcp(
  executable,
  {
    env = process.env,
    input = process.stdin,
    output = process.stdout,
    errorOutput = process.stderr,
    args = ['--mcp'],
    eofTimeoutMs = 10_000,
  } = {},
) {
  const { child, stdout } = launchWindowsMcp(executable, env, args);
  let failure;
  let closed = false;
  let forceKill;
  let abandon;
  let eofDeadline;
  let finish;
  const completion = new Promise((resolveExit) => {
    finish = resolveExit;
  });
  const fail = () => {
    failure ??= new Error(
      'Windows MCP pipe failed. Check the installed Imnota version and local agent access.',
    );
    input.unpipe(child.stdin);
    input.pause();
    child.stdin.destroy();
    stdout.unpipe(output);
    stdout.destroy();
    if (!closed) child.kill('SIGTERM');
    forceKill ??= globalThis.setTimeout(() => {
      if (!closed) child.kill('SIGKILL');
    }, 2_000);
    abandon ??= globalThis.setTimeout(() => {
      if (closed) return;
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish(1);
    }, 5_000);
  };
  const onEof = () => {
    eofDeadline ??= globalThis.setTimeout(fail, eofTimeoutMs);
  };
  for (const stream of [input, output, errorOutput, child.stdin, child.stdout, child.stderr, stdout, child])
    stream.on('error', fail);
  const onSignal = () => fail();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, onSignal);
  child.once('close', (code, signal) => {
    closed = true;
    finish(signal ? 1 : (code ?? 1));
  });
  input.once('end', onEof);
  input.pipe(child.stdin);
  child.stderr.pipe(errorOutput, { end: false });
  stdout.pipe(output, { end: false });
  const code = await completion;
  // close follows the child's stdio closure; wait for any transformed bytes to finish draining.
  if (!failure && !stdout.readableEnded)
    await new Promise((resolveEnd) => {
      stdout.once('end', resolveEnd);
      stdout.once('error', resolveEnd);
      if (stdout.readableEnded || stdout.destroyed) resolveEnd();
    });
  input.unpipe(child.stdin);
  input.pause();
  input.off('end', onEof);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, onSignal);
  globalThis.clearTimeout(forceKill);
  globalThis.clearTimeout(abandon);
  globalThis.clearTimeout(eofDeadline);
  // Keep stream error handlers until pending writes settle; no stdout diagnostics.
  if (failure) {
    errorOutput.write(`${failure.message}\n`);
    return 1;
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32' || process.argv.length !== 2) {
    process.stderr.write(
      'Use Node.js 24+ to run the installed Windows resources/imnota-mcp.mjs without arguments.\n',
    );
    process.exitCode = 1;
  } else {
    const executable = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'Imnota.exe');
    process.exitCode = await relayWindowsMcp(executable);
  }
}
