// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { smokeStringLiteral } from './smoke-string-literal.js';

it.each([
  '</script><script>globalThis.injected = true</script>',
  '"; globalThis.injected = true; //',
  'C:\\fixture\\quotes" and line\nend',
  '\u2028line separator\u2029paragraph separator',
  JSON.stringify(['C:\\fixture\\<collection>', 'collection_123']),
])('preserves fixture text as data without a raw script boundary: %s', (value) => {
  const literal = smokeStringLiteral(value);
  const context = { injected: false };
  expect(literal).not.toMatch(/[<>\u2028\u2029]/);
  expect(runInNewContext(`(${literal})`, context)).toBe(value);
  expect(context.injected).toBe(false);
});
