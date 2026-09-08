import assert from 'node:assert/strict';
import test from 'node:test';
import { ClipboardUnavailableError, writeShareClipboard } from '../public/share-copy.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const markdown = Buffer.from('# Prompt\r\n\r\nUnicode: café\n', 'utf8');
const token = 'a'.repeat(43);
const sharePath = `/s/${token}`;
const locationObject = { href: `https://app.imnota.xyz${sharePath}`, origin: 'https://app.imnota.xyz' };

class TestClipboardItem {
  constructor(parts) {
    this.parts = parts;
  }
}

function response(bytes, type) {
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(bytes.length) },
  });
}

test('starts fetches and clipboard.write in the click turn, then preserves exact Markdown and PNG bytes', async () => {
  const calls = [];
  let resolveMarkdown;
  let resolvePng;
  const markdownResponse = new Promise((resolve) => {
    resolveMarkdown = resolve;
  });
  const pngResponse = new Promise((resolve) => {
    resolvePng = resolve;
  });
  let item;
  const clipboard = {
    write(items) {
      calls.push('write');
      [item] = items;
      return Promise.all(Object.values(item.parts));
    },
  };
  const result = writeShareClipboard({
    markdownPath: `${sharePath}/markdown`,
    pngPath: `${sharePath}/assets/prompt-001.png`,
    clipboard,
    ClipboardItemCtor: TestClipboardItem,
    locationObject,
    fetchImpl(url, options) {
      calls.push(new URL(url).pathname);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return url.endsWith('/markdown') ? markdownResponse : pngResponse;
    },
  });

  assert.deepEqual(calls, [`${sharePath}/markdown`, `${sharePath}/assets/prompt-001.png`, 'write']);
  assert.deepEqual(Object.keys(item.parts).sort(), ['image/png', 'text/plain']);
  resolveMarkdown(response(markdown, 'text/markdown; charset=utf-8'));
  resolvePng(response(png, 'image/png'));
  await result;
  assert.deepEqual(Buffer.from(await item.parts['text/plain'].then((blob) => blob.arrayBuffer())), markdown);
  assert.deepEqual(Buffer.from(await item.parts['image/png'].then((blob) => blob.arrayBuffer())), png);
});

test('keeps PNG-only copy explicit and rejects invalid image responses', async () => {
  let item;
  const clipboard = {
    write(items) {
      [item] = items;
      return Promise.all(Object.values(item.parts));
    },
  };
  await writeShareClipboard({
    pngPath: `${sharePath}/assets/prompt-001.png`,
    clipboard,
    ClipboardItemCtor: TestClipboardItem,
    locationObject,
    fetchImpl: async () => response(png, 'image/png'),
  });
  assert.deepEqual(Object.keys(item.parts), ['image/png']);

  await assert.rejects(
    writeShareClipboard({
      pngPath: `${sharePath}/assets/prompt-001.png`,
      clipboard,
      ClipboardItemCtor: TestClipboardItem,
      locationObject,
      fetchImpl: async () => response(Buffer.from('not a png'), 'image/png'),
    }),
    /valid PNG artifact/,
  );
  await assert.rejects(
    writeShareClipboard({
      markdownPath: `${sharePath}/markdown`,
      clipboard,
      ClipboardItemCtor: TestClipboardItem,
      locationObject,
      fetchImpl: async () => response(markdown, 'text/plain'),
    }),
    /unexpected file type/,
  );
});

test('rejects unsupported clipboard APIs, oversized artifacts, and foreign artifact paths without reporting success', async () => {
  assert.throws(
    () =>
      writeShareClipboard({ markdownPath: `${sharePath}/markdown`, ClipboardItemCtor: TestClipboardItem }),
    ClipboardUnavailableError,
  );
  const clipboard = { write: (items) => Promise.all(Object.values(items[0].parts)) };
  await assert.rejects(
    writeShareClipboard({
      markdownPath: `${sharePath}/markdown`,
      clipboard,
      ClipboardItemCtor: TestClipboardItem,
      locationObject,
      fetchImpl: async () =>
        new Response(markdown, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown', 'Content-Length': String(32 * 1024 * 1024 + 1) },
        }),
    }),
    /too large/,
  );
  await assert.rejects(
    writeShareClipboard({
      markdownPath: 'https://elsewhere.invalid/markdown',
      clipboard,
      ClipboardItemCtor: TestClipboardItem,
      locationObject,
      fetchImpl: async () => response(markdown, 'text/markdown'),
    }),
    /same-origin/,
  );
});

test('bounds streamed bodies and aborts pending artifact requests when clipboard setup or write fails', async () => {
  const clipboard = { write: (items) => Promise.all(Object.values(items[0].parts)) };
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  await assert.rejects(
    writeShareClipboard({
      markdownPath: `${sharePath}/markdown`,
      clipboard,
      ClipboardItemCtor: TestClipboardItem,
      locationObject,
      fetchImpl: async () => new Response(oversizedStream, { headers: { 'Content-Type': 'text/markdown' } }),
    }),
    /too large/,
  );

  let constructorSignal;
  class ThrowingClipboardItem {
    constructor() {
      throw new Error('ClipboardItem failed');
    }
  }
  assert.throws(
    () =>
      writeShareClipboard({
        markdownPath: `${sharePath}/markdown`,
        clipboard,
        ClipboardItemCtor: ThrowingClipboardItem,
        locationObject,
        fetchImpl: (_url, options) => {
          constructorSignal = options.signal;
          return new Promise(() => {});
        },
      }),
    /ClipboardItem failed/,
  );
  assert.equal(constructorSignal.aborted, true);

  let deniedSignal;
  await assert.rejects(
    writeShareClipboard({
      markdownPath: `${sharePath}/markdown`,
      clipboard: {
        write: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
      },
      ClipboardItemCtor: TestClipboardItem,
      locationObject,
      fetchImpl: (_url, options) => {
        deniedSignal = options.signal;
        return new Promise(() => {});
      },
    }),
    /Denied/,
  );
  assert.equal(deniedSignal.aborted, true);
});
