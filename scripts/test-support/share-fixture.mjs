import { performance } from 'node:perf_hooks';
import { createHook } from 'node:async_hooks';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';

const allocation = { current: undefined };

// The Vitest SQLite constructor observer registers the real connection before
// schema initialization or later synchronous service setup can fail.
export function ownShareDatabase(db) {
  allocation.current?.databases.add(db);
  return db;
}

export class ShareFixture {
  directories = [];
  databases = new Set();
  operations = new Set();
  requests = new Set();
  bodySettled = false;
  accepting = true;
  retained = false;
  server;
  body;
  notify = () => {};

  run(body) {
    const result = Promise.resolve().then(body);
    // Keep the actual body, independently of Vitest's timeout wrapper. Its original
    // rejection still goes to Vitest; teardown must not replace the primary failure.
    this.body = result.then(
      () => {
        this.bodySettled = true;
      },
      () => {
        this.bodySettled = true;
      },
    );
    return result;
  }

  async directory(prefix) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    this.directories.push(directory);
    return directory;
  }

  async start(createService, options, port = 0) {
    let service;
    allocation.current = this;
    try {
      service = createService(options);
      this.databases.add(service.db);
    } finally {
      allocation.current = undefined;
    }
    this.observeHandlers(service.app.router.stack);
    this.server = createServer((request, response) => {
      if (!this.accepting) {
        response.writeHead(503).end();
        return;
      }
      this.requests.add(response);
      const done = () => {
        this.requests.delete(response);
        this.notify();
      };
      response.once('finish', done);
      response.once('close', done);
      service.app(request, response);
    });
    const listening = once(this.server, 'listening');
    this.server.listen(port, '127.0.0.1');
    await listening;
    return `http://127.0.0.1:${this.server.address().port}`;
  }

  observeHandlers(layers) {
    // Express's asyncRoute intentionally does not return the handler promise.
    // Capture promises created synchronously by each registered layer (including
    // the async function's own promise), not just socket/response completion.
    // No hook stays enabled across an await; each observer attaches after its hook is disabled.
    for (const layer of layers) {
      if (layer.route) this.observeHandlers(layer.route.stack);
      const original = layer.handle;
      const track = (promise) => this.track(promise);
      function invoke(receiver, args) {
        const promises = new Set();
        const hook = createHook({
          init(_id, type, _trigger, resource) {
            if (type === 'PROMISE') promises.add(resource);
          },
        });
        hook.enable();
        try {
          return original.apply(receiver, args);
        } finally {
          hook.disable();
          for (const promise of promises) track(promise);
        }
      }
      // Express distinguishes error middleware by arity.
      layer.handle =
        original.length === 4
          ? function (error, request, response, next) {
              return invoke(this, [error, request, response, next]);
            }
          : function (request, response, next) {
              return invoke(this, [request, response, next]);
            };
    }
  }

  track(promise) {
    if (this.operations.has(promise)) return;
    this.operations.add(promise);
    const done = () => {
      this.operations.delete(promise);
      this.notify();
    };
    promise.then(done, done);
  }

  state() {
    return {
      bodySettled: this.bodySettled,
      operations: this.operations.size,
      requests: this.requests.size,
      listening: this.server?.listening ?? false,
      openDatabases: [...this.databases].filter((db) => db.isOpen).length,
      retained: this.retained,
    };
  }

  async teardown(budgetMs = 8_000) {
    // One deadline for the WHOLE teardown, below the existing 10s Vitest hook
    // bound. On nonsettlement the continuation never advances to rm.
    const deadline = performance.now() + budgetMs;
    const bounded = async (work, phase) => {
      let timer;
      try {
        return await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Share fixture teardown deadline: ${phase}`)),
              Math.max(0, deadline - performance.now()),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const errors = [];
    try {
      await bounded(this.body, 'body');
      await bounded(
        new Promise((resolve) => {
          this.notify = () => {
            if (!this.operations.size && !this.requests.size) resolve();
          };
          this.notify();
        }),
        'service operations',
      );
      this.accepting = false;
      try {
        if (this.server?.listening) {
          await bounded(
            new Promise((resolve, reject) => {
              this.server.close((error) => (error ? reject(error) : resolve()));
            }),
            'HTTP close',
          );
        }
      } catch (error) {
        errors.push(error);
      } finally {
        // No handler can enter after accepting=false, and all previous handlers
        // settled. A server.close error must not strand the owned SQLite handle.
        for (const db of this.databases) {
          try {
            if (db.isOpen) db.close();
          } catch (error) {
            errors.push(error);
          }
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Share fixture close failed');
      const state = this.state();
      if (!state.bodySettled || state.operations || state.requests || state.listening || state.openDatabases)
        throw new Error('Share fixture is still live');
      for (const directory of this.directories) {
        await bounded(fs.rm(directory, { recursive: true, force: true }), 'directory removal');
      }
    } catch (error) {
      this.retained = true;
      throw new Error(
        `Share fixture retained: ${JSON.stringify(this.state())}; paths=${JSON.stringify(this.directories)}`,
        { cause: error },
      );
    } finally {
      this.notify = () => {};
    }
  }
}
