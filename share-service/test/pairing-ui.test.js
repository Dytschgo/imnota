import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/new.js', import.meta.url), 'utf8');

function fixture({ response, clipboard } = {}) {
  let now = Date.UTC(2026, 8, 8);
  let tick;
  const elements = new Map();
  const document = {
    hidden: false,
    addEventListener() {},
    querySelector(selector) {
      if (!elements.has(selector))
        elements.set(selector, {
          textContent: '',
          value: '',
          hidden: false,
          disabled: false,
          dataset: {},
          listeners: {},
          attributes: {},
          addEventListener(event, handler) {
            this.listeners[event] = handler;
          },
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          removeAttribute(name) {
            delete this.attributes[name];
          },
          focus() {
            this.focused = true;
          },
          select() {
            this.selected = true;
          },
        });
      return elements.get(selector);
    },
  };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  vm.runInNewContext(source, {
    document,
    Date: Clock,
    AbortSignal,
    navigator: { clipboard: clipboard ?? { writeText: async () => {} } },
    fetch:
      response ??
      (async () => ({
        ok: true,
        json: async () => ({ uploadToken: 'a'.repeat(43), expiresAt: new Date(now + 600_000).toISOString() }),
      })),
    setInterval(callback) {
      tick = callback;
      return 1;
    },
    clearInterval() {
      tick = undefined;
    },
  });
  return {
    get: (selector) => elements.get(selector),
    click: (selector) => elements.get(selector).listeners.click(),
    advance(ms) {
      now += ms;
      tick?.();
    },
  };
}

test('pairing gives a copyable code, advances instructions, then expires and allows another attempt', async () => {
  const page = fixture();
  await page.click('#create-code');
  assert.equal(page.get('#upload-code').value.length, 43);
  assert.equal(page.get('#expiry').textContent, '10:00 remaining');
  assert.equal(page.get('#step-paste').attributes['aria-current'], 'step');
  await page.click('#copy-code');
  assert.equal(page.get('#copy-code').textContent, 'Copied');
  page.advance(600_000);
  assert.equal(page.get('#upload-code').value, '');
  assert.equal(page.get('#result').hidden, true);
  assert.equal(page.get('#create-code').disabled, false);
  assert.equal(page.get('#copy-code').disabled, true);
  assert.match(page.get('#pairing-status').textContent, /expired/);
  await page.click('#create-code');
  assert.equal(page.get('#result').hidden, false);
  assert.equal(page.get('#copy-code').disabled, false);
});

test('clipboard denial selects the code for manual copy and never reports success', async () => {
  const page = fixture({
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  });
  await page.click('#create-code');
  await page.click('#copy-code');
  assert.match(page.get('#error').textContent, /manually/);
  assert.equal(page.get('#upload-code').selected, true);
  assert.notEqual(page.get('#copy-code').textContent, 'Copied');
});

test('an expired code cannot be copied even when a suspended timer has not fired', async () => {
  let resolveCopy;
  const page = fixture({
    clipboard: {
      writeText: () =>
        new Promise((resolve) => {
          resolveCopy = resolve;
        }),
    },
  });
  await page.click('#create-code');
  const pending = page.click('#copy-code');
  page.advance(600_000);
  resolveCopy();
  await pending;
  assert.equal(page.get('#connection-state').textContent, 'Code expired');
  assert.match(page.get('#pairing-status').textContent, /expired/);
});

test('invalid and failed responses keep retry available without exposing an unusable token', async () => {
  for (const payload of [
    { ok: false, json: async () => ({ error: { message: 'Too many attempts.' } }) },
    { ok: true, json: async () => ({ uploadToken: 'invalid', expiresAt: 'invalid' }) },
  ]) {
    const page = fixture({ response: async () => payload });
    await page.click('#create-code');
    assert.equal(page.get('#create-code').disabled, false);
    assert.equal(page.get('#upload-code').value, '');
    assert.ok(page.get('#error').textContent);
  }
});
