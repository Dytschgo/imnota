import { performance } from 'node:perf_hooks';
import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ShareFixture, ownShareDatabase } from './share-fixture.mjs';
import { timeoutControl, assertTimeoutLifecycle } from './share-timeout-control.mjs';

it('retains the failed 5000ms timeout but settles the real upload before fixture removal', async () => {
  const result = await timeoutControl();
  // Keep trace and child log even when an assertion fails.
  try {
    assertTimeoutLifecycle(result);
  } catch (error) {
    throw new Error(`Timeout lifecycle control: ${result.directory}`, { cause: error });
  }
}, 35_000);

async function resource() {
  const fixture = new ShareFixture();
  const directory = await fixture.directory('imnota-share-lifetime-resource-');
  const db = new DatabaseSync(path.join(directory, 'shares.sqlite'));
  db.exec("CREATE TABLE evidence (value TEXT); INSERT INTO evidence VALUES ('preserved')");
  fixture.databases.add(db);
  return { fixture, directory, db };
}

it('retains files and a live database on a bounded unsettled-body failure', async () => {
  const { fixture, directory, db } = await resource();
  let release;
  const body = fixture.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const started = performance.now();
  try {
    await expect(fixture.teardown(40)).rejects.toMatchObject({
      cause: { message: 'Share fixture teardown deadline: body' },
    });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(db.isOpen).toBe(true);
    expect(db.prepare('SELECT value FROM evidence').get().value).toBe('preserved');
    expect(await fs.stat(path.join(directory, 'shares.sqlite'))).toBeDefined();
  } finally {
    release();
    await body;
    db.close();
  }
  // A late settlement must not resume the abandoned cleanup and remove evidence.
  expect(await fs.stat(path.join(directory, 'shares.sqlite'))).toBeDefined();
});

it('waits for an async handler after its HTTP socket closes and retains it at the bound', async () => {
  const { fixture, directory, db } = await resource();
  let release;
  let entered;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const layer = {
    handle: async (_request, response) => {
      entered();
      response.destroy();
      await barrier;
      db.prepare('INSERT INTO evidence VALUES (?)').run('late handler settled');
    },
  };
  fixture.observeHandlers([layer]);
  fixture.server = createServer((req, res) => layer.handle(req, res));
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  const body = fixture.run(async () => {
    const outgoing = request(`http://127.0.0.1:${fixture.server.address().port}`);
    const closed = once(outgoing, 'error');
    outgoing.end();
    await closed;
  });
  await ready;
  await body;
  try {
    await expect(fixture.teardown(40)).rejects.toMatchObject({
      cause: { message: 'Share fixture teardown deadline: service operations' },
    });
    expect(db.isOpen).toBe(true);
    expect(await fs.stat(path.join(directory, 'shares.sqlite'))).toBeDefined();
  } finally {
    release();
    await Promise.all([...fixture.operations]);
    await new Promise((resolve, reject) =>
      fixture.server.close((error) => (error ? reject(error) : resolve())),
    );
    expect(
      db
        .prepare('SELECT value FROM evidence')
        .all()
        .map((row) => row.value),
    ).toEqual(['preserved', 'late handler settled']);
    db.close();
  }
  expect(await fs.stat(path.join(directory, 'shares.sqlite'))).toBeDefined();
});

it('owns the first directory when later setup fails, and owns SQLite before service setup throws', async () => {
  const fixture = new ShareFixture();
  let directory;
  let db;
  const failure = new Error('setup after database allocation');
  await expect(
    fixture.run(async () => {
      directory = await fixture.directory('imnota-share-lifetime-setup-');
      await fixture.start(() => {
        db = ownShareDatabase(new DatabaseSync(path.join(directory, 'shares.sqlite')));
        throw failure;
      }, {});
    }),
  ).rejects.toBe(failure);
  await fixture.teardown();
  expect(db.isOpen).toBe(false);
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('closes its real SQLite handle and preserves the primary listen failure', async () => {
  const { fixture, directory, db } = await resource();
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  try {
    const app = () => {};
    app.router = { stack: [] };
    await expect(
      fixture.run(() => fixture.start(() => ({ app, db }), {}, occupied.address().port)),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await fixture.teardown();
    expect(db.isOpen).toBe(false);
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

it('closes SQLite even when HTTP close reports an error; preserves body failure and files', async () => {
  const { fixture, directory, db } = await resource();
  const app = () => {};
  app.router = { stack: [] };
  const primary = new Error('primary assertion failed');
  await expect(
    fixture.run(async () => {
      await fixture.start(() => ({ app, db }), {});
      throw primary;
    }),
  ).rejects.toBe(primary);
  const close = fixture.server.close.bind(fixture.server);
  fixture.server.close = (callback) => close(() => callback(new Error('injected close error')));
  await expect(fixture.teardown()).rejects.toMatchObject({
    cause: { message: 'Share fixture close failed' },
  });
  expect(db.isOpen).toBe(false);
  expect(fixture.server.listening).toBe(false);
  expect(await fs.stat(path.join(directory, 'shares.sqlite'))).toBeDefined();
});

it('cleans its first directory after a second directory allocation fails', async () => {
  const fixture = new ShareFixture();
  let directory;
  await expect(
    fixture.run(async () => {
      directory = await fixture.directory('imnota-share-lifetime-directory-');
      await fs.mkdtemp(path.join(directory, 'absent-parent', 'second-'));
    }),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  await fixture.teardown();
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('blocks new HTTP handlers and closes SQLite when server.close throws synchronously', async () => {
  const { fixture, directory, db } = await resource();
  const app = () => {
    throw new Error('No handler may enter after teardown starts');
  };
  app.router = { stack: [] };
  await fixture.run(() => fixture.start(() => ({ app, db }), {}));
  const close = fixture.server.close.bind(fixture.server);
  fixture.server.close = () => {
    throw new Error('injected synchronous close error');
  };
  try {
    await expect(fixture.teardown()).rejects.toMatchObject({
      cause: { message: 'Share fixture close failed' },
    });
    expect(db.isOpen).toBe(false);
    const response = await globalThis.fetch(`http://127.0.0.1:${fixture.server.address().port}`);
    expect(response.status).toBe(503);
    await response.arrayBuffer();
    expect(await fs.stat(path.join(directory, 'shares.sqlite'))).toBeDefined();
  } finally {
    await new Promise((resolve) => close(resolve));
  }
});
