// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { decodePngDataUrl, isPngDataUrl, maxPngDataUrlLength, PNG_DATA_URL_PREFIX } from './png-data-url.js';

// The pattern this decoder replaces at IPC boundaries; acceptance must stay identical.
const LEGACY = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

function legacyDecode(value: string): Buffer | undefined {
  const match = LEGACY.exec(value);
  return match ? Buffer.from(match[1], 'base64') : undefined;
}

function expectLegacyEquivalent(value: string): void {
  const expected = legacyDecode(value);
  const actual = decode(value);
  expect(actual === undefined, JSON.stringify(value)).toBe(expected === undefined);
  if (expected && actual) expect(actual.equals(expected), JSON.stringify(value)).toBe(true);
}

const url = (payload: string) => `${PNG_DATA_URL_PREFIX}${payload}`;
// Equivalence tests compare acceptance only; length limits have their own tests.
const decode = (value: string) => decodePngDataUrl(value, Number.MAX_SAFE_INTEGER);
const isPng = (value: string) => isPngDataUrl(value, Number.MAX_SAFE_INTEGER);
const base64Decodes = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((call) => call[1] === 'base64');

describe('PNG data URL decoding', () => {
  it('decodes canonical base64 exactly', () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 1]);
    expect(decode(url(bytes.toString('base64')))?.equals(bytes)).toBe(true);
    expect(isPng(url(bytes.toString('base64')))).toBe(true);
  });

  it('rejects a missing or different prefix', () => {
    for (const value of [
      'iVBORw0KGgo=',
      'data:image/jpeg;base64,iVBORw0KGgo=',
      'DATA:image/png;base64,iVBORw0KGgo=',
      'data:image/png;charset=utf-8;base64,iVBORw0KGgo=',
      ' data:image/png;base64,iVBORw0KGgo=',
      'data:image/png,iVBORw0KGgo=',
    ])
      expect(decode(value), value).toBeUndefined();
    expect(decode(undefined as unknown as string)).toBeUndefined();
    expect(isPng('data:image/jpeg;base64,AAAA')).toBe(false);
  });

  it('rejects empty payloads, whitespace, URL-safe characters, and misplaced padding', () => {
    for (const payload of [
      '',
      '=',
      '==',
      'AAAA===',
      'AA=A',
      'AA==AAAA',
      'AA==B',
      '=AAA',
      'AAAA AAAA',
      'AAAA\nAAAA',
      'AAAA\r\nAAAA',
      ' AAAA',
      'AAAA ',
      'AAAA\t',
      'AA-_',
      'AAAA%3D',
      'AAAA*',
      'AAAÀ',
    ]) {
      expect(decode(url(payload)), JSON.stringify(payload)).toBeUndefined();
      expectLegacyEquivalent(url(payload));
    }
  });

  it('keeps accepting the unpadded and non-canonical forms the pattern allowed', () => {
    for (const payload of [
      'A',
      'AA',
      'AAA',
      'AAAAA',
      'AB',
      'AB=',
      'AB==',
      'ABC=',
      'AAAA=',
      'AAA==',
      'AP//',
      '+/+/',
    ])
      expectLegacyEquivalent(url(payload));
    expect(decode(url('AB'))?.equals(Buffer.from([0]))).toBe(true);
    expect(decode(url('AB=='))?.equals(Buffer.from([0]))).toBe(true);
  });

  it('matches the legacy pattern on generated inputs', () => {
    const alphabet = 'ABCZabcz0189+/=-_ \n.%À';
    let seed = 0x2545f491;
    const next = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    for (let round = 0; round < 20_000; round++) {
      const length = next() % 14;
      let payload = '';
      for (let index = 0; index < length; index++) payload += alphabet[next() % alphabet.length];
      expectLegacyEquivalent(url(payload));
    }
    for (let round = 0; round < 200; round++) {
      const bytes = Buffer.alloc(next() % 64);
      for (let index = 0; index < bytes.length; index++) bytes[index] = next() & 0xff;
      const encoded = bytes.toString('base64');
      expectLegacyEquivalent(url(encoded));
      expectLegacyEquivalent(url(encoded.replace(/=+$/, '')));
      const position = next() % (encoded.length + 1);
      expectLegacyEquivalent(url(`${encoded.slice(0, position)} ${encoded.slice(position)}`));
    }
  });

  it('rejects an over-limit string before decoding anything', () => {
    const limit = url('AAAA').length;
    const spy = vi.spyOn(Buffer, 'from');
    try {
      expect(decodePngDataUrl(url('AAAAAAAA'), limit)).toBeUndefined();
      expect(isPngDataUrl(url('AAAAA'), limit)).toBe(false);
      expect(decodePngDataUrl(url('A'.repeat(1_000_000)), 1_000)).toBeUndefined();
      // Wrong prefixes, misplaced padding, and a bad partial final group also skip decoding.
      for (const value of [
        url(''),
        url('AA=A'),
        url('AAAA==='),
        url('AAAA A'),
        'data:image/jpeg;base64,AAAA',
      ])
        expect(decode(value), value).toBeUndefined();
      expect(base64Decodes(spy)).toEqual([]);
      expect(decodePngDataUrl(url('AAAA'), limit)?.equals(Buffer.alloc(3))).toBe(true);
      expect(base64Decodes(spy)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('sizes limits for the canonical encoding of a byte count', () => {
    for (const bytes of [1, 2, 3, 4, 100])
      expect(maxPngDataUrlLength(bytes)).toBe(url(Buffer.alloc(bytes).toString('base64')).length);
  });

  it('compares multi-megabyte payloads in chunks without missing a defect in any chunk', () => {
    const bytes = Buffer.alloc(10 * 1024 * 1024 + 2);
    for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 2_654_435_761) >>> 24;
    const encoded = bytes.toString('base64');
    expect(decode(url(encoded))?.equals(bytes)).toBe(true);
    // Same-length substitutions Node would decode as URL-safe digits, in the first, a middle,
    // and the last complete chunk, and at a chunk boundary (3 MiB of bytes is 4 Mi characters).
    for (const position of [0, 4 * 1024 * 1024 - 1, 4 * 1024 * 1024, 9_000_000, encoded.length - 5]) {
      const corrupted = `${encoded.slice(0, position)}-${encoded.slice(position + 1)}`;
      expect(decode(url(corrupted)), String(position)).toBeUndefined();
    }
    expect(decode(url(`${encoded.slice(0, 9_000_000)} ${encoded.slice(9_000_001)}`))).toBeUndefined();
  });
});
